<#
Wire probe for engines 14.35 (ticket 69) and 14.0.7. Windows PowerShell 5.1. It loads the staged
toolset (14.35: IOM 15 and Libs 14.35; 14.0.7: IOM and Libs 14.0.7; hash-checked by the caller) and runs the real
CItemHelper.Login, the version probe, the gate, CItemException and IOM's own helpers
against Stub.cs's StubConnection, which never touches a network: it records the
documents IOM hands to CallAction and answers from a script. The result is the
evidence spec/wire.md cites for what the proxy capture cannot show (fixtures/wire/14.35-probe/ and
fixtures/wire/14.0.7-probe/). Section F (IOM 15's public hash helpers) is 14.35 only.

No server, no credential and no password is involved.
#>
param(
    [Parameter(Mandatory)][string] $ToolsetDir,
    [Parameter(Mandatory)][string] $Out,
    [ValidateSet('14.35', '14.0.7')][string] $Engine = '14.35'
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$script:toolsetDir = $ToolsetDir
[void](New-Object System.Reflection.AssemblyName('warm-up'))
[void](Test-Path -LiteralPath (Join-Path $ToolsetDir 'warm-up.dll'))
[AppDomain]::CurrentDomain.add_AssemblyResolve({
    param($sender, $e)
    $name = (New-Object System.Reflection.AssemblyName($e.Name)).Name
    $candidate = Join-Path $script:toolsetDir ($name + '.dll')
    if (Test-Path -LiteralPath $candidate) { return [System.Reflection.Assembly]::LoadFrom($candidate) }
    return $null
})
$iomPath = Join-Path $ToolsetDir 'IOM.dll'
$libsPath = Join-Path $ToolsetDir 'Libs.dll'
$iom = [System.Reflection.Assembly]::LoadFrom($iomPath)
$libs = [System.Reflection.Assembly]::LoadFrom($libsPath)
$expected = @{ '14.35' = '14.35.0.43890'; '14.0.7' = '14.0.7.35492' }[$Engine]
if ($libs.GetName().Version.ToString() -ne $expected) { throw "Libs.dll is $($libs.GetName().Version), not $expected" }
$refs = @($iomPath, $libsPath, 'System.Xml')
$netstandard = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'Facades\netstandard.dll'
if (Test-Path -LiteralPath $netstandard) { $refs += $netstandard }
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'Stub.cs')) -ReferencedAssemblies $refs

$log = [ordered]@{ engine = $Engine; assemblyVersion = $libs.GetName().Version.ToString(); iomVersion = $iom.GetName().Version.ToString(); scenarios = [ordered]@{} }
function Note([string] $key, $value) { $log.scenarios[$key] = $value }
function Unwrap($ex) {
    while ($ex -is [System.Management.Automation.MethodInvocationException] -or $ex -is [System.Reflection.TargetInvocationException]) { $ex = $ex.InnerException }
    return $ex
}
function Clip([string] $s, [int] $n) { if ($s.Length -gt $n) { return $s.Substring(0, $n) } else { return $s } }
function Desc($ex) {
    $x = Unwrap $ex
    $o = [ordered]@{ type = $x.GetType().FullName }
    if ($x -is [Aras.Tools.SolutionUpgrade.CItemException]) { $o.faultcode = $x.faultcode; $o.faultstring = Clip $x.faultstring 1200; $o.faultdetail = Clip $x.faultdetail 300 }
    $o.message = Clip $x.Message 1200
    return $o
}
function Version-Text($v) { if ($v -eq $null) { return $null } else { return [ordered]@{ major = $v.Major; minor = $v.Minor; servicePack = $v.ServicePack; build = $v.Build; serviceUpdate = $v.ServiceUpdate; fullString = $v.InnovatorVersionFullString } }
}
function New-Stub($respond, $loginResult) {
    $c = New-Object WireProbe.StubConnection
    $c.Respond = $respond
    $c.LoginResult = $loginResult
    return $c
}
$okLogin = { (New-Object Aras.IOM.Innovator($c)).newItem() }
# The server's answer to the four probe requests; $vars maps a Variable name to its value ($null = no row, 'FAULT0' = faultcode 0).
function Probe-Responder($vars) {
    return {
        param($action, $req)
        $names = @([regex]::Matches($req, '<name>(Version\w+)</name>') | ForEach-Object { $_.Groups[1].Value })
        $rows = ''
        foreach ($n in $names) {
            if ($vars.Contains($n)) {
                $v = $vars[$n]
                if ($v -eq 'FAULT0') { return [WireProbe.Env]::Fault('0', 'No items of type Variable found.') }
                if ($v -eq 'FAULT500') { return [WireProbe.Env]::Fault('500', 'boom') }
                $rows += [WireProbe.Env]::Variable($n, $v)
            }
        }
        if ($rows -eq '') { return [WireProbe.Env]::Fault('0', 'No items of type Variable found.') }
        return [WireProbe.Env]::Result($rows)
    }.GetNewClosure()
}
function Run-Login($vars) {
    $c = New-Object WireProbe.StubConnection
    $c.Respond = Probe-Responder $vars
    $inn = New-Object Aras.IOM.Innovator($c)
    $c.LoginResult = { $inn.newItem() }.GetNewClosure()
    $h = New-Object Aras.Tools.SolutionUpgrade.CItemHelper($c)
    $thrown = $null
    try { $h.Login() } catch { $thrown = Desc $_.Exception }
    return [ordered]@{ vars = $vars; requests = @($c.Requests); actions = @($c.Actions); logins = $c.Logins; thrown = $thrown; isConnected = ($h.Inn -ne $null); innovatorVersion = (Version-Text $h.InnovatorVersion) }
}
$full = [ordered]@{ VersionMajor = '12'; VersionMinor = '0'; VersionServicePack = 'SP9'; VersionBuild = '24090'; VersionServiceUpdate = '0' }

