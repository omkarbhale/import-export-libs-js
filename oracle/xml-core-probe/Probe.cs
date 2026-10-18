// Records .NET Framework 4.8 System.Xml / System.Net / System.IO results for the XML core vectors.
// Compiled by Add-Type (C# 5): no interpolated strings, no ?. operators.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;
using System.Xml;
using System.Xml.Linq;
using System.Xml.XPath;

public static class XmlCoreProbe
{
    // ---- JSON output (ASCII only, so lone surrogates and control characters survive) ----
    static string Js(string s)
    {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        foreach (char c in s)
        {
            if (c == '"') b.Append("\\\"");
            else if (c == '\\') b.Append("\\\\");
            else if (c < 0x20 || c > 0x7E) b.Append("\\u" + ((int)c).ToString("x4"));
            else b.Append(c);
        }
        return b.Append('"').ToString();
    }

    static string Obj(params string[] kv)
    {
        StringBuilder b = new StringBuilder("{");
        for (int i = 0; i < kv.Length; i += 2)
        {
            if (i > 0) b.Append(",");
            b.Append(Js(kv[i])).Append(":").Append(kv[i + 1]);
        }
        return b.Append("}").ToString();
    }

    static string Err(Exception e)
    {
        return Obj("type", Js(e.GetType().Name), "message", Js(e.Message));
    }

    static string Str(Dictionary<string, object> c, string key)
    {
        object v;
        return c.TryGetValue(key, out v) ? (string)v : null;
    }

    static bool Flag(Dictionary<string, object> c, string key, bool dflt)
    {
        object v;
        return c.TryGetValue(key, out v) ? (bool)v : dflt;
    }

    // ---- DOM dump: a canonical text form of an XmlDocument's tree ----
    static void Dump(XmlNode n, StringBuilder b)
    {
        switch (n.NodeType)
        {
            case XmlNodeType.Document:
                foreach (XmlNode c in n.ChildNodes) Dump(c, b);
                break;
            case XmlNodeType.XmlDeclaration:
                XmlDeclaration d = (XmlDeclaration)n;
                b.Append("X(" + d.Version + "|" + d.Encoding + "|" + d.Standalone + ")");
                break;
            case XmlNodeType.DocumentType:
                XmlDocumentType t = (XmlDocumentType)n;
                b.Append("D(" + t.Name + "|" + t.PublicId + "|" + t.SystemId + "|" + t.InternalSubset + ")");
                break;
            case XmlNodeType.Element:
                XmlElement e = (XmlElement)n;
                b.Append("E(" + e.Name + "|" + e.NamespaceURI + "|" + (e.IsEmpty ? "1" : "0"));
                foreach (XmlAttribute a in e.Attributes) b.Append("|" + a.Name + "=" + a.NamespaceURI + "=" + a.Value);
                b.Append("){");
                foreach (XmlNode c in e.ChildNodes) Dump(c, b);
                b.Append("}");
                break;
            case XmlNodeType.Text:
            case XmlNodeType.Whitespace:
            case XmlNodeType.SignificantWhitespace: b.Append("T(" + n.Value + ")"); break;
            case XmlNodeType.CDATA: b.Append("C(" + n.Value + ")"); break;
            case XmlNodeType.Comment: b.Append("M(" + n.Value + ")"); break;
            case XmlNodeType.ProcessingInstruction: b.Append("P(" + n.Name + "|" + n.Value + ")"); break;
            case XmlNodeType.EntityReference: b.Append("R(" + n.Name + ")"); break;
            default: b.Append("?(" + n.NodeType + ")"); break;
        }
    }

    static string DumpOf(XmlDocument doc)
    {
        StringBuilder b = new StringBuilder();
        Dump(doc, b);
        return b.ToString();
    }

    static XmlDocument Load(string text, bool preserve)
    {
        XmlDocument doc = new XmlDocument();
        doc.PreserveWhitespace = preserve;
        doc.LoadXml(text);
        return doc;
    }

