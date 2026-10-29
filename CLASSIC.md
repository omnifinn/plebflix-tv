# What counts as an internet classic

Plebflix plays clips that already lived a life online. A famous song, a TV premiere, or a new upload is not enough.

## The hard rule

The original release year is required, and it has to be at least ten years ago. The validator computes that as `current UTC year − 10`. In 2026 the latest year that passes is 2016. A later year fails even if every other field is filled in.

Older is preferred. Pre-2010 is the heart of the shelf. Pre-YouTube, meaning before 2005, gets extra weight when two candidates are otherwise equal. That preference is editorial. It is not a second number in the JSON.

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

Playback is a separate question. The set embeds YouTube, archive.org, or Vimeo. `original_url` can be a dead page's snapshot while the picture comes from a later upload. A link-out is not playback.

Flash-era `.swf` files stay off the loop unless the card carries `license` of `cc0`, `cc-by`, `cc-by-sa`, or `public-domain`. Only then may the set run the file in Ruffle. An archival SWF with no such license is a find, not a programme.

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
| Embed | YouTube `mLyOj_QD4a4`, oEmbed title “Leeroy Jenkins HD 1080p” |
| Duration | 172 seconds |
| `year` | 2005 |
| `original_url` | `https://www.youtube.com/watch?v=mLyOj_QD4a4` |
| `signals` | `a`, `b`, `c`, `d`, `e` |

This is an HD upload of the 2005 World of Warcraft machinima. No verified snapshot of the earlier warcraftmovies.com page was found, so the original URL is this film. It was born in a game community, quoted until the line stopped meaning anything else, homemade machinima, and it defined that raid-night scene.

## What does not get on

A chart hit that people know from the radio fails the test when it was not born online, was not a DIY web object, and did not define a web scene. “Still famous” is only signal `c`. One signal is not three.

The Suomi shelf was cut to clips that can carry three honest letters. The two weakest stays are “Aina mun pitää” (Eurovision 2015) and Cheek's “Timantit” (2013): widely forwarded and still recognized, filed as `b`, `c`, `e`, and not as homemade web objects. Anything from 2017 onward is out because of the year rule.
