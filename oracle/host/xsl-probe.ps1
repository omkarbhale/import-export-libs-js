<#
Oracle host for `npm run oracle -- --engine <v> xsl`. Windows PowerShell 5.1.
Runs one engine's embedded stylesheet (export.xsl or build.xsl) on each input
document, through the engine's own CItemHelper, and writes the results to
OutDir. It needs no server and no credential.

For each input it records, in OutDir\cases\<name>\:
  transform.xml  the text the engine's transform writes: what ApplyXsl gets from
                 XslCompiledTransform.Transform into a StringWriter with the
                 invariant culture, before its SOAP-ENV replace and reload.
  applied.xml    the outer XML of the document after CItemHelper.ApplyXsl: the
                 transform, the replace, then LoadXml into the same document.
  An error of either step is recorded in host.json instead, with its type and message.

The stylesheet is read from the staged Libs.dll at run time, by the engine's own
GetXslTransform (a compiled transform, cached by resource name, as ApplyXsl uses it).
It is never written out; host.json holds its size and sha256 only.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $Engine,
    [Parameter(Mandatory)][string] $ToolsetDir,
    [Parameter(Mandatory)][string] $InputDir,
    [Parameter(Mandatory)][string] $OutDir,
    [Parameter(Mandatory)][ValidateSet('export.xsl','build.xsl')][string] $Xsl,
    # The source document's PreserveWhitespace: IOM's response DOM (true) for export.xsl,
    # CItemHelper.CreateNewXmlDocument() (false) for build.xsl.
    [Parameter(Mandatory)][bool] $PreserveWhitespace,
    # Sets the thread's CurrentCulture (xsl:sort uses it); empty keeps the host's.
    [string] $Culture,
    [Parameter(Mandatory)][string] $ExpectedLibsSha256,
    [Parameter(Mandatory)][string] $ExpectedLibsMvid,
    [Parameter(Mandatory)][string] $ExpectedLibsVersion,
    [Parameter(Mandatory)][string] $ExpectedIomSha256,
    [Parameter(Mandatory)][string] $ExpectedIomMvid,
    [Parameter(Mandatory)][string] $ExpectedIomVersion
)
. (Join-Path $PSScriptRoot 'common.ps1')
Add-Type -AssemblyName System.Xml

$engineAssemblies = Import-OracleEngine -Engine $Engine -ToolsetDir $ToolsetDir -Expected $PSBoundParameters
$libs = $engineAssemblies.Libs

if ($Culture) { [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo($Culture) }

$flags = [Reflection.BindingFlags]'Public,NonPublic,Static'
$cih = $libs.GetType('Aras.Tools.SolutionUpgrade.CItemHelper', $true)
$getXslTransform = $cih.GetMethod('GetXslTransform', $flags)
$applyXsl = $cih.GetMethod('ApplyXsl', $flags)
$getResourceStream = $cih.GetMethod('GetManifestResourceStream', $flags)
foreach ($m in @(@('GetXslTransform', $getXslTransform), @('ApplyXsl', $applyXsl), @('GetManifestResourceStream', $getResourceStream))) {
    if ($null -eq $m[1]) { throw "CItemHelper.$($m[0]) not found in Libs.dll $($libs.GetName().Version)" }
}

function Unwrap([Exception] $e) {
    # Reflection and PowerShell's method calls wrap the engine's exception.
    while (($e -is [Reflection.TargetInvocationException] -or $e -is [Management.Automation.MethodInvocationException]) -and $e.InnerException) { $e = $e.InnerException }
    return $e
}

# The type and message of an exception, and of its cause when it has one.
function Describe([Exception] $e) {
    $e = Unwrap $e
    $d = [ordered]@{ type = $e.GetType().FullName; message = $e.Message }
    if ($e.InnerException) {
        $d['cause'] = [ordered]@{ type = $e.InnerException.GetType().FullName; message = $e.InnerException.Message }
    }
    return $d
}

function Sha256Hex([byte[]] $bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
}

$utf8 = New-Object Text.UTF8Encoding($false)

function NewSource([string] $text) {
    $doc = New-Object Xml.XmlDocument
    $doc.PreserveWhitespace = $PreserveWhitespace
    $doc.LoadXml($text)
    return $doc
}

# The stylesheet's identity, from the same resource stream the engine compiles.
$stream = $getResourceStream.Invoke($null, @($Xsl))
$styleBytes = New-Object IO.MemoryStream
$stream.CopyTo($styleBytes)
$stream.Close()
$stylesheet = [ordered]@{ resource = $Xsl; bytes = [int]$styleBytes.Length; sha256 = (Sha256Hex $styleBytes.ToArray()) }

$cases = @()
foreach ($file in (Get-ChildItem -LiteralPath $InputDir -Filter '*.xml' -File | Sort-Object { $_.Name } )) {
    $name = [IO.Path]::GetFileNameWithoutExtension($file.Name)
    $inputBytes = [IO.File]::ReadAllBytes($file.FullName)
    $case = [ordered]@{ name = $name; inputSha256 = (Sha256Hex $inputBytes) }
    $caseDir = Join-Path $OutDir (Join-Path 'cases' $name)
    New-Item -ItemType Directory -Path $caseDir -Force | Out-Null
    $text = [IO.File]::ReadAllText($file.FullName)

    # Step 1: the raw transform, as ApplyXsl runs it.
    try {
        $source = NewSource $text
        $transform = $getXslTransform.Invoke($null, @($Xsl))
        $writer = New-Object IO.StringWriter([Globalization.CultureInfo]::InvariantCulture)
        $transform.Transform([Xml.XPath.IXPathNavigable]$source, $null, [IO.TextWriter]$writer)
        [IO.File]::WriteAllText((Join-Path $caseDir 'transform.xml'), $writer.ToString(), $utf8)
        $case['transform'] = 'transform.xml'
    } catch {
        $case['transformError'] = Describe $_.Exception
    }

    # Step 2: the engine's ApplyXsl itself, on a fresh document.
    try {
        $source = NewSource $text
        $applyXsl.Invoke($null, [object[]]@($source.psobject.BaseObject, $Xsl)) | Out-Null
        [IO.File]::WriteAllText((Join-Path $caseDir 'applied.xml'), $source.OuterXml, $utf8)
        $case['applied'] = 'applied.xml'
    } catch {
        $case['appliedError'] = Describe $_.Exception
    }
    $cases += , $case
    [Console]::Out.WriteLine(("CASE {0}: transform {1}, applied {2}" -f $name, $(if ($case['transform']) { 'ok' } else { 'error' }), $(if ($case['applied']) { 'ok' } else { 'error' })))
}

$info = [ordered]@{
    culture = [Threading.Thread]::CurrentThread.CurrentCulture.Name
    clr = [Environment]::Version.ToString()
    stylesheet = $stylesheet
    cases = $cases
}
[IO.File]::WriteAllText((Join-Path $OutDir 'host.json'), (ConvertTo-Json -InputObject $info -Depth 6), $utf8)
[Console]::Out.WriteLine("HOST_EXIT 0")
exit 0
