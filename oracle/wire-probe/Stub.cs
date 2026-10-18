using System;
using System.Collections.Generic;
using System.Xml;
using Aras.IOM;

namespace WireProbe
{
    // A connection that never touches the network: it records the document IOM hands to
    // CallAction and answers from a script. Login is scripted too, so CItemHelper.Login
    // runs its own code after IOM's login.
    public class StubConnection : HttpServerConnection
    {
        public List<string> Requests = new List<string>();
        public List<string> Actions = new List<string>();
        public Func<string, string, string> Respond;   // action, request OuterXml -> response envelope xml
        public Func<Item> LoginResult;
        public int Logins;
        public StubConnection() : base("http://stub/", "db", "u", "p", "en-US", null) { }

        public override Item Login()
        {
            Logins++;
            return LoginResult();
        }

        public override void CallAction(string actionName, XmlDocument inDom, XmlDocument outDom)
        {
            Actions.Add(actionName);
            Requests.Add(inDom.OuterXml);
            outDom.LoadXml(Respond(actionName, inDom.OuterXml));
        }
    }

    public static class Env
    {
        const string Head = "<SOAP-ENV:Envelope xmlns:SOAP-ENV=\"http://schemas.xmlsoap.org/soap/envelope/\"><SOAP-ENV:Body>";
        const string Tail = "</SOAP-ENV:Body></SOAP-ENV:Envelope>";
        public static string Result(string inner) { return Head + "<Result>" + inner + "</Result>" + Tail; }
        public static string Variable(string name, string value)
        {
            return "<Item type=\"Variable\" id=\"V" + name + "\"><name>" + name + "</name>" + (value == null ? "" : "<value>" + value + "</value>") + "</Item>";
        }
        public static string Fault(string code, string text)
        {
            return Head + "<SOAP-ENV:Fault xmlns:af=\"http://www.aras.com/InnovatorFault\"><faultcode>" + code + "</faultcode><faultstring><![CDATA[" + text + "]]></faultstring><detail><af:legacy_detail><![CDATA[" + text + "]]></af:legacy_detail></detail></SOAP-ENV:Fault>" + Tail;
        }
    }
}
