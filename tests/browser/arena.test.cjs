// Real Chromium UI regression. Local assets only, no relay or online-PvP claim.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');

async function launch(t, device = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
      if (!file.startsWith(ROOT + path.sep)) return res.writeHead(400).end();
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' }[path.extname(file)] || 'text/plain';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(await fs.readFile(file));
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  t.after(async () => {
    if (browser && process.env.SPACE_MAN_ARENA_SCREENSHOTS) {
      try {
        await fs.mkdir(process.env.SPACE_MAN_ARENA_SCREENSHOTS, { recursive: true });
        for (const context of browser.contexts()) for (const p of context.pages()) {
          await p.screenshot({ path: path.join(process.env.SPACE_MAN_ARENA_SCREENSHOTS, 'last-' + (device.hasTouch ? 'phone' : 'desktop') + '-' + Date.now() + '.png') });
        }
      } catch (_) { /* Diagnostics never replace a test result. */
      }
    }
    if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
  });
  browser = await chromium.launch(process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', ...device });
  await context.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window), pending = new Set();
    window.requestAnimationFrame = fn => {
      const id = request(time => { pending.delete(id); fn(time); }); pending.add(id); return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); return cancel(id); };
    Object.defineProperty(window, '__arenaRafPending', { get: () => pending.size });
  });
  const page = await context.newPage(), errors = [], sockets = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('websocket', ws => sockets.push(ws.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('#btnArena').waitFor();
  t.after(() => { assert.deepEqual(errors, [], 'no uncaught browser errors'); assert.deepEqual(sockets, [], 'CPU arena never opens a relay socket'); });
  return { page, context, errors, sockets };
}
async function screen(page, value) { await page.locator(`.arena-root[data-screen="${value}"]`).waitFor(); }
async function playing(page) { await page.waitForFunction(() => arenaUI.snapshot()?.phase === 'playing'); }
async function pause(page) { await page.keyboard.press('Escape'); await screen(page, 'pause'); }
async function capture(page, name) {
  if (!process.env.SPACE_MAN_ARENA_SCREENSHOTS) return;
  await fs.mkdir(process.env.SPACE_MAN_ARENA_SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.SPACE_MAN_ARENA_SCREENSHOTS, name + '.png') });
}

test('arena desktop: launcher, real controls, pause, result/rematch, stage formats and safe runner return', { timeout: 90000 }, async t => {
  const { page } = await launch(t);
  await page.evaluate(() => { localStorage.setItem('sm2.best', '4321'); window.runnerAtArenaLaunch = G.player; });
  await page.locator('#btnArena').click(); await screen(page, 'lobby');
  assert.equal(await page.locator('.arena-stage-card').count(), 3);
  assert.equal(await page.locator('.arena-format-card').count(), 3);
  await capture(page, 'arena-lobby-desktop');
  await page.locator('.arena-launch').click(); await playing(page);
  const start = await page.evaluate(() => arenaUI.snapshot());
  assert.equal(start.actors.length, 2);
  assert.equal(start.actors[0].controller, 'human');
  assert.equal(start.actors[1].controller, 'cpu');
  await page.keyboard.down('d'); await page.waitForTimeout(160); await page.keyboard.up('d');
  assert.ok((await page.evaluate(() => arenaUI.snapshot().actors[0].x)) > start.actors[0].x + 5);
  await page.keyboard.down('Space');
  await page.waitForFunction(() => arenaUI.snapshot().actors[0].vy < -2);
  await page.keyboard.up('Space');
  await page.keyboard.press('f'); await page.waitForFunction(() => arenaUI.snapshot().actors[0].attackTicks > 0);
  await page.waitForTimeout(500);
  await page.keyboard.press('Shift'); await page.waitForFunction(() => arenaUI.snapshot().actors[0].dashTicks > 0);
  await capture(page, 'arena-match-desktop');
  await pause(page);
  const pausedTick = await page.evaluate(() => arenaUI.snapshot().tick);
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => arenaUI.snapshot().tick), pausedTick);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.closest('.arena-dialog') !== null), true, 'focus stays in arena modal');
  await page.getByRole('button', { name: 'Restart match', exact: true }).click(); await playing(page);
  // Lose a real match using ordinary movement; results are not manufactured by a QA hook.
  await page.keyboard.down('d');
  await page.locator('.arena-root[data-screen="results"]').waitFor({ timeout: 35000 });
  await page.keyboard.up('d');
  assert.equal(await page.evaluate(() => arenaUI.snapshot().phase), 'over');
  await page.getByRole('button', { name: 'Rematch', exact: true }).click();
  assert.equal(await page.evaluate(() => arenaUI.snapshot().phase), 'countdown');
  await pause(page);
  await page.getByRole('button', { name: 'Choose a match', exact: true }).click(); await screen(page, 'lobby');
  for (const [format, stage] of [['ffa', 'bloom-reactor'], ['teams', 'ember-foundry']]) {
    await page.locator(`.arena-format-card[data-format="${format}"]`).click();
    await page.locator(`.arena-stage-card[data-arena="${stage}"]`).click();
    await page.locator('.arena-launch').click();
    const snapshot = await page.evaluate(() => arenaUI.snapshot());
    assert.equal(snapshot.actors.length, 4); assert.equal(snapshot.format, format); assert.equal(snapshot.arenaId, stage);
    if (format === 'teams') assert.deepEqual(snapshot.actors.map(a => a.team), [0, 0, 1, 1]);
    await pause(page);
    await page.getByRole('button', { name: 'Choose a match', exact: true }).click();
  }
  await page.getByRole('button', { name: /Back to runner/ }).filter({ visible: true }).click();
  assert.equal(await page.evaluate(() => arenaUI.active), false);
  assert.equal(await page.evaluate(() => G.player === window.runnerAtArenaLaunch), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('sm2.best')), '4321');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnArena');
  await page.locator('#btnPlay').click(); await page.keyboard.down('d');
  await page.waitForFunction(() => G.mode === 'play' && G.player.vx > 0);
  await page.keyboard.up('d');
});

