import { playback, rightsLine, watchUrl } from "../public/play.js";

const SHELL = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${title} — Plebflix TV</title>
<link rel="stylesheet" href="/styles/tokens.css">
<link rel="stylesheet" href="/styles.css">
<style>
  .page { max-width: 960px; margin: 0 auto; padding: 28px 16px 64px; color: var(--ink, #e8e4d8); }
  .page h1 { font: 600 28px/1.2 var(--font-ui, sans-serif); margin: 0 0 8px; }
  .page p, .page li { font: 16px/1.45 var(--font-ui, sans-serif); }
  .page a { color: inherit; }
  .page table { width: 100%; border-collapse: collapse; font: 14px/1.35 var(--font-ui, sans-serif); }
  .page th, .page td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.12); }
  .page .wrap { overflow-x: auto; }
  .page .back { margin-bottom: 18px; }
</style>
</head>
<body>
<main class="page">
<p class="back"><a href="/">← Plebflix TV</a> · <a href="/credits">Credits</a> · <a href="/takedown">Takedown</a></p>
${body}
</main>
</body>
</html>
`;

/**
 * @param {Array<{ id: string, name: string, items: any[] }>} channels
 */
export function renderCredits(channels) {
  const ordered = [...channels].sort((a, b) => (a.number || 0) - (b.number || 0));
  const blocks = ordered.map((channel) => {
    const rows = (channel.items || [])
      .filter((item) => item.status !== "pending")
      .map((item) => {
        const play = playback(item);
        const original = item.original_url || watchUrl(item);
        const originalCell = original ? `<a href="${escapeAttr(original)}">${escapeHtml(original)}</a>` : "";
        return `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(channel.name)}</td><td>${escapeHtml(String(item.year ?? ""))}</td><td>${escapeHtml(play.uploader || "")}</td><td>${originalCell}</td><td>${escapeHtml(rightsLine(item))}</td></tr>`;
      })
      .join("\n");
    return `<h2>${escapeHtml(channel.name)}</h2>
<div class="wrap"><table>
<thead><tr><th>Tape</th><th>Channel</th><th>Year</th><th>Uploader</th><th>Original</th><th>Rights</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
  });
  const body = `<h1>Credits</h1>
<p>Plebflix TV does not host these videos. Each tape is an embed of someone else's upload, or a link to the original page when no embed exists. The uploader is whoever the embed names. "embedded via YouTube" means the picture is played from YouTube, not from plebflix.com.</p>
${blocks.join("\n")}
`;
  return SHELL("Credits", body);
}

export function renderTakedown() {
  const body = `<h1>Takedown</h1>
<p>Plebflix TV does not host video files. Tapes play through an embed of a YouTube or Internet Archive upload, or the glass links out to the original page. If you are the rights holder and you want a tape removed from the broadcast, email <a href="mailto:takedown@plebflix.com">takedown@plebflix.com</a>.</p>
<p>Include the address of the tape on plebflix.com (or its title and channel), the original you own, and a way to confirm you hold the rights. We remove the tape from the shelf promptly.</p>
<p>Taking a tape off this site does not remove it from YouTube or the Internet Archive. Those requests go to the service that hosts the file.</p>
`;
  return SHELL("Takedown", body);
}

/** @param {string} value */
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** @param {string} value */
function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