# --- A: the probe and what it reads -------------------------------------------------------------
$a = [ordered]@{}
$a['dev-12.0-SP9'] = Run-Login $full
$a['14.35.0.1234'] = Run-Login ([ordered]@{ VersionMajor = '14'; VersionMinor = '35'; VersionServicePack = $null; VersionBuild = '1234'; VersionServiceUpdate = '3' })
$a['sp-with-su'] = Run-Login ([ordered]@{ VersionMajor = '12'; VersionMinor = '0'; VersionServicePack = 'SP9 SU1'; VersionBuild = '1'; VersionServiceUpdate = '0' })
$a['sp-empty-value'] = Run-Login ([ordered]@{ VersionMajor = '12'; VersionMinor = '0'; VersionServicePack = ''; VersionBuild = '1'; VersionServiceUpdate = '0' })
$a['sp-fault0'] = Run-Login ([ordered]@{ VersionMajor = '12'; VersionMinor = '0'; VersionServicePack = 'FAULT0'; VersionBuild = '1'; VersionServiceUpdate = '0' })
$a['sp-fault500'] = Run-Login ([ordered]@{ VersionMajor = '12'; VersionMinor = '0'; VersionServicePack = 'FAULT500'; VersionBuild = '1'; VersionServiceUpdate = '0' })
$a['build-fault0'] = Run-Login ([ordered]@{ VersionMajor = '12'; VersionMinor = '0'; VersionServicePack = 'SP1'; VersionBuild = 'FAULT0'; VersionServiceUpdate = '0' })
$a['build-not-integer'] = Run-Login ([ordered]@{ VersionMajor = '12'; VersionMinor = '0'; VersionServicePack = 'SP1'; VersionBuild = 'x'; VersionServiceUpdate = '0' })
$a['build-no-value'] = Run-Login ([ordered]@{ VersionMajor = '12'; VersionMinor = '0'; VersionServicePack = 'SP1'; VersionBuild = $null; VersionServiceUpdate = '0' })
$a['su-fault0'] = Run-Login ([ordered]@{ VersionMajor = '12'; VersionMinor = '0'; VersionServicePack = 'SP1'; VersionBuild = '1'; VersionServiceUpdate = 'FAULT0' })
$a['su-fault500'] = Run-Login ([ordered]@{ VersionMajor = '12'; VersionMinor = '0'; VersionServicePack = 'SP1'; VersionBuild = '1'; VersionServiceUpdate = 'FAULT500' })
$a['only-major-row'] = Run-Login ([ordered]@{ VersionMajor = '12' })
$a['only-minor-row'] = Run-Login ([ordered]@{ VersionMinor = '0' })
$a['no-rows-fault0'] = Run-Login ([ordered]@{})
$a['major-fault500'] = Run-Login ([ordered]@{ VersionMajor = 'FAULT500'; VersionMinor = '0' })
$a['major-no-value'] = Run-Login ([ordered]@{ VersionMajor = $null; VersionMinor = '0' })
Note 'A.probe' $a

