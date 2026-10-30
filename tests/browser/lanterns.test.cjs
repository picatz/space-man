'use strict';
// Lantern Lines in a real browser: open it from home, play Flare by keyboard and
// touch, pass and play, the menu, and no overflow at phone, tablet and laptop
// sizes. Rules and rooms have unit tests (tabletop, table-room); this guards the
// screen. SPACE_MAN_HOME_BROWSER picks the engine (CI runs it in the home suite).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require('playwright');
const ROOT = path.resolve(__dirname, '../..');
const engine = process.env.SPACE_MAN_HOME_BROWSER === 'webkit' ? webkit : chromium;
const SHOTS = process.env.SPACE_MAN_HOME_SCREENSHOTS;

async function launch(t, viewport) {
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
  const mobile = viewport.width < 1000;
  const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.routeWebSocket('**/*', ws => ws.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no runtime errors'));
  return { page, base };
}
async function home(page, base) {
  await page.goto(base);
  await page.locator('#ovAttract.in').waitFor();
  await page.waitForFunction(() => G.mode === 'attract' && !document.getElementById('ovAttract').inert);
  await page.evaluate(() => { settings.muted = true; return document.fonts.ready; });
}
async function open(t, viewport, init) {
  const { page, base } = await launch(t, viewport);
  if (init) await page.context().addInitScript(init);
  await page.goto(base);
  await page.locator('#ovAttract.in').waitFor();
  await page.waitForFunction(() => G.mode === 'attract' && !document.getElementById('ovAttract').inert);
  await page.evaluate(() => { settings.muted = true; });
  const lanterns = page.locator('#btnLanterns');
  if (viewport.width < 1000) await lanterns.tap(); else await lanterns.click();
  await page.locator('.tt-root[data-screen=lobby]').waitFor();
  return page;
}
const debug = page => page.evaluate(() => { const d = tableUI.debug(); return { mode: d.mode, status: d.status, phase: d.match && d.match.phase, ply: d.match && d.match.state.ply, turn: d.match && d.match.state.turn, cells: d.match ? SpaceManTabletop.LANTERNS.cells(d.match.state) : null }; });
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.tt-root button')].filter(b => b.offsetParent).some(b => { const r = b.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }));

for (const [width, height] of [[390, 844], [768, 1024], [1280, 800], [844, 390]]) {
  test(`lantern lines ${width}x${height}: lobby and board fit, Flare answers, menu and home work`, async t => {
    const page = await open(t, { width, height });
    assert.equal(await overflow(page), false, 'lobby fits');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `lanterns-lobby-${width}x${height}.png`) });
    await page.locator('#ttPlayCpu').click();
    await page.locator('.tt-root[data-screen=match]').waitFor();
    assert.equal(await overflow(page), false, 'board fits');
    // Every star is a real button inside the viewport, at least 44 px across.
    const boxes = await page.locator('.tt-cell').evaluateAll(cells => cells.map(c => c.getBoundingClientRect()).map(r => ({ w: r.width, b: r.bottom, r: r.right })));
    assert.equal(boxes.length, 9);
    for (const b of boxes) { assert.ok(b.w >= 44, 'star target ' + b.w); assert.ok(b.b <= height + 1 && b.r <= width + 1, 'star on screen'); }
    // The chart is painted (reduced motion included): a free star's centre glints near white.
    await page.waitForTimeout(150);
    const glint = await page.evaluate(() => { const b = document.querySelector('.tt-cell[data-cell="1"]').getBoundingClientRect(), c = document.querySelector('.tt-canvas'), k = c.width / innerWidth; return Array.from(c.getContext('2d').getImageData(Math.round((b.left + b.width / 2) * k), Math.round((b.top + b.height / 2) * k), 1, 1).data); });
    assert.ok(glint[0] > 150 && glint[1] > 150, 'star painted: ' + glint);
    const first = await debug(page);
    assert.equal(first.status, 'Your turn · light a lantern');
    if (width < 1000) await page.locator('.tt-cell[data-cell="4"]').tap(); else await page.locator('.tt-cell[data-cell="4"]').click();
    await page.waitForFunction(() => tableUI.debug().match.state.ply === 2, null, { timeout: 4000 });
    const after = await debug(page);
    assert.equal(after.cells[4], 1, 'your lantern on the centre star');
    assert.equal(after.cells.filter(v => v === 2).length, 1, 'Flare lit one lantern');
    assert.equal(await page.locator('.tt-cell[data-cell="4"]').getAttribute('aria-label'), 'centre star, your cyan round lantern');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `lanterns-match-${width}x${height}.png`) });
    await page.keyboard.press('Escape');
    await page.locator('.tt-dialog-wrap:not([hidden]) .tt-dialog').waitFor();
    assert.equal(await page.evaluate(() => tableUI.screen), 'menu');
    await page.getByRole('button', { name: 'Home' }).click();
    await page.locator('#ovAttract.in').waitFor();
    assert.equal(await page.evaluate(() => tableUI.active), false);
  });
}

