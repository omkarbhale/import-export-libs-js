#!/bin/sh
# Stages oracle/native/14.35 and the probes to %LOCALAPPDATA%\libsjs73-probe and runs one probe on Windows PowerShell 5.1.
# usage: run.sh <repo-root> <probe.ps1>   (in WSL); prints the probe's output with LF line breaks.
# 07-host-arguments and 08-host-lpimport also need the toolset's ConsoleUpgrade.exe(.config); set CU to the folder that holds it
# (Desktop\Delete me\PackageImportExportUtilities35\ConsoleUpgrade, WSL view under /mnt/c/Users/<you>/Desktop/).
set -e
REPO="$1"; P="$2"
WLOCAL="$(wslpath "$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')")"
L="$WLOCAL/libsjs73-probe"
mkdir -p "$L/14.35" "$L/cu"
cp -r "$REPO"/oracle/native/14.35/. "$L/14.35/"
cp "$REPO"/fixtures/import-languages/14.35/probes/*.ps1 "$L/"
if [ -n "$CU" ]; then
  cp "$CU/ConsoleUpgrade.exe" "$CU/ConsoleUpgrade.exe.config" "$L/cu/"
  cp "$L/14.35/Libs.dll" "$L/14.35/IOM.dll" "$L/cu/"
fi
WL="$(wslpath -w "$L")"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WL\\$P" | tr -d '\r'
