# Standalone Plebflix TV launcher

The Tizen application opens the live `https://plebflix.com/` site as its top
level page. This preserves the real Plebflix interface, schedule, player,
channels, and origin. The icon is the project's `public/icon-192.png`. It is
an online website launcher, not a bundled native port; it does not provide its
own offline downloads or family library. TV remote operation and playback need
user verification. It is independent of Bask.

Build with `apps/tv/prepare.sh <output-dir>` and package the output with the
Tizen CLI and the television signing profile. The app ID is
`PlbFlx2026.Plebflix`, distinct from Bask. The earlier iOS experiment is not
part of this TV app or package.
