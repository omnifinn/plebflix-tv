# Standalone Plebflix apps — work in progress

Plebflix is independent of Bask. Its catalogue is `plebflix.com`'s curated
International and Suomi shelves. No YouTube likes, comments, subscriptions or
account connection are used. Native shells are under `ios/` and `tv/`.

The iPhone source browses the live catalogue, plays YouTube embeds or supported
Archive files, saves direct MP4/M4V/MOV files, and offers the iOS share sheet for
saved files. It has no background transfer recovery or household library sync.
The unsigned Debug iPhone build succeeded. This is not device playback evidence.

The Tizen source is a standalone remote-controlled catalogue browser. It uses
live catalogue data where available and the packaged catalogue as a fallback.
Playback uses YouTube embeds or Archive video. It does not yet support offline
downloads, sharing, broadcast schedule, source fallback, or full remote focus
behavior. The signed WGT was packaged but has not been installed or exercised.

TV packaging: `apps/tv/prepare.sh <new-output-dir>`; then use the local Tizen
CLI with the TV signing profile to package that output. `app.js` is roughly
3.5 KB, independent of Bask's 1,344 KiB aggregate JavaScript guard. iOS project:
`xcodegen generate --spec apps/ios/project.yml`; build the resulting project.
Do not deploy these work-in-progress builds as a completed release. Household
sharing and device-independent offline transfer remain to be implemented.
