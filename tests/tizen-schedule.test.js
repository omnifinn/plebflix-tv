import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as esbuild from 'esbuild';
import * as site from '../public/schedule.js';
import international from '../channels/international.json' with {type:'json'};
import schedule from '../channels/schedule.json' with {type:'json'};

test('TV compiled schedule matches site tape and offset over many timestamps', async () => {
  const built = await esbuild.build({entryPoints:['public/schedule.js'],bundle:true,format:'cjs',target:'chrome69',write:false});
  const module = {exports:{}};
  vm.runInNewContext(built.outputFiles[0].text, {module, exports:module.exports, Date, Math, Map, Object, Number, String, Array, Infinity});
  const tv = module.exports;
  const stats = Object.fromEntries(international.items.slice(0,12).map((x,i)=>[x.id,{up:i+3,down:i%3,impressions:i*4}]));
  for (let t=Date.UTC(2025,0,1);t<Date.UTC(2027,0,1);t+= 37*3600000) {
    const a=site.buildBroadcast(international,t,stats,site.resolveDefinition(schedule,international.id));
    const b=tv.buildBroadcast(international,t,stats,tv.resolveDefinition(schedule,international.id));
    const sa=site.spotAt(a,site.liveSeconds(a,t));
    const sb=tv.spotAt(b,tv.liveSeconds(b,t));
    assert.equal(sb?.item.id,sa?.item.id, String(t));
    assert.equal(sb?.offset,sa?.offset, String(t));
  }
});
