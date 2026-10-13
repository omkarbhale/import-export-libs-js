<#
Shared body of the per-engine oracle hosts (engine-<version>.ps1). Windows
PowerShell 5.1 only: it loads one engine's IOM.dll and Libs.dll from a staged,
hash-checked toolset folder, compiles OracleHost.cs against them, and runs one
export, import or language-pack import through the recording connection.

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
    CertificateStoreLocation = 'Context.CertificateStoreLocation'
    CertificateStoreName     = 'Context.CertificateStoreName'
    CertificateFindType      = 'Context.CertificateFindType'
    CertificateFindValue     = 'Context.CertificateFindValue'
    CertificateValidOnly     = 'Context.CertificateValidOnly'
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
    $iomPath = Join-Path $toolset 'IOM.dll'
    $libsPath = Join-Path $toolset 'Libs.dll'

    # The hash check comes before anything is loaded.
    Assert-Sha256 'IOM.dll' $iomPath $Bound['ExpectedIomSha256']
    Assert-Sha256 'Libs.dll' $libsPath $Bound['ExpectedLibsSha256']

    # 14.35 ships binding redirects in import.exe.config; a PowerShell host has
    # none, so dependencies resolve by simple name from the toolset folder.
    $script:toolsetDir = $toolset
    [AppDomain]::CurrentDomain.add_AssemblyResolve({
        param($sender, $e)
        $name = (New-Object System.Reflection.AssemblyName($e.Name)).Name
        $candidate = Join-Path $script:toolsetDir ($name + '.dll')
        if (Test-Path -LiteralPath $candidate) { return [System.Reflection.Assembly]::LoadFrom($candidate) }
        return $null
    })
    $iom = [System.Reflection.Assembly]::LoadFrom($iomPath)
    $libs = [System.Reflection.Assembly]::LoadFrom($libsPath)
    Assert-Loaded 'IOM.dll' $iom $toolset $Bound['ExpectedIomMvid'] $Bound['ExpectedIomVersion']
    Assert-Loaded 'Libs.dll' $libs $toolset $Bound['ExpectedLibsMvid'] $Bound['ExpectedLibsVersion']
    [Console]::Out.WriteLine(("ENGINE {0}: Libs {1} ({2}), IOM {3} ({4})" -f $Engine, $libs.GetName().Version, $Bound['ExpectedLibsMvid'], $iom.GetName().Version, $Bound['ExpectedIomMvid']))

    $source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'OracleHost.cs')
    if ($Engine -eq '12.0') { $source = "#define ENGINE_12`n" + $source }
    $refs = @($iomPath, $libsPath, 'System.Xml')
    $netstandard = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'Facades\netstandard.dll'
    if ($Engine -eq '14.35' -and (Test-Path -LiteralPath $netstandard)) { $refs += $netstandard }
    Add-Type -TypeDefinition $source -ReferencedAssemblies $refs

    $password = $env:ARAS_PASSWORD
    if ([string]::IsNullOrEmpty($password)) { throw 'ARAS_PASSWORD is not set' }
    if ($Bound['PasswordForm'] -eq 'md5') {
        $md5 = [System.Security.Cryptography.MD5]::Create()
        $password = -join ($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($password)) | ForEach-Object { $_.ToString('x2') })
    }

    $request = New-Object LibsJsOracle.HostRequest
    $request.Command = $Bound['Command']
    $request.Url = $Bound['Url']
    $request.Database = $Bound['Database']
    $request.User = $Bound['User']
    $request.Password = $password
    $request.HostLogin = [bool]$Bound['HostLogin']
    $request.Logout = -not [bool]$Bound['NoLogout']
    $request.Timeout = $Bound['Timeout']
    $request.ErrorQuestionAnswer = switch ($Bound['ErrorQuestionAnswer']) { 'yes' { $true } 'no' { $false } default { $null } }
    $request.OutDir = $Bound['OutDir']
    $request.WorkDir = $Bound['WorkDir']
    if ($Bound.ContainsKey('ImportManifest')) { $request.ManifestFile = $Bound['ImportManifest'] }
    # Each item is "package<TAB>type<TAB>id<TAB>keyed name".
    if ($Bound.ContainsKey('Items')) { $request.Items = [string[]]$Bound['Items'] }
    if ($Bound.ContainsKey('Packages')) { $request.Packages = [string[]]$Bound['Packages'] }
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
