// Oracle host core, compiled by common.ps1 with Add-Type against one engine's
// IOM.dll and Libs.dll. Windows PowerShell 5.1 compiles C# 5, so this file
// avoids newer syntax. ENGINE_12 is defined for 12.0, which has no language
// packs and needs the host-side login step (ticket 03).
//
// Design (ticket 03): the recorder subclasses IOM's HttpServerConnection and
// overrides CallAction, so Libs' own `is HttpServerConnection` casts (Login,
// Timeout) behave exactly as with Aras's tools.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Xml;
using Aras.IOM;
using Aras.Tools.SolutionUpgrade;

namespace LibsJsOracle
{
    public static class Json
    {
        public static string Str(string s)
        {
            if (s == null) return "null";
            var b = new StringBuilder(s.Length + 16);
            b.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': b.Append("\\\""); break;
                    case '\\': b.Append("\\\\"); break;
                    case '\n': b.Append("\\n"); break;
                    case '\r': b.Append("\\r"); break;
                    case '\t': b.Append("\\t"); break;
                    default:
                        // Control characters and every surrogate are escaped, so a lone
                        // surrogate survives the UTF-8 file and JSON.parse restores it.
                        if (c < 0x20 || (c >= 0xD800 && c <= 0xDFFF))
                            b.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else
                            b.Append(c);
                        break;
                }
            }
            b.Append('"');
            return b.ToString();
        }

        public static string Num(long n) { return n.ToString(CultureInfo.InvariantCulture); }

        public static string Bool(bool? v) { return v.HasValue ? (v.Value ? "true" : "false") : "null"; }
    }

    /// <summary>
    /// Thread-safe event log. Calls and messages share one event counter, so
    /// their interleaving is recoverable; 14.35 enters CallAction from
    /// Parallel.ForEach, so every write happens under one lock.
    /// </summary>
    public static class Rec
    {
        private static readonly object Gate = new object();
        private static StreamWriter _calls;
        private static StreamWriter _messages;
        private static long _event;
        private static long _callSeq;
        private static long _callStart;
        private static long _messageSeq;
        private static volatile bool _recording;
        private static readonly List<string[]> _created = new List<string[]>();
        [ThreadStatic] private static int _depth;

        public static long Calls { get { lock (Gate) { return _callSeq; } } }
        public static long Messages { get { lock (Gate) { return _messageSeq; } } }
        public static bool Recording { get { return _recording; } }

        /// <summary>Type and id of every item a recorded call created, in completion order.</summary>
        public static IList<string[]> Created { get { lock (Gate) { return _created.ToArray(); } } }

        public static void Open(string callsPath, string messagesPath)
        {
            var utf8 = new UTF8Encoding(false);
            _calls = new StreamWriter(callsPath, false, utf8);
            _messages = new StreamWriter(messagesPath, false, utf8);
            _calls.NewLine = "\n";
            _messages.NewLine = "\n";
            _recording = true;
        }

        /// <summary>Ends the recording; later calls (the cleanup) pass straight through.</summary>
        public static void Stop()
        {
            lock (Gate) { _recording = false; }
        }

        public static void Close()
        {
            lock (Gate)
            {
                if (_calls != null) { _calls.Dispose(); _calls = null; }
                if (_messages != null) { _messages.Dispose(); _messages = null; }
            }
        }

        public static long BeginCall()
        {
            lock (Gate) { return ++_callStart; }
        }

        public static int EnterDepth() { return _depth++; }

        public static void LeaveDepth() { _depth--; }

        /// <summary>
        /// One line per completed call. `seq` is completion order; a relogin that
        /// IOM runs inside a call completes, and is numbered, before its parent.
        /// </summary>
        public static void EndCall(long start, int depth, string action, string request, string response,
                                   string error, long startTicks, long endTicks)
        {
            List<string[]> created = error == null ? CreatedItems.From(request, response) : null;
            lock (Gate)
            {
                _callSeq++;
                _event++;
                var line = new StringBuilder();
                line.Append("{\"event\":").Append(Json.Num(_event));
                line.Append(",\"seq\":").Append(Json.Num(_callSeq));
                line.Append(",\"start\":").Append(Json.Num(start));
                line.Append(",\"depth\":").Append(Json.Num(depth));
                line.Append(",\"thread\":").Append(Json.Num(Thread.CurrentThread.ManagedThreadId));
                line.Append(",\"startTicks\":").Append(Json.Num(startTicks));
                line.Append(",\"endTicks\":").Append(Json.Num(endTicks));
                line.Append(",\"action\":").Append(Json.Str(action));
                line.Append(",\"request\":").Append(Json.Str(request));
                line.Append(",\"response\":").Append(Json.Str(response));
                if (error != null) line.Append(",\"error\":").Append(Json.Str(error));
                line.Append('}');
                _calls.WriteLine(line.ToString());
                _calls.Flush();
                if (created != null) _created.AddRange(created);
            }
        }

        public static void Message(string channel, string text, bool? answer)
        {
            lock (Gate)
            {
                _messageSeq++;
                _event++;
                var line = new StringBuilder();
                line.Append("{\"event\":").Append(Json.Num(_event));
                line.Append(",\"seq\":").Append(Json.Num(_messageSeq));
                line.Append(",\"thread\":").Append(Json.Num(Thread.CurrentThread.ManagedThreadId));
                line.Append(",\"ticks\":").Append(Json.Num(Stopwatch.GetTimestamp()));
                line.Append(",\"channel\":").Append(Json.Str(channel));
                line.Append(",\"text\":").Append(Json.Str(text));
                line.Append(",\"answer\":").Append(Json.Bool(answer));
                line.Append('}');
                _messages.WriteLine(line.ToString());
                _messages.Flush();
            }
        }
    }

    /// <summary>
    /// The items one call created: each top-level request Item with
    /// action="add", unless the response is a fault. An add without an id (the
    /// engine's PackageDefinition, PackageGroup, PackageElement and
    /// DatabaseUpgrade rows) takes the id of the response's Result item of
    /// that type.
    /// </summary>
    public static class CreatedItems
    {
        private const string Body = "/*[local-name()='Envelope']/*[local-name()='Body']";

        public static List<string[]> From(string request, string response)
        {
            var created = new List<string[]>();
            if (request == null || response == null) return created;
            var req = new XmlDocument();
            var res = new XmlDocument();
            var adds = new List<XmlElement>();
            try
            {
                req.LoadXml(request);
                XmlNodeList items = req.DocumentElement.Name == "Item" ? req.SelectNodes("/Item") : req.DocumentElement.SelectNodes("Item");
                foreach (XmlElement item in items)
                {
                    if (item.GetAttribute("action") == "add") adds.Add(item);
                }
                if (adds.Count == 0) return created;
                res.LoadXml(response);
            }
            catch (XmlException)
            {
                return created;
            }
            if (res.SelectSingleNode(Body + "/*[local-name()='Fault']") != null) return created;
            var results = new List<XmlElement>();
            foreach (XmlElement result in res.SelectNodes(Body + "/*[local-name()='Result']/Item")) results.Add(result);
            foreach (XmlElement item in adds)
            {
                string type = item.GetAttribute("type");
                string id = item.GetAttribute("id");
                if (id.Length == 0)
                {
                    XmlElement result = results.Find(x => x.GetAttribute("type") == type);
                    if (result != null)
                    {
                        id = result.GetAttribute("id");
                        results.Remove(result);
                    }
                }
                created.Add(new[] { type, id });
            }
            return created;
        }
    }

    public class RecordingHttpServerConnection : HttpServerConnection
    {
        // "en-US" and a null time zone are what Libs' own HttpConnectorExtension passes.
        public RecordingHttpServerConnection(string url, string db, string user, string password)
            : base(url, db, user, password, "en-US", null)
        {
        }

        public override void CallAction(string actionName, XmlDocument inDom, XmlDocument outDom)
        {
            if (!Rec.Recording)
            {
                base.CallAction(actionName, inDom, outDom);
                return;
            }
            long start = Rec.BeginCall();
            int depth = Rec.EnterDepth();
            long t0 = Stopwatch.GetTimestamp();
            // Captured before the call: IOM may change inDom while sending it.
            string request = inDom == null ? null : inDom.OuterXml;
            try
            {
                base.CallAction(actionName, inDom, outDom);
                Rec.EndCall(start, depth, actionName, request, outDom == null ? null : outDom.OuterXml, null,
                            t0, Stopwatch.GetTimestamp());
            }
            catch (Exception e)
            {
                Rec.EndCall(start, depth, actionName, request, outDom == null ? null : outDom.OuterXml,
                            e.GetType().FullName + ": " + e.Message, t0, Stopwatch.GetTimestamp());
                throw;
            }
            finally
            {
                Rec.LeaveDepth();
            }
        }
    }

    public class RecordedMessage : Message
    {
        private readonly string _channel;
        private readonly bool? _answer;

        public RecordedMessage(string channel, bool? answer)
        {
            _channel = channel;
            _answer = answer;
        }

        public override bool? Execute()
        {
            Rec.Message(_channel, Text, _answer);
            return _answer;
        }
    }

    /// <summary>
    /// Channel names follow IMessagesFactory. Only the error question's answer
    /// is read by Libs (`== true` continues past an import error); the others
    /// return null like Aras's ConsoleUpgrade.
    /// </summary>
    public class RecordedMessages : IMessagesFactory
    {
        private readonly bool? _questionAnswer;

        public RecordedMessages(bool? questionAnswer) { _questionAnswer = questionAnswer; }

        public Message GetErrorMessage() { return new RecordedMessage("error", null); }
        public Message GetErrorMessageQuestion() { return new RecordedMessage("errorQuestion", _questionAnswer); }
        public Message GetWarningMessage() { return new RecordedMessage("warning", null); }
        public Message GetStatusMessage() { return new RecordedMessage("status", null); }
        public Message GetCurrentPackageMessage() { return new RecordedMessage("currentPackage", null); }
    }

    public class HostRequest
    {
        public string Command;          // export | import | lpimport
        public string Url;
        public string Database;
        public string User;
        public string Password;
        public int Timeout;
        public bool? ErrorQuestionAnswer;
        public string OutDir;
        public string WorkDir;          // export: output folder; import: the package folder
        public string ManifestFile;     // import: the manifest's full path
        public string[] Items;          // export: "package\ttype\tid\tkeyed name"
        public string[] Packages;       // import: null means every package in the manifest
        public Hashtable Context;       // SolutionUpgradeContext property -> string value
        public Hashtable Export;        // SUExportContext property -> string value
        public Hashtable Import;        // SUImportContext property -> string value
    }

    /// <summary>
    /// Live imports touch only LIBSJS-SCRATCH-* packages and items (AGENTS.md).
    /// Checked on what ImportSolutions is about to get: every package name and,
    /// per package, the item files LoadPackageDom reads, whose file name is the
    /// keyed name the engine records; for a language pack, the keyed_name of
    /// every item in its xml folder. An empty package set is refused too.
    /// </summary>
    public static class Scratch
    {
        public const string Prefix = "LIBSJS-SCRATCH-";

        public static bool Is(string name)
        {
            return name != null && name.StartsWith(Prefix, StringComparison.Ordinal);
        }

        public static void AssertImport(ICollection packages, ImportExportManager manager, string lpPath)
        {
            if (packages.Count == 0) throw new InvalidOperationException("refusing to import: no packages to import");
            var bad = new List<string>();
            foreach (object p in packages)
            {
                string name = p as string;
                if (!Is(name)) bad.Add("package '" + name + "'");
                else if (lpPath == null) CheckPackageFiles(name, manager, bad);
            }
            if (lpPath != null) CheckLanguagePack(lpPath, bad);
            if (bad.Count == 0) return;
            string shown = string.Join(", ", bad.GetRange(0, Math.Min(10, bad.Count)).ToArray());
            if (bad.Count > 10) shown += " and " + (bad.Count - 10).ToString(CultureInfo.InvariantCulture) + " more";
            throw new InvalidOperationException("refusing to import non-scratch " + shown);
        }

        private static void CheckPackageFiles(string package, ImportExportManager manager, List<string> bad)
        {
            string path;
            try
            {
                path = ImportExportManager.GetSolutionPath(package, manager.ManifestFileDirectoryPath, manager.ManifestFile);
            }
            catch (Exception)
            {
                return; // not in the manifest: the engine fails on it before reading a file
            }
            if (!Directory.Exists(path)) return;
            foreach (string dir in Directory.GetDirectories(path))
            {
                foreach (string file in Directory.GetFiles(dir, "*.xml"))
                {
                    XmlDocument doc = Load(file);
                    if (doc == null || doc.SelectSingleNode("AML/Item") == null) continue;
                    if (!Is(Path.GetFileNameWithoutExtension(file))) bad.Add("item file '" + file + "'");
                    foreach (XmlNode name in doc.SelectNodes("AML/Item/name"))
                    {
                        if (!Is(name.InnerText)) bad.Add("item '" + name.InnerText + "' in " + file);
                    }
                }
            }
        }

        private static void CheckLanguagePack(string lpPath, List<string> bad)
        {
            string dir = Path.Combine(Path.GetDirectoryName(lpPath), "xml");
            if (!Directory.Exists(dir)) return;
            foreach (string file in Directory.GetFiles(dir, "*.xml"))
            {
                XmlDocument doc = Load(file);
                if (doc == null) continue;
                foreach (XmlElement item in doc.SelectNodes("export/Item"))
                {
                    string keyedName = item.GetAttribute("keyed_name");
                    if (!Is(keyedName)) bad.Add("language pack item '" + keyedName + "' in " + file);
                }
            }
        }

        /// <summary>Null for a file that is not XML; the engine fails on it before importing that package.</summary>
        private static XmlDocument Load(string file)
        {
            var doc = new XmlDocument();
            try
            {
                doc.Load(file);
                return doc;
            }
            catch (XmlException)
            {
                return null;
            }
        }
    }

    /// <summary>
    /// Deletes what an import created, newest first, through the same
    /// connection once recording has stopped, so none of it reaches the
    /// transcript. An item is deleted only when it belongs to a
    /// LIBSJS-SCRATCH-* name: a relationship (PackageGroup, PackageElement, ...)
    /// by its source's, any other item by its name or keyed name.
    /// </summary>
    public static class Cleanup
    {
        public static string Run(Innovator inn, IList<string[]> created)
        {
            var all = new List<string>();
            var deleted = new List<string>();
            var kept = new List<string>();
            foreach (string[] c in created) all.Add(Entry(c[0], c[1], null));
            for (int i = created.Count - 1; i >= 0; i--)
            {
                string type = created[i][0];
                string id = created[i][1];
                string reason = null;
                try
                {
                    if (id.Length == 0)
                    {
                        reason = "the server returned no id";
                    }
                    else
                    {
                        string owner = Owner(inn, type, id, 0);
                        if (owner == null) continue; // already gone, with its source
                        if (!Scratch.Is(owner))
                        {
                            reason = "belongs to '" + owner + "', not " + Scratch.Prefix + "*";
                        }
                        else
                        {
                            Item delete = inn.newItem(type, "delete");
                            delete.setID(id);
                            Item result = delete.apply();
                            if (result.isError()) reason = "delete failed: " + result.getErrorString();
                        }
                    }
                }
                catch (Exception e)
                {
                    reason = "cleanup failed: " + e.Message;
                }
                if (reason == null) deleted.Add(Entry(type, id, null));
                else kept.Add(Entry(type, id, reason));
            }
            return "{\"created\":[" + string.Join(",", all.ToArray()) + "],\"deleted\":[" + string.Join(",", deleted.ToArray()) +
                   "],\"kept\":[" + string.Join(",", kept.ToArray()) + "]}";
        }

        /// <summary>
        /// The name an item belongs to, or null when it no longer exists: a
        /// relationship's source's, otherwise its own name or keyed name.
        /// </summary>
        private static string Owner(Innovator inn, string type, string id, int depth)
        {
            Item get = inn.newItem(type, "get");
            get.setID(id);
            Item item = get.apply();
            if (item.isError())
            {
                if (item.getErrorCode() == "0") return null;
                throw new InvalidOperationException(item.getErrorString());
            }
            string sourceId = item.getProperty("source_id", "");
            if (sourceId.Length == 0)
            {
                string name = item.getProperty("name", "");
                return name.Length > 0 ? name : item.getProperty("keyed_name", "");
            }
            string sourceType = item.getPropertyAttribute("source_id", "type", "");
            if (sourceType.Length == 0 || depth >= 3)
                throw new InvalidOperationException("cannot resolve the source of " + type + " " + id);
            string source = Owner(inn, sourceType, sourceId, depth + 1);
            if (source == null) throw new InvalidOperationException("source " + sourceType + " " + sourceId + " not found");
            return source;
        }

        private static string Entry(string type, string id, string reason)
        {
            string entry = "{\"type\":" + Json.Str(type) + ",\"id\":" + Json.Str(id);
            if (reason != null) entry += ",\"reason\":" + Json.Str(reason);
            return entry + "}";
        }
    }

    public static class Host
    {
        public static int Run(HostRequest r)
        {
            var info = new StringBuilder();
            info.Append("{\"stopwatchFrequency\":").Append(Json.Num(Stopwatch.Frequency));
            info.Append(",\"clr\":").Append(Json.Str(Environment.Version.ToString()));
            int code = 0;
            string error = null;
            string innovatorVersion = null;
            string result = null;
            int timeoutAfter = 0;
            string cleanup = null;
            Rec.Open(Path.Combine(r.OutDir, "transcript.jsonl"), Path.Combine(r.OutDir, "messages.jsonl"));
            RecordingHttpServerConnection conn = null;
            CItemHelper ci = null;
            try
            {
                conn = new RecordingHttpServerConnection(r.Url, r.Database, r.User, r.Password);
#if ENGINE_12
                // 12.0's CItemHelper.Login() skips any connection that is not exactly
                // HttpConnectorExtension, so the host logs in first, as Aras's 12.0 tool does.
                Item login = conn.Login();
                if (login.isError()) throw new InvalidOperationException("host login failed: " + login.getErrorString());
#endif
                ci = new CItemHelper(conn);
                ci.Login();
                innovatorVersion = Describe(ci.InnovatorVersion);

                var context = new SolutionUpgradeContext();
                context.Url = r.Url;
                context.DataBase = r.Database;
                context.UserName = r.User;
                context.Password = "";
                context.Timeout = r.Timeout;
                context.LogFilePath = Path.Combine(r.OutDir, "engine.log");
                context.WorkingDirectory = r.WorkDir;
                Apply(context, r.Context, "Context");
                var messages = new RecordedMessages(r.ErrorQuestionAnswer);

                if (r.Command == "export")
                {
                    if (!Has(r.Context, "Action")) context.Action = ImportExport.Export;
                    var exportContext = new SUExportContext();
                    exportContext.sLevel = "1";
                    exportContext.RefToUnknownPacks = ReferencesToUnknownPackages.DoNotRemove;
                    Apply(exportContext, r.Export, "Export");
                    var manager = new ImportExportManager(context, messages, ci);
                    manager.ExportSolutions(exportContext, Selection(r.Items));
                    result = "exported";
                }
                else if (r.Command == "import" || r.Command == "lpimport")
                {
                    var importContext = new SUImportContext();
                    Apply(importContext, r.Import, "Import");
                    IDisposable preprocessor = null;
                    string lpPath = null;
                    try
                    {
                        if (r.Command == "lpimport")
                        {
#if ENGINE_12
                            throw new NotSupportedException("engine 12.0 has no language-pack import");
#else
                            // The sequence Aras's ConsoleUpgrade runs for `lpimport`.
                            context.Action = ImportExport.LPImport;
                            var lp = new LanguagePackPreprocessor(new IOWrapper(), ci, new ManifestFile(),
                                                                  context.LPPath, context.LPPackage, context.LPDebug);
                            preprocessor = lp;
                            lpPath = context.LPPath;
                            context.Action = ImportExport.Import;
                            context.ManifestFile = lp.TempManifestFilePath;
#endif
                        }
                        else
                        {
                            context.Action = ImportExport.Import;
                            context.ManifestFile = r.ManifestFile;
                        }
                        var manager = new ImportExportManager(context, messages, ci);
                        ICollection packages = r.Packages == null
                            ? manager.ManifestFile.GetAllPackageNames()
                            : (ICollection)new ArrayList(r.Packages);
                        Scratch.AssertImport(packages, manager, lpPath);
                        int rc = manager.ImportSolutions(packages, importContext);
                        result = "ImportSolutions returned " + rc.ToString(CultureInfo.InvariantCulture);
                    }
                    finally
                    {
                        if (preprocessor != null) preprocessor.Dispose();
                    }
                }
                else
                {
                    throw new ArgumentException("unknown command " + r.Command);
                }
                timeoutAfter = conn.Timeout;
            }
            catch (Exception e)
            {
                code = 2;
                error = e.ToString();
            }
            finally
            {
                if (ci != null)
                {
                    try { ci.logout(); }
                    catch (Exception e) { if (error == null) error = "logout: " + e; }
                }
                Rec.Stop();
                if (conn != null && r.Command != "export")
                {
                    try { cleanup = Cleanup.Run(IomFactory.CreateInnovator(conn), Rec.Created); }
                    catch (Exception e) { if (error == null) error = "cleanup: " + e; }
                }
                info.Append(",\"calls\":").Append(Json.Num(Rec.Calls));
                info.Append(",\"messages\":").Append(Json.Num(Rec.Messages));
                Rec.Close();
            }
            info.Append(",\"innovatorVersion\":").Append(Json.Str(innovatorVersion));
            info.Append(",\"timeoutAfterRun\":").Append(Json.Num(timeoutAfter));
            info.Append(",\"result\":").Append(Json.Str(result));
            info.Append(",\"error\":").Append(Json.Str(error));
            if (cleanup != null) info.Append(",\"cleanup\":").Append(cleanup);
            info.Append('}');
            File.WriteAllText(Path.Combine(r.OutDir, "host.json"), info.ToString(), new UTF8Encoding(false));
            return code;
        }

        /// <summary>"Major=12 Minor=0 ServicePack=9 ..." from the public properties ArasVersion has on this engine.</summary>
        private static string Describe(object version)
        {
            if (version == null) return null;
            var parts = new List<string>();
            foreach (PropertyInfo p in version.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (p.PropertyType == typeof(int)) parts.Add(p.Name + "=" + ((int)p.GetValue(version, null)).ToString(CultureInfo.InvariantCulture));
            }
            return string.Join(" ", parts.ToArray());
        }

        private static bool Has(Hashtable t, string key) { return t != null && t.ContainsKey(key); }

        private static Hashtable Selection(string[] items)
        {
            var table = new Hashtable();
            foreach (string spec in items ?? new string[0])
            {
                string[] p = spec.Split('\t');
                if (p.Length != 4) throw new ArgumentException("bad item spec: " + spec);
                var inner = table[p[0]] as Hashtable;
                if (inner == null) { inner = new Hashtable(); table[p[0]] = inner; }
                inner[p[2]] = new ExportItem(p[3], p[2], p[1]);
            }
            return table;
        }

        /// <summary>
        /// Sets public properties by name from string values. An option the
        /// engine does not have is an error, so a per-engine host cannot pass
        /// an option silently ignored by that build.
        /// </summary>
        private static void Apply(object target, Hashtable values, string label)
        {
            if (values == null) return;
            Type type = target.GetType();
            foreach (DictionaryEntry e in values)
            {
                string name = (string)e.Key;
                PropertyInfo p = type.GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
                if (p == null || !p.CanWrite)
                    throw new ArgumentException(label + "." + name + " is not a settable option of this engine");
                p.SetValue(target, Convert(e.Value, p.PropertyType, label + "." + name), null);
            }
        }

        private static object Convert(object value, Type t, string label)
        {
            if (value == null) return null;
            if (t.IsInstanceOfType(value)) return value;
            string s = value.ToString();
            if (t == typeof(string)) return s;
            if (t == typeof(bool)) return bool.Parse(s);
            if (t == typeof(int)) return int.Parse(s, CultureInfo.InvariantCulture);
            if (t.IsEnum) return Enum.Parse(t, s, false);
            if (t == typeof(string[])) return s.Length == 0 ? new string[0] : s.Split(',');
            throw new ArgumentException(label + ": unsupported option type " + t.FullName);
        }
    }
}
