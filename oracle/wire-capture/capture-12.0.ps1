<#
Wire capture for engine 12.0 (ticket 46). Windows PowerShell 5.1. Loads the
staged, hash-checked 12.0 toolset (run `npm run oracle -- verify` or any
12.0 oracle run first to stage it) and runs ReferenceHost-12.0.cs against -Url,
which points at the recording proxy (proxy.mjs). The password comes only from
$env:ARAS_PASSWORD (passed through WSLENV) and is never written or printed.
#>
param(
    [Parameter(Mandatory)][string] $ToolsetDir,
    [Parameter(Mandatory)][string] $Url,
    [Parameter(Mandatory)][string] $Database,
    [Parameter(Mandatory)][string] $User,
    [Parameter(Mandatory)][string] $OutDir,
    [Parameter(Mandatory)][string] $Package,
    [Parameter(Mandatory)][string] $Type,
    [Parameter(Mandatory)][string] $Id,
    [Parameter(Mandatory)][string] $KeyedName
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$iomPath = Join-Path $ToolsetDir 'IOM.dll'
$libsPath = Join-Path $ToolsetDir 'Libs.dll'
[void][System.Reflection.Assembly]::LoadFrom($iomPath)
$libs = [System.Reflection.Assembly]::LoadFrom($libsPath)
if ($libs.GetName().Version.ToString() -ne '12.0.0.13341') { throw "Libs.dll is $($libs.GetName().Version), not 12.0.0.13341" }
Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'ReferenceHost-12.0.cs')) -ReferencedAssemblies @($iomPath, $libsPath, 'System.Xml')
$password = $env:ARAS_PASSWORD
if ([string]::IsNullOrEmpty($password)) { throw 'ARAS_PASSWORD is not set' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
exit ([LibsJsWireCapture.Host]::Run($Url, $Database, $User, $password, $OutDir, $Package, $Type, $Id, $KeyedName))
