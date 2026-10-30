# legacy/

Code that left the live paths but is kept whole (zero-loss). Nothing in `src/` imports from here; the tests still run.

- `recommend.mjs` + `recommend.test.js` — the REC route that opened a GitHub pull request from the Worker (needed `GITHUB_TOKEN`).
  Retired 2026-10-30 in favour of `lib/submissions.mjs`: REC rows go to D1 and the librarian routine opens the PR.