    // ---- case kinds ----
    static string KLoad(Dictionary<string, object> c)
    {
        bool preserve = Flag(c, "preserve", false);
        try
        {
            XmlDocument doc = Load(Str(c, "text"), preserve);
            string outer;
            try { outer = Js(doc.OuterXml); } catch (Exception e) { outer = Obj("error", Err(e)); }
            return Obj("dump", Js(DumpOf(doc)), "outer", outer);
        }
        catch (Exception e) { return Obj("error", Err(e)); }
    }

    static string KItemWrite(Dictionary<string, object> c)
    {
        bool preserve = Flag(c, "preserve", true);
        XmlDocument doc;
        try { doc = Load(Str(c, "text"), preserve); }
        catch (Exception e) { return Obj("loadError", Err(e)); }
        return ItemWrite(doc);
    }

    static string ItemWrite(XmlDocument doc)
    {
        MemoryStream ms = new MemoryStream();
        string error = null;
        StreamWriter sw = new StreamWriter(ms, new UTF8Encoding(true));
        try
        {
            XmlWriterSettings s = new XmlWriterSettings();
            s.Indent = true;
            s.OmitXmlDeclaration = true;
            s.IndentChars = " ";
            using (XmlWriter w = XmlWriter.Create(sw, s)) { doc.Save(w); }
        }
        catch (Exception e) { error = Err(e); }
        finally { sw.Dispose(); }
        byte[] bytes = ms.ToArray();
        bool bom = bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
        string text = Encoding.UTF8.GetString(bytes, bom ? 3 : 0, bytes.Length - (bom ? 3 : 0));
        return error == null
            ? Obj("bom", bom ? "true" : "false", "text", Js(text))
            : Obj("bom", bom ? "true" : "false", "partial", Js(text), "error", error);
    }


    static void ApplyOp(XmlDocument doc, Dictionary<string, object> op)
    {
        string kind = Str(op, "op");
        XmlNode target = doc.SelectSingleNode(Str(op, "path"));
        if (target == null) throw new InvalidOperationException("no node at " + Str(op, "path"));
        XmlElement el = target as XmlElement;
        switch (kind)
        {
            case "innerText": target.InnerText = Str(op, "value"); break;
            case "innerXml": target.InnerXml = Str(op, "value"); break;
            case "removeAll": el.RemoveAll(); break;
            case "removeNode": target.ParentNode.RemoveChild(target); break;
            case "setIsEmpty": el.IsEmpty = Flag(op, "value", true); break;
            case "append":
                XmlElement created = doc.CreateElement(Str(op, "name"));
                target.AppendChild(created);
                break;
            case "appendText": target.AppendChild(doc.CreateTextNode(Str(op, "value"))); break;
            case "appendCData": target.AppendChild(doc.CreateCDataSection(Str(op, "value"))); break;
            case "appendComment": target.AppendChild(doc.CreateComment(Str(op, "value"))); break;
            case "setAttr": el.SetAttribute(Str(op, "name"), Str(op, "value")); break;
            case "removeAttr": el.RemoveAttribute(Str(op, "name")); break;
            default: throw new InvalidOperationException("unknown op " + kind);
        }
    }

    static string KOps(Dictionary<string, object> c)
    {
        bool preserve = Flag(c, "preserve", true);
        XmlDocument doc;
        try { doc = Load(Str(c, "text"), preserve); }
        catch (Exception e) { return Obj("loadError", Err(e)); }
        try
        {
            foreach (object o in (object[])c["ops"]) ApplyOp(doc, (Dictionary<string, object>)o);
        }
        catch (Exception e) { return Obj("opError", Err(e)); }
        string outer;
        try { outer = Js(doc.OuterXml); } catch (Exception e) { outer = Obj("error", Err(e)); }
        return Obj("dump", Js(DumpOf(doc)), "outer", outer, "item", ItemWrite(doc));
    }


