import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as esbuild from 'esbuild';
import ts from 'typescript';
import { buildLineup } from '../lib/lineup.mjs';
const stage = process.argv[2] || 'dist/tizen/stage';
const read = async f => JSON.parse(await readFile(f, 'utf8'));
const docs = { international: await read('channels/international.json'), suomi: await read('channels/suomi.json') };
const lineup = buildLineup(docs, await read('channels/categories.json'));
const snapshot = { index: {channels: lineup.index}, docs: {...docs, ...lineup.cats}, schedule: await read('channels/schedule.json') };
await mkdir(stage, {recursive:true});
await writeFile(`${stage}/snapshot.js`, 'window.SNAPSHOT='+JSON.stringify(snapshot)+';');
const result = await esbuild.build({entryPoints:['tizen/tv.js'], bundle:true, format:'iife', target:'chrome69', write:false});
const output = ts.transpileModule(result.outputFiles[0].text, {compilerOptions:{target:ts.ScriptTarget.ES5, downlevelIteration:true}});
await writeFile(`${stage}/bundle.js`, output.outputText);

// Four deterministic grayscale frames in a single 480 × 1080 PNG. The TV scales it with nearest-neighbour sampling.
const { deflateSync } = await import('node:zlib');
const { cp } = await import('node:fs/promises');
for (const dir of ['fonts', 'brand', 'textures']) await cp(`public/${dir}`, `${stage}/${dir}`, {recursive:true});
function crc32(buf) {
  let value = 0xffffffff;
  for (const byte of buf) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([len, name, bytes, crc]);
}
const width = 480, height = 1080, raw = Buffer.alloc((width + 1) * height);
let seed = 0x504c4542;
for (let y = 0; y < height; y++) {
  raw[y * (width + 1)] = 0;
  for (let x = 0; x < width; x++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    raw[y * (width + 1) + 1 + x] = 35 + ((seed >>> 0) % 185);
  }
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8;
await writeFile(`${stage}/noise.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
