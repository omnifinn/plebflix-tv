# Plebflix TV — visual system ("PLEBAMP" skin)

Designed by Iris (late-90s Winamp-skin direction), built into `public/` on 29 Oct 2026. It replaces the v1 "90s living room" set.

- **Tokens and components:** `public/styles/tokens.css` — palette, fonts, bevels, glows, window chrome, LCD + marquee, lamp, EQ, keys, rocker, schedule rows, pill, plaques. Suomi swaps only the LCD/accent colours via `body[data-channel="suomi"]`.
- **Layout and live-player layers:** `public/styles.css` — desktop (≥1100, compact at 1100–1379), tablet (720–1099), mobile (<720, sticky screen, accordions, thumb dock), plus the embed stage, ident/test card, snow, tracking glitch and REC dialog states.
- **Markup:** `public/index.html` (inline icon sprite). **Behaviour:** `public/app.js`.
- **Brand:** `public/brand/` (wordmarks, idents), `public/og-image.png`, favicon set + `site.webmanifest` at the root. Textures in `public/textures/`.

## Palette

| Token | Intl (default) | Suomi | Use |
| --- | --- | --- | --- |
| `--desk` | `#0B0D10` | same | page |
| `--panel` / hi / lo | `#2B3036` / `#4A525B` / `#16191D` | same | brushed windows, bevels |
| `--ink` / `--ink-dim` | `#E9ECEF` / `#9AA3AD` | same | labels |
| `--lcd` on `--lcd-bg` | `#7CFF6B` on `#050A06` | `#6FD8FF` on `#04080D` | LCD, EQ, now row |
| `--amber` | `#FFB547` | same | focus, timeshift lamp, lit keys (Intl) |
| `--channel-accent` / `--key-lit` | amber | `#2F6BFF` / `#4C8DFF` | rocker, lit keys |
| `--rec` | `#E5322B` | same | REC key, LIVE LED |

## Type

VT323 (LCDs), Silkscreen (8px décor), Chakra Petch 700 italic (wordmark, outlined in the SVGs), IBM Plex Mono (window titles, schedule, rocker, pill), IBM Plex Sans (captions, forms). VT323/Silkscreen/Chakra Petch are self-hosted OFL subsets. IBM Plex is **not** self-hosted: IBM reserves the "Plex" name for modified files, so it loads from Google Fonts.

## Behaviour notes

- The screen fits the 16:9 embed by height (pillarbox, never crop). Idents use `brand/ident-{intl,suomi}.svg`; STOP shows colour bars + NO SIGNAL.
- LCD marquee: `TITLE ★ YEAR ★ NOW PLAYING ★`; lamps read LIVE / PAUSE (−mm:ss behind live) / TIMESHIFT ±mm:ss (REW, FWD, scrubber) / CONTINUOUS (Skip, Back, schedule row, search) / LOOP / SHUFFLE / STOP. Exactly one transport key is latched; PAUSE pressed again plays on.
- Schedule window = the UTC day's programme guide at local wall-clock times (`schedule.js`), a date divider at local midnight; inverse row = ON AIR on the shared clock (click → GO LIVE), amber-outlined row = this viewer when off the broadcast; the well scrolls and follows the row that matters unless the viewer scrolled it in the last 20 s; footer count = tapes airing today. It stays readable during STOP.
- Tally = `/api/stats` (yesterday's snapshot) + this viewer's fresh vote.
- SOURCE pill links each tape's `original_url`; Wayback links read `host (Wayback, year)`.
- REC dialog is one field: a pasted link files itself (`POST /api/recommend` → D1 `submissions`, channel = the TV that is on). The host echo shows known shelves from `sources.json`. 503 "The tape shelf is offline" while `DB` is unbound.
- A click on the glass pauses; the next click plays on (or wakes a stopped set). Buttons on the OSD keep their own meaning.
- Reduced motion: no marquee, static EQ, steady LEDs, no snow/glitch.