    static string KFragmentWrite(Dictionary<string, object> c)
    {
        XmlDocument doc;
        try { doc = Load("<r/>", true); }
        catch (Exception e) { return Obj("loadError", Err(e)); }
        XmlElement r = doc.DocumentElement;
        try { r.InnerXml = Str(c, "text"); }
        catch (Exception e) { return Obj("setError", Err(e)); }
        StringBuilder sb = new StringBuilder();
        try
        {
            XmlWriterSettings s = new XmlWriterSettings();
            s.Indent = true;
            s.IndentChars = " ";
            s.NewLineChars = "\r\n";
            s.NewLineHandling = NewLineHandling.Replace;
            s.OmitXmlDeclaration = true;
            s.ConformanceLevel = ConformanceLevel.Auto;
            using (XmlWriter w = XmlWriter.Create(sb, s)) { foreach (XmlNode ch in r.ChildNodes) ch.WriteTo(w); }
            return Obj("text", Js(sb.ToString()));
        }
        catch (Exception e) { return Obj("partial", Js(sb.ToString()), "error", Err(e)); }
    }

    static string KInnerXml(Dictionary<string, object> c)
    {
        XmlDocument doc;
        try { doc = Load(Str(c, "text"), Flag(c, "preserve", true)); }
        catch (Exception e) { return Obj("loadError", Err(e)); }
        XmlNode n = doc.SelectSingleNode(Str(c, "path"));
        try { return Obj("inner", Js(n.InnerXml), "text", Js(n.InnerText)); }
        catch (Exception e) { return Obj("error", Err(e)); }
    }

