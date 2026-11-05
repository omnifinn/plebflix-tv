#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
out=${1:?Pass an output directory outside the source tree}
mkdir -p "$out/channels"
cp "$root"/apps/tv/config.xml "$root"/apps/tv/index.html "$root"/apps/tv/style.css "$root"/apps/tv/app.js "$out/"
cp "$root"/channels/international.json "$root"/channels/suomi.json "$out/channels/"
