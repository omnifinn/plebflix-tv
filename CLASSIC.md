# What counts as an internet classic

Plebflix TV is an archive of internet video culture up to 2013. A tape is on air only if it **became popular online as an internet meme or viral video**, however it was first released: a homemade upload, a Flash cartoon, or a TV, film or game-show clip that people spread, remixed and quoted on the web.

## The hard rule

1. **Viral or meme status online.** There must be evidence it spread on the web: a Know Your Meme, Wikipedia or meemi.info entry, a Riemurasia/board history, a place in viral compilations, mass views or remixes. "Old", "famous" or "Finnish" is not enough.
2. **Peak spread in 2013 or earlier** (older than 2014). The online peak, not the release, decides. A 1984 film scene that went viral in 2007 passes; a 2012 viral passes; a 2014 or later viral does not.
3. **Originals only.** Use the original upload or broadcast. A remix, fan edit, compilation or cartoon version is allowed only when that remix itself is what went viral (e.g. the Sparta remix, Hobbits to Isengard), and the card's `note` says so.
4. Still off the shelf: plain music or audio tracks, ordinary songs and official music videos that were never memes, TV or film content that never went viral online, and anything picked only because it is old or Finnish.

The `year` field is the original release year: 2013 or earlier, and at least ten years ago (`min(2013, current UTC year − 10)`).

## The five signals

A tape also has to meet **at least three** of these. `signals` is the list of letters that actually apply. Do not tick one you cannot defend.

| Letter | Signal |
| --- | --- |
| a | **Born online.** It spread on the web first, not as a TV broadcast. |
| b | **Spread widely.** People shared it, remixed it, or parodied it, or it has a Know Your Meme or Wikipedia entry. |
| c | **Still quoted or recognized** today. |
| d | **Amateur or DIY.** Homemade, Flash, a webcam, or a forum. |
| e | **Defined its scene.** It sits in the middle of a community's culture, not merely next to a famous song. |

`why` is one line, 200 characters at most, saying which of those are true.

## Fields

| Field | Rule |
| --- | --- |
| `year` | Integer. The original release year, not the date a reupload happened to be posted, unless that posting is the release. |
| `signals` | Three to five unique letters from `a` through `e`. |
| `why` | One line. |
| `original_url` | The original upload or site. If that page is gone, a Wayback snapshot that was actually fetched. Shown on the glass as SOURCE. |
| `play` | How it plays: `youtube`, `archive`, or `link`, plus `official` and `uploader`. See `LIBRARIAN.md` §0. |

Playback is a separate question, and it is the `play` list on the tape, best source first: a YouTube embed (the creator's or an official channel's upload when one exists), an archive.org stream, or a still from its public host. The set does not host the file. `original_url` can be a dead page's snapshot while the picture comes from a later upload.

Flash-era `.swf` files stay off the loop. The deck does not run Ruffle. An archival SWF is a find, not a programme.

## Calibration

These three are on the shelf, and they are the examples to judge the others against. Ids and durations were checked: YouTube oEmbed for the title and author, and a yt-dlp search that returned the same id for the duration.

### Suomi — B5mies

| | |
| --- | --- |
| Embed | YouTube `f-lnF5eNFFY`, oEmbed title “B5mies”, channel shokteenik |
| Duration | 141 seconds |
| Upload on that page | 30 March 2015 |
| `year` | 1999 |
| `original_url` | `https://www.youtube.com/watch?v=f-lnF5eNFFY` |
| `signals` | `a`, `c`, `d`, `e` |

The uploader's description calls it Wezz the Warlock's ballad from 1999, about Babylon 5 fans at the end of the 1990s. No earlier page was found, so the original URL is this upload, and the year is the year that description claims. That is the uploader's statement, not a discography entry.

It is a net ballad, not a TV clip (`a`), homemade (`d`), and it is the name of that Finnish fan scene (`e`). The owner still cited it in 2026 (`c`). It does **not** get `b`. The page showed on the order of 1,300 views. That is not a mass meme, and it is not claimed here.

### International — Numa Numa

Gary Brolsma's Numa Numa Dance.

| | |
| --- | --- |
| Embed | YouTube `Cqd1Gvq-RBY`, oEmbed title “Numa Numa”, author Gary Brolsma |
| Duration | 100 seconds |
| `year` | 2004 |
| `original_url` | `https://web.archive.org/web/20041211162602/http://www.newgrounds.com:80/portal/view/206373` |
| `signals` | `a`, `b`, `c`, `d` |

The Newgrounds player is gone. That Wayback snapshot is the original page. Playback is Gary's YouTube upload, inside the set, not a link out to Newgrounds and not the archive.org re-encode `numa-numa-2004`. Webcam, born online, copied everywhere, still the name of the dance.

### International — Leeroy Jenkins

| | |
| --- | --- |
| Embed | YouTube `mLyOj_QD4a4`, oEmbed title “Leeroy Jenkins HD 1080p”, uploader J Jonah Jameson, `play.official: false` |
| Duration | 172 seconds |
| `year` | 2005 |
| `original_url` | `https://www.youtube.com/watch?v=mLyOj_QD4a4` |
| `signals` | `a`, `b`, `c`, `d`, `e` |

This is an HD re-upload of the 2005 World of Warcraft machinima, not the creator's own channel. The warcraftmovies.com original is gone, and the other copies that turned up (`LkCNJRfSZBU`, `sAooq7e0gg0`) are not an official upload either, so this embed stays and is marked not official. It was born in a game community, quoted until the line stopped meaning anything else, homemade machinima, and it defined that raid-night scene. The calibration id stays `mLyOj_QD4a4`.

## What does not get on

A chart hit that people know from the radio fails the test when it was not born online, was not a DIY web object, and did not define a web scene. “Still famous” is only signal `c`. One signal is not three.

The Suomi shelf was cut to clips that can carry three honest letters. The two weakest stays are “Aina mun pitää” (Eurovision 2015) and Cheek's “Timantit” (2013): widely forwarded and still recognized, filed as `b`, `c`, `e`, and not as homemade web objects. Anything from 2017 onward is out because of the year rule.
