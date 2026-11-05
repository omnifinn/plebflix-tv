# Standalone Plebflix TV port

`apps/tv/build.mjs` packages the Plebflix website's own interface, player,
scheduling code, channel data, artwork and icon into the Tizen application.
It transpiles the website JavaScript for the TV browser and adds remote focus
navigation. It is separate from Bask. No YouTube likes or comments are used.

Build to a fresh external directory by setting `PLEBFLIX_ESBUILD` to an
installed esbuild module and running `node apps/tv/build.mjs <output-dir>`.
Package the result with the local Tizen CLI and television signing profile.
The application ID remains `PlbFlx2026.Plebflix`.

The packaged player runs from the Tizen application origin. The website's
remote APIs and YouTube embeds may have origin/referrer requirements; these
must be checked on the actual TV. Offline downloading and family sharing are
not implemented in this port. Device installation does not establish that
playback or remote input work.
