#!/usr/bin/env node
// Step 1 of the list-curation method: harvest comments and list entries that may recommend an old internet video.
//   node scripts/curation/harvest.mjs hn|reddit|wiki|kym|wayback|fi|all
// Writes data/curation/raw/<source>.jsonl. Re-running a source overwrites its file. Nothing here touches a shelf.
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";

const OUT = "data/curation/raw";
mkdirSync(OUT, { recursive: true });
const UA = "plebflix-curation/1.0 (list harvest; plebflix.com)";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const VIDEO_LINK = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?[^\s"'<>]*v=|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})|vimeo\.com\/(\d{5,})|archive\.org\/details\/([A-Za-z0-9._-]+)/g;
const OLDWEB = /\b(old|early|classic|ol[d']? ?school|viral|meme|nostalg|remember|back in the day|golden age|2000s|200\d|201[0-3]|flash|newgrounds|ytmnd|ebaum|albino ?blacksheep|homestar|rotten|stickam|dial-?up|bonzi|albino|youtube poop|machinima|collegehumor|break\.com|icanhas|4chan|fark|something ?awful)\b/i;

async function get(url, { json = true, tries = 5, pace = 0 } = {}) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(45000) });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) return null;
      const out = json ? await response.json() : await response.text();
      if (pace) await sleep(pace);
      return out;
    } catch (error) {
      await sleep(2000 * 2 ** attempt);
      if (attempt === tries - 1) console.error(`give up ${url}: ${error.message}`);
    }
  }
  return null;
}

const strip = (html) => String(html || "")
  .replace(/<a [^>]*href="([^"]+)"[^>]*>.*?<\/a>/gs, " $1 ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x2F;/g, "/").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<")
  .replace(/\s+/g, " ").trim();

const THREAD_QUERIES = [
  "best old internet videos", "viral videos 2000s", "old internet videos", "favorite youtube videos of all time",
  "early youtube videos", "classic internet videos", "internet memes history", "old youtube", "first viral video",
  "YTMND", "Newgrounds flash animations", "Homestar Runner", "old web nostalgia", "what internet video do you remember",
  "ask hn best videos", "ask hn favorite video", "ask hn youtube videos changed", "funniest video on the internet",
  "best flash animations", "albino blacksheep", "ebaumsworld", "history of memes", "golden age of youtube",
  "HackerTube", "internet culture 2000s", "lost media internet video", "machinima red vs blue", "youtube poop",
];
const COMMENT_QUERIES = [
  "old internet video", "classic youtube video", "early youtube", "viral video", "old youtube", "old meme video",
  "remember this video", "flash animation newgrounds", "ytmnd", "homestar runner", "numa numa", "star wars kid",
  "charlie bit my finger", "dramatic chipmunk", "leeroy jenkins", "albino blacksheep", "ebaumsworld", "old viral",
  "internet classic", "peak internet", "golden age internet", "the old internet", "youtube 2006", "youtube 2007",
  "youtube 2008", "youtube 2009", "best video on the internet", "funniest video ever", "this video is a classic",
  "my favorite video", "one of the first viral", "badger badger", "peanut butter jelly", "hampster dance", "rickroll",
  "dancing baby", "all your base", "lonelygirl15", "double rainbow", "david after dentist", "keyboard cat",
  "chocolate rain", "turbo encabulator", "retro encabulator", "evolution of dance", "free hugs", "powerthirst",
  "shoes the video", "llamas with hats", "charlie the unicorn", "end of ze world", "potter puppet pals", "salad fingers",
];

function hnLine(hit, via) {
  const text = strip(hit.comment_text || hit.story_text || hit.text || "");
  return { src: "hn", id: String(hit.objectID ?? hit.id), url: `https://news.ycombinator.com/item?id=${hit.objectID ?? hit.id}`, author: hit.author || "", at: hit.created_at || "", thread: hit.story_title || hit.title || "", via, text: text.slice(0, 1200), storyUrl: hit.url || "" };
}

