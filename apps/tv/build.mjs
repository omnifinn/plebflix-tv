// Package Plebflix's real player and interface for Tizen, without modifying the website.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLineup } from '../../lib/lineup.mjs';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(process.argv[2] || '');
if (!process.argv[2] || out === root || out.startsWith(root + '/')) throw Error('Choose a new output directory outside the source tree');
const esbuildPath = process.env.PLEBFLIX_ESBUILD;
if (!esbuildPath) throw Error('Set PLEBFLIX_ESBUILD to the esbuild module path');
const esbuild = await import(pathToFileURL(esbuildPath));
await mkdir(out, { recursive: true });
await cp(join(root, 'public'), out, { recursive: true });
await cp(join(root, 'channels'), join(out, 'channels'), { recursive: true });
await cp(join(root, 'sources.json'), join(out, 'sources.json'));
await cp(join(root, 'apps/tv/config.xml'), join(out, 'config.xml'));
await cp(join(root, 'public/icon-192.png'), join(out, 'icon.png'));
await cp(join(root, 'apps/tv/tv-remote.js'), join(out, 'tv-remote.js'));
const read = async (p) => JSON.parse(await readFile(join(root, p), 'utf8'));
const lineup = buildLineup({suomi: await read('channels/suomi.json'), international: await read('channels/international.json')}, await read('channels/categories.json'));
await writeFile(join(out, 'channels/index.json'), JSON.stringify({build: 'bundled', langs: lineup.langs, channels: lineup.index}));
for (const [id, doc] of Object.entries(lineup.cats)) await writeFile(join(out, 'channels', id + '.json'), JSON.stringify(doc));
let html = await readFile(join(root, 'public/index.html'), 'utf8');
html = html.replace(/(href|src)="\/(?!\/)/g, '$1="');
html = html.replace(/<script type="module" src="(app|fx|audio|search|skins|tactile)\.js"><\/script>/g, '<script defer src="$1.tv.js"></script>');
html = html.replace('</head>', '<link rel="stylesheet" href="tv.css"></head>').replace('</body>', '<script defer src="tv-remote.js"></script></body>');
await writeFile(join(out, 'index.html'), html);
let css = await readFile(join(root, 'public/styles.css'), 'utf8');
css = css.replace(/url\((['"]?)\//g, 'url($1');
await writeFile(join(out, 'styles.css'), css);
await cp(join(root, 'apps/tv/tv.css'), join(out, 'tv.css'));
for (const name of ['app', 'fx', 'audio', 'search', 'skins', 'tactile']) {
  await esbuild.build({entryPoints: [join(root, 'public', name + '.js')], bundle: true, format: 'iife', target: ['chrome69'], minify: true, outfile: join(out, name + '.tv.js'), plugins: [{name: 'tv-paths', setup(build) { build.onLoad({filter: /\.js$/}, async (args) => {
    let text = await readFile(args.path, 'utf8');
    text = text.replace(/(["'`])\/(channels\/|sources\.json|brand\/|favicons\/|textures\/)/g, '$1$2');
    text = text.replace(/(["'`])\/api\//g, '$1https://plebflix.com/api/');
    return {contents: text, loader: 'js'};
  }); }}]});
}
console.log('Bundled real Plebflix interface, player, schedule, channels and TV controls to ' + out);
