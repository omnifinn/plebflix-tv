import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

test('TV guide previews the other language and search provides keyboard suggestions', async () => {
  const stage=await mkdtemp(join(tmpdir(),'plebflix-ui-'));
  execFileSync(process.execPath,['tizen/build.mjs',stage]);
  for (const name of ['index.html','tv.css','diagnostics.js']) await cp('tizen/'+name,join(stage,name));
  let browser;
  try { browser=await chromium.launch({channel:"chrome",headless:true}); }
  catch { browser=await chromium.launch({headless:true}); }
  try {
    const page=await browser.newPage({viewport:{width:1920,height:1080}});
    await page.addInitScript(()=>{window.tizen={tvinputdevice:{registerKey(){}},application:{getCurrentApplication(){return {exit(){}}}}};});
    await page.route('https://**/*',route=>route.abort());
    await page.goto(pathToFileURL(join(stage,'index.html')).href);
    const key=async code=>page.evaluate(k=>document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:k,which:k,bubbles:true})),code);
    await key(404);
    assert.match(await page.locator('#panel').innerText(),/CHANNEL GUIDE/);
    await key(39);
    assert.equal(await page.locator('#panel').getAttribute('data-language'),'suomi');
    assert.equal(await page.locator('body').getAttribute('data-language'),'international');
    await key(10009);
    assert.equal(await page.locator('#panel').isHidden(),true);
    await key(405);
    assert.match(await page.locator('#panel').innerText(),/RECENT & POPULAR/);
    assert.match(await page.locator('#panel').innerText(),/Numa Numa/);
  } finally {await browser.close();}
});
