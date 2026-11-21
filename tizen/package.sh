#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
studio=${TIZEN_STUDIO:-$HOME/Developer/_tools/tizen-studio}
profile=${TIZEN_PROFILE:-plebflix}
tizen="$studio/tools/ide/bin/tizen"
out="$root/dist/tizen"
stage="$out/stage"
cd "$root"
mkdir -p "$stage"
node tizen/build.mjs
cp tizen/config.xml tizen/index.html tizen/tv.css tizen/icon.png "$stage/"
"$tizen" package -t wgt -s "$profile" -- "$stage"
cp "$stage"/*.wgt "$out/PlebflixTV.wgt"
if [ "${1:-}" = install ]; then
 serial=${2:?pass TV serial}
 (cd "$out" && "$tizen" install -n PlebflixTV.wgt -s "$serial")
 "$tizen" run -p PlbFlx2026.PlebflixTV -s "$serial"
fi