# --- B: the gate --------------------------------------------------------------------------------
$b = [ordered]@{}
foreach ($m in @(@(9, 4), @(9, 0), @(10, 0), @(11, 12), @(12, 0), @(13, 0), @(14, 0), @(14, 35), @(15, 0), @(16, 2))) {
    $b["$($m[0]).$($m[1])"] = Run-Login ([ordered]@{ VersionMajor = [string]$m[0]; VersionMinor = [string]$m[1]; VersionServicePack = 'SP2'; VersionBuild = '77'; VersionServiceUpdate = '5' })
}
Note 'B.gate' $b

# --- C: login faults ----------------------------------------------------------------------------
$c = [ordered]@{}
function Run-LoginFault([string] $faultXml) {
    $conn = New-Object WireProbe.StubConnection
    $conn.Respond = { param($action, $req) [WireProbe.Env]::Result('') }
    $inn = New-Object Aras.IOM.Innovator($conn)
    $conn.LoginResult = { $it = $inn.newItem(); $d = $it.dom; $d.LoadXml($faultXml); $it.dom = $d; $it }.GetNewClosure()
    $h = New-Object Aras.Tools.SolutionUpgrade.CItemHelper($conn)
    $thrown = $null
    try { $h.Login() } catch { $thrown = Desc $_.Exception }
    return [ordered]@{ fault = $faultXml; requests = @($conn.Requests); thrown = $thrown; isConnected = ($h.Inn -ne $null); innovatorVersion = (Version-Text $h.InnovatorVersion) }
}
$ioFault = { param($code, $text, $actor) '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:i18n="http://www.aras.com/I18N"><SOAP-ENV:Body><SOAP-ENV:Fault>' + "`r`n`t<faultcode>$code</faultcode>`r`n`t<faultstring>$text</faultstring>`r`n`t<faultactor>$actor</faultactor>`r`n`t<detail>unknown error</detail>`r`n" + '</SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>' }
$c['oauth-invalid-grant'] = Run-LoginFault (& $ioFault 'invalid_grant' 'Authentication failed for u' 'OAuthServer')
$c['io-999-transport'] = Run-LoginFault (& $ioFault '999' 'System.Net.WebException: The operation has timed out' 'HttpServerConnection')
$c['cancelled-task'] = Run-LoginFault (& $ioFault '999' 'System.Threading.Tasks.TaskCanceledException: A task was canceled.' 'HttpServerConnection')
$c['cancelled-text-elsewhere'] = Run-LoginFault (& $ioFault '999' 'x System.Threading.Tasks.TaskCanceledException y' 'OAuthServer')
$c['cancelled-lowercase'] = Run-LoginFault (& $ioFault '999' 'system.threading.tasks.taskcanceledexception' 'HttpServerConnection')
Note 'C.loginFaults' $c

# --- D: CItemException built from faults ---------------------------------------------------------
$d = [ordered]@{}
function Run-Apply([string] $aml, [string] $response) {
    $conn = New-Object WireProbe.StubConnection
    $conn.Respond = { param($action, $req) $response }.GetNewClosure()
    $conn.LoginResult = { $null }
    $h = New-Object Aras.Tools.SolutionUpgrade.CItemHelper($conn)
    $r = [ordered]@{ aml = $aml; requests = @($conn.Requests); actions = @($conn.Actions) }
    try { $x = $h.applyAML($aml); $r.returned = Clip $x.OuterXml 400 } catch { $r.thrown = Desc $_.Exception }
    return $r
}
$d['fault-0'] = Run-Apply "<Item type='Part' action='get'><id>X</id></Item>" ([WireProbe.Env]::Fault('0', 'No items of type Part found.'))
$d['fault-999'] = Run-Apply "<Item type='Part' action='get'><id>X</id></Item>" ([WireProbe.Env]::Fault('SOAP-ENV:Server', 'boom & <b>'))
$d['fault-attr-and-text'] = Run-Apply "<Item type='Part' action='get'><name>a &amp; b</name><desc>text</desc></Item>" ([WireProbe.Env]::Fault('1', 'Plain text fault'))
$d['not-a-single-item'] = Run-Apply '<AML><Item type="Part" action="get" /></AML>' ([WireProbe.Env]::Result(''))
$d['malformed-request'] = Run-Apply "<Item type='Part' action='get'>" ([WireProbe.Env]::Result(''))
Note 'D.applyAML' $d