test('arena phone: readable controls, multi-touch movement/release, rotation and remapped keyboard', { timeout: 60000 }, async t => {
  const { page, context } = await launch(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.evaluate(() => { settings.reduceMotion = true; settings.muted = true; settings.batterySaver = true; settings.keys.jump = 'q'; });
  await page.locator('#btnArena').tap(); await screen(page, 'lobby');
  await capture(page, 'arena-lobby-phone');
  await page.locator('.arena-launch').tap(); await playing(page);
  const root = page.locator('.arena-root');
  assert.equal(await root.getAttribute('data-calm'), 'true');
  assert.equal(await root.getAttribute('data-saver'), 'true');
  for (const name of ['jump', 'attack', 'dash']) {
    const r = await page.locator('.arena-touch-' + name).boundingBox();
    assert.ok(r && r.width >= 48 && r.height >= 48 && r.x >= 0 && r.y >= 0 && r.x + r.width <= 391 && r.y + r.height <= 845, name + ' is visible and thumb-sized');
  }
  const cdp = await context.newCDPSession(page);
  const stick = await page.locator('.arena-stick-zone').boundingBox();
  const x = stick.x + stick.width * .4, y = stick.y + stick.height * .6;
  const before = await page.evaluate(() => arenaUI.snapshot().actors[0].x);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 0, x: x + 40, y }] });
  await page.waitForTimeout(180);
  assert.ok((await page.evaluate(() => arenaUI.snapshot().actors[0].x)) > before + 5);
  const jump = await page.locator('.arena-touch-jump').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 0, x: x + 40, y }, { id: 1, x: jump.x + jump.width / 2, y: jump.y + jump.height / 2 }] });
  await page.waitForFunction(() => arenaUI.snapshot().actors[0].vy < -2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.arena-pressed').count(), 0, 'cancel clears touch capture and visual holds');
  await page.keyboard.press('q');
  await page.waitForFunction(() => arenaUI.snapshot().actors[0].jumpCount === 2);
  await capture(page, 'arena-match-phone');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await capture(page, 'arena-match-phone-landscape');
  await page.locator('[aria-label="Pause match"]').tap(); await screen(page, 'pause');
  await page.getByRole('button', { name: 'Back to runner', exact: true }).filter({ visible: true }).tap();
  assert.equal(await page.evaluate(() => arenaUI.active), false);
  assert.equal(await page.evaluate(() => input.left || input.right || input.jumpHeld), false);
});

test('arena browser gamepad mapping and held-button mode-boundary guard', { timeout: 35000 }, async t => {
  const { page } = await launch(t);
  await page.evaluate(() => {
    window.testPad = { connected: true, mapping: 'standard', index: 0, id: 'Standard test controller', axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.testPad] });
  });
  await page.locator('#btnArena').click();
  await page.locator('.arena-launch').focus(); await page.waitForTimeout(80);
  await page.evaluate(() => { window.testPad.buttons[0].pressed = true; });
  await playing(page);
  assert.ok(await page.evaluate(() => window.__arenaRafPending <= 2), 'one runner frame and one arena frame after controller launch');
  await page.evaluate(() => { window.testPad.buttons[0].pressed = false; }); await page.waitForTimeout(80);
  await page.evaluate(() => { window.testPad.buttons[0].pressed = true; });
  await page.waitForFunction(() => arenaUI.snapshot().actors[0].vy < -2);
  await page.evaluate(() => { window.testPad.buttons[0].pressed = false; window.testPad.axes[0] = .8; });
  await page.waitForFunction(() => arenaUI.snapshot().actors[0].vx > 1);
  await page.evaluate(() => { window.testPad.axes[0] = 0; window.testPad.buttons[9].pressed = true; });
  await screen(page, 'pause');
  await page.evaluate(() => { window.testPad.buttons[9].pressed = false; });
  await page.waitForTimeout(80);
  const pausedTick = await page.evaluate(() => arenaUI.snapshot().tick);
  await page.getByRole('button', { name: 'Resume match', exact: true }).focus();
  await page.evaluate(() => { window.testPad.buttons[0].pressed = true; });
  await page.waitForFunction(tick => arenaUI.snapshot().tick > tick, pausedTick);
  assert.ok(await page.evaluate(() => window.__arenaRafPending <= 2), 'controller resume cannot add another frame chain');
  await page.evaluate(() => { window.testPad.buttons[0].pressed = false; }); await page.waitForTimeout(80);
  await page.evaluate(() => { window.testPad.buttons[9].pressed = true; }); await screen(page, 'pause');
  await page.evaluate(() => { window.testPad.buttons[9].pressed = false; }); await page.waitForTimeout(80);
  await page.getByRole('button', { name: 'Back to runner', exact: true }).filter({ visible: true }).focus();
  await page.evaluate(() => { window.testPad.buttons[0].pressed = true; });
  await page.waitForFunction(() => !arenaUI.active);
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => G.mode), 'attract');
  assert.equal(await page.evaluate(() => arenaUI.active), false, 'held A cannot reopen arena');
  await page.evaluate(() => { window.testPad.buttons[0].pressed = false; });
  await page.waitForFunction(() => !arenaPadNeutral);
});