async function harvestHn() {
  const file = createWriteStream(`${OUT}/hn.jsonl`);
  const seen = new Set();
  const emit = (row) => {
    if (!row.id || seen.has(row.id) || !row.text) return;
    seen.add(row.id);
    file.write(`${JSON.stringify(row)}\n`);
  };
  // 1. Every HN comment carrying a video link that also uses old-web words, sliced by month so Algolia's 1000-hit cap never bites.
  const start = Date.UTC(2007, 0, 1) / 1000;
  const end = Math.floor(Date.now() / 1000);
  const month = 30.44 * 86400;
  for (const host of ["youtube.com", "youtu.be", "vimeo.com"]) {
    for (let at = start; at < end; at += month) {
      for (let page = 0; page < 10; page += 1) {
        const url = `https://hn.algolia.com/api/v1/search_by_date?query=${host}&tags=comment&hitsPerPage=1000&page=${page}&numericFilters=created_at_i>=${Math.floor(at)},created_at_i<${Math.floor(at + month)}`;
        const data = await get(url, { pace: 250 });
        if (!data?.hits?.length) break;
        for (const hit of data.hits) {
          const text = strip(hit.comment_text);
          if (text.match(VIDEO_LINK) && (OLDWEB.test(text) || OLDWEB.test(hit.story_title || ""))) emit(hnLine(hit, `link:${host}`));
        }
        if (page + 1 >= data.nbPages) break;
      }
    }
    console.error(`hn ${host} done, ${seen.size} rows`);
  }
  // 2. Keyword comments, with or without a link: a named clip counts as a mention too.
  for (const query of COMMENT_QUERIES) {
    for (let page = 0; page < 3; page += 1) {
      const data = await get(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=comment&hitsPerPage=200&page=${page}`, { pace: 250 });
      if (!data?.hits?.length) break;
      for (const hit of data.hits) emit(hnLine(hit, `kw:${query}`));
    }
  }
  console.error(`hn keywords done, ${seen.size} rows`);
  // 3. Whole threads whose title asks for or lists old videos: every comment in them is in context.
  const threads = new Map();
  for (const query of THREAD_QUERIES) {
    const data = await get(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=40`, { pace: 250 });
    for (const hit of data?.hits || []) if (hit.num_comments >= 8) threads.set(hit.objectID, hit.title);
  }
  console.error(`hn threads ${threads.size}`);
  for (const [id, title] of threads) {
    const tree = await get(`https://hn.algolia.com/api/v1/items/${id}`, { pace: 200 });
    const walk = (node) => {
      if (node.type === "comment" && node.text) emit({ ...hnLine(node, `thread:${title}`), thread: title });
      for (const child of node.children || []) walk(child);
    };
    if (tree) walk(tree);
  }
  file.end();
  console.error(`hn total ${seen.size}`);
}

const REDDIT_SUBS = process.env.REDDIT_SUBS ? process.env.REDDIT_SUBS.split(",") : ["ObscureMedia", "nostalgia", "internetcollection", "videos", "AskReddit", "OldSchoolCool", "lostmedia", "youtubehaiku", "deepintoyoutube", "InternetIsBeautiful", "NewTubers", "Oldschoolcelebs", "web_nostalgia", "90s", "2000sNostalgia", "millenials", "Xennials", "OutOfTheLoop", "youtube", "newgrounds", "homestarrunner", "ytmnd", "MemeHistory", "Damnthatsinteresting", "AskOldPeople", "Music"];
const REDDIT_POST_TERMS = ["viral video", "old internet", "old youtube", "early youtube", "old meme", "2000s video", "classic video", "first viral", "ytmnd", "newgrounds", "flash animation", "internet video", "remember this video", "golden age"];
const REDDIT_BODY_TERMS = ["youtube.com/watch", "youtu.be", "old youtube", "viral video", "newgrounds", "ytmnd"];
const WINDOWS = [["2010-01-01", "2014-01-01"], ["2014-01-01", "2017-01-01"], ["2017-01-01", "2020-01-01"], ["2020-01-01", "2023-01-01"], ["2023-01-01", "2027-01-01"]];
const ARCTIC = "https://arctic-shift.photon-reddit.com/api";

async function harvestReddit() {
  const file = createWriteStream(`${OUT}/reddit.jsonl`);
  const seen = new Set();
  const emit = (row) => {
    if (!row.id || seen.has(row.id) || !row.text) return;
    seen.add(row.id);
    file.write(`${JSON.stringify(row)}\n`);
  };
  const comment = (c, via, thread = "") => ({ src: "reddit", id: `c${c.id}`, url: `https://www.reddit.com${c.permalink || `/comments/${String(c.link_id || "").replace("t3_", "")}/_/${c.id}`}`, sub: c.subreddit, author: c.author, score: c.score, at: new Date((c.created_utc || 0) * 1000).toISOString(), thread, via, text: String(c.body || "").slice(0, 1200) });
  const threads = new Map();
  for (const sub of REDDIT_SUBS) {
    for (const term of REDDIT_POST_TERMS) {
      for (const [after, before] of WINDOWS) {
      const data = await get(`${ARCTIC}/posts/search?subreddit=${sub}&title=${encodeURIComponent(term)}&after=${after}&before=${before}&limit=100&sort=desc&fields=id,title,num_comments,url,author,score,created_utc,subreddit,permalink,selftext`, { pace: 250 });
      for (const post of data?.data || []) {
        const link = String(post.url || "");
        const text = `${post.title} ${link} ${String(post.selftext || "").slice(0, 600)}`;
        if (link.match(VIDEO_LINK)) emit({ src: "reddit", id: `p${post.id}`, url: `https://www.reddit.com${post.permalink}`, sub: post.subreddit, author: post.author, score: post.score, at: new Date(post.created_utc * 1000).toISOString(), thread: post.title, via: `post:${term}`, text });
        if (post.num_comments >= 15) threads.set(post.id, { title: post.title, n: post.num_comments, score: post.score });
      }
      }
    }
    for (const term of REDDIT_BODY_TERMS) {
      for (const [after, before] of WINDOWS) {
        const data = await get(`${ARCTIC}/comments/search?subreddit=${sub}&body=${encodeURIComponent(term)}&after=${after}&before=${before}&limit=100&sort=desc`, { pace: 250 });
        for (const c of data?.data || []) if (String(c.body || "").match(VIDEO_LINK) && OLDWEB.test(c.body)) emit(comment(c, `body:${term}`));
      }
    }
    console.error(`reddit ${sub}: ${seen.size} rows, ${threads.size} threads`);
  }
  // AskReddit-size threads are the point of the method: every reply in them recommends something.
  const ranked = [...threads.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 180);
  for (const [id, meta] of ranked) {
    const data = await get(`${ARCTIC}/comments/search?link_id=t3_${id}&limit=100&sort=desc`, { pace: 300 });
    for (const c of data?.data || []) emit(comment(c, `thread:${meta.title}`, meta.title));
  }
  file.end();
  console.error(`reddit total ${seen.size}`);
}

async function wikiText(host, page) {
  const data = await get(`https://${host}/w/api.php?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent(page)}`, { pace: 200 });
  return data?.parse?.wikitext?.["*"] || "";
}

async function harvestWiki() {
  const file = createWriteStream(`${OUT}/wiki.jsonl`);
  const pages = [
    ["en.wikipedia.org", "List of Internet phenomena"], ["en.wikipedia.org", "Viral video"], ["en.wikipedia.org", "List of viral videos"],
    ["en.wikipedia.org", "List of YouTube videos"], ["en.wikipedia.org", "YouTube Poop"], ["en.wikipedia.org", "Timeline of Internet memes"],
    ["en.wikipedia.org", "List of Flash animated web series"], ["en.wikipedia.org", "Machinima"], ["en.wikipedia.org", "Lip dub"], ["en.wikipedia.org", "List of most-viewed YouTube videos"],
    ["en.wikipedia.org", "List of most-subscribed YouTube channels"], ["en.wikipedia.org", "History of YouTube"], ["en.wikipedia.org", "Internet meme"], ["en.wikipedia.org", "List of web television series"],
    ["en.wikipedia.org", "Newgrounds"], ["en.wikipedia.org", "YTMND"], ["en.wikipedia.org", "Web series"], ["fi.wikipedia.org", "Luettelo internetilmiöistä"], ["fi.wikipedia.org", "Internetilmiö"],
    ["de.wikipedia.org", "Liste von Internetphänomenen"], ["sv.wikipedia.org", "Lista över internetfenomen"], ["fr.wikipedia.org", "Liste de phénomènes Internet"],
  ];
  let total = 0;
  for (const [host, page] of pages) {
    const wikitext = await wikiText(host, page);
    if (!wikitext) { console.error(`wiki missing ${host} ${page}`); continue; }
    let section = "";
    for (const line of wikitext.split("\n")) {
      const head = line.match(/^=+\s*(.+?)\s*=+$/);
      if (head) { section = head[1]; continue; }
      if (!/^[*|#;]|\[\[/.test(line) || line.length < 8) continue;
      const row = { src: "wiki", id: `${host}:${page}:${++total}`, url: `https://${host}/wiki/${encodeURIComponent(page.replace(/ /g, "_"))}`, page, section, text: line.replace(/<ref[^>]*\/>|<ref.*?<\/ref>/gs, " ").replace(/\{\{cite[^}]*\}\}/gi, " ").slice(0, 900) };
      file.write(`${JSON.stringify(row)}\n`);
    }
  }
  file.end();
  console.error(`wiki lines ${total}`);
}

// Know Your Meme: listing pages by views, then each entry's Year and its embedded video ids (the origin clip comes first).
async function kymPage(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(45000) }).catch(() => null);
    if (response?.ok) return response.text();
    if (response && response.status !== 429 && response.status < 500) return "";
    await sleep(4000 * (attempt + 1));
  }
  return "";
}

