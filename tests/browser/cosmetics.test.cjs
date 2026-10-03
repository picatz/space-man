// Real wardrobe controls, save migration and mode handoff. No relay or purchases.
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), path = require('node:path'), fs = require('node:fs/promises');
const { chromium, webkit } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const engineName = process.env.SPACE_MAN_COSMETICS_BROWSER || 'chromium';
const engine = engineName === 'webkit' ? webkit : chromium;
async function launch(t, { viewport = { width:1280, height:800 }, legacy } = {}) {
  const server = http.createServer(async (req,res) => {
    try {
      const pathname = new URL(req.url,'http://localhost').pathname;
      const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(ROOT + path.sep)) return res.writeHead(400).end();
      res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)] || 'application/octet-stream'}).end(await fs.readFile(file));
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser; t.after(async()=>{ if(browser) await browser.close(); server.closeAllConnections(); await new Promise(r=>server.close(r)); });
  browser = await engine.launch(engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH ? {executablePath:process.env.SPACE_MAN_CHROMIUM_PATH}:{});
  const context = await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce',hasTouch:viewport.width<900,isMobile:viewport.width<900});
  await context.addInitScript(({legacy})=>{
    if (legacy && !sessionStorage.getItem('seeded')) { for(const [key,value] of Object.entries(legacy)) localStorage.setItem(key,value); sessionStorage.setItem('seeded','1'); }
    window.testPad={connected:true,mapping:'standard',index:0,id:'Xbox test',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{value:()=>[testPad],configurable:true});
  },{legacy});
  const page=await context.newPage(),errors=[],sockets=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('websocket',w=>sockets.push(w.url()));
  t.after(()=>{assert.deepEqual(errors,[]);assert.deepEqual(sockets,[]);});
  await page.goto(process.env.SPACE_MAN_BASE_URL || `http://127.0.0.1:${server.address().port}/`);
  await page.locator('#btnWardrobe').waitFor(); await page.evaluate(()=>{settings.muted=true;settings.reduceMotion=true;});
  return page;
}
async function shot(page,name){if(!process.env.SPACE_MAN_COSMETICS_SCREENSHOTS)return;await fs.mkdir(process.env.SPACE_MAN_COSMETICS_SCREENSHOTS,{recursive:true});await page.screenshot({animations:'disabled',path:path.join(process.env.SPACE_MAN_COSMETICS_SCREENSHOTS,`${engineName}-${name}.png`)});}
async function fit(page){const errors=await page.evaluate(()=>Array.from(document.querySelectorAll('#ovWardrobe .panel,#wardTabs,#wardChoices,.ward-choice')).filter(n=>n.getClientRects().length).flatMap(n=>{const b=n.getBoundingClientRect();return n.scrollWidth>n.clientWidth+1||b.left < -1||b.right>innerWidth+1 ? [{id:n.id,width:n.clientWidth,scroll:n.scrollWidth}]:[];}));assert.deepEqual(errors,[]);}
async function equip(page,slot,id){await page.locator('#wardTab-'+slot).click();await page.locator('[data-cosmetic="'+id+'"]').click();assert.equal(await page.locator('[data-cosmetic="'+id+'"]').getAttribute('aria-pressed'),'true');}
for(const [width,height] of [[320,568],[390,844],[667,375],[844,390],[1280,800]])test(`wardrobe ${width}x${height}: category controls, locked hints, equip, close and reload`,{timeout:60000},async t=>{
  const page=await launch(t,{viewport:{width,height}});
  await page.locator('#btnWardrobe').click();await page.locator('#ovWardrobe.in').waitFor();
  assert.equal(await page.locator('[role=tab]').count(),6);
  await fit(page);await equip(page,'suit','mint');await equip(page,'hat','antenna');await equip(page,'eyes','happy');await equip(page,'helmet','bubble');await equip(page,'detail','stripe');await equip(page,'ship','orbit');
  await page.locator('[data-cosmetic=leaf]').click();assert.match(await page.locator('#wardHint').innerText(),/Explore 2 adventure encounters/);assert.equal(await page.evaluate(()=>G.cosmetics.ship),'orbit');
  await fit(page);await shot(page,`wardrobe-${width}x${height}-ship`);
  await page.locator('#btnWardrobeDone').scrollIntoViewIfNeeded();const b=await page.locator('#btnWardrobeDone').boundingBox();assert.ok(b.height>=44&&b.y>=0&&b.y+b.height<=height+1);
  await page.keyboard.press('Escape');await page.locator('#ovAttract.show').waitFor();assert.equal(await page.evaluate(()=>G.mode),'attract');
  await page.reload();await page.locator('#btnWardrobe').click();await page.locator('#ovWardrobe.in').waitFor();
  assert.deepEqual(await page.evaluate(()=>equippedAppearance()),{v:1,suit:'mint',hat:'antenna',eyes:'happy',helmet:'bubble',detail:'stripe',ship:'orbit'});
  await page.locator('#wardTab-suit').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#wardTab-hat').getAttribute('aria-selected'),'true');
  await page.locator('#btnWardrobeDone').click();
});

