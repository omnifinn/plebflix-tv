# Plebflix TV for Samsung Tizen

The signed widget contains a television-specific interface, the schedule code and a catalog snapshot. It never loads the website UI. It refreshes catalog, schedule and daily vote snapshot JSON from plebflix.com; the last successful data is cached locally. When offline the bundled snapshot is used, so it can differ from the live schedule. YouTube uses a minimal player-only page on plebflix.com because the TV rejected the packaged origin with error 153; Archive sources are tried when a source fails or does not start within ten seconds for YouTube or eight seconds for Archive.

Remote: CH+/CH− or up/down change channel; digits select a channel; OK shows the banner. RED switches International/Suomi, GREEN opens the guide, YELLOW opens search, BLUE shows information. Arrows and OK navigate overlays. BACK closes an overlay or exits. Play, pause, stop, rewind and fast-forward control playback.

Build and sign with `tizen/package.sh`; `tizen/package.sh install <serial>` installs and launches. Requires Tizen Studio and the `plebflix` signing profile. App ID remains `PlbFlx2026.PlebflixTV`.
