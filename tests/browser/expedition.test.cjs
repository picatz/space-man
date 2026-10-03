// Connected solo gameplay. Real UI loops and engines; controller driver submits
// ordinary commands. No state teleport, simulated result, relay or score seeding.
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), path = require('node:path'), fs = require('node:fs/promises');
const { chromium, webkit } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const engine = process.env.SPACE_MAN_EXPEDITION_BROWSER === 'webkit' ? webkit : chromium;
async function launch(t, device = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(ROOT + path.sep)) return res.writeHead(400).end();
      const bytes = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' }).end(bytes);
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  t.after(async () => { if (browser) await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  browser = await engine.launch(engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', ...device });
  await context.addInitScript(() => {
    window.testPad = { connected: true, mapping: 'standard', index: 0, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.testPad], configurable: true });
  });
  const page = await context.newPage(), errors = [], sockets = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('websocket', ws => sockets.push(ws.url()));
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(sockets, [], 'solo expedition never opens a room'); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(() => { settings.muted = true; settings.reduceMotion = true; });
  return { page, context };
}
async function capture(page, name) {
  if (!process.env.SPACE_MAN_EXPEDITION_SCREENSHOTS) return;
  await fs.mkdir(process.env.SPACE_MAN_EXPEDITION_SCREENSHOTS, { recursive: true });
  await page.waitForFunction(() => { const panel = document.querySelector('#ovExpedition'); return !panel.classList.contains('show') || (panel.classList.contains('in') && getComputedStyle(panel).opacity === '1' && getComputedStyle(panel.querySelector('.panel')).opacity === '1'); });
  await page.screenshot({ animations:'disabled', path: path.join(process.env.SPACE_MAN_EXPEDITION_SCREENSHOTS, name + '.png') });
}
async function briefing(page) { await page.locator('#ovExpedition.show').waitFor(); }
async function loseRunner(page) {
  await page.locator('#btnExpeditionContinue').click();
  await page.keyboard.down('d');
  await briefing(page); await page.keyboard.up('d');
  assert.equal(await page.evaluate(() => expedition.snapshot().records.length), 1);
}
test('desktop: full runner → duel → one-lap race, receipt, replay and standalone return', { timeout: 150000 }, async t => {
  const {page} = await launch(t);
  await page.locator('#btnExpedition').click(); await briefing(page); await capture(page, 'expedition-desktop-briefing');
  await loseRunner(page); await capture(page, 'expedition-runner-receipt');
  const earned = await page.evaluate(() => stats.runs); assert.equal(earned, 1);
  await page.locator('#btnExpeditionContinue').click();
  await page.locator('.arena-root[data-screen=match]').waitFor();
  assert.equal(await page.evaluate(() => arenaUI.snapshot().format), 'duel');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#arenaLobby').innerText(), 'Leave expedition');
  assert.equal(await page.getByRole('button', {name:'Leave expedition',exact:true}).filter({visible:true}).count(), 1);
  await page.getByRole('button', {name:'Restart match',exact:true}).click();
  assert.equal(await page.evaluate(() => arenaUI.snapshot().phase), 'countdown');
  await page.keyboard.press('Escape'); await page.locator('#arenaResume').click();
  await page.keyboard.down('d'); await briefing(page); await page.keyboard.up('d');
  assert.equal(await page.evaluate(() => arenaUI.active), false);
  assert.equal(await page.evaluate(() => expedition.snapshot().records.length), 2);
  await capture(page, 'expedition-arena-receipt');
  await page.locator('#btnExpeditionContinue').click();
  await page.locator('.race-root[data-screen=play]').waitFor();
  assert.equal(await page.evaluate(() => raceUI.snapshot().laps), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#raceLobby').innerText(), 'Leave expedition');
  assert.equal(await page.getByRole('button', {name:'Leave expedition',exact:true}).filter({visible:true}).count(), 1);
  await page.locator('#raceRestart').click();
  assert.equal(await page.evaluate(() => raceUI.snapshot().phase), 'countdown');
  // The existing visibility handler must safely pause an expedition leg too.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {value:true,configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('.race-root[data-screen=pause]').waitFor();
  const pausedTick = await page.evaluate(() => raceUI.snapshot().tick);
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => raceUI.snapshot().tick), pausedTick);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {value:false,configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('#raceResume').click();
  await page.evaluate(() => {
    window.lastRace = null;
    window.driver = setInterval(() => {
      const s = raceUI.snapshot(); if (!s || s.phase !== 'racing') return;
      lastRace = s;
      const c = SpaceManRace.cpuInput(s, s.actors[0]);
      testPad.axes[0] = c.steer; testPad.buttons[0].pressed = c.boost; testPad.buttons[1].pressed = c.brake;
    }, 16);
  });
  await page.locator('#ovExpedition.show').waitFor({timeout:75000});
  await page.evaluate(() => { clearInterval(driver); testPad.axes[0] = 0; testPad.buttons.forEach(b => b.pressed = false); });
  const completed = await page.evaluate(() => expedition.snapshot());
  assert.equal(completed.phase, 'complete'); assert.equal(completed.records[2].finished, true);
  assert.ok(completed.records[2].time > 5); assert.equal(completed.records.length, 3);
  assert.equal(await page.evaluate(() => stats.runs), earned, 'arcade chapters never bank a runner score');
  assert.equal(await page.evaluate(() => raceUI.active || arenaUI.active), false);
  assert.equal(await page.locator('#expeditionReceipt li').count(), 3);
  await capture(page, 'expedition-complete');
  await page.locator('#btnExpeditionContinue').click();
  assert.equal(await page.evaluate(() => expedition.snapshot().records.length), 0);
  await page.locator('#btnExpeditionExit').click();
  await page.locator('#btnRace').click(); await page.locator('.race-launch').click();
  assert.equal(await page.evaluate(() => raceUI.snapshot().laps), 3, 'standalone keeps its full length');
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'Back to runner',exact:true}).filter({visible:true}).click();
  assert.equal(await page.evaluate(() => expedition), null);
  await page.locator('#btnPlay').focus(); await page.keyboard.press('Enter'); await page.keyboard.down('d');
  await page.waitForFunction(() => G.mode === 'play' && G.player.vx > 0); await page.keyboard.up('d');
});

