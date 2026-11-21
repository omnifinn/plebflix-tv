#!/bin/sh
# Build and sign Plebflix TV (.wgt) for a Samsung Tizen TV, and optionally install and launch it.
#   tizen/package.sh                 → dist/tizen/PlebflixTV.wgt
#   tizen/package.sh install <sdb-serial>   → also install on that TV and launch it
# Needs Tizen Studio's CLI (TIZEN_STUDIO, default ~/Developer/_tools/tizen-studio) and a signing profile
# (TIZEN_PROFILE, default "plebflix") whose certificate the TV accepts.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
studio=${TIZEN_STUDIO:-$HOME/Developer/_tools/tizen-studio}
profile=${TIZEN_PROFILE:-plebflix}
tizen="$studio/tools/ide/bin/tizen"
sdb="$studio/tools/sdb"
out="$root/dist/tizen"
stage="$out/stage"
rm -rf "$out"
mkdir -p "$stage"
cp "$root/tizen/config.xml" "$root/tizen/index.html" "$root/tizen/launcher.js" "$root/tizen/icon.png" "$stage/"
"$tizen" package -t wgt -s "$profile" -- "$stage"
mv "$stage"/*.wgt "$out/PlebflixTV.wgt"
echo "built $out/PlebflixTV.wgt"
if [ "${1:-}" = "install" ]; then
  serial=${2:?pass the sdb serial of the TV}
  # `sdb install` pushes the file but does not install on this TV; the tizen CLI does.
  (cd "$out" && "$tizen" install -n PlebflixTV.wgt -s "$serial")
  "$tizen" run -p PlbFlx2026.PlebflixTV -s "$serial"
fi