test('old/corrupt profiles and real mode handoffs preserve a literal equipped outfit',{timeout:60000},async t=>{
  const page=await launch(t,{legacy:{'sm2.cosmetics':JSON.stringify({suit:'graphite',hat:'halo',unlocked:['graphite','halo','crown'],callsign:[2,3],patches:['old']}),'sm2.stats':JSON.stringify({runs:25,medals:{GOLD:1}})}});
  assert.equal(await page.evaluate(()=>G.cosmetics.unlocked.includes('crown')),true);
  await page.locator('#btnWardrobe').click();await equip(page,'eyes','happy');await page.locator('#btnWardrobeDone').click();
  const appearance=await page.evaluate(()=>equippedAppearance());
  await page.locator('#btnArena').click();await page.locator('.arena-launch').click();await page.locator('.arena-root[data-screen=match]').waitFor();
  assert.deepEqual(await page.evaluate(()=>arenaUI.snapshot().actors.find(a=>a.controller==='human').appearance),appearance);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'All games',exact:true}).filter({visible:true}).click();
  assert.equal(await page.evaluate(()=>G.cosmetics.progress.arena),0,'aborting earns nothing');
  await page.locator('#btnRace').click();await page.locator('.race-launch').click();await page.locator('.race-root[data-screen=play]').waitFor();
  assert.deepEqual(await page.evaluate(()=>raceUI.snapshot().actors.find(a=>a.controller==='human').appearance),appearance);
  await page.keyboard.press('Escape');await page.locator('#raceLobby').click();await page.locator('.race-lobby-header button').click();
  assert.equal(await page.evaluate(()=>G.cosmetics.progress.race),0,'leaving race earns nothing');
  await page.locator('#btnWardrobe').click();
  // Enter with focus on Color, traverse with D-pad, activate Eyes, then move to
  // Calm and equip with A. A held across a rebuild must not trigger a new action.
  await page.locator('#wardTab-suit').focus();
  const pad = async (button, hold = 90) => { await page.evaluate(button=>{testPad.buttons[button].pressed=true;},button); await page.waitForTimeout(hold); await page.evaluate(button=>{testPad.buttons[button].pressed=false;},button); await page.waitForTimeout(90); };
  await pad(15); await pad(15); await pad(0);
  assert.equal(await page.locator('#wardTab-eyes').getAttribute('aria-selected'),'true');
  await pad(13);
  // D-pad down from Eyes lands in the aligned choice column; move until Calm.
  for (let i=0; i<4 && await page.evaluate(()=>document.activeElement?.dataset.cosmetic) !== 'calm'; i++) await pad(14);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.cosmetic),'calm');
  await pad(0,450); assert.equal(await page.evaluate(()=>G.cosmetics.eyes),'calm');
  assert.equal(await page.evaluate(()=>G.mode),'attract'); assert.equal(await page.locator('#ovWardrobe.show').count(),1);
  await pad(1); await page.locator('#ovAttract.show').waitFor();
  await page.evaluate(()=>localStorage.setItem(BUILD.storageKey('sm2.cosmetics'),'{broken'));await page.reload();
  assert.deepEqual(await page.evaluate(()=>equippedAppearance()),{v:1,suit:'classic',hat:'none',eyes:'bright',helmet:'round',detail:'plain',ship:'comet'});
});
