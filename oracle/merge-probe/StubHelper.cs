using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Xml;
using Aras.IOM;
using Aras.Tools.SolutionUpgrade;

namespace MergeProbe
{
    // A scriptable ICItemHelper for CImportItems. It records every call, in order, in Calls and
    // answers from tables the scenario fills. It never touches a network.
    public class StubHelper : ICItemHelper
    {
        public List<string> Calls = new List<string>();
        // request text -> response: an envelope text, or "FAULT:<code>". null (or no script) means the default:
        // a get finds nothing (fault 0) and every other request succeeds with an empty Result.
        public Func<string, string> OnApply;
        public Dictionary<string, bool> Versionable = new Dictionary<string, bool>();
        public Dictionary<string, string> LatestId = new Dictionary<string, string>();   // id -> new id for SetItemIdToLastGeneration
        public Dictionary<string, bool> RelExists = new Dictionary<string, bool>();      // "type|source|related"
        public Dictionary<string, int> RelFault = new Dictionary<string, int>();         // "type|source|related" -> faultcode thrown
        public string UnlockFault;                                                       // "FAULT:<code>" makes Unlock throw
        public bool DefaultVersionable = false;

        public XmlDocument applyAML(string aml)
        {
            Calls.Add("applyAML " + aml);
            // IOM parses the AML before sending it, so malformed text fails with XmlException.
            new XmlDocument().LoadXml(aml);
            string r = OnApply == null ? null : OnApply(aml);
            if (string.IsNullOrEmpty(r)) r = aml.Contains("action='get'") || aml.Contains("action=\"get\"") ? "FAULT:0" : "<SOAP-ENV:Envelope xmlns:SOAP-ENV=\"http://schemas.xmlsoap.org/soap/envelope/\"><SOAP-ENV:Body><Result /></SOAP-ENV:Body></SOAP-ENV:Envelope>";
            if (r.StartsWith("FAULT:"))
                throw new CItemException(int.Parse(r.Substring(6)), "fault " + r.Substring(6), "fault " + r.Substring(6), null);
            XmlDocument d = new XmlDocument();
            d.LoadXml(r);
            return d;
        }
        public bool IsVersionable(string t)
        {
            Calls.Add("IsVersionable " + t);
            bool v;
            if (Versionable.TryGetValue(t, out v)) return v;
            return DefaultVersionable;
        }
        public void SetItemIdToLastGeneration(XmlElement item)
        {
            Calls.Add("SetItemIdToLastGeneration " + item.GetAttribute("type") + "|" + item.GetAttribute("id"));
            string n;
            if (LatestId.TryGetValue(item.GetAttribute("id"), out n)) item.SetAttribute("id", n);
        }
        public void Unlock(string id, string type)
        {
            Calls.Add("Unlock " + id + "|" + type);
            if (UnlockFault != null) throw new CItemException(int.Parse(UnlockFault.Substring(6)), "unlock fault", "unlock fault", null);
        }
        public bool ExistRelItemInCurVer(string type, string sourceId, string relatedId)
        {
            string k = type + "|" + sourceId + "|" + relatedId;
            Calls.Add("ExistRelItemInCurVer " + k);
            int f;
            if (RelFault.TryGetValue(k, out f)) throw new CItemException(f, "rel fault", "rel fault", null);
            bool b;
            return RelExists.TryGetValue(k, out b) && b;
        }

        public CookieContainer Cookie { get { throw new NotImplementedException(); } }
        public string Folder { get { throw new NotImplementedException(); } set { } }
        public Innovator Inn { get { throw new NotImplementedException(); } }
        public ArasVersion InnovatorVersion { get { throw new NotImplementedException(); } }
        public XmlDocument applySQL(string sqlXml) { throw new NotImplementedException(); }
        public void CheckDataSourceReferences(XmlDocument itemInXml, StreamWriter logWriter, IList unresolvedRefs) { throw new NotImplementedException(); }
        public void DeleteSqlItems(XmlNodeList allItems) { throw new NotImplementedException(); }
        public void DoChecking(DelayedResolutionManager manager, XmlDocument itemInXml, StreamWriter logWriter, bool doFullCheck) { throw new NotImplementedException(); }
        public bool DoesItemAlreadyExist(XmlNode item, CItemHelper.IdTypePair idTypePair) { throw new NotImplementedException(); }
        public void doImport(XmlDocument itemInXml, bool mergeMode) { throw new NotImplementedException(); }
        public string GetConfigId(string id, string type) { throw new NotImplementedException(); }
        public string GetCurrentIdByUniqueKey(XmlNode item, bool exceptionIfPropMissing) { throw new NotImplementedException(); }
        public string GetCurrentIdOfVersion(string id, string type) { throw new NotImplementedException(); }
        public string GetLabelOfItemType(string type) { throw new NotImplementedException(); }
        public string GetPackageGroupIdOrCreateIfNotExists(string packageDefinitionId, string packageGroupName) { throw new NotImplementedException(); }
        public IEnumerable<string> GetSolutionNames() { throw new NotImplementedException(); }
        public XmlDocument getSolutions() { throw new NotImplementedException(); }
        public bool Islocked(string strId, string strType) { throw new NotImplementedException(); }
        public bool ItemExistById(string strId, string strType) { throw new NotImplementedException(); }
        public void Login() { throw new NotImplementedException(); }
        public void logout() { throw new NotImplementedException(); }
        public void PackageItem(ExportItem item, string packageName, string level, Hashtable excludedReferences) { throw new NotImplementedException(); }
        public void RecurseCheck(XmlDocument itemInXml, StreamWriter logWriter, IList unresolvedRefs) { throw new NotImplementedException(); }
        public XmlNode createAttr(string name, string value, XmlDocument output) { throw new NotImplementedException(); }
        public int getDepencyLevel(string typeId, int depencyLevel) { throw new NotImplementedException(); }
        public XmlDocument GetItemType(string name) { throw new NotImplementedException(); }
        public void processIndependentRelatedItems(XmlDocument xmlDoc) { throw new NotImplementedException(); }
        public void ProcessPropertiesOfTypeItem(XmlElement item) { throw new NotImplementedException(); }
        public void ReplaceReferencesToPolyLists(XmlDocument xmlDoc) { throw new NotImplementedException(); }
        public void RemoveReferencesToAnotherPackages(ExportItem item, XmlDocument xmlDoc, string packageName, Hashtable excludedReferences) { throw new NotImplementedException(); }
        public void RemoveNamespaceNodes(XmlDocument doc) { throw new NotImplementedException(); }
        public void RemoveEmptyRelationships(XmlDocument doc) { throw new NotImplementedException(); }
        public string WriteReleaseData(string packageName, int status, string targetRelease, string description) { throw new NotImplementedException(); }
    }
}
