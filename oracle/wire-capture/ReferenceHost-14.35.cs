// Wire-capture host for engine 14.35 (ticket 69), compiled by capture-14.35.ps1
// with Add-Type against the staged IOM.dll (15.0.0.0) and Libs.dll. It follows
// Aras's ConsoleUpgrade.exe 14.35 step by step: the nine-argument
// HttpConnectorExtension with ConsoleUpgrade's default certificate arguments (no
// find value, so a password login), CItemHelper.Login() outside any try, the
// ImportExportManager, one export, then CItemHelper.logout() in a finally.
// A CItemException ends the run with exit code 1, as in ConsoleUpgrade; any other
// exception is printed and ends the run with exit code 2.
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
        // items: "package<TAB>type<TAB>id<TAB>keyed name" per item.
        public static int Run(string url, string db, string user, string password, string outDir, string[] items)
        {
            CItemHelper ci;
            try
            {
                var conn = new HttpConnectorExtension(url, db, user, password, "CurrentUser", "My", "FindBySubjectName", string.Empty, true);
                ci = new CItemHelper(conn);
                ci.Login();
            }
            catch (CItemException ex)
            {
                Console.WriteLine("login failed: CItemException faultcode=" + ex.faultcode);
                Console.WriteLine("message: " + ex.Message);
                return 1;
            }
            Console.WriteLine("login returned: IsConnected=" + ci.IsConnected + " InnovatorVersion=" + (ci.InnovatorVersion == null ? "null" : ci.InnovatorVersion.InnovatorVersionFullString));
            int code = 0;
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
                context.Languages = new string[0];
                var export = new SUExportContext();
                export.sLevel = "1";
                var manager = new ImportExportManager(context, new Messages(), ci);
                var selection = new Hashtable();
                foreach (var line in items)
                {
                    var f = line.Split('\t');
                    var inner = (Hashtable)selection[f[0]];
                    if (inner == null) { inner = new Hashtable(); selection[f[0]] = inner; }
                    inner[f[2]] = new ExportItem(f[3], f[2], f[1]);
                }
                manager.ExportSolutions(export, selection);
            }
            catch (CItemException ex)
            {
                Console.WriteLine("CItemException faultcode=" + ex.faultcode);
                Console.WriteLine("message: " + ex.Message);
                code = 1;
            }
            catch (Exception ex)
            {
                Console.WriteLine("unexpected " + ex.GetType().FullName + ": " + ex.Message);
                code = 2;
            }
            finally
            {
                ci.logout();
                Console.WriteLine("logout done: IsConnected=" + ci.IsConnected);
            }
            return code;
        }
    }
}