for (const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:820,height:1180}]) {
  test(`touch layout ${viewport.width}×${viewport.height}: readable brief, chapter controls and exit`, {timeout:45000}, async t => {
    const {page} = await launch(t, {viewport, hasTouch:true, isMobile:true});
    await page.locator('#btnExpedition').tap(); await briefing(page);
    assert.equal(await page.locator('.expedition-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'no horizontal clipping');
    if (viewport.width > viewport.height) {
      await capture(page, `expedition-${viewport.width}x${viewport.height}-top`);
      const size = await page.locator('.expedition-panel').evaluate(el => ({scroll:el.scrollHeight,client:el.clientHeight}));
      assert.ok(size.scroll <= size.client + 1, 'landscape briefing fits without scrolling: ' + JSON.stringify(size));
    }
    for (const id of ['btnExpeditionContinue','btnExpeditionExit']) {
      await page.locator('#'+id).scrollIntoViewIfNeeded();
      const box = await page.locator('#'+id).boundingBox(); assert.ok(box.height >= 44 && box.width >= 44);
    }
    await capture(page, `expedition-${viewport.width}x${viewport.height}`);
    await page.locator('#btnExpeditionContinue').tap();
    await page.keyboard.press('Escape'); await page.locator('#btnQuit').tap();
    assert.equal(await page.evaluate(() => expedition), null);
    assert.equal(await page.locator('#ovAttract').evaluate(el => el.inert), false);
    await page.locator('#btnExpedition').tap(); await page.locator('#btnExpeditionExit').tap();
    assert.equal(await page.evaluate(() => expedition), null);
  });
}

test('arcade leg interruption aborts cleanly and restores standalone selections', {timeout:50000}, async t => {
  const {page} = await launch(t);
  await page.locator('#btnRace').click(); await page.locator('[data-track=ember]').click();
  await page.getByRole('button', {name:'← Back to runner',exact:true}).click();
  const saved = await page.evaluate(() => localStorage.getItem('sm2.race.v1'));
  await page.locator('#btnExpedition').click(); await loseRunner(page);
  await page.locator('#btnExpeditionContinue').click(); await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'Leave expedition',exact:true}).filter({visible:true}).first().click();
  assert.equal(await page.evaluate(() => expedition), null);
  assert.equal(await page.evaluate(() => arenaUI.active), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('sm2.race.v1')), saved);
  await page.locator('#btnArena').click(); await page.locator('.arena-launch').click();
  assert.equal(await page.evaluate(() => arenaUI.snapshot().difficulty), 'normal');
});
