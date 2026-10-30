// Renders the share/favicon <head> block from share.config.json (the one place to edit).
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export const BEGIN = "<!-- share:begin -->";
export const END = "<!-- share:end -->";

export function renderShareHead(cfg, tv = "intl") {
  const p = { ...cfg.intl, ...(tv === "suomi" ? cfg.suomi : {}) };
  const v = `?v=${cfg.version}`;
  const abs = (path) => `${cfg.origin}${path}`;
  const img = abs(p.image) + v;
  const i = cfg.icons;
  return [
    BEGIN,
    `<!-- Generated from share.config.json by lib/share-head.mjs. Edit that file, not these tags. -->`,
    `<link rel="canonical" href="${abs(p.path)}">`,
    `<link rel="icon" href="${i.ico}${v}" sizes="${i.icoSizes || "48x48"}">`,
    `<link rel="icon" href="${p.iconSvg || i.svg}${v}" type="image/svg+xml" id="favicon-svg">`,
    `<link rel="icon" href="${i.png32}${v}" type="image/png" sizes="32x32">`,
    `<link rel="icon" href="${i.png16}${v}" type="image/png" sizes="16x16">`,
    `<link rel="apple-touch-icon" href="${i.appleTouch}${v}">`,
    `<link rel="manifest" href="${p.manifest || i.manifest}${v}">`,
    `<meta name="theme-color" content="${p.themeColor}">`,
    `<meta name="description" content="${esc(p.description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Plebflix TV">`,
    `<meta property="og:url" content="${abs(p.path)}">`,
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.ogDescription)}">`,
    `<meta property="og:image" content="${img}">`,
    `<meta property="og:image:secure_url" content="${img}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="${p.imageWidth}">`,
    `<meta property="og:image:height" content="${p.imageHeight}">`,
    `<meta property="og:image:alt" content="${esc(p.imageAlt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(p.title)}">`,
    `<meta name="twitter:description" content="${esc(p.twitterDescription)}">`,
    `<meta name="twitter:image" content="${img}">`,
    `<meta name="twitter:image:alt" content="${esc(p.twitterImageAlt)}">`,
    END,
  ].join("\n");
}

export function applyShareHead(html, cfg, tv = "intl") {
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  if (a < 0 || b < a) throw new Error("index.html is missing the share:begin/end block");
  let out = html.slice(0, a) + renderShareHead(cfg, tv) + html.slice(b + END.length);
  const p = { ...cfg.intl, ...(tv === "suomi" ? cfg.suomi : {}) };
  out = out.replace(/<html lang="[^"]*">/, `<html lang="${p.lang}">`).replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`);
  if (tv === "suomi") out = out.replace('<body data-channel="international">', '<body data-channel="suomi">');
  return out;
}
