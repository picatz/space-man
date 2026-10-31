'use strict';
// Today in the Reach in a real browser: the home strip, the Daily Chart solved
// by taps against Flare's real defence, a failed try that costs a try, Arena and
// Circuit dailies launching straight into play, and Share. SPACE_MAN_HOME_BROWSER
// picks the engine (CI runs it in the home suite).
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
async function home(t, viewport, init) {
  const { page, base } = await launch(t, viewport);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  if (init) await page.context().addInitScript(init);
  await page.goto(base);
  await page.locator('#ovAttract.in').waitFor();
  await page.waitForFunction(() => G.mode === 'attract' && !document.getElementById('ovAttract').inert);
  await page.evaluate(() => { settings.muted = true; return document.fonts.ready; });
  return page;
}
const press = (page, sel, touch) => (touch ? page.locator(sel).tap() : page.locator(sel).click());
const tiles = page => page.evaluate(() => [...document.querySelectorAll('.today-tile')].map(b => ({ id: b.id, state: b.dataset.state, text: b.innerText.replace(/\s+/g, ' ').trim(), r: b.getBoundingClientRect().toJSON() })));
// Your next answer on the chart (the solver in src/daily.js), once Flare has replied.
async function playAnswer(page, touch) {
  await page.waitForFunction(() => { const d = tableUI.debug(); return d.match && d.match.state.turn === 1; });
  const cell = await page.evaluate(() => { const d = tableUI.debug(), left = d.daily.par - Math.ceil((d.match.state.ply - d.daily.state.ply) / 2); return SpaceManDaily.winningMoves(SpaceManTabletop.LANTERNS, d.match.state, left)[0]; });
  await press(page, `.tt-cell[data-cell="${cell}"]`, touch);
}

for (const [width, height] of [[390, 844], [820, 1180], [1440, 900]]) {
  const touch = width < 1000;
  test(`today ${width}x${height}: four dailies fit, the chart solves, and the strip and share follow`, async t => {
    const page = await home(t, { width, height });
    const before = await tiles(page);
    assert.deepEqual(before.map(x => x.id), ['btnDaily', 'btnDailyArena', 'btnDailyRace', 'btnDailyChart']);
    for (const x of before) {
      assert.equal(x.state, 'new', x.id);
      assert.ok(x.r.width >= 70 && x.r.height >= 48, x.id + ' is a comfortable target');
      assert.ok(x.r.left >= 0 && x.r.right <= width, x.id + ' fits the screen');
    }
    assert.ok(before.every((x, i) => i === 0 || Math.abs(x.r.top - before[0].r.top) < 1), 'one row of four');
    assert.equal(await page.locator('#btnTodayShare').isVisible(), false);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `today-home-${width}x${height}.png`) });

    await press(page, '#btnDailyChart', touch);
    await page.locator('.tt-root[data-screen=match]').waitFor();
    assert.match(await page.locator('.tt-round').innerText(), /daily chart · try 1 of 3/i);
    const par = await page.evaluate(() => tableUI.debug().daily.par);
    for (let i = 0; i < par; i++) await playAnswer(page, touch);
    await page.waitForFunction(() => tableUI.screen === 'daily');
    assert.match(await page.locator('.tt-dialog h2').innerText(), /Chart solved!/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `today-chart-solved-${width}x${height}.png`) });
    assert.deepEqual(await page.evaluate(() => todayRec().chart), { solved: 1, tries: 1 });
    await press(page, '.tt-dialog button:has-text("Home")', touch);
    await page.waitForFunction(() => !tableUI.active && G.mode === 'attract');
    const after = await tiles(page);
    assert.equal(after[3].state, 'done');
    assert.match(after[3].text, /SOLVED/);
    await press(page, '#btnTodayShare', touch);
    if (!touch) {
      await page.waitForFunction(() => navigator.clipboard.readText().then(t => t.includes('Chart ✓ 1st try')).catch(() => true));
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `today-home-played-${width}x${height}.png`) });
  });
}

test('a wrong first star costs one try; Flare holds the chart and the tile counts down', async t => {
  const page = await home(t, { width: 390, height: 844 });
  await page.locator('#btnDailyChart').tap();
  await page.locator('.tt-root[data-screen=match]').waitFor();
  const wrong = await page.evaluate(() => { const d = tableUI.debug(), g = SpaceManTabletop.LANTERNS, ok = SpaceManDaily.winningMoves(g, d.match.state, d.daily.par); return g.moves(d.match.state).find(m => !ok.includes(m)); });
  await page.locator(`.tt-cell[data-cell="${wrong}"]`).tap();
  // Keep lighting any dark star until the try ends; a perfect Flare never lets it through.
  for (let i = 0; i < 4; i++) {
    const end = await page.evaluate(() => document.querySelector('.tt-root').dataset.screen === 'daily' || tableUI.screen === 'daily');
    if (end) break;
    await page.waitForFunction(() => tableUI.screen === 'daily' || (tableUI.debug().match.state.turn === 1));
    if (await page.evaluate(() => tableUI.screen === 'daily')) break;
    const cell = await page.evaluate(() => SpaceManTabletop.LANTERNS.moves(tableUI.debug().match.state)[0]);
    await page.locator(`.tt-cell[data-cell="${cell}"]`).tap();
  }
  await page.waitForFunction(() => tableUI.screen === 'daily');
  assert.match(await page.locator('.tt-dialog h2').innerText(), /Not this time|Flare held/);
  assert.match(await page.locator('.tt-dialog').innerText(), /2 tries left today/);
  assert.deepEqual(await page.evaluate(() => todayRec().chart), { solved: 0, tries: 1 });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'today-chart-missed-390x844.png') });
  await page.locator('.tt-dialog button:has-text("Try again")').tap();
  assert.match(await page.locator('.tt-round').innerText(), /try 2 of 3/i);
  // Leaving after the first star of a try still spends it.
  const first = await page.evaluate(() => SpaceManTabletop.LANTERNS.moves(tableUI.debug().match.state)[0]);
  await page.locator(`.tt-cell[data-cell="${first}"]`).tap();
  await page.evaluate(() => tableUI.close());
  await page.waitForFunction(() => G.mode === 'attract' && !tableUI.active);
  assert.equal(await page.locator('#dailyChartInfo').innerText(), '1 OF 3 LEFT');
});

test('Arena and Circuit dailies launch straight into today’s match and race', async t => {
  const page = await home(t, { width: 1280, height: 800 });
  const spec = await page.evaluate(() => todaySpecs(COURSE.dayKey(Date.now())));
  await page.locator('#btnDailyArena').click();
  await page.waitForFunction(() => arenaUI && arenaUI.active && arenaUI.screen === 'play');
  const s = await page.evaluate(() => { const x = arenaUI.snapshot(); return { arenaId: x.arenaId, format: x.format, difficulty: x.difficulty }; });
  assert.deepEqual(s, spec.arena);
  assert.match(await page.locator('.arena-root').innerText(), /DAILY ·/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'today-arena-1280x800.png') });
  await page.evaluate(() => arenaUI.close());
  await page.waitForFunction(() => G.mode === 'attract' && !arenaUI.active);
  await page.locator('#btnDailyRace').click();
  await page.waitForFunction(() => raceUI && raceUI.active && raceUI.screen === 'play');
  const r = await page.evaluate(() => { const x = raceUI.snapshot(); return { trackId: x.trackId, difficulty: x.difficulty }; });
  assert.deepEqual(r, spec.race);
  assert.match(await page.locator('.race-target').innerText(), /DAILY CIRCUIT/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'today-race-1280x800.png') });
});
