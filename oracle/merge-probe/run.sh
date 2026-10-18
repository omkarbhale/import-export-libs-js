#!/bin/bash
# Stage the toolset and the probe sources under %LOCALAPPDATA% (.NET refuses assemblies from \\wsl.localhost), run the probe, print where the JSON landed.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
stage="$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')\\import-export-libs-js\\merge-probe"
wstage="$(wslpath "$stage")"
rm -rf "$wstage"; mkdir -p "$wstage/bin" "$wstage/request-probe" "$wstage/merge-probe"
cp "$repo/oracle/native/14.0.7/IOM.dll" "$repo/oracle/native/14.0.7/Libs.dll" "$wstage/bin/"
cp "$repo/oracle/request-probe/Stub.cs" "$wstage/request-probe/"
cp "$here/StubHelper.cs" "$here/probe-14.0.7.ps1" "$wstage/merge-probe/"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$stage\\merge-probe\\probe-14.0.7.ps1" -ToolsetDir "$stage\\bin" -RequestProbeDir "$stage\\request-probe" -Out "$stage\\out.json"
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8").replace(/^\uFEFF/,""));fs.writeFileSync(process.argv[2],JSON.stringify(j,null,2)+"\n")' "$wstage/out.json" "${1:-$repo/fixtures/import-merge/14.0.7-probe/results.json}"
rm -rf "$wstage"
