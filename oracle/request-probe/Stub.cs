using System;
using System.Collections.Generic;
using System.Xml;
using Aras.IOM;

namespace Probe
{
    public class StopProbe : Exception { public StopProbe(string m) : base(m) { } }

    // A connection that never touches the network: it records the document IOM hands to CallAction
    // and answers from a script (a list of canned envelopes, or a callback).
    public class StubConnection : HttpServerConnection
    {
        public List<string> Requests = new List<string>();
        public List<string> Actions = new List<string>();
        public Func<string, string> Respond;   // request OuterXml -> response envelope xml; null => StopProbe
        public StubConnection() : base("http://stub/", "db", "u", "p", "en-US", null) { }

        public override void CallAction(string actionName, XmlDocument inDom, XmlDocument outDom)
        {
            string req = inDom.OuterXml;
            Actions.Add(actionName);
            Requests.Add(req);
            string resp = Respond == null ? null : Respond(req);
            if (resp == null) throw new StopProbe("stop after " + Requests.Count);
            outDom.LoadXml(resp);
        }
    }

    public static class Env
    {
        const string Head = "<SOAP-ENV:Envelope xmlns:SOAP-ENV=\"http://schemas.xmlsoap.org/soap/envelope/\"><SOAP-ENV:Body>";
        const string Tail = "</SOAP-ENV:Body></SOAP-ENV:Envelope>";
        public static string Result(string inner) { return Head + "<Result>" + inner + "</Result>" + Tail; }
        public static string Fault(string code, string text)
        {
            return Head + "<SOAP-ENV:Fault xmlns:af=\"http://www.aras.com/InnovatorFault\"><faultcode>" + code + "</faultcode><faultstring><![CDATA[" + text + "]]></faultstring><detail><af:legacy_detail><![CDATA[" + text + "]]></af:legacy_detail></detail></SOAP-ENV:Fault>" + Tail;
        }
    }
}