# --- E: logout, Inn and IsConnected --------------------------------------------------------------
$f = [ordered]@{}
$conn = New-Object WireProbe.StubConnection
$conn.Respond = { param($action, $req) [WireProbe.Env]::Result('') }
$h = New-Object Aras.Tools.SolutionUpgrade.CItemHelper($conn)
$before = ($h.Inn -ne $null)
$h.logout()
$f['stub-connection'] = [ordered]@{ isConnectedBefore = $before; isConnectedAfter = ($h.Inn -ne $null); requests = @($conn.Requests); secondLogoutThrows = $false }
try { $h.logout() } catch { $f['stub-connection'].secondLogoutThrows = $true }
# A real HttpConnectorExtension whose server refuses connections: Logoff fails inside IOM and is swallowed.
$real = New-Object Aras.Tools.SolutionUpgrade.HttpConnectorExtension('http://127.0.0.1:9/probe', 'db', 'u', 'p', 'CurrentUser', 'My', 'FindBySubjectName', '', $true)
$h2 = New-Object Aras.Tools.SolutionUpgrade.CItemHelper($real)
$thrown = $null
try { $h2.logout() } catch { $thrown = Desc $_.Exception }
$f['http-connector-extension-unreachable'] = [ordered]@{ thrown = $thrown; isConnectedAfter = ($h2.Inn -ne $null) }
Note 'E.logout' $f

# --- F: IOM helpers the wire rules rely on (14.35 only: 14.0.7's are internal) ------------------
if ($Engine -eq '14.35') {
$g = [ordered]@{}
[void][System.Reflection.Assembly]::LoadFrom((Join-Path $ToolsetDir 'Aras.Cryptography.dll'))
$md5 = [Aras.Cryptography.Hashes.Md5]; $sha = [Aras.Cryptography.Hashes.Sha256]
$nonAscii = 'p' + [char]0xE4 + 'ss' + [char]0x20AC
$g['md5(abc)'] = $md5::ComputeHash('abc')
$g['md5(non-ascii)'] = $md5::ComputeHash($nonAscii)
$g['md5(question-marks)'] = $md5::ComputeHash('p?ss?')
$g['sha256(abc)'] = $sha::ComputeHash('abc')
$g['sha256(non-ascii)'] = $sha::ComputeHash($nonAscii)
$g['sha256(question-marks)'] = $sha::ComputeHash('p?ss?')
$g['isHash'] = [ordered]@{ md5Lower = $md5::IsHash('0123456789abcdef0123456789abcdef'); md5Upper = $md5::IsHash('0123456789ABCDEF0123456789ABCDEF'); md5Newline = $md5::IsHash("0123456789abcdef0123456789abcdef`n"); md5Of64 = $md5::IsHash(('a' * 64)); sha256Of64 = $sha::IsHash(('a' * 64)); sha256Of32 = $sha::IsHash(('a' * 32)) }
$ro = [Aras.IOM.HttpServerConnection].GetMethod('IsReadonlyRequest', [Reflection.BindingFlags]'NonPublic,Static')
function Is-ReadOnly([string] $action, [string] $xml) { $doc = New-Object System.Xml.XmlDocument; $doc.LoadXml($xml); return $ro.Invoke($null, [object[]]@($action, $doc.psobject.BaseObject)) }
$g['readOnlyHeader'] = [ordered]@{
    'ApplyItem readOnly=1' = Is-ReadOnly 'ApplyItem' '<Item type="Part" action="get" readOnly="1" />'
    'ApplyItem no attribute' = Is-ReadOnly 'ApplyItem' '<Item type="Part" action="get" />'
    'ApplyItem readOnly=true' = Is-ReadOnly 'ApplyItem' '<Item type="Part" action="get" readOnly="true" />'
    'ApplyAML all readOnly' = Is-ReadOnly 'ApplyAML' '<AML><Item type="Part" action="get" readOnly="1" /><Item type="Part" action="get" readOnly="1" /></AML>'
    'ApplyAML one not readOnly' = Is-ReadOnly 'ApplyAML' '<AML><Item type="Part" action="get" readOnly="1" /><Item type="Part" action="get" /></AML>'
    'ApplyAML no items' = Is-ReadOnly 'ApplyAML' '<AML />'
    'ValidateUser' = Is-ReadOnly 'ValidateUser' '<Item readOnly="1" />'
    'Logoff' = Is-ReadOnly 'Logoff' '<logoff skip_unlock="1" />'
}
Note 'F.iomHelpers' $g
}

$json = $log | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding($false)))
