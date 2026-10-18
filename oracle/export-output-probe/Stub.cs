using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Threading;
using System.Xml;
using Aras.IOM;
using Aras.Tools.SolutionUpgrade;

namespace Probe
{
    // A connection that never touches the network. It answers the requests an export makes
    // from a small script, so the real engine can run ExportSolutions offline and in
    // parallel. Thread-safe: 14.35 calls it from Parallel.ForEach worker threads.
    public class ScriptedConnection : HttpServerConnection
    {
        const string Head = "<SOAP-ENV:Envelope xmlns:SOAP-ENV=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:i18n=\"http://www.aras.com/I18N\"><SOAP-ENV:Body>";
        const string Tail = "</SOAP-ENV:Body></SOAP-ENV:Envelope>";

        public static string Result(string inner) { return Head + "<Result>" + inner + "</Result>" + Tail; }
        public static string Fault(string code, string text)
        {
            return Head + "<SOAP-ENV:Fault xmlns:af=\"http://www.aras.com/InnovatorFault\"><faultcode>" + code + "</faultcode><faultstring><![CDATA[" + text + "]]></faultstring><detail><af:legacy_detail><![CDATA[" + text + "]]></af:legacy_detail></detail></SOAP-ENV:Fault>" + Tail;
        }

        // ---- script ----
        // Inner XML of the Result for the getSolutions request; null answers "no items" (faultcode 0).
        public string SolutionsXml;
        // package name -> inner XML (PackageReferencedElement items) for the PackageDependsOn lookup.
        public Dictionary<string, string> ReferencedByPackage = new Dictionary<string, string>();
        // ids whose main fetch answers a server fault (faultcode 1) / throws a plain exception.
        public HashSet<string> FailIds = new HashSet<string>();
        public HashSet<string> ThrowIds = new HashSet<string>();
        // ids whose main fetch answers "no items" (faultcode 0).
        public HashSet<string> EmptyIds = new HashSet<string>();
        // extra inner XML written into the item answered for an id.
        public Dictionary<string, string> BodyById = new Dictionary<string, string>();
        public Dictionary<string, int> DelayById = new Dictionary<string, int>();
        public int DelayMs;
        // When > 0, a main fetch waits (up to GateTimeoutMs) until this many main fetches are in
        // flight at once, which proves that the engine runs them concurrently.
        public int Gate;
        public int GateTimeoutMs = 3000;
        public string ItemBody = "";
        // Inner XML (Item elements with a name) answering the polymorphic ItemType lookup; null answers "no items".
        public string PolyNamesXml;
        public int PolyDelayMs;
        // The default-permission lookup (ItemType with Allowed Permission) fails with faultcode 1 this many times, then succeeds.
        public int DefaultPermissionFailures;
        public string DefaultPermissionId = "PERM1";
        int permissionCalls;
        public bool Versionable;

        // ---- record ----
        public ConcurrentQueue<string> Calls = new ConcurrentQueue<string>();
        public ConcurrentQueue<string> Requests = new ConcurrentQueue<string>();
        public ConcurrentQueue<string> Responses = new ConcurrentQueue<string>();
        int inFlight; public int MaxInFlight; public int MainFetches;
        long seq;
        readonly Stopwatch clock = Stopwatch.StartNew();
        readonly object gateLock = new object();

        public ScriptedConnection() : base("http://stub/", "db", "u", "p", "en-US", null) { }

        static string Attr(XmlElement e, string n) { return e.HasAttribute(n) ? e.GetAttribute(n) : null; }

        public override void CallAction(string actionName, XmlDocument inDom, XmlDocument outDom)
        {
            string req = inDom.OuterXml;
            Requests.Enqueue(clock.ElapsedMilliseconds + "ms t" + Thread.CurrentThread.ManagedThreadId + " " + req);
            string resp = Answer(req);
            Responses.Enqueue(resp);
            outDom.LoadXml(resp);
        }

