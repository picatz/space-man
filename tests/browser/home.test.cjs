'use strict';
// Exercise the shipped home and real entry/return handlers. Art assertions read
// production canvas pixels; no mocked game, forced outcomes or relay sessions.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const engineName = process.env.SPACE_MAN_HOME_BROWSER || 'chromium';
const engine = engineName === 'webkit' ? webkit : chromium;
const SHOTS = process.env.SPACE_MAN_HOME_SCREENSHOTS;
const entries = ['btnExpedition', 'btnExpeditionFriends', 'btnPlay', 'btnArena', 'btnRace', 'btnTogether', 'btnDaily', 'btnWardrobe', 'btnTrophy', 'btnSettings'];
const sizes = [[320, 568], [390, 844], [667, 375], [820, 1180], [1440, 900]];

async function launch(t, viewport = { width: 1440, height: 900 }, controller = false) {
  let server, browser;
  t.after(async () => {
    if (browser) await browser.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  let base = process.env.SPACE_MAN_BASE_URL;
  if (!base) {
    server = http.createServer(async (req, res) => {
      try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        const file = path.resolve(ROOT, '.' + decodeURIComponent(pathname) + (pathname.endsWith('/') ? 'index.html' : ''));
        if (!file.startsWith(ROOT + path.sep)) return res.writeHead(400).end();
        const bytes = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(bytes);
      } catch (_) { res.writeHead(404).end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/`;
  }
  browser = await engine.launch(engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1000, isMobile: viewport.width < 1000, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const errors = [], sockets = [], externalRequests = [];
  // Opening a friends front door must stay local. Prevent a regression from
  // contacting a real relay, then fail if any connection was even attempted.
  await context.routeWebSocket('**/*', ws => { sockets.push(ws.url()); ws.close(); });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  });
  if (controller) await context.addInitScript(() => {
    window.homeTestPad = { connected: true, mapping: 'standard', index: 0, id: 'Xbox home test', axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [homeTestPad] });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => {
    assert.deepEqual(errors, [], 'no runtime errors');
    assert.deepEqual(sockets, [], 'no attempted relay/WebSocket connections');
    assert.deepEqual(externalRequests, [], 'no external HTTP requests');
  });
  await page.goto(base);
  await home(page);
  await page.evaluate(() => { settings.muted = true; });
  if (process.env.SPACE_MAN_EXPECTED_SHA) assert.equal(JSON.parse(await page.locator('meta[name="space-man-preview"]').getAttribute('content')).sha, process.env.SPACE_MAN_EXPECTED_SHA);
  return { page, context };
}
async function home(page) {
  await page.locator('#ovAttract.in').waitFor();
  await page.waitForFunction(() => G.mode === 'attract' && !document.getElementById('ovAttract').inert);
}
async function capture(page, name) {
  if (!SHOTS) return;
  await fs.mkdir(SHOTS, { recursive: true });
  await page.screenshot({ animations: 'disabled', path: path.join(SHOTS, `${engineName}-${name}.png`) });
}
async function resetScroll(page) { await page.locator('.home-shell').evaluate(n => { n.scrollTop = 0; }); }
async function fit(page) {
  const problems = await page.evaluate(() => {
    const selectors = ['#ovAttract', '.home-shell', '.home-header', '.home-world', '.home-launch', '.home-play-actions', '.launch-modes', '.home-mode', '.home-footer', '#btnDaily', '#homeCallsign'];
    return selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)).filter(n => n.getClientRects().length).flatMap(n => {
      const b = n.getBoundingClientRect();
      return n.scrollWidth > n.clientWidth + 1 || b.left < -1 || b.right > innerWidth + 1 ? [{ selector, width: n.clientWidth, scroll: n.scrollWidth, left: b.left, right: b.right }] : [];
    }));
  });
  assert.deepEqual(problems, [], 'no horizontal overflow or clipped home content');
}
async function reachable(page, id) {
  const node = page.locator('#' + id);
  await node.scrollIntoViewIfNeeded();
  const result = await node.evaluate(n => {
    const b = n.getBoundingClientRect(), target = n.closest('.home-mode') || n, t = target.getBoundingClientRect();
    // The arcade button's ::before deliberately expands across the illustration.
    const x = b.left + b.width / 2, y = b.top + b.height / 2, hit = document.elementFromPoint(x, y);
    return { x: b.left, y: b.top, right: b.right, bottom: b.bottom, width: t.width, height: t.height, hit: hit === n || n.contains(hit), enabled: !n.disabled, viewport: [innerWidth, innerHeight] };
  });
  assert.ok(result.width >= 44 && result.height >= 44, `${id}: effective touch target is at least 44px`);
  assert.ok(result.x >= -1 && result.y >= -1 && result.right <= result.viewport[0] + 1 && result.bottom <= result.viewport[1] + 1, `${id}: reachable inside the viewport`);
  assert.ok(result.hit && result.enabled, `${id}: not covered by decoration or another control`);
}
async function activate(page, id) {
  const button = page.locator('#' + id);
  if (page.viewportSize().width < 1000) await button.tap(); else await button.click();
}
async function leaveExpedition(page) {
  await page.waitForFunction(() => expedition?.snapshot().phase === 'playing');
  const mode = await page.evaluate(() => expedition.snapshot().current.id);
  await page.keyboard.press('Escape');
  await page.locator(mode === 'runner' ? '#btnQuit' : mode === 'arena' ? '#arenaExit' : '#raceExit').click();
  await home(page);
  assert.equal(await page.evaluate(() => expedition), null);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnExpedition');
}
async function stopRun(page) {
  await page.waitForFunction(() => G.mode === 'play');
  await page.keyboard.press('Escape');
  await page.locator('#ovPause.show').waitFor();
  await page.locator('#btnQuit').click();
  await home(page);
}
async function artPixels(page) {
  return page.evaluate(() => Object.fromEntries(['homeHero', 'homeRunArt', 'homeArenaArt', 'homeRaceArt'].map(id => {
    const c = document.getElementById(id), data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let opaque = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
    return [id, { png: c.toDataURL(), opaque, width: c.width, height: c.height }];
  })));
}

for (const [width, height] of sizes) test(`home ${width}x${height}: exact screenshots, every entry, real launch and return`, { timeout: 90000 }, async t => {
  const { page } = await launch(t, { width, height });
  await fit(page);
  const art = await artPixels(page);
  for (const [id, pixels] of Object.entries(art)) assert.ok(pixels.opaque > 500, `${id}: production illustration is painted`);
  await capture(page, `home-${width}x${height}-top`);
  for (const id of entries) await reachable(page, id);
  await capture(page, `home-${width}x${height}-utilities`);
  await resetScroll(page);
  // The first action is visible even on the smallest phone and landscape view.
  const primary = await page.locator('#btnExpedition').boundingBox();
  assert.ok(primary.y >= 0 && primary.y + primary.height <= height + 1, 'Play solo is visible without scrolling');

  await activate(page, 'btnExpedition');
  await leaveExpedition(page);
  await activate(page, 'btnExpeditionFriends');
  await page.locator('#journeyFriends:not([hidden])').waitFor();
  assert.equal(await page.locator('#journeyHost').isEnabled(), true);
  assert.equal(await page.locator('#journeyJoinInput').isVisible(), true);
  assert.equal(await page.evaluate(() => journeyUI.room.status().active), false, 'friends front door does not create a room');
  await capture(page, `home-${width}x${height}-friends`);
  await page.keyboard.press('Escape'); await home(page);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnExpeditionFriends');

  await activate(page, 'btnPlay'); await stopRun(page);
  await activate(page, 'btnArena'); await page.locator('.arena-root[data-screen=lobby]').waitFor();
  await page.locator('.arena-launch').click(); await page.locator('.arena-root[data-screen=match]').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'All games', exact: true }).filter({ visible: true }).click();
  await home(page); assert.equal(await page.evaluate(() => document.activeElement.id), 'btnArena');
  await activate(page, 'btnRace'); await page.locator('.race-root[data-screen=lobby]').waitFor();
  await page.locator('.race-launch').click(); await page.locator('.race-root[data-screen=play]').waitFor();
  await page.keyboard.press('Escape'); await page.locator('#raceExit').click();
  await home(page); assert.equal(await page.evaluate(() => document.activeElement.id), 'btnRace');

  await activate(page, 'btnDaily'); await page.waitForFunction(() => G.mode === 'play');
  assert.equal(await page.evaluate(() => G.course?.kind), 'daily');
  await stopRun(page);
  await activate(page, 'btnTogether'); await page.locator('#ovTogether.show').waitFor();
  await page.locator('#btnTogetherBack').click(); await home(page);
  await activate(page, 'btnTrophy'); await page.locator('#ovTrophy.show').waitFor();
  await page.locator('#btnCloseTrophy').click(); await home(page);
  await activate(page, 'btnSettings'); await page.locator('#ovSettings.show').waitFor();
  await page.locator('#btnCloseSettings').click(); await home(page);
  await activate(page, 'btnWardrobe'); await page.locator('#ovWardrobe.show').waitFor();
  await page.locator('#btnWardrobeDone').click(); await home(page);
  await fit(page); await resetScroll(page); await capture(page, `home-${width}x${height}-returned`);
});

for (const [width, height] of [[390, 844], [1440, 900]]) test(`home ${width}x${height}: outfit pixels and callsign persist through real controls and reload`, { timeout: 60000 }, async t => {
  const { page } = await launch(t, { width, height });
  const before = await artPixels(page);
  await activate(page, 'btnWardrobe');
  for (const [slot, id] of [['suit', 'mint'], ['hat', 'antenna'], ['eyes', 'happy'], ['helmet', 'bubble'], ['detail', 'stripe'], ['ship', 'orbit']]) {
    await page.locator('#wardTab-' + slot).click();
    await page.locator(`[data-cosmetic="${id}"]`).click();
    assert.equal(await page.locator(`[data-cosmetic="${id}"]`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('#wardCallsignRow').click();
  await page.locator('#ovCallsign.show').waitFor();
  await page.locator('#callsignCols .arrow-btn').first().click();
  const callsign = await page.locator('#callsignPreview').innerText();
  assert.ok(callsign.trim());
  await page.locator('#btnCallsignDone').click();
  await page.locator('#btnWardrobeDone').click(); await home(page);
  assert.equal(await page.locator('#homeCallsign').innerText(), callsign);
  const appearance = await page.evaluate(() => equippedAppearance());
  assert.deepEqual(appearance, { v: 1, suit: 'mint', hat: 'antenna', eyes: 'happy', helmet: 'bubble', detail: 'stripe', ship: 'orbit' });
  const equipped = await artPixels(page);
  for (const id of Object.keys(before)) assert.notEqual(equipped[id].png, before[id].png, `${id}: equipped appearance changes real pixels`);
  await capture(page, `home-${width}x${height}-equipped`);
  await page.reload(); await home(page);
  assert.deepEqual(await page.evaluate(() => equippedAppearance()), appearance);
  assert.equal(await page.locator('#homeCallsign').innerText(), callsign);
  assert.deepEqual(await artPixels(page), equipped, 'all four rendered illustrations reproduce the saved outfit exactly');
  await fit(page); await capture(page, `home-${width}x${height}-equipped-reloaded`);
});

test('keyboard and controller focus, repeated friends dismissal, and saved reduced motion', { timeout: 60000 }, async t => {
  const { page } = await launch(t, { width: 1440, height: 900 }, true);
  await page.waitForFunction(() => input.pad.connected);
  await page.locator('#btnExpedition').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnExpeditionFriends');
  assert.equal(await page.locator('#btnExpeditionFriends').evaluate(n => getComputedStyle(n).outlineStyle), 'solid');
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Enter'); await page.locator('#journeyFriends:not([hidden])').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'journeyHost');
    await page.keyboard.press('Shift+Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'journeyLeave');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'journeyHost');
    await page.keyboard.press('Escape'); await home(page);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'btnExpeditionFriends');
  }
  await page.locator('#btnWardrobe').focus(); await page.keyboard.press('Enter');
  await page.locator('#ovWardrobe.show').waitFor();
  await page.evaluate(() => { homeTestPad.buttons[1].pressed = true; });
  await home(page);
  await page.evaluate(() => { homeTestPad.buttons[1].pressed = false; });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnExpedition', 'controller return selects the featured adventure');
  await page.keyboard.press('Enter'); await leaveExpedition(page);
  await page.locator('#btnArena').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btnRace');

  assert.equal(await page.evaluate(() => settings.reduceMotion), true);
  const stable = await artPixels(page); await page.waitForTimeout(300);
  assert.deepEqual(await artPixels(page), stable, 'reduced-motion home art stays still');
  assert.equal(await page.locator('.home-mode').first().evaluate(n => getComputedStyle(n).transitionDuration), '0s');
  await page.locator('#btnSettings').click();
  const motion = page.locator('#ovSettings [data-setting=reduceMotion]');
  assert.equal(await motion.getAttribute('aria-checked'), 'true');
  await motion.click(); await page.locator('#btnCloseSettings').click(); await home(page);
  assert.ok(await page.locator('.home-mode').first().evaluate(n => getComputedStyle(n).transitionDuration.split(',').some(v => parseFloat(v) > 0)), 'explicit motion setting restores hover feedback');
  await page.locator('#btnSettings').click(); await motion.click();
  await page.locator('#btnCloseSettings').click(); await home(page);
  await page.reload(); await home(page);
  assert.equal(await page.evaluate(() => settings.reduceMotion), true);
  assert.equal(await page.locator('.home-mode').first().evaluate(n => getComputedStyle(n).transitionDuration), '0s');
});
