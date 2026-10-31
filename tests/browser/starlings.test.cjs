'use strict';
// Starlings in a real browser: open it from home, befriend one by keys, a shy
// Starling, touch and the pause menu, and fit at phone, tablet and laptop sizes.
// Rules have unit tests (starling.test.cjs); this guards the scene. CI runs it
// in the home suite, so SPACE_MAN_HOME_BROWSER picks the engine.
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
async function open(t, viewport, init) {
  const { page, base } = await launch(t, viewport);
  if (init) await page.context().addInitScript(init);
  await page.goto(base);
  await page.locator('#ovAttract.in').waitFor();
  await page.waitForFunction(() => G.mode === 'attract' && !document.getElementById('ovAttract').inert);
  await page.evaluate(() => { settings.muted = true; });
  const card = page.locator('#btnStarlings');
  if (viewport.width < 1000) await card.tap(); else await card.click();
  await page.locator('.sl-root:not([hidden])').waitFor();
  return page;
}
const debug = page => page.evaluate(() => starlingUI.debug());
const waitPhase = (page, phase) => page.waitForFunction(p => starlingUI.debug().phase === p, phase, { timeout: 9000 });
// Echo the current verse with key presses timed in the page, so the rhythm is as steady as a player's.
async function echo(page, { wrong = false } = {}) {
  await waitPhase(page, 'listen');
  await page.evaluate(wrong => new Promise(done => {
    const v = starlingUI.debug().verse, codes = { left: 'ArrowLeft', up: 'ArrowUp', right: 'ArrowRight', down: 'ArrowDown' };
    const other = { left: 'right', right: 'left', up: 'down', down: 'up' };
    v.forEach((b, i) => setTimeout(() => {
      const code = codes[wrong ? other[b.point] : b.point];
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
      if (i === v.length - 1) done();
    }, b.at - v[0].at));
  }), wrong);
}
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.sl-root button')].filter(b => b.offsetParent).some(b => { const r = b.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1; }));

for (const [width, height] of [[390, 844], [768, 1024], [1280, 800], [844, 390]]) {
  test(`starlings ${width}x${height}: the scene fits and the four points are big, separate targets`, async t => {
    const page = await open(t, { width, height });
    await waitPhase(page, 'listen');
    assert.equal(await overflow(page), false, 'scene fits');
    const boxes = await page.locator('.sl-point').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { p: e.dataset.point, x: r.left, y: r.top, w: r.width, h: r.height }; }));
    assert.deepEqual(boxes.map(b => b.p), ['left', 'up', 'right', 'down']);
    for (const b of boxes) assert.ok(b.w >= 64, b.p + ' target ' + b.w);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      assert.ok(a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1 || a.y + a.h <= b.y + 1 || b.y + b.h <= a.y + 1, `${a.p} and ${b.p} overlap`);
    }
    const back = await page.locator('#slBack').boundingBox();
    for (const b of boxes) assert.ok(b.y >= back.y + back.height, b.p + ' clears the top bar');
    // The scene is painted (reduced motion included): the Starling's core glows at the centre of the points.
    const core = await page.evaluate(() => { const u = document.querySelector('.sl-point[data-point=up]').getBoundingClientRect(), d = document.querySelector('.sl-point[data-point=down]').getBoundingClientRect(), c = document.querySelector('.sl-canvas'), k = c.width / innerWidth; return Array.from(c.getContext('2d').getImageData(Math.round((u.left + u.width / 2) * k), Math.round((u.top + u.height / 2 + d.top + d.height / 2) / 2 * k), 1, 1).data); });
    assert.ok(core[1] > 180, 'Starling painted: ' + core);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `starlings-${width}x${height}.png`) });
  });
}

test('starlings: three clean echoes befriend one, it joins the diary and the logbook', async t => {
  const page = await open(t, { width: 1280, height: 800 });
  assert.match(await page.locator('.sl-root [role=status]').textContent(), /left, up, right and down/, 'the first visit explains itself to screen readers');
  for (let v = 0; v < 3; v++) { await echo(page); await page.waitForFunction(n => starlingUI.debug().state.trust === n, v + 1, { timeout: 4000 }); }
  await page.waitForFunction(() => starlingUI.screen === 'friend', null, { timeout: 6000 });
  const d = await debug(page);
  assert.equal(d.state.phase, 'befriended'); assert.equal(d.friends, 1);
  assert.equal(await page.locator('#slDialogTitle').textContent(), d.starling.name + ' rides with you');
  assert.deepEqual(await page.locator('.sl-diary li').allTextContents(), [d.starling.name]);
  assert.ok(await page.evaluate(() => G.discoveries.includes('starling')), 'logbook: first Starling');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'starlings-friend-1280x800.png') });
  await page.keyboard.press('Enter');
  await waitPhase(page, 'listen');
  assert.equal(await page.locator('.sl-friends').textContent(), '✦ 1');
  assert.notEqual((await debug(page)).starling.seed, d.starling.seed, 'a new Starling calls');
});

test('starlings: a sloppy echo makes it sing again slower; three misses and it is shy', async t => {
  const page = await open(t, { width: 390, height: 844 });
  const first = await debug(page);
  await echo(page, { wrong: true });
  await page.waitForFunction(() => starlingUI.debug().state.take === 1, null, { timeout: 4000 });
  const again = await debug(page);
  assert.equal(again.state.trust, 0); assert.equal(again.state.misses, 2);
  await waitPhase(page, 'listen');
  const verse = (await debug(page)).verse;
  assert.deepEqual(verse.map(b => b.point), (await page.evaluate(() => SpaceManStarling.verse(SpaceManStarling.start(starlingUI.debug().state.seed)))).map(b => b.point), 'the same song');
  assert.ok(verse[1].at > 500, 'sung slower');
  await echo(page, { wrong: true });
  await page.waitForFunction(() => starlingUI.screen === 'shy', null, { timeout: 6000 });
  assert.equal(await page.locator('#slDialogTitle').textContent(), first.starling.name + ' is shy today');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'starlings-shy-390x844.png') });
  await page.locator('#slHome').tap();
  await page.locator('#ovAttract.in').waitFor();
  assert.equal(await page.evaluate(() => document.getElementById('ovAttract').inert), false, 'home is live again');
});

test('starlings by touch and menu: a tap echoes, Escape pauses and the call starts over', async t => {
  const page = await open(t, { width: 390, height: 844 }, () => { delete Navigator.prototype.vibrate; });
  await waitPhase(page, 'listen');
  const p = (await debug(page)).verse[0].point;
  await page.locator(`.sl-point[data-point=${p}]`).tap();
  await page.waitForFunction(() => starlingUI.debug().grades.length >= 1);
  assert.equal((await debug(page)).grades[0], 'perfect', 'the first tap is the downbeat');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => starlingUI.screen), 'menu');
  await page.getByRole('button', { name: 'Keep listening' }).tap({ timeout: 3000 });
  await page.waitForFunction(() => starlingUI.screen === 'call' || starlingUI.screen === 'listen');
  assert.deepEqual((await debug(page)).grades, [], 'a paused verse is sung again, not judged');
  await page.keyboard.press('Escape');
  await page.locator('.sl-dialog').getByRole('button', { name: 'Home', exact: true }).tap({ timeout: 3000 });
  await page.locator('#ovAttract.in').waitFor();
});
