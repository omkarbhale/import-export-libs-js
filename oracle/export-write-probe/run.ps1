param([string]$P)
& "$P\probe.ps1" -Bin "$P\bin" -Work "$P\work" | ForEach-Object { $_.Replace("$P\work", '<WD>') }
