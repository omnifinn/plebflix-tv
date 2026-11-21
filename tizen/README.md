# Plebflix TV on a Samsung TV (Tizen)

The TV app is a small launcher (`tizen/`) plus the live deck at **https://plebflix.com/tv/**.

- `tizen/launcher.js` runs inside the signed `.wgt`. Tizen APIs only exist there, so it registers the remote keys
  (CH+/CH−, digits, play/pause/stop/rew/ffwd, colour keys) and opens `https://plebflix.com/tv/`.
- `/tv/` is built by `scripts/build.mjs` (`buildTv`): the same deck, schedule, channels, search and players, bundled into
  one classic script lowered for the TV's Chromium, `public/tv/polyfills.js` for missing runtime APIs, one lowered
  stylesheet with `public/tv/tv.css` (fixed 1080p sizes, big focus ring), and `public/tv/remote.js` (remote control).
  Because the deck is served from plebflix.com, YouTube embeds get the site's own origin and referrer, and every site
  deploy updates the TV without reinstalling.

## Remote

| Key | Watching (nothing highlighted) | Deck (a control highlighted) |
| --- | --- | --- |
| ▲ / ▼, CH+ / CH− | next / previous channel | ▲ ▼ move the highlight; CH± still change channel |
| ◀ / ▶ | seek −15 s / +15 s | move the highlight |
| OK | show the deck controls (highlight PAUSE) | press the highlighted control |
| BACK | close the app | hide the highlight (or close search / the skin menu / REC) |
| 0–9 | tune that channel number | same |
| ▶ ❚❚ ■ ◀◀ ▶▶ | play, pause, stop, rewind, fast-forward | same |
| RED / GREEN / YELLOW / BLUE | International ⇄ Suomi / go live / search / LIVE→LOOP→SHUFFLE | same |

## Build, sign, install

From a Mac with Tizen Studio (`~/Developer/_tools/tizen-studio`), the signing profile `plebflix` and the TV connected
with `sdb connect <tv-ip>` (developer mode on the TV, this Mac's IP as the developer host):

```sh
tizen/package.sh                       # → dist/tizen/PlebflixTV.wgt
tizen/package.sh install <sdb-serial>  # also install and launch it
```

App id `PlbFlx2026.PlebflixTV`, name **Plebflix TV**. It shows up in the TV's Apps list.
