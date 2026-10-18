<#
Shared body of the per-engine oracle hosts (engine-<version>.ps1). Windows
PowerShell 5.1 only: it loads one engine's IOM.dll and Libs.dll from a staged,
hash-checked toolset folder, compiles OracleHost.cs against them, and runs one
export, import, language-pack import or DB patch run (14.35) through the recording connection.

The password comes only from $env:ARAS_PASSWORD (passed through WSLENV) and is
never written or printed.
#>
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

# Host parameter name -> engine property. Context = SolutionUpgradeContext,
# Export = SUExportContext, Import = SUImportContext.
$script:OptionMap = [ordered]@{
    EngineAction             = 'Context.Action'
    ContextVerbose           = 'Context.Verbose'
    ManifestFile             = 'Context.ManifestFile'
    LPPath                   = 'Context.LPPath'
    LPPackage                = 'Context.LPPackage'
    LPDebug                  = 'Context.LPDebug'
    Languages                = 'Context.Languages'
    Level                    = 'Export.sLevel'
    ExportReferencedItems    = 'Export.bExportReferencedItems'
    RefToUnknownPacks        = 'Export.RefToUnknownPacks'
    UseImport                = 'Export.UseImport'
    Merge                    = 'Import.bMerge'
    Fast                     = 'Import.bFast'
    Release                  = 'Import.Release'
    Description              = 'Import.Description'
    Vault                    = 'Import.bVault'
    AmlBatchMode             = 'Import.AmlBatchMode'
    AmlBatchMaxSize          = 'Import.AmlBatchMaxSize'
    CollectImportErrors      = 'Import.CollectImportErrors'
    CollectImportErrorsMaxCount = 'Import.CollectImportErrorsMaxCount'
}

function Assert-Sha256([string] $Label, [string] $Path, [string] $Sha256) {
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256) { throw "$Label sha256 $actual does not match the manifest ($Sha256)" }
}

