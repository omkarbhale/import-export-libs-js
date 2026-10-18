# A connection that never touches a network. It implements IOM's IServerConnection from the real interface,
# records the document IOM hands to CallAction (inDom.OuterXml) and answers from a callback
# (request -> response envelope; null throws StopProbe). Also a recording IMessagesFactory.
. (Join-Path $PSScriptRoot 'common.ps1')
function CsName([Type]$t) {
  if ($t.IsArray) { return (CsName $t.GetElementType()) + '[]' }
  if ($t.IsGenericType) {
    $n = $t.GetGenericTypeDefinition().FullName -replace '`\d+$', '' -replace '\+', '.'
    return $n + '<' + (($t.GetGenericArguments() | ForEach-Object { CsName $_ }) -join ', ') + '>'
  }
  if ($t -eq [void]) { return 'void' }
  return ($t.FullName -replace '\+', '.')
}
function StubInterface([Type]$iface, [string[]]$skip) {
  $sb = New-Object System.Text.StringBuilder
  $all = @($iface) + @($iface.GetInterfaces())
  foreach ($i in $all) {
    foreach ($p in $i.GetProperties()) {
      if ($skip -contains $p.Name) { continue }
      $ty = CsName $p.PropertyType
      [void]$sb.Append("public $ty $($p.Name) {")
      if ($p.CanRead) { [void]$sb.Append(" get { return default($ty); }") }
      if ($p.CanWrite) { [void]$sb.Append(' set { }') }
      [void]$sb.AppendLine(' }')
    }
    foreach ($m in $i.GetMethods()) {
      if ($m.IsSpecialName) { continue }
      if ($skip -contains $m.Name) { continue }
      $ps = ($m.GetParameters() | ForEach-Object { (CsName $_.ParameterType) + ' ' + $_.Name }) -join ', '
      $rt = CsName $m.ReturnType
      $body = if ($rt -eq 'void') { '' } else { "return default($rt);" }
      [void]$sb.AppendLine("public $rt $($m.Name)($ps) { $body }")
    }
  }
  $sb.ToString()
}
$connStubs = StubInterface ([Aras.IOM.IServerConnection]) @('CallAction')
$code = @"
using System; using System.Collections.Generic; using System.Xml; using Aras.IOM; using Aras.Tools.SolutionUpgrade;
public class StopProbe : Exception { public StopProbe(string m) : base(m) { } }
public class StubConn : IServerConnection {
  public List<string> Requests = new List<string>();
  public List<string> Actions = new List<string>();
  public Func<string, string> Respond;
  public void CallAction(string action, XmlDocument inDom, XmlDocument outDom) {
    string req = inDom.OuterXml;
    Requests.Add(req);
    Actions.Add(action);
    string resp = Respond == null ? null : Respond(req);
    if (resp == null) throw new StopProbe("no answer for request " + Requests.Count);
    outDom.LoadXml(resp);
  }
  $connStubs
}
public class RecMessage : Message {
  public string Channel; public List<string> Sink;
  public RecMessage(string channel, List<string> sink) { Channel = channel; Sink = sink; }
  public override bool? Execute() { Sink.Add(Channel + " | " + Text); return null; }
}
public class RecFactory : IMessagesFactory {
  public List<string> Sink = new List<string>();
  public Message GetErrorMessage() { return new RecMessage("error", Sink); }
  public Message GetErrorMessageQuestion() { return new RecMessage("errorQuestion", Sink); }
  public Message GetWarningMessage() { return new RecMessage("warning", Sink); }
  public Message GetStatusMessage() { return new RecMessage("status", Sink); }
  public Message GetCurrentPackageMessage() { return new RecMessage("currentPackage", Sink); }
}
"@
$refs = @((Join-Path $dll 'IOM.dll'), (Join-Path $dll 'Libs.dll'), 'System.Xml.dll', 'System.dll')
Add-Type -TypeDefinition $code -ReferencedAssemblies $refs -Language CSharp

# A real CItemHelper over a stub connection; the server version is set the way the login would (a private setter).
function NewHelper([scriptblock]$respond, [int[]]$ver = @(12, 0, 9, 24090, 0)) {
  $conn = New-Object StubConn
  $conn.Respond = [Func[string,string]]$respond
  $helper = New-Object Aras.Tools.SolutionUpgrade.CItemHelper($conn)
  $v = New-Object Aras.Tools.SolutionUpgrade.ArasVersion($ver[0], $ver[1], $ver[2], $ver[3], $ver[4])
  $helper.GetType().GetProperty('InnovatorVersion').GetSetMethod($true).Invoke($helper, [object[]]@($v.psobject.BaseObject)) | Out-Null
  @{ conn = $conn; helper = $helper }
}
