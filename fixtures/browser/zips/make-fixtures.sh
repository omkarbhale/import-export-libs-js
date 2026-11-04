#!/usr/bin/env bash
# Regenerates the zips of this folder (ticket 18, HOST-250). The committed files are the fixtures: they are not rebuilt by `npm test`,
# and the bytes of a rebuild may differ (the tools write their own version stamps). Needs Info-ZIP `zip` 3.0, 7-Zip (`7z`) and Python 3.
#
#   ZIPBIN=/path/to/zip SEVENZ=/path/to/7z ./make-fixtures.sh
set -euo pipefail
ZIPBIN="${ZIPBIN:-zip}"
SEVENZ="${SEVENZ:-7z}"
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
export LC_ALL=C.UTF-8

# The package every zip holds (but for the names fixtures): a small tree with a folder that has no file, an empty file and a
# 3 kB file that deflates well. The times are fixed so that a rebuild is stable.
stage() {
  local root="$1"
  mkdir -p "$root/Pkg/ItemType" "$root/Pkg/sub/dir" "$root/Pkg/empty"
  printf '<imports>\r\n</imports>\r\n' > "$root/Pkg/imports.mf"
  printf '<?xml version="1.0"?>\n<AML><Item type="ItemType" id="1"/></AML>\n' > "$root/Pkg/ItemType/a.xml"
  printf '<AML>%s</AML>\n' "$(head -c 3000 /dev/zero | tr '\0' 'x')" > "$root/Pkg/sub/dir/b.xml"
  printf 'plain\n' > "$root/Pkg/readme.txt"
  : > "$root/Pkg/sub/zero.bin"
}
settime() { find "$1" -exec touch -d '2024-03-05 10:20:30' {} +; }

stage "$work/plain"; settime "$work/plain"
(cd "$work/plain" && "$ZIPBIN" -r -X -q "$here/info-zip.zip" Pkg)
(cd "$work/plain" && "$ZIPBIN" -r -X -q -fz "$here/info-zip-zip64.zip" Pkg)
# written to a pipe, Info-ZIP cannot go back to fill in the sizes, so every entry has a data descriptor
(cd "$work/plain" && "$ZIPBIN" -r -X -q - Pkg < /dev/null | cat > "$here/info-zip-streamed.zip")
(cd "$work/plain" && "$SEVENZ" a -tzip -mm=Deflate -mtm=on -bd -y "$here/7zip-deflate.zip" Pkg > /dev/null)
(cd "$work/plain" && "$SEVENZ" a -tzip -mm=Copy -bd -y "$here/7zip-store.zip" Pkg > /dev/null)

# macOS: what Finder's "Compress" leaves next to the folder (a __MACOSX tree of AppleDouble files) and inside it
stage "$work/mac"
mkdir -p "$work/mac/__MACOSX/Pkg/ItemType"
printf 'AppleDouble' > "$work/mac/__MACOSX/Pkg/._imports.mf"
printf 'AppleDouble' > "$work/mac/__MACOSX/Pkg/ItemType/._a.xml"
printf 'AppleDouble' > "$work/mac/__MACOSX/._Pkg"
printf 'Bud1' > "$work/mac/Pkg/.DS_Store"
printf 'Bud1' > "$work/mac/Pkg/sub/.DS_Store"
printf 'AppleDouble' > "$work/mac/Pkg/ItemType/._b.xml"
printf 'thumbs' > "$work/mac/Pkg/sub/Thumbs.db"
settime "$work/mac"
(cd "$work/mac" && "$ZIPBIN" -r -X -q "$here/macos-style.zip" Pkg __MACOSX)

# non-ASCII names: 7-Zip sets the UTF-8 flag; Info-ZIP 3.0 writes the UTF-8 bytes of the name and leaves the flag off
for tool in 7zip info-zip; do
  rm -rf "$work/names"; mkdir -p "$work/names/Pkg/日本語"
  printf '<a/>' > "$work/names/Pkg/café.xml"
  printf '<b/>' > "$work/names/Pkg/日本語/名前.xml"
  settime "$work/names"
  if [ "$tool" = 7zip ]; then
    (cd "$work/names" && "$SEVENZ" a -tzip -mcu=on -bd -y "$here/names-7zip-utf8.zip" Pkg > /dev/null)
  else
    (cd "$work/names" && "$ZIPBIN" -r -X -q "$here/names-info-zip.zip" Pkg)
  fi
done

python3 - "$here" <<'PY'
import sys, zipfile, time
here = sys.argv[1]
DATE = (2024, 3, 5, 10, 20, 30)

def entry(name, data=b"", directory=False):
    info = zipfile.ZipInfo(name, DATE)
    if directory:
        info.external_attr = 0x10
    return info

# Windows: Explorer's "Send to compressed folder" of older Windows and .NET's ZipFile before 4.6.1 wrote backslashes
with zipfile.ZipFile(f"{here}/windows-backslash.zip", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr(entry("Pkg\\", directory=True), b"")
    z.writestr(entry("Pkg\\imports.mf"), b"<imports>\r\n</imports>\r\n")
    z.writestr(entry("Pkg\\ItemType\\", directory=True), b"")
    z.writestr(entry("Pkg\\ItemType\\a.xml"), b'<?xml version="1.0"?>\n<AML><Item type="ItemType" id="1"/></AML>\n')
    z.writestr(entry("Pkg\\sub\\dir\\b.xml"), b"<AML>" + b"x" * 3000 + b"</AML>\n")

# Windows Explorer: names outside ASCII are written in the OEM code page (CP437 here), with no UTF-8 flag. Python would flag a
# non-ASCII name, so the name is written as ASCII placeholders of the same length and the bytes of the real name are put in.
placeholders = {"Pkg/cafX.xml": b"Pkg/caf\x82.xml", "Pkg/Xber.xml": b"Pkg/\x81ber.xml", "Pkg/straße": None}
with zipfile.ZipFile(f"{here}/names-cp437.zip", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr(entry("Pkg/cafX.xml"), b"<cafe/>")
    z.writestr(entry("Pkg/Xber.xml"), b"<uber/>")
    z.writestr(entry("Pkg/straX.xml"), b"<strasse/>")
raw = open(f"{here}/names-cp437.zip", "rb").read()
for old, new in ((b"Pkg/cafX.xml", b"Pkg/caf\x82.xml"), (b"Pkg/Xber.xml", b"Pkg/\x81ber.xml"), (b"Pkg/straX.xml", b"Pkg/stra\xe1.xml")):
    assert len(old) == len(new) and raw.count(old) == 2, old
    raw = raw.replace(old, new)
open(f"{here}/names-cp437.zip", "wb").write(raw)

# the same name with the UTF-8 flag, by a tool that writes it (Python), for a name outside CP437 as well
with zipfile.ZipFile(f"{here}/names-python-utf8.zip", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr(entry("Pkg/café.xml"), b"<cafe/>")
    z.writestr(entry("Pkg/日本語/名前.xml"), b"<name/>")
PY
ls -l "$here"/*.zip
