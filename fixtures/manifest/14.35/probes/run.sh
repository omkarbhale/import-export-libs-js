#!/bin/sh
# Stages oracle/native/14.35 and the probes to %LOCALAPPDATA%\libsjs60-probe and runs one probe on Windows PowerShell 5.1.
# usage: run.sh <repo-root> <probe.ps1>   (in WSL); prints the probe's output with LF line breaks.
set -e
REPO="$1"; P="$2"
WLOCAL="$(wslpath "$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')")"
L="$WLOCAL/libsjs60-probe"
mkdir -p "$L/14.35"
cp -r "$REPO"/oracle/native/14.35/. "$L/14.35/"
cp "$REPO"/fixtures/manifest/14.35/probes/*.ps1 "$L/"
WL="$(wslpath -w "$L")"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WL\\$P" | tr -d '\r'
