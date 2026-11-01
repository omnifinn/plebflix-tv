# List curation corpus (2026-11-01)

The HackerTube method applied to Plebflix TV. Order: `scripts/curation/harvest.mjs` (raw/) -> `link-table.mjs` (mention counts per
YouTube id) -> `cut.mjs` (batches) -> Haiku filter agents (agents/) -> `score.mjs` (filtered.jsonl, scored.json) -> `resolve.mjs`
(resolved.json) -> picks.json (hand-judged against CLASSIC.md; `held` lists clips left out and why) -> `upload-dates.mjs` ->
`file-tapes.mjs` (shelf rows, non-YouTube first) -> `npm run verify-all-play -- --hold 9` -> `report.mjs` (blocks.json).
`raw/hn.jsonl.gz` is gzipped: gunzip before re-running. Coverage limits: Reddit is thin (Arctic Shift timed out on large
subreddits); Finnish forums are thin (Ylilauta gone, Murobbs refused, meemi.info not reachable).
