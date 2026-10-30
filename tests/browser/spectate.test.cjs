// The shared spectator dock in Run Together, at phone, landscape-phone and desktop sizes: it replaces the play
// controls, every button is touch-sized and on screen, and arrows, Q/E, V and a swipe all switch or toggle.
// Uses the deterministic Run Together watch fixture (#shot=room&scene=watch), so no relay is needed.
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs/promises'), path = require('node:path');
const { chromium, webkit } = require('playwright'), ROOT = path.resolve(__dirname, '../..');
const engine = process.env.SPACE_MAN_IDENTITY_BROWSER === 'webkit' ? webkit : chromium, shots = process.env.SPACE_MAN_IDENTITY_SCREENSHOTS;

for (const [width, height] of [[390, 844], [844, 390], [1280, 800]]) test(`spectator dock at ${width}x${height}`, { timeout: 30000 }, async (t) => {
  let browser;
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost'), p = path.resolve(ROOT, '.' + decodeURIComponent(u.pathname) + (u.pathname.endsWith('/') ? 'index.html' : ''));
      if (!p.startsWith(ROOT + path.sep)) return res.writeHead(400).end();
      res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(p)] || 'application/octet-stream' }).end(await fs.readFile(p));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await browser?.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  browser = await engine.launch(engine === chromium && process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  const phone = width < 900, page = await browser.newPage({ viewport: { width, height }, isMobile: phone && engine === chromium, hasTouch: phone, serviceWorkers: 'block' }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto((process.env.SPACE_MAN_BASE_URL || `http://127.0.0.1:${server.address().port}/`) + '#shot=room&scene=watch');
  const dock = page.locator('.sm-watch[data-mode=run]');
  await dock.waitFor({ state: 'visible' });
  const name = () => page.locator('#runWatchName').innerText();

  for (const id of ['runWatchPrevious', 'runWatchNext', 'runWatchOverview', 'runWatchJoin', 'runWatchLeave']) {
    const b = await page.locator('#' + id).boundingBox();
    assert.ok(b && b.width >= 44 && b.height >= 44, id + ' is touch-sized');
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height, id + ' is fully on screen');
  }
  assert.match(await page.locator('.sm-watch-eyebrow').innerText(), /WATCHING/);
  assert.ok((await name()).length > 0, 'the dock names who is on screen');
  assert.equal(await page.evaluate(() => netSpectating() && !emoteAvailable()), true, 'a watcher has no play controls');
  if (shots) { await fs.mkdir(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `spectate-run-${width}x${height}.png`) }); }

  // The fixture is a still frame: freeze the field so only our input changes who is watched.
  await page.evaluate(() => { spec.tour = false; });
  const first = await name();
  await page.locator('#runWatchNext').click();
  const second = await name();
  assert.notEqual(second, first, 'next switches runner');
  await page.locator('#runWatchPrevious').click();
  assert.equal(await name(), first, 'previous comes back');
  await page.keyboard.press('KeyE');
  assert.equal(await name(), second, 'E is next');
  await page.keyboard.press('KeyQ');
  assert.equal(await name(), first, 'Q is previous');

  await page.keyboard.press('KeyV');
  assert.equal(await page.locator('#runWatchOverview').getAttribute('aria-pressed'), 'true', 'V turns the auto camera on');
  await page.locator('#runWatchOverview').click();
  assert.equal(await page.evaluate(() => spec.tour), false, 'the button turns it off again');

  if (phone) {
    const box = await page.locator('#game').boundingBox(), y = box.y + box.height * 0.45;
    const before = await name();
    await page.evaluate(({ x0, x1, y }) => {
      const c = document.getElementById('game'), at = (type, x, ts) => c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, isPrimary: true, bubbles: true, pointerType: 'touch' }));
      at('pointerdown', x0); at('pointerup', x1);
    }, { x0: box.x + box.width * 0.8, x1: box.x + box.width * 0.2, y });
    assert.notEqual(await name(), before, 'a swipe left watches the next runner');
  }
});
