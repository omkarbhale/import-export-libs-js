#!/bin/sh
# Stage a vendored toolset and this folder to %LOCALAPPDATA%, run the probe, copy the output back.
# usage: run.sh <repo-root> <output file> [scenario glob] [engine: 14.0.7 (default) | 14.35 | 12.0]
set -e
REPO="$1"; OUT="$2"; ONLY="${3:-}"; ENGINE="${4:-14.0.7}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WLOCAL="$(wslpath "$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')")"
STAGE="$WLOCAL/libsjs-22-probe"
rm -rf "$STAGE"; mkdir -p "$STAGE/bin" "$STAGE/work"
cp -r "$REPO"/oracle/native/"$ENGINE"/* "$STAGE/bin/"
cp "$HERE/probe.ps1" "$HERE/Probe.cs" "$STAGE/"
WSTAGE="$(wslpath -w "$STAGE")"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$WSTAGE\\probe.ps1" -ToolsetDir "$WSTAGE\\bin" -Work "$WSTAGE\\work" -Out "$WSTAGE\\out.txt" -Only "$ONLY" -Engine "$ENGINE"
cp "$STAGE/out.txt" "$OUT"
rm -rf "$STAGE"
