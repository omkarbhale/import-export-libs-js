# Runs the cases in -Cases through .NET Framework's System.Xml and writes the recorded results to -Out
# as {"info": ..., "results": [...]}. Stage this folder under %LOCALAPPDATA% first (see README.md).
param([string]$Cases, [string]$Out, [string]$Work)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
Add-Type -Path (Join-Path $PSScriptRoot 'Probe.cs') -ReferencedAssemblies 'System.Xml', 'System.Xml.Linq', 'System.Core', 'System.Web.Extensions'
$json = [IO.File]::ReadAllText($Cases, [Text.Encoding]::UTF8)
$results = [XmlCoreProbe]::Run($json, $Work)
$xmlDll = [Reflection.Assembly]::GetAssembly([Xml.XmlDocument]).Location
$info = '{"clr":"' + [Environment]::Version.ToString() + '","systemXml":"' + (Get-Item $xmlDll).VersionInfo.FileVersion + '","os":"' + [Environment]::OSVersion.VersionString + '"}'
[IO.File]::WriteAllText($Out, '{"info":' + $info + ',"results":' + $results + '}', (New-Object Text.UTF8Encoding($false)))
Write-Output "done"