test('lantern lines by keyboard: arrows, number keys and a full round of pass and play', async t => {
  const page = await open(t, { width: 1280, height: 800 });
  await page.locator('#ttPass').click();
  await page.locator('.tt-root[data-screen=match]').waitFor();
  // Pilot 1 lights the top row by number keys while Pilot 2 answers in the middle; arrows move focus.
  for (const key of ['1', '4', '2', '5']) await page.keyboard.press(key);
  assert.equal((await debug(page)).status, 'Pilot 1 · your turn');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  const d = await debug(page);
  assert.equal(d.phase, 'round');
  assert.equal(d.status, 'Pilot 1 lights a line!');
  await page.waitForFunction(() => tableUI.debug().match.round === 2, null, { timeout: 5000 });
  assert.equal((await debug(page)).status, 'Pilot 2 · your turn', 'the loser lights first');
});

test('lantern lines: the oldest lantern goes dark when a fourth is lit, and the hint says which', async t => {
  const page = await open(t, { width: 390, height: 844 });
  await page.locator('#ttPass').tap();
  await page.locator('.tt-root[data-screen=match]').waitFor();
  for (const cell of [0, 4, 8, 1, 7]) await page.locator(`.tt-cell[data-cell="${cell}"]`).tap();
  // Pilot 1 now has 0, 8 and 7 lit, so lighting a fourth lets 0 (the oldest) go dark.
  await page.locator('.tt-cell[data-cell="3"]').tap();
  assert.match(await page.locator('.tt-hint').textContent(), /top left lantern goes dark/);
  assert.match(await page.locator('.tt-cell[data-cell="0"]').getAttribute('aria-label'), /goes dark next/);
  await page.locator('.tt-cell[data-cell="2"]').tap();
  const d = await debug(page);
  assert.equal(d.cells[0], 0, 'the oldest lantern went dark');
  assert.deepEqual(d.cells, [0, 2, 1, 2, 2, 0, 0, 1, 1]);
});

test('lantern lines with iPhone tap haptics: the switch overlays never cover the menu', async t => {
  // iOS has no navigator.vibrate, so the page lays a haptic switch label over every button; those must stay under dialogs.
  const page = await open(t, { width: 390, height: 844 }, () => { delete Navigator.prototype.vibrate; });
  assert.equal(await page.evaluate(() => iosTapHaptics), true);
  await page.locator('#ttPlayCpu').tap();
  await page.locator('.tt-cell[data-cell="4"]').tap();
  await page.waitForFunction(() => tableUI.debug().match.state.ply === 2, null, { timeout: 4000 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Resume' }).tap({ timeout: 3000 });
  assert.equal(await page.evaluate(() => tableUI.screen), 'match');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Home' }).tap({ timeout: 3000 });
  await page.locator('#ovAttract.in').waitFor();
});