function Assert-Loaded([string] $Label, [System.Reflection.Assembly] $Assembly, [string] $ToolsetDir, [string] $Mvid, [string] $Version) {
    $location = [System.IO.Path]::GetFullPath($Assembly.Location)
    $root = [System.IO.Path]::GetFullPath($ToolsetDir).TrimEnd('\') + '\'
    if (-not $location.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label loaded from $location, not from the staged toolset $root"
    }
    $loadedMvid = $Assembly.ManifestModule.ModuleVersionId.ToString()
    if ($loadedMvid -ne $Mvid) { throw "$Label MVID $loadedMvid does not match the manifest ($Mvid)" }
    $loadedVersion = $Assembly.GetName().Version.ToString()
    if ($loadedVersion -ne $Version) { throw "$Label version $loadedVersion does not match the manifest ($Version)" }
}

# Hash-checks IOM.dll and Libs.dll in a staged toolset, loads both, and asserts they are the
# manifest's builds loaded from that folder. Returns the two assemblies. The hash check comes
# before anything is loaded.
function Import-OracleEngine {
    param(
        [Parameter(Mandatory)][string] $Engine,
        [Parameter(Mandatory)][string] $ToolsetDir,
        [Parameter(Mandatory)] $Expected
    )
    $iomPath = Join-Path $ToolsetDir 'IOM.dll'
    $libsPath = Join-Path $ToolsetDir 'Libs.dll'
    Assert-Sha256 'IOM.dll' $iomPath $Expected['ExpectedIomSha256']
    Assert-Sha256 'Libs.dll' $libsPath $Expected['ExpectedLibsSha256']

    # 14.35 ships binding redirects in import.exe.config; a PowerShell host has
    # none, so dependencies resolve by simple name from the toolset folder.
    $script:toolsetDir = $ToolsetDir
    [AppDomain]::CurrentDomain.add_AssemblyResolve({
        param($sender, $e)
        $name = (New-Object System.Reflection.AssemblyName($e.Name)).Name
        $candidate = Join-Path $script:toolsetDir ($name + '.dll')
        if (Test-Path -LiteralPath $candidate) { return [System.Reflection.Assembly]::LoadFrom($candidate) }
        return $null
    })
    $iom = [System.Reflection.Assembly]::LoadFrom($iomPath)
    $libs = [System.Reflection.Assembly]::LoadFrom($libsPath)
    Assert-Loaded 'IOM.dll' $iom $ToolsetDir $Expected['ExpectedIomMvid'] $Expected['ExpectedIomVersion']
    Assert-Loaded 'Libs.dll' $libs $ToolsetDir $Expected['ExpectedLibsMvid'] $Expected['ExpectedLibsVersion']
    [Console]::Out.WriteLine(("ENGINE {0}: Libs {1} ({2}), IOM {3} ({4})" -f $Engine, $libs.GetName().Version, $Expected['ExpectedLibsMvid'], $iom.GetName().Version, $Expected['ExpectedIomMvid']))
    return @{ Iom = $iom; Libs = $libs; IomPath = $iomPath; LibsPath = $libsPath }
}

function Invoke-OracleHost {
    param(
        [Parameter(Mandatory)][string] $Engine,
        # The calling host's $PSBoundParameters.
        [Parameter(Mandatory)] $BoundParameters,
        # Values of host parameters that have defaults, which $PSBoundParameters omits.
        [Parameter(Mandatory)][hashtable] $Defaults
    )
    $Bound = @{}
    foreach ($key in $Defaults.Keys) { $Bound[$key] = $Defaults[$key] }
    foreach ($key in $BoundParameters.Keys) { $Bound[$key] = $BoundParameters[$key] }
    $toolset = $Bound['ToolsetDir']
    $engineAssemblies = Import-OracleEngine -Engine $Engine -ToolsetDir $toolset -Expected $Bound
    $iomPath = $engineAssemblies.IomPath
    $libsPath = $engineAssemblies.LibsPath

    $source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'OracleHost.cs')
    if ($Engine -eq '12.0') { $source = "#define ENGINE_12`n" + $source }
    # Only 14.35 has ApplyDBUpdateManifest and DBUpdateConfig (spec/db-patches.md, DBP-001).
    if ($Engine -eq '14.35') { $source = "#define ENGINE_DBPATCH`n" + $source }
    $refs = @($iomPath, $libsPath, 'System.Xml')
    $netstandard = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'Facades\netstandard.dll'
    if ($Engine -eq '14.35' -and (Test-Path -LiteralPath $netstandard)) { $refs += $netstandard }
    Add-Type -TypeDefinition $source -ReferencedAssemblies $refs

    $password = $env:ARAS_PASSWORD
    if ([string]::IsNullOrEmpty($password)) { throw 'ARAS_PASSWORD is not set' }
    # 14.35's host hands IOM the MD5 hex: IOM 15 would otherwise send the plain password first.
    if ($Engine -eq '14.35') {
        $md5 = [System.Security.Cryptography.MD5]::Create()
        $password = -join ($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($password)) | ForEach-Object { $_.ToString('x2') })
    }

    $request = New-Object LibsJsOracle.HostRequest
    $request.Command = $Bound['Command']
    $request.Url = $Bound['Url']
    $request.Database = $Bound['Database']
    $request.User = $Bound['User']
    $request.Password = $password
    $request.Timeout = $Bound['Timeout']
    $request.ErrorQuestionAnswer = switch ($Bound['ErrorQuestionAnswer']) { 'yes' { $true } 'no' { $false } default { $null } }
    $request.OutDir = $Bound['OutDir']
    $request.WorkDir = $Bound['WorkDir']
    if ($Bound.ContainsKey('ImportManifest')) { $request.ManifestFile = $Bound['ImportManifest'] }
    # Each item is "package<TAB>type<TAB>id<TAB>keyed name".
    if ($Bound.ContainsKey('Items')) { $request.Items = [string[]]$Bound['Items'] }
    if ($Bound.ContainsKey('Packages')) { $request.Packages = [string[]]$Bound['Packages'] }
    if ($Bound.ContainsKey('CancelAfterStatus')) { $request.CancelAfterStatus = [int]$Bound['CancelAfterStatus'] }
    if ($Bound.ContainsKey('KeepCreated')) { $request.KeepCreated = $Bound['KeepCreated'].IsPresent }
    if ($Bound.ContainsKey('PriorCreated')) { $request.PriorCreated = [string[]]$Bound['PriorCreated'] }
    if ($Bound.ContainsKey('VersionBefore')) { $request.VersionBefore = [string[]]$Bound['VersionBefore'] }
    if ($Bound.ContainsKey('LockUpgradeRows')) { $request.LockUpgradeRows = $Bound['LockUpgradeRows'].IsPresent }
    if ($Bound.ContainsKey('DbManifest')) { $request.DbManifest = $Bound['DbManifest'] }
    if ($Bound.ContainsKey('DbPatchesFolder')) { $request.DbPatchesFolder = $Bound['DbPatchesFolder'] }
    if ($Bound.ContainsKey('DbToolName')) { $request.DbToolName = $Bound['DbToolName'] }
    if ($Bound.ContainsKey('ExpectedDbManifestSha256')) { $request.ExpectedDbManifestSha256 = $Bound['ExpectedDbManifestSha256'] }
    if ($Bound.ContainsKey('ExpectedDbPatchSha256')) { $request.ExpectedDbPatchSha256 = $Bound['ExpectedDbPatchSha256'] }
    if ($Bound.ContainsKey('DbPatchCleanup')) { $request.DbPatchCleanup = $Bound['DbPatchCleanup'].IsPresent }
    $request.Context = @{}
    $request.Export = @{}
    $request.Import = @{}
    foreach ($name in $script:OptionMap.Keys) {
        if (-not $Bound.ContainsKey($name)) { continue }
        $target, $property = $script:OptionMap[$name].Split('.')
        $value = $Bound[$name]
        if ($value -is [System.Management.Automation.SwitchParameter]) { $value = $value.IsPresent }
        if ($value -is [array]) { $value = $value -join ',' }
        switch ($target) {
            'Context' { $request.Context[$property] = [string]$value }
            'Export' { $request.Export[$property] = [string]$value }
            'Import' { $request.Import[$property] = [string]$value }
        }
    }

    $code = [LibsJsOracle.Host]::Run($request)
    [Console]::Out.WriteLine("HOST_EXIT $code")
    return $code
}
