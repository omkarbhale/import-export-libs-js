using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Xml;

namespace Probe
{
    // Adds the language-export lookups to the export probe's ScriptedConnection, still without a
    // network: the Language get, the ml_string Property lookup, the two tree lookups, and a main
    // fetch body per type for the types ScriptedConnection does not answer (ItemType). Every other
    // request is passed on to ScriptedConnection, which answers it as it does for its own probe.
    public class LangConnection : ScriptedConnection
    {
        // Codes the Language get answers (in this order), as the code property. null answers faultcode 0.
        public List<string> LanguageCodes;
        // When set, the Language get answers this fault code instead.
        public string LanguageFaultCode;
        // Extra inner XML for the Language items (replaces the generated one when set).
        public string LanguageXml;
        // type name -> names of its ml_string properties, as the lookup answers them.
        public Dictionary<string, string[]> Ml = new Dictionary<string, string[]>();
        // "rows": a type without ml_string properties answers faultcode 0 (what the server does);
        // "item": it answers an ItemType with no Relationships; "fault1": it answers faultcode 1.
        public string MlNoRows = "rows";
        // The ml_string lookup answers this fault code for every type when set.
        public string MlFaultCode;
        // relationship types of a type (the RelationshipType lookup) and the data_source of its related_id.
        public Dictionary<string, string[]> Rels = new Dictionary<string, string[]>();
        public Dictionary<string, string> Related = new Dictionary<string, string>();
        // full main fetch Item XML (the Result's inner XML) by item id, for types ScriptedConnection does not answer.
        public Dictionary<string, string> MainById = new Dictionary<string, string>();
        public ConcurrentQueue<string> Seen = new ConcurrentQueue<string>();

        static string Attr(XmlElement e, string n) { return e.HasAttribute(n) ? e.GetAttribute(n) : null; }

        public override void CallAction(string actionName, XmlDocument inDom, XmlDocument outDom)
        {
            string req = inDom.OuterXml;
            Seen.Enqueue(req);
            string resp = Mine(req);
            if (resp == null) { base.CallAction(actionName, inDom, outDom); return; }
            outDom.LoadXml(resp);
        }

        string Mine(string req)
        {
            var d = new XmlDocument(); d.LoadXml(req);
            var root = d.DocumentElement;
            string type = Attr(root, "type"), action = Attr(root, "action");
            if (type == "Language" && action == "get")
            {
                if (LanguageFaultCode != null) return Fault(LanguageFaultCode, "scripted Language fault");
                if (LanguageXml != null) return Result(LanguageXml);
                if (LanguageCodes == null) return Fault("0", "No items of type Language found.");
                var sb = new System.Text.StringBuilder();
                foreach (var c in LanguageCodes) sb.Append("<Item type=\"Language\" id=\"LG-" + c + "\"><code>" + c + "</code><name>Lang " + c + "</name></Item>");
                return Result(sb.ToString());
            }
            var nameNode = root.SelectSingleNode("name");
            if (type == "ItemType" && action == "get")
            {
                var ml = root.SelectSingleNode("Relationships/Item[@type='Property']/data_type");
                var rid = root.SelectSingleNode("Relationships/Item[@type='Property']/name");
                string n = nameNode == null ? null : nameNode.InnerText;
                if (ml != null && ml.InnerText == "ml_string" && n != null)
                {
                    if (MlFaultCode != null) return Fault(MlFaultCode, "scripted ml lookup fault");
                    string[] names;
                    if (Ml.TryGetValue(n, out names) && names.Length > 0)
                    {
                        var sb = new System.Text.StringBuilder();
                        foreach (var p in names) sb.Append("<Item type=\"Property\" id=\"PR-" + n + "-" + p + "\"><name>" + p + "</name></Item>");
                        return Result("<Item type=\"ItemType\" id=\"IT-" + n + "\"><Relationships>" + sb + "</Relationships></Item>");
                    }
                    if (MlNoRows == "item") return Result("<Item type=\"ItemType\" id=\"IT-" + n + "\"></Item>");
                    if (MlNoRows == "fault1") return Fault("1", "scripted failure");
                    return Fault("0", "No items of type ItemType found.");
                }
                if (rid != null && rid.InnerText == "related_id" && n != null)
                {
                    string ds;
                    if (!Related.TryGetValue(n, out ds)) return Fault("0", "No items of type ItemType found.");
                    string dsXml = ds == "" ? "<data_source />" : "<data_source keyed_name=\"" + ds + "\" type=\"ItemType\" name=\"" + ds + "\">DS-" + ds + "</data_source>";
                    return Result("<Item type=\"ItemType\" id=\"IT-" + n + "\"><Relationships><Item type=\"Property\" id=\"P-" + n + "\">" + dsXml + "</Item></Relationships></Item>");
                }
                var idn = root.SelectSingleNode("id");
                string body;
                if (idn != null && MainById.TryGetValue(idn.InnerText, out body)) return Result(body);
            }
            if (type == "RelationshipType" && action == "get")
            {
                var n2 = root.SelectSingleNode("source_id/Item/name");
                string[] rs;
                if (n2 != null && Rels.TryGetValue(n2.InnerText, out rs) && rs.Length > 0)
                {
                    var sb = new System.Text.StringBuilder();
                    foreach (var r in rs) sb.Append("<Item type=\"RelationshipType\" id=\"RT-" + r + "\"><name>" + r + "</name></Item>");
                    return Result(sb.ToString());
                }
                return Fault("0", "No items of type RelationshipType found.");
            }
            var id2 = root.SelectSingleNode("id");
            string body2;
            if (action == "get" && id2 != null && MainById.TryGetValue(id2.InnerText, out body2)) return Result(body2);
            return null;
        }
    }
}
