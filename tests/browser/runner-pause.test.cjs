'use strict';
// Regress the visible runner Pause control through real mouse/touch input.
// Fixed expedition seed selects a runner entry; no actor/clock/result teleport.
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs/promises'), path = require('node:path');
const { chromium, webkit } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const engine = process.env.SPACE_MAN_PAUSE_BROWSER === 'webkit' ? webkit : chromium;
async function launch(t, touch) {
  let server, browser;
  t.after(async () => { if (browser) await browser.close(); if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); } });
  let base = process.env.SPACE_MAN_BASE_URL;
  if (!base) {
    server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url, 'http://localhost'), file = path.resolve(ROOT, '.' + decodeURIComponent(u.pathname) + (u.pathname.endsWith('/') ? 'index.html' : ''));
        if (!file.startsWith(ROOT + path.sep)) return res.writeHead(400).end();
        const data = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' }).end(data);
      } catch (_) { res.writeHead(404).end(); }
    });
    await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); });
    base = 'http://127.0.0.1:' + server.address().port + '/';
  }
  browser = await engine.launch(engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: touch ? { width: 820, height: 1180 } : { width: 1440, height: 900 }, hasTouch: touch, isMobile: touch, serviceWorkers: 'block' });
  const errors = [], sockets = [];
  await context.routeWebSocket('**/*', ws => { sockets.push(ws.url()); ws.close(); });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(sockets, [], 'solo stays offline'); });
  await page.goto(base); await page.locator('#ovAttract.in').waitFor();
  if (process.env.SPACE_MAN_EXPECTED_SHA) assert.equal(JSON.parse(await page.locator('meta[name="space-man-preview"]').getAttribute('content')).sha, process.env.SPACE_MAN_EXPECTED_SHA);
  return page;
}
async function start(page, expeditionMode) {
  if (expeditionMode) await page.evaluate(() => {
    let seed = 1; while (SpaceManExpedition.encounterAt(seed, 0).id !== 'runner') seed++;
    const random = Math.random;
    try { Math.random = () => (seed + .1) / 0xffffffff; openExpedition(); } finally { Math.random = random; }
  });
  else await page.locator('#btnPlay').click();
  await page.waitForFunction(() => G.mode === 'play' && G._pauseHit && !G.player.dead);
}
async function pausePoint(page) {
  return page.evaluate(() => { const r = canvas.getBoundingClientRect(), h = G._pauseHit; return { x: r.left + (h.x0 + h.x1) / 2, y: r.top + (h.y0 + h.y1) / 2 }; });
}
async function state(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify({
    mode: G.mode, frame: G.frameCount, player: G.player, platforms: G.platforms,
    enemies: G.enemies, bullets: G.bullets, ebullets: G.ebullets, pickups: G.pickups,
    flare: G.flare, dist: G.dist, score: G.score, cooldown: G.cooldown,
    slowTimer: G.slowTimer, mission: G.mission, expedition: expedition?.snapshot() || null
  })));
}
async function assertFrozen(page) {
  await page.waitForFunction(() => G.mode === 'pause');
  assert.equal(await page.locator('#ovPause.in').count(), 1, 'visible pause dialog opens');
  const before = await state(page); await page.waitForTimeout(1600);
  assert.deepEqual(await state(page), before, 'physics, AI, projectiles, simulation clocks and route director freeze');
  assert.equal(await page.evaluate(() => input.shoot || input.fireMouse || input.jumpHeld || input.left || input.right || input.stick.active || input.shootBtn.pressed), false, 'pause clears gameplay input');
  return before;
}
for (const expeditionMode of [false, true]) for (const touch of [false, true]) {
  test(`${expeditionMode ? 'preserved expedition' : 'standalone runner'} visible ${touch ? 'tablet touch' : 'desktop mouse'} Pause freezes and resumes neutrally`, { timeout: 45000 }, async t => {
    const page = await launch(t, touch); await start(page, expeditionMode);
    // Put a genuine fired projectile in motion before pausing.
    await page.keyboard.press('f');
    await page.waitForFunction(() => G.bullets.length > 0);
    const p = await pausePoint(page);
    if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    const before = await assertFrozen(page);
    if (process.env.SPACE_MAN_PAUSE_SCREENSHOTS) {
      await fs.mkdir(process.env.SPACE_MAN_PAUSE_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SPACE_MAN_PAUSE_SCREENSHOTS, `${expeditionMode ? 'expedition' : 'runner'}-${touch ? 'tablet' : 'desktop'}-paused.png`), animations: 'disabled' });
    }
    await page.locator('#btnResume').click();
    if (touch) {
      await page.waitForFunction(() => G.mode === 'resume');
      const q = await pausePoint(page); await page.touchscreen.tap(q.x, q.y);
      await assertFrozen(page); // Pause must also interrupt the touch countdown.
      await page.locator('#btnResume').click();
    }
    await page.waitForFunction(frame => G.mode === 'play' && G.frameCount > frame, before.frame);
    assert.equal(await page.evaluate(() => input.shoot || input.fireMouse || input.fireKey || input.jumpHeld || input.left || input.right), false, 'resume does not replay the pause click');
    await page.keyboard.press('Escape'); await assertFrozen(page);
    await page.locator('#btnQuit').click(); await page.locator('#ovAttract.in').waitFor();
    assert.equal(await page.evaluate(() => expedition), null, 'exit cancels preserved expedition');
  });
}
