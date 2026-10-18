#!/bin/sh
# Stage the vendored 14.0.7 toolset and this folder to %LOCALAPPDATA%, run the probe, copy the output back.
# usage: run.sh <repo-root> <output file> [scenario glob]
set -e
REPO="$1"; OUT="$2"; ONLY="${3:-}"
WLOCAL="$(wslpath "$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')")"
STAGE="$WLOCAL/libsjs-22-probe"
rm -rf "$STAGE"; mkdir -p "$STAGE/bin" "$STAGE/work"
cp "$REPO"/oracle/native/14.0.7/* "$STAGE/bin/" 2>/dev/null || true
cp -r "$REPO"/oracle/native/14.0.7/runtimes "$STAGE/bin/" 2>/dev/null || true
cp "$REPO"/fixtures/import-run/probe/probe.ps1 "$REPO"/fixtures/import-run/probe/Probe.cs "$STAGE/"
WSTAGE="$(wslpath -w "$STAGE")"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WSTAGE\\probe.ps1" -ToolsetDir "$WSTAGE\\bin" -Work "$WSTAGE\\work" -Out "$WSTAGE\\out.txt" -Only "$ONLY"
cp "$STAGE/out.txt" "$OUT"
rm -rf "$STAGE"
