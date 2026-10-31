# plebflix-tv — read this first (every session, headless included)

plebflix.com = this repo (`omnifinn/plebflix-tv`) = Cloudflare Worker `plebflix-tv` on account
`f7b1f5882ab68d7dfd785ad6942b2db2`. The Worker `plebflix` and repo `omnifinn/plebflix` on the same account are Bask's
project: never touch them.

## Who does what (Niko, 2026-10-30)

Niko talks only to **Page** (his Grok Bot), from any device. Page drives Claude headless on this Mac
(`claude -p` in this directory). Claude owns the code: change, test, commit, push to GitHub, prepare the deploy, verify.
Page owns the Cloudflare connector (`execute` on the account above) and runs its signed calls. Niko gets results, not
homework: never hand Niko a step a session or Page can do.

Standing authorization (Niko, 2026-10-30): plebflix maintenance ships without asking him first. The gates still run:
`npm run validate`, `npm test`, the vigilant review of the diff, and `node scripts/deploy.mjs verify` after every deploy.

## Ship protocol (exact)

1. Claude: make the change; `npm test`; `npm run validate`; commit on `main`; `git push origin main`.
2. Claude: `node scripts/deploy.mjs ship` — refuses unless `main` is clean and equals `origin/main`, re-runs the gates,
   builds, refuses a manifest that contains `/media/`, writes `dist/deploy/step0-migrate.js` and `dist/deploy/step1-session.js`.
   Claude's last line to Page: `SHIP READY <commit>`.
3. Page (connector `execute`): run `dist/deploy/step0-migrate.js` (applies D1 migrations not yet recorded; safe to re-run).
4. Page (connector `execute`): run `dist/deploy/step1-session.js`; write its JSON result to `dist/deploy/session.json`.
5. Page (shell here): `node scripts/deploy.mjs upload` → writes `dist/deploy/step3-publish.js`.
6. Page (connector `execute`): run `dist/deploy/step3-publish.js` (publishes Worker + assets; keeps secrets).
7. Page (shell here): `node scripts/deploy.mjs verify` — must end `verify: all checks passed` (proves the live build
   stamp equals the one just built). Then tell Niko in one line what is live.

Headless call Page uses: `claude -p --permission-mode acceptEdits "<task>"` from this directory. The allowlist in
`.claude/settings.json` covers git/npm/node/tests; wrangler login/secret/delete, force-push and edits to
`wrangler.jsonc` / `.claude/` are denied on purpose.

## Content (Page's PRs)

Page edits only `channels/*.json`. Format, required fields, scheduling and the gate: `LIBRARIAN.md` §0.
The site does not host video. There is no ingest step and no `media/` upload.

## Rules carried from Niko's global instructions

Decision log: every decision → `DECISIONS.md` (newest first). Zero-loss: cut code moves to `legacy/`, never deleted.
Push `main` to GitHub before any deploy. Nothing that costs money without Niko's priced approval.
