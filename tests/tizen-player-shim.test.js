import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('player shim accepts only its parent and forwards YouTube state', async () => {
  let listener, options, made=0, played=0, paused=0;
  const sent=[];
  const parent={postMessage:(m)=>sent.push(m)};
  const root={innerHTML:'',appendChild() {}};
  function Player(id, config) { made++; options=config; this.playVideo=()=>played++; this.pauseVideo=()=>paused++; this.destroy=()=>{}; }
  const window={parent, YT:{Player}, addEventListener:(type,cb)=>{if(type==='message')listener=cb;}};
  const context={window, YT:window.YT, document:{createElement:()=>({}),getElementById:()=>root}, Math};
  vm.runInNewContext(await readFile('public/tv/yt-shim.js','utf8'),context);
  const load={target:'plebflix-yt',command:'load',id:'Cqd1Gvq-RBY',start:12,token:4};
  listener({source:{},data:load}); assert.equal(made,0);
  listener({source:parent,data:load}); assert.equal(made,1);
  assert.equal(options.playerVars.origin,'https://plebflix.com');
  options.events.onReady({target:{playVideo:()=>played++}}); assert.equal(played,1);
  options.events.onStateChange({data:1}); assert.equal(sent.at(-1).type,'state'); assert.equal(sent.at(-1).token,4);
  listener({source:parent,data:{target:'plebflix-yt',command:'pause',token:5}}); assert.equal(paused,0);
  listener({source:parent,data:{target:'plebflix-yt',command:'pause',token:4}}); assert.equal(paused,1);
});

test('player-only page replaces the site frame-ancestor policy', async () => {
  const headers=await readFile('public/_headers','utf8');
  assert.match(headers,/\/tv\/yt\n\s+! Content-Security-Policy\n\s+Content-Security-Policy:/);
  const app=await readFile('tizen/tv.js','utf8');
  assert.match(app,/e\.origin!==['"]https:\/\/plebflix\.com['"]/);
  assert.match(app,/e\.source!==yt\.frame\.contentWindow/);
});