        string Answer(string req)
        {
            var d = new XmlDocument(); d.LoadXml(req);
            var root = d.DocumentElement;
            string type = Attr(root, "type"), action = Attr(root, "action");
            string select = Attr(root, "select");
            var idNode = root.SelectSingleNode("id");
            var nameNode = root.SelectSingleNode("name");

            if (type == "PackageDefinition" && select == "name,generation")
            {
                if (SolutionsXml == null) return Fault("0", "No items of type PackageDefinition found.");
                return Result(SolutionsXml);
            }
            if (type == "PackageDefinition" && select == "id,name,generation" && nameNode != null)
                return Result("<Item type=\"PackageDefinition\" id=\"PD-" + nameNode.InnerText + "\"><id>PD-" + nameNode.InnerText + "</id><name>" + nameNode.InnerText + "</name><generation>1</generation></Item>");
            if (type == "PackageDependsOn")
            {
                string n = nameNode == null ? "" : nameNode.InnerText;
                string inner;
                if (ReferencedByPackage.TryGetValue(n, out inner)) return Result("<Item type=\"PackageDependsOn\" id=\"PDO\"><Relationships>" + inner + "</Relationships></Item>");
                return Fault("0", "No items of type PackageDependsOn found.");
            }
            if (type == "ItemType" && select == "name" && root.SelectSingleNode("implementation_type") != null)
            {
                if (PolyDelayMs > 0) Thread.Sleep(PolyDelayMs);
                if (PolyNamesXml == null) return Fault("0", "No items of type ItemType found.");
                return Result(PolyNamesXml);
            }
            if (type == "ItemType" && select == "id, is_relationship, use_src_access")
            {
                int n = Interlocked.Increment(ref permissionCalls);
                if (n <= DefaultPermissionFailures) return Fault("1", "scripted permission lookup failure");
                return Result("<Item type=\"ItemType\" id=\"IT\"><is_relationship>0</is_relationship><use_src_access>0</use_src_access><Relationships><Item type=\"Allowed Permission\" id=\"AP\"><related_id><Item type=\"Permission\" id=\"" + DefaultPermissionId + "\"><id>" + DefaultPermissionId + "</id></Item></related_id></Item></Relationships></Item>");
            }
            if (type == "ItemType" && select == "is_versionable")
                return Result("<Item type=\"ItemType\" id=\"IT\"><is_versionable>" + (Versionable ? "1" : "0") + "</is_versionable></Item>");
            if (type == "ItemType" && root.SelectSingleNode("Relationships") != null && select == "id")
                return Fault("0", "No items of type ItemType found.");
            if (type == "RelationshipType" && select == "name")
                return Fault("0", "No items of type RelationshipType found.");

            if (idNode != null && action == "get" && type != "ItemType" && type != "PackageElement")
            {
                string id = idNode.InnerText;
                Interlocked.Increment(ref MainFetches);
                long t0 = clock.ElapsedTicks;
                int now = Interlocked.Increment(ref inFlight);
                lock (gateLock) { if (now > MaxInFlight) MaxInFlight = now; }
                try
                {
                    int delay = DelayMs; int dv;
                    if (DelayById.TryGetValue(id, out dv)) delay = dv;
                    if (Gate > 0)
                    {
                        var sw = Stopwatch.StartNew();
                        while (Volatile.Read(ref inFlight) < Gate && sw.ElapsedMilliseconds < GateTimeoutMs) Thread.Sleep(1);
                    }
                    if (delay > 0) Thread.Sleep(delay);
                    string answer;
                    if (ThrowIds.Contains(id)) throw new InvalidOperationException("scripted failure for " + id);
                    if (FailIds.Contains(id)) answer = Fault("1", "scripted failure for " + id);
                    else if (EmptyIds.Contains(id)) answer = Fault("0", "No items of type " + type + " found.");
                    else
                    {
                        string body; BodyById.TryGetValue(id, out body);
                        answer = Result("<Item type=\"" + type + "\" id=\"" + id + "\" keyed_name=\"k-" + id + "\"><id keyed_name=\"k-" + id + "\" type=\"" + type + "\">" + id + "</id><name>n-" + id + "</name>" + ItemBody + (body ?? "") + "</Item>");
                    }
                    Calls.Enqueue(string.Format("{0}|{1}|{2}|{3}|{4}", Interlocked.Increment(ref seq), Thread.CurrentThread.ManagedThreadId, t0, clock.ElapsedTicks, id));
                    return answer;
                }
                finally { Interlocked.Decrement(ref inFlight); }
            }
            return Fault("0", "No items of type " + type + " found.");
        }
    }

    public class ProbeMessage : Message
    {
        readonly ProbeMessages owner; readonly string channel;
        public ProbeMessage(ProbeMessages o, string c) { owner = o; channel = c; }
        public override bool? Execute() { return owner.Record(channel, Text); }
    }

    public class ProbeMessages : IMessagesFactory
    {
        public ConcurrentQueue<string> Log = new ConcurrentQueue<string>();
        public bool? QuestionAnswer = true;
        // Calls Manager.Cancel() once, when a status message contains this text.
        public string CancelWhenStatusContains;
        public ImportExportManager Manager;
        int cancelled;
        long seq;
        public bool? Record(string channel, string text)
        {
            Log.Enqueue(string.Format("{0}|{1}|{2}|{3}", Interlocked.Increment(ref seq), Thread.CurrentThread.ManagedThreadId, channel, text == null ? "<null>" : text.Replace("\r", "\\r").Replace("\n", "\\n")));
            if (CancelWhenStatusContains != null && channel == "status" && text != null && text.Contains(CancelWhenStatusContains) && Interlocked.Exchange(ref cancelled, 1) == 0) Manager.Cancel();
            return channel == "errorQuestion" ? QuestionAnswer : null;
        }
        public Message GetErrorMessage() { return new ProbeMessage(this, "error"); }
        public Message GetErrorMessageQuestion() { return new ProbeMessage(this, "errorQuestion"); }
        public Message GetWarningMessage() { return new ProbeMessage(this, "warning"); }
        public Message GetStatusMessage() { return new ProbeMessage(this, "status"); }
        public Message GetCurrentPackageMessage() { return new ProbeMessage(this, "currentPackage"); }
    }
}
