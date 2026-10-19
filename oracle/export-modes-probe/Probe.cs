using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.IO;
using System.Xml;
using Aras.Tools.SolutionUpgrade;

namespace ModesProbe
{
    // One entry of an inner table, in the order the table enumerates.
    public class CapturedItem
    {
        public string Key;
        public string KeyedName;
        public string IdName;
        public string TypeName;
    }

    // One entry of the outer table: a package and its items, in enumeration order.
    public class CapturedPackage
    {
        public string Name;
        public List<CapturedItem> Items = new List<CapturedItem>();
    }

    // IImportExportManager over the engine's own manager. Everything is forwarded except ExportSolutions, which records the
    // table it is handed, in the order the Hashtable enumerates it, and the export context, and then returns without exporting.
    // ConsoleUpgrade.ProcessExport takes this interface, so its loops run unchanged and only the engine's export is cut off.
    public class CapturingManager : IImportExportManager
    {
        readonly IImportExportManager inner;
        public List<CapturedPackage> Table;
        public SUExportContext Context;
        public int ExportCalls;
        public int SolutionsCalls;
        public int GenerateCalls;

        public CapturingManager(IImportExportManager inner) { this.inner = inner; }

        public IManifestFile ManifestFile { get { return inner.ManifestFile; } }
        public int ImportSolutions(ICollection packagesToImportList, SUImportContext importContext) { return inner.ImportSolutions(packagesToImportList, importContext); }
        public string GetSolutionPath(string name, string mfDirPath, ManifestFile manifestFile) { return inner.GetSolutionPath(name, mfDirPath, manifestFile); }
        public XmlDocument LoadPackageDom(string solutionPath, StreamWriter logWriter) { return inner.LoadPackageDom(solutionPath, logWriter); }
        public IEnumerable<XmlDocument> GetItemsFromPackageDom(XmlDocument packsDom) { return inner.GetItemsFromPackageDom(packsDom); }
        public XmlDocument GetSolutions2Xml() { SolutionsCalls++; return inner.GetSolutions2Xml(); }
        public Hashtable GenerateHashtableFromManifest(string manifestFile) { GenerateCalls++; return inner.GenerateHashtableFromManifest(manifestFile); }
#if V1435
        public void ApplyDBUpdateManifest(Aras.Tools.SolutionUpgrade.DBPatches.DBUpdateConfig config) { inner.ApplyDBUpdateManifest(config); }
        public void Cancel() { inner.Cancel(); }
#endif

        public void ExportSolutions(SUExportContext exportContext, Hashtable selItemsTable)
        {
            ExportCalls++;
            Context = exportContext;
            Table = Snapshot(selItemsTable);
        }

        public static List<CapturedPackage> Snapshot(Hashtable table)
        {
            if (table == null) return null;
            var packages = new List<CapturedPackage>();
            foreach (DictionaryEntry entry in table)
            {
                var package = new CapturedPackage { Name = (string)entry.Key };
                var items = (Hashtable)entry.Value;
                foreach (DictionaryEntry itemEntry in items)
                {
                    var item = (ExportItem)itemEntry.Value;
                    package.Items.Add(new CapturedItem { Key = (string)itemEntry.Key, KeyedName = item.keyedName, IdName = item.idName, TypeName = item.typeName });
                }
                packages.Add(package);
            }
            return packages;
        }
    }
}
