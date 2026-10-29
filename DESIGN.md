# Plebflix TV — visual system

A 90s living room, not a dark product UI. The page is a wall, a lamp, a plant, and a television on a wooden cabinet. An outside collaborator can mark this file up; the CSS variables in `public/styles.css` are the values below.

## Palette

| Token | Hex | Where |
| --- | --- | --- |
| Wall | `#e7b08c` | Page background, under the floral wallpaper |
| Floral | `#a85a62` | Wallpaper stroke (`public/wallpaper.svg`) |
| Cream | `#f3e2c8` | Baseboard, REC card, button label ink on the deck |
| Lamp | `#ffc27a` | Shade and the warm pool in the upper corner |
| Wood light | `#c48a55` | Top of the cabinet |
| Wood | `#8d5a32` | Cabinet body |
| Wood dark | `#6a3b22` | Cabinet bottom, library link |
| Shelf | `#4a2a16` | The recess the tapes sit in |
| Carpet | `#5c3a22` | The strip along the floor |
| Plastic | `#2c2622` | Bezel, transport keys |
| Brass | `#d7b15e` | PLEBTRON wordmark, focus ring, tape selection |
| Screen | `#070b0c` | Tube, behind the picture |
| Phosphor | `#d8ffc4` | OSD type |
| Record | `#d3222a` | REC dot, REC stamp, the left edge of the filing card |
| LCD | `#9fef7a` on `#10210f` | Deck readout and the power LED |

Suomi’s tape spine is red (`#d15a48` to `#8e2e28`). International’s is blue (`#4d82b8` to `#2a5278`).

## Type

- **VT323** — OSD, LCD, brand, transport keys, channel window. SIL Open Font License, `public/fonts/vt323-latin.woff2`.
- **Special Elite** — the REC card and the “Tape library” link. SIL Open Font License, `public/fonts/special-elite-latin.woff2`.

Both files are the Latin cut. Finnish ä, ö, and å are in that range. The stack falls through to a monospace or Palatino if a glyph is missing.

## The tube

The screen is 4:3, inset in a dark bezel with a brass PLEBTRON COLOR mark and a power LED (steady when the set is on, blinking while paused).

- The picture is scaled a few percent past the mask so the edges crop, a stand-in for barrel distortion.
- An inset shadow vignettes the glass.
- Scanlines are a 1px-on / 2px-off multiply gradient.
- A radial highlight sits on the upper left of the glass.
- A faint phosphor glow sits outside the tube.

VHS tracking, on a channel change or a seek, is a short burst of horizontal bars plus snow. Snow is a 160×120 canvas, drawn about 12 times a second, scaled up with pixelated rendering. STOP leaves the snow up and shows a colour-bar card reading PLEBFLIX / NO SIGNAL. `prefers-reduced-motion` drops the snow, the tracking burst, and the lamp flicker, and keeps a quieter scanline.

The OSD (VT323, phosphor, slight glow) carries the channel, a clock, the transport state (`PLAY ▶`, `PAUSE ❚❚`, `REW ◀◀`, `FWD ▶▶`, `STOP ■`, `REC ●`), the title, a SOURCE link to `original_url`, and a LIVE pill. After a local timeshift the pill reads `TIMESHIFT` and the offset. SOURCE and the LIVE pill are the controls on the glass. A “Tap for sound” button sits in the middle until the viewer unmutes; playback starts muted, with `playsinline` so iOS can keep the picture in the tube. A transparent shield covers the embed so a click inside the player cannot pause the broadcast out from under the schedule. A vote flashes in the middle of the glass (`UP ▲`, `DOWN ▼`, `ALREADY VOTED`, `NOT A TAPE`) and then clears.

Between clips the tube shows a station ident: the colour bars stay hidden, the card goes green, and it reads the channel name or `PLEBFLIX` over the line `Plebflix — real human slop`. It is drawn locally. It is not a video. The same line is engraved on a brass nameplate at the top of the cabinet.

The picture is scaled about 15% past the mask so a 16:9 letterbox pulls toward the bezel. The tube behind it is `#070b0c`. A real CRT overscans; the crop is that, kept light enough that a 4:3 frame still shows the face.

## The cabinet

Wood grain is a vertical stripe over a warm gradient. Under the LCD is a tape slot, then six beveled keys (REC, REW, PLAY, FWD, PAUSE, STOP), then CH− / name / CH+. Under that is a small remote: two wider keys, UP and DOWN, each with a thumb. The down thumb is the same mark turned over. A vote already cast on the tape that is on leaves that key pressed, in phosphor. Keys are at least 44px and the transport wraps to two rows of three under 560px. The lamp and the plant step aside on narrow screens so the set can use the width. The whole set shrinks with the viewport height so the deck stays on screen.

The REC dialog is an index card: cream stock, a red rule down the left, a tilted REC stamp, Special Elite. The heading is “File a tape.” It asks for the link, channel, title, year, a one-line why, and at least three signal checkboxes. EJECT closes it. FILE submits it.

## Components

Room (wallpaper, lamp, plant, floor), CRT bezel (brand, LED, screen, speaker grilles, channel window), stage (poster, YouTube mount, embed iframe, optional Ruffle mount, test card, station ident, snow), shield, OSD (including SOURCE, the unmute button, and the vote flash), scanlines, glass, tracking layer, cabinet, LCD, slot, transport, tuner, thumb remote, tape shelf, library link, REC dialog.