    static string Hex(byte[] b)
    {
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < b.Length; i++) s.Append(b[i].ToString("X2"));
        return s.ToString();
    }

    static string KManifestWrite(Dictionary<string, object> c, string work)
    {
        bool preserve = Flag(c, "preserve", false);
        XmlDocument doc;
        try { doc = Load(Str(c, "text"), preserve); }
        catch (Exception e) { return Obj("loadError", Err(e)); }
        string path = Path.Combine(work, "manifest.out");
        try
        {
            doc.Save(path);
            byte[] bytes = File.ReadAllBytes(path);
            return Obj("hex", Js(Hex(bytes)), "text", Js(File.ReadAllText(path)));
        }
        catch (Exception e) { return Obj("error", Err(e)); }
    }

    static string KXdoc(Dictionary<string, object> c)
    {
        string mode = Str(c, "mode");
        try
        {
            XDocument x = XDocument.Parse(Str(c, "text"));
            return Obj("text", Js(x.ToString(mode == "none" ? SaveOptions.DisableFormatting : SaveOptions.None)));
        }
        catch (Exception e) { return Obj("error", Err(e)); }
    }

    static string KHtml(Dictionary<string, object> c, bool encode)
    {
        string t = Str(c, "text");
        return Obj("text", Js(encode ? WebUtility.HtmlEncode(t) : WebUtility.HtmlDecode(t)));
    }

    static string KReadBytes(Dictionary<string, object> c, string work)
    {
        string hex = Str(c, "hex");
        byte[] bytes = new byte[hex.Length / 2];
        for (int i = 0; i < bytes.Length; i++) bytes[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
        string path = Path.Combine(work, "read.bin");
        File.WriteAllBytes(path, bytes);
        string text = File.ReadAllText(path);
        string load;
        try { load = Obj("dump", Js(DumpOf(Load(text, false)))); }
        catch (Exception e) { load = Obj("error", Err(e)); }
        return Obj("text", Js(text), "load", load);
    }

    static string Descriptor(XPathNavigator n)
    {
        switch (n.NodeType)
        {
            case XPathNodeType.Element: return "element|" + n.Name + "|" + ((IHasXmlNode)n).GetNode().OuterXml;
            case XPathNodeType.Attribute: return "attribute|" + n.Name + "|" + n.Value;
            case XPathNodeType.Text:
            case XPathNodeType.Whitespace:
            case XPathNodeType.SignificantWhitespace: return "text||" + n.Value;
            case XPathNodeType.Comment: return "comment||" + n.Value;
            case XPathNodeType.ProcessingInstruction: return "pi|" + n.Name + "|" + n.Value;
            case XPathNodeType.Root: return "root||";
            default: return n.NodeType + "|" + n.Name + "|" + n.Value;
        }
    }

    static string KXpath(Dictionary<string, object> c)
    {
        bool preserve = Flag(c, "preserve", true);
        XmlDocument doc;
        try { doc = Load(Str(c, "text"), preserve); }
        catch (Exception e) { return Obj("loadError", Err(e)); }
        try
        {
            XPathNavigator nav = doc.CreateNavigator();
            XmlNamespaceManager nm = new XmlNamespaceManager(nav.NameTable);
            object r = Flag(c, "ns", true) ? nav.Evaluate(Str(c, "expr"), nm) : nav.Evaluate(Str(c, "expr"));
            if (r is XPathNodeIterator)
            {
                List<string> items = new List<string>();
                foreach (XPathNavigator n in (XPathNodeIterator)r) items.Add(Js(Descriptor(n)));
                return Obj("nodes", "[" + string.Join(",", items.ToArray()) + "]");
            }
            if (r is double) return Obj("number", Js(((double)r).ToString("R", System.Globalization.CultureInfo.InvariantCulture)));
            if (r is bool) return Obj("boolean", ((bool)r) ? "true" : "false");
            return Obj("string", Js((string)r));
        }
        catch (Exception e) { return Obj("error", Err(e)); }
    }

    static string KFileNames()
    {
        List<string> chars = new List<string>();
        foreach (char ch in Path.GetInvalidFileNameChars()) chars.Add(((int)ch).ToString());
        return Obj("chars", "[" + string.Join(",", chars.ToArray()) + "]");
    }

    static string KHtmlEntities()
    {
        Type h = typeof(WebUtility).GetNestedType("HtmlEntities", BindingFlags.NonPublic);
        FieldInfo f = h.GetField("_entitiesList", BindingFlags.Static | BindingFlags.NonPublic);
        string[] list = (string[])f.GetValue(null);
        List<string> items = new List<string>();
        foreach (string s in list) items.Add(Js(s));
        return Obj("list", "[" + string.Join(",", items.ToArray()) + "]");
    }

    static string KHtmlEncodeChanged()
    {
        List<string> items = new List<string>();
        for (int i = 0; i <= 0xFFFF; i++)
        {
            string s = ((char)i).ToString();
            string e = WebUtility.HtmlEncode(s);
            if (e != s) items.Add(Js(i.ToString("X4") + ">" + e));
        }
        return Obj("changed", "[" + string.Join(",", items.ToArray()) + "]");
    }

    public static string Run(string casesJson, string work)
    {
        JavaScriptSerializer js = new JavaScriptSerializer();
        js.MaxJsonLength = int.MaxValue;
        object[] cases = (object[])js.DeserializeObject(casesJson);
        List<string> outputs = new List<string>();
        foreach (object o in cases)
        {
            Dictionary<string, object> c = (Dictionary<string, object>)o;
            string kind = Str(c, "kind");
            string result;
            switch (kind)
            {
                case "load": result = KLoad(c); break;
                case "item-write": result = KItemWrite(c); break;
                case "ops": result = KOps(c); break;
                case "fragment-write": result = KFragmentWrite(c); break;
                case "inner-xml": result = KInnerXml(c); break;
                case "manifest-write": result = KManifestWrite(c, work); break;
                case "xdoc": result = KXdoc(c); break;
                case "html-encode": result = KHtml(c, true); break;
                case "html-decode": result = KHtml(c, false); break;
                case "read-bytes": result = KReadBytes(c, work); break;
                case "xpath": result = KXpath(c); break;
                case "file-names": result = KFileNames(); break;
                case "html-entities": result = KHtmlEntities(); break;
                case "html-encode-changed": result = KHtmlEncodeChanged(); break;
                default: result = Obj("error", Obj("type", Js("Probe"), "message", Js("unknown kind " + kind))); break;
            }
            outputs.Add(Obj("id", Js(Str(c, "id")), "expect", result));
        }
        return "[" + string.Join(",\n", outputs.ToArray()) + "]";
    }
}
