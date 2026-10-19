#!/bin/bash
# Stage the vendored toolset (ENGINE=12.0, 14.0.7 or 14.35; default 14.0.7), the toolset's own ConsoleUpgrade.exe and the probe's inputs under
# %LOCALAPPDATA% (.NET refuses assemblies from \\wsl.localhost), run the probe, and write the result to
# fixtures/export-modes/<engine>-probe.json (or the path given as the first argument). ConsoleUpgrade.exe is not vendored: it is read
# from the captain's toolset folder and checked against the sha256 pinned below.
set -e
ENGINE="${ENGINE:-14.0.7}"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
desktop="/mnt/c/Users/omkarb/Desktop"
case "$ENGINE" in
  12.0)   console="$desktop/ImportExport/12/ConsoleUpgrade/ConsoleUpgrade.exe";  sha=b00085df94ee5719cef1c12388c60fc69e60c9f2278d7373373192ae810d70d7 ;;
  14.0.7) console="$desktop/ImportExport/23/ConsoleUpgrade/ConsoleUpgrade.exe";  sha=10c7ff72613f9784c8edecf5a7c91c775c93d224acc9fde45f662a579ff8a3f8 ;;
  14.35)  console="$desktop/Delete me/PackageImportExportUtilities35/ConsoleUpgrade/ConsoleUpgrade.exe"; sha=237f412b4621755683e253ac68b46aae4f7524a8d051f24fac819e060a6736a9 ;;
  *) echo "unknown ENGINE $ENGINE" >&2; exit 2 ;;
esac
# the recorded GetSolutions2Xml answer of ticket 24 (dev, 55 packages): fixtures/14.0.7/export/p1-order-six-forward, call 7
blob="$repo/fixtures/14.0.7/export/_blobs/316a9c3d9a9560ddfc841f6a2eeac8ee1be992500fd4610f8a50458e38cb7910.xml"
stage="$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')\\import-export-libs-js\\export-modes-probe"
wstage="$(wslpath "$stage")"
rm -rf "$wstage"; mkdir -p "$wstage/bin" "$wstage/probe" "$wstage/inputs" "$wstage/work"
cp -r "$repo/oracle/native/$ENGINE/." "$wstage/bin/"
cp "$console" "$wstage/bin/ConsoleUpgrade.exe"
cp "$repo/oracle/export-output-probe/Stub.cs" "$here/Probe.cs" "$here/probe.ps1" "$wstage/probe/"
cp "$blob" "$wstage/blob.xml"
# ticket 25's input folders: every recorded import step's input, kept under its case and step
(cd "$repo/fixtures/$ENGINE/import" && find . -type d -name input | while read -r d; do mkdir -p "$wstage/inputs/$d"; cp -r "$d/." "$wstage/inputs/$d/"; done)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$stage\\probe\\probe.ps1" -Bin "$stage\\bin" -Inputs "$stage\\inputs" -Blob "$stage\\blob.xml" -Work "$stage\\work" -Out "$stage\\out.json" -ProbeDir "$stage\\probe" -Engine "$ENGINE" -ConsoleSha256 "$sha"
mkdir -p "$repo/fixtures/export-modes"
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8").replace(/^﻿/,""));fs.writeFileSync(process.argv[2],JSON.stringify(j,null,2)+"\n")' "$wstage/out.json" "${1:-$repo/fixtures/export-modes/$ENGINE-probe.json}"
rm -rf "$wstage"