const YT_ANY = /(?:videoid="|youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/g;

async function harvestKym() {
  const file = createWriteStream(`${OUT}/kym.jsonl`);
  const slugs = new Set();
  for (const base of ["https://knowyourmeme.com/categories/meme", "https://knowyourmeme.com/memes/all", "https://knowyourmeme.com/types/viral-video", "https://knowyourmeme.com/types/video", "https://knowyourmeme.com/types/flash", "https://knowyourmeme.com/types/remix", "https://knowyourmeme.com/categories/subculture"]) {
    for (let page = 1; page <= 40; page += 1) {
      const html = await kymPage(`${base}/page/${page}?sort=views`);
      const found = [...html.matchAll(/href="\/memes\/([a-z0-9-]+)"/g)].map((m) => m[1]).filter((slug) => !["all", "popular", "trending", "submissions", "researching", "confirmed", "newsworthy", "deadpool", "subcultures", "events", "people", "sites"].includes(slug));
      if (!found.length) break;
      for (const slug of found) slugs.add(slug);
      await sleep(600);
    }
    console.error(`kym ${base}: ${slugs.size} slugs`);
  }
  // Add the historical listings (the first sweep's old entries live in this seed; missing is fine).
  try { for (const line of readFileSync("data/curation/raw/kym-seed.txt", "utf8").split("\n")) if (line) slugs.add(line); } catch { /* first run */ }
  let kept = 0;
  for (const slug of slugs) {
    const html = await kymPage(`https://knowyourmeme.com/memes/${slug}`);
    await sleep(500);
    if (!html) continue;
    const year = Number(html.match(/search\?query=year%3A(\d{4})/)?.[1] || 0);
    if (year && year > 2013) continue;
    const title = (html.match(/og:title' content='([^']*?) \| Know Your Meme/)?.[1] || slug).replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
    const type = [...html.matchAll(/search\?[^"]*type[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
    const origin = strip(html.match(/<h2 id="origin">.*?<\/h2>(.*?)<h2/s)?.[1] || "").slice(0, 700);
    const ids = [...new Set([...html.matchAll(YT_ANY)].map((m) => m[1]))];
    const originHtml = html.match(/<h2 id="origin">.*?<\/h2>(.*?)<h2/s)?.[1] || "";
    const originIds = [...new Set([...originHtml.matchAll(YT_ANY)].map((m) => m[1]))];
    file.write(`${JSON.stringify({ src: "kym", id: slug, url: `https://knowyourmeme.com/memes/${slug}`, title, year, type, originIds, ids: ids.slice(0, 12), text: origin })}\n`);
    kept += 1;
  }
  file.end();
  console.error(`kym entries ${kept} of ${slugs.size}`);
}

// Wayback: the top-list pages of the sites that made this culture, one capture per target. CDX picks a real 200 capture.
const WAYBACK = [
  ["ytmnd.com/lists/top_rated", "2008"], ["ytmnd.com/lists/most_viewed", "2008"], ["ytmnd.com/lists/top", "2008"], ["www.albinoblacksheep.com/flash/", "2006"], ["www.albinoblacksheep.com/video/", "2008"], ["www.albinoblacksheep.com/", "2005"],
  ["www.ebaumsworld.com/videos/", "2007"], ["www.ebaumsworld.com/", "2005"], ["www.newgrounds.com/portal/", "2005"], ["www.newgrounds.com/portal/toprated", "2006"], ["www.newgrounds.com/portal/best", "2008"], ["www.newgrounds.com/portal/top-rated", "2010"],
  ["www.youtube.com/browse?s=mp", "2006"], ["www.youtube.com/browse?s=tr", "2007"], ["www.youtube.com/charts", "2008"], ["www.youtube.com/videos?s=mp", "2008"], ["www.youtube.com/browse?s=mp&t=a", "2007"], ["www.youtube.com/charts/videos_views", "2010"],
  ["www.collegehumor.com/videos", "2008"], ["www.break.com/", "2007"], ["www.funnyordie.com/videos", "2008"], ["www.metacafe.com/", "2007"], ["www.milkandcookies.com/", "2006"], ["www.rotten.com/", "2003"], ["www.b3ta.com/links/", "2005"], ["www.fark.com/videolinks", "2008"], ["viralvideochart.unrulymedia.com/all", "2010"], ["viralvideochart.com/", "2009"], ["www.time.com/time/specials/packages/completelist/0,29569,1974961,00.html", "2010"],
  ["www.g4tv.com/attackoftheshow/", "2007"], ["www.nothingtoxic.com/", "2007"], ["www.hugelol.com/", "2011"], 
  ["www.riemurasia.net/", "2004"], ["www.riemurasia.net/top", "2006"], ["meemi.info/index.php?title=Luokka:Videot", "2011"], ["meemi.info/index.php?title=Etusivu", "2010"], ["www.naurunappula.com/", "2007"], ["www.naurunappula.com/?m=top", "2008"], ["www.pelit.fi/", ""],
];

async function harvestWayback() {
  const file = createWriteStream(`${OUT}/wayback.jsonl`);
  let total = 0;
  for (const [target, year] of WAYBACK) {
    if (!year) continue;
    const cdx = await get(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&from=${year}&to=${Number(year) + 2}&filter=statuscode:200&collapse=timestamp:6&limit=3&output=json`, { pace: 1500 });
    const rows = (cdx || []).slice(1);
    for (const row of rows.slice(0, 2)) {
      const html = await get(`https://web.archive.org/web/${row[1]}id_/${row[2]}`, { json: false, pace: 2000, tries: 2 });
      if (!html) continue;
      const text = strip(html.replace(/<script.*?<\/script>|<style.*?<\/style>/gis, " "));
      const anchors = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis)].map((m) => `${strip(m[2])} <${m[1]}>`).filter((line) => line.length > 12 && line.length < 200 && !/^\W/.test(line));
      file.write(`${JSON.stringify({ src: "wayback", id: `${target}@${row[1]}`, url: `https://web.archive.org/web/${row[1]}/${row[2]}`, page: target, at: row[1], text: anchors.slice(0, 300).join(" | ").slice(0, 16000) || text.slice(0, 6000) })}\n`);
      total += 1;
    }
    console.error(`wayback ${target}: ${rows.length} captures`);
  }
  file.end();
  console.error(`wayback captures ${total}`);
}

const FI_QUERIES = ["vanhat nettivideot", "parhaat nettivideot", "klassikko video netti", "suomalaiset meemit", "internetilmiö video", "viraalivideo suomi", "youtube klassikko", "riemurasia video", "naurunappula", "kahden kilon siika", "ismo ja seppo", "muistatko tämän videon", "legendaarinen video netti", "2000-luvun nettivideot", "hauskin video suomi", "ÄM-IRK", "nettiklassikko"];

// Finnish lists: Suomi24 and Murobbs search through Yle and Wayback captures, plus fi.wikipedia's search.
async function harvestFi() {
  const file = createWriteStream(`${OUT}/fi.jsonl`);
  let total = 0;
  const write = (row) => { file.write(`${JSON.stringify(row)}\n`); total += 1; };
  for (const query of FI_QUERIES) {
    const s24 = await kymPage(`https://keskustelu.suomi24.fi/haku?keyword=${encodeURIComponent(query)}`);
    const threads = [...new Set([...s24.matchAll(/href="(https:\/\/keskustelu\.suomi24\.fi\/t\/[^"]+)"/g)].map((m) => m[1]))].slice(0, 12);
    for (const url of threads) {
      const html = await kymPage(url);
      await sleep(700);
      if (!html) continue;
      const paragraphs = [...html.matchAll(/<(?:p|div)[^>]*class="[^"]*(?:thread-text|comment-text|answer-text|message)[^"]*"[^>]*>(.*?)<\/(?:p|div)>/gs)].map((m) => strip(m[1])).filter(Boolean);
      const links = [...html.matchAll(VIDEO_LINK)].map((m) => m[0]);
      write({ src: "suomi24", id: url, url, via: `kw:${query}`, thread: strip(html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1] || ""), links: [...new Set(links)], text: (paragraphs.join(" | ") || strip(html.replace(/<script.*?<\/script>|<style.*?<\/style>/gis, " "))).slice(0, 5000) });
    }
    const yle = await get(`https://fi.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=20&srsearch=${encodeURIComponent(query)}`, { pace: 200 });
    for (const hit of yle?.query?.search || []) write({ src: "fiwiki", id: `search:${hit.pageid}:${query}`, url: `https://fi.wikipedia.org/?curid=${hit.pageid}`, via: `kw:${query}`, thread: hit.title, text: strip(hit.snippet) });
    console.error(`fi ${query}: ${total}`);
  }
  // Finnish meme wiki and forums, through Wayback where they no longer answer.
  const finnish = ["meemi.info", "murobbs.muropaketti.com", "ylilauta.org", "www.riemurasia.net", "www.naurunappula.com", "yle.fi/uutiset", "www.is.fi", "www.iltalehti.fi", "www.hs.fi", "dome.fi"];
  for (const host of finnish) {
    for (const term of ["youtube", "video", "klassikko"]) {
      const cdx = await get(`https://web.archive.org/cdx/search/cdx?url=${host}/*&matchType=prefix&filter=statuscode:200&filter=mimetype:text/html&filter=urlkey:.*(${term}|nettiilmio|internetilmio|meemi|viraali|klassikko).*&collapse=urlkey&limit=25`, { json: false, pace: 2000, tries: 2 });
      for (const line of String(cdx || "").split("\n").slice(0, 15)) {
        const [, stamp, original] = line.split(" ");
        if (!original) continue;
        const html = await get(`https://web.archive.org/web/${stamp}id_/${original}`, { json: false, pace: 1500, tries: 2 });
        if (!html) continue;
        const links = [...html.matchAll(VIDEO_LINK)].map((m) => m[0]);
        write({ src: `wb:${host}`, id: `${original}@${stamp}`, url: `https://web.archive.org/web/${stamp}/${original}`, via: `wb:${term}`, thread: strip(html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] || ""), links: [...new Set(links)], text: strip(html.replace(/<script.*?<\/script>|<style.*?<\/style>/gis, " ")).slice(0, 4000) });
      }
    }
    console.error(`fi ${host}: ${total}`);
  }
  file.end();
  console.error(`fi total ${total}`);
}

const JOBS = { hn: harvestHn, reddit: harvestReddit, wiki: harvestWiki, kym: harvestKym, wayback: harvestWayback, fi: harvestFi };
const pick = process.argv[2] || "all";
if (pick === "all") await Promise.allSettled(Object.values(JOBS).map((job) => job()));
else await JOBS[pick]();
