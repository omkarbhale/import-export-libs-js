[void][Reflection.Assembly]::LoadFrom((Join-Path $env:LOCALAPPDATA 'libsjs10-probe\14.0.7\Libs.dll'))
$CM=[string][char]0x301
foreach($n in ('com.aras.innovator.solution.'+$CM+'x'),('com.aras.innovator.solution.x'),('com.aras.innovator.'+$CM+'x')){ Write-Output ("{0} core={1}" -f ($n -replace [char]0x301,'<U+0301>'), [Aras.Tools.SolutionUpgrade.ExportImportBase]::IsCorePackage($n)) }
