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
- LCD marquee: `TITLE ★ YEAR ★ NOW PLAYING ★`; lamps read LIVE / PAUSE / TIMESHIFT ±mm:ss / STOP. Exactly one transport key is latched.
- Schedule rows are real local wall-clock times from `schedule.js`; footer count = tapes on air in `channels/*.json`.
- Tally = `/api/stats` (yesterday's snapshot) + this viewer's fresh vote.
- SOURCE pill links each tape's `original_url`; Wayback links read `host (Wayback, year)`.
- REC dialog validates the host against the embed hosts + `sources.json` shelves and posts to `POST /api/recommend` (503 with a clear message while `GITHUB_TOKEN` is unset).
- Reduced motion: no marquee, static EQ, steady LEDs, no snow/glitch.
