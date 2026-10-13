<#
Oracle host for engine 14.0.7 (Libs 14.0.7.35492). Windows PowerShell 5.1.
Every parameter below the "Engine options" line maps to one property of this
engine's SolutionUpgradeContext, SUExportContext or SUImportContext (see
$OptionMap in common.ps1); unset parameters keep the engine's own defaults.
Run through `npm run oracle`, which stages the toolset, checks its hashes and
passes ARAS_PASSWORD through WSLENV.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('export','import','lpimport')][string] $Command,
    [Parameter(Mandatory)][string] $ToolsetDir,
    [Parameter(Mandatory)][string] $OutDir,
    [Parameter(Mandatory)][string] $WorkDir,
    [Parameter(Mandatory)][string] $Url,
    [Parameter(Mandatory)][string] $Database,
    [Parameter(Mandatory)][string] $User,
    [Parameter(Mandatory)][string] $ExpectedLibsSha256,
    [Parameter(Mandatory)][string] $ExpectedLibsMvid,
    [Parameter(Mandatory)][string] $ExpectedLibsVersion,
    [Parameter(Mandatory)][string] $ExpectedIomSha256,
    [Parameter(Mandatory)][string] $ExpectedIomMvid,
    [Parameter(Mandatory)][string] $ExpectedIomVersion,
    # How the password reaches IOM: plain (IOM hashes it) or md5 (the host sends the MD5 hex).
    [ValidateSet('plain','md5')][string] $PasswordForm = 'plain',
    # Also call IOM Login() before CItemHelper.Login(); 14.x Libs logs in itself.
    [switch] $HostLogin,
    # Skip CItemHelper.logout() at the end (Aras's ConsoleUpgrade logs out).
    [switch] $NoLogout,
    # What the errorQuestion channel answers: yes continues past an import error.
    [ValidateSet('yes','no','none')][string] $ErrorQuestionAnswer = 'no',
    [int] $Timeout = 600000,
    # export: "package<TAB>type<TAB>id<TAB>keyed name" per item.
    [string[]] $Items,
    # import: the manifest's full path; Packages defaults to every package in it.
    [string] $ImportManifest,
    [string[]] $Packages,

    # ---- Engine options ----
    [switch] $ContextVerbose,
    [string] $ManifestFile,
    [string] $LPPath,
    [string] $LPPackage,
    [switch] $LPDebug,
    [string] $CertificateStoreLocation,
    [string] $CertificateStoreName,
    [string] $CertificateFindType,
    [string] $CertificateFindValue,
    [switch] $CertificateValidOnly,
    [string] $Level,
    [switch] $ExportReferencedItems,
    [ValidateSet('RemoveSilently','RemoveWithWarning','DoNotRemove')][string] $RefToUnknownPacks,
    [switch] $UseImport,
    [switch] $Merge,
    [switch] $Fast,
    [string] $Release,
    [string] $Description,
    [switch] $Vault
)
. (Join-Path $PSScriptRoot 'common.ps1')
$defaults = @{ PasswordForm = $PasswordForm; HostLogin = [bool]$HostLogin; ErrorQuestionAnswer = $ErrorQuestionAnswer; Timeout = $Timeout }
$result = @(Invoke-OracleHost -Engine '14.0.7' -BoundParameters $PSBoundParameters -Defaults $defaults)
exit ([int]$result[-1])
