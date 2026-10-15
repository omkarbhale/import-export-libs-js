// Wire-capture host for engine 14.0.7 (ticket 09), compiled by
// capture-14.0.7.ps1 with Add-Type against the staged IOM.dll and Libs.dll.
// It connects exactly as Aras's ConsoleUpgrade.exe 14.0.7 does: the nine-argument
// HttpConnectorExtension with ConsoleUpgrade's default certificate arguments
// (no find value, so a password login), CItemHelper.Login(), no Timeout (the
// console default 0 leaves IOM's own), one export, then CItemHelper.logout().
using System;
using System.Collections;
using Aras.Tools.SolutionUpgrade;

namespace LibsJsWireCapture
{
    public class PrintedMessage : Message
    {
        private readonly string _channel;
        public PrintedMessage(string channel) { _channel = channel; }
        public override bool? Execute() { Console.WriteLine(_channel + ": " + Text); return null; }
    }

    /// <summary>Like ConsoleUpgrade's factory, every channel answers null.</summary>
    public class Messages : IMessagesFactory
    {
        public Message GetErrorMessage() { return new PrintedMessage("error"); }
        public Message GetErrorMessageQuestion() { return new PrintedMessage("errorQuestion"); }
        public Message GetWarningMessage() { return new PrintedMessage("warning"); }
        public Message GetStatusMessage() { return new PrintedMessage("status"); }
        public Message GetCurrentPackageMessage() { return new PrintedMessage("currentPackage"); }
    }

    public static class Host
    {
        public static int Run(string url, string db, string user, string password, string outDir, string pkg, string type, string id, string keyedName)
        {
            var conn = new HttpConnectorExtension(url, db, user, password, "CurrentUser", "My", "FindBySubjectName", string.Empty, true);
            var ci = new CItemHelper(conn);
            ci.Login();
            try
            {
                var context = new SolutionUpgradeContext();
                context.Action = ImportExport.Export;
                context.Url = url;
                context.DataBase = db;
                context.UserName = user;
                context.Password = string.Empty;
                context.WorkingDirectory = outDir;
                context.LogFilePath = System.IO.Path.Combine(outDir, "engine.log");
                var export = new SUExportContext();
                export.sLevel = "1";
                var manager = new ImportExportManager(context, new Messages(), ci);
                var inner = new Hashtable();
                inner[id] = new ExportItem(keyedName, id, type);
                var selection = new Hashtable();
                selection[pkg] = inner;
                manager.ExportSolutions(export, selection);
            }
            finally
            {
                ci.logout();
            }
            return 0;
        }
    }
}
