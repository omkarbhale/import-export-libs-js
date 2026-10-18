<#
Wire capture for engine 14.35 (ticket 69). Windows PowerShell 5.1. Loads the
staged, hash-checked 14.35 toolset (run `npm run oracle -- verify` first to stage
it) and runs ReferenceHost-14.35.cs against -Url, which points at the recording
proxy (proxy.mjs). Modes:
  export    logs in as -User with the password from $env:ARAS_PASSWORD, handed to
            IOM as its MD5 hex (IOM 15 would otherwise send the plain password
            first; oracle/README.md, Rules), and exports -Items.
  rejected  logs in as a user that does not exist, with a password that is not
            one, handed to IOM as given (no hash), to record the server's answer
            to a plain password and IOM 15's rehash retry. No credential is used.
The real password is never written or printed.
#>
param(
    [Parameter(Mandatory)][string] $ToolsetDir,
    [Parameter(Mandatory)][string] $Url,
    [Parameter(Mandatory)][string] $Database,
    [Parameter(Mandatory)][string] $User,
    [Parameter(Mandatory)][string] $OutDir,
    [ValidateSet('export', 'rejected')][string] $Mode = 'export',
    # Items to export: "package|type|id|keyed name", separated by ";".
    [string] $Items = ''
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$script:toolsetDir = $ToolsetDir
# A PowerShell host has no binding redirects (import.exe.config has them), so dependencies resolve by simple name.
# The handler's own cmdlets are run once first: loading their assemblies inside the handler would call it again.
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
if ($libs.GetName().Version.ToString() -ne '14.35.0.43890') { throw "Libs.dll is $($libs.GetName().Version), not 14.35.0.43890" }
if ($iom.GetName().Version.ToString() -ne '15.0.0.0') { throw "IOM.dll is $($iom.GetName().Version), not 15.0.0.0" }
$refs = @($iomPath, $libsPath, 'System.Xml')
$netstandard = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'Facades\netstandard.dll'
if (Test-Path -LiteralPath $netstandard) { $refs += $netstandard }
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'ReferenceHost-14.35.cs')) -ReferencedAssemblies $refs
if ($Mode -eq 'rejected') {
    $User = 'libsjs-no-such-user'
    $password = 'libsjs-not-a-password'
} else {
    $plain = $env:ARAS_PASSWORD
    if ([string]::IsNullOrEmpty($plain)) { throw 'ARAS_PASSWORD is not set' }
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $password = -join ($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($plain)) | ForEach-Object { $_.ToString('x2') })
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
exit ([LibsJsWireCapture.Host]::Run($Url, $Database, $User, $password, $OutDir, [string[]]@($Items -split ';' | Where-Object { $_ -ne '' } | ForEach-Object { $_ -replace '\|', "`t" })))
