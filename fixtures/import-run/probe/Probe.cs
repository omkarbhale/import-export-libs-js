using System;
using System.Collections.Generic;
using System.Xml;
using Aras.IOM;
using Aras.Tools.SolutionUpgrade;

namespace Probe
{
    // A connection that never touches the network: it records the document IOM hands to CallAction
    // and answers from a callback (request OuterXml -> response envelope; null => the probe stops).
    public class StopProbe : Exception { public StopProbe(string m) : base(m) { } }

    public class StubConnection : HttpServerConnection
    {
        public List<string> Requests = new List<string>();
        public Func<string, string> Respond;
        public StubConnection() : base("http://stub/", "db", "u", "p", "en-US", null) { }
        public override void CallAction(string actionName, XmlDocument inDom, XmlDocument outDom)
        {
            string req = inDom.OuterXml;
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

    public class RecMessage : Message
    {
        public string Channel; public List<string> Sink;
        public RecMessage(string channel, List<string> sink) { Channel = channel; Sink = sink; }
        public override bool? Execute() { Sink.Add(Channel + " | " + Text); return null; }
    }

    public class RecFactory : IMessagesFactory
    {
        public List<string> Sink = new List<string>();
        public Message GetErrorMessage() { return new RecMessage("error", Sink); }
        public Message GetErrorMessageQuestion() { return new RecMessage("errorQuestion", Sink); }
        public Message GetWarningMessage() { return new RecMessage("warning", Sink); }
        public Message GetStatusMessage() { return new RecMessage("status", Sink); }
        public Message GetCurrentPackageMessage() { return new RecMessage("currentPackage", Sink); }
    }
}
