// Browser-only hosting/storage checks. Uses loopback assets and no public relay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { copyProduction, buildPreview } = require('../../scripts/build-preview.cjs');
const ROOT = path.resolve(__dirname, '../..');

async function launch(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'space-man-browser-previews-'));
  const site = path.join(dir, 'site');
  await copyProduction(ROOT, site);
  const buildSha = 'b'.repeat(40), shaA = 'a'.repeat(40), shaB = 'c'.repeat(40);
  const a = await buildPreview({ source: ROOT, output: path.join(site, 'pr/27', shaA, buildSha), pr: 27, sha: shaA, buildSha });
  const b = await buildPreview({ source: ROOT, output: path.join(site, 'pr/27', shaB, buildSha), pr: 27, sha: shaB, buildSha });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const rel = decodeURIComponent(url.pathname).replace(/^\//, '') + (url.pathname.endsWith('/') ? 'index.html' : '');
      const file = path.resolve(site, rel);
      if (!file.startsWith(site + path.sep)) return res.writeHead(400).end();
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[path.extname(file)] || 'text/plain';
      const bytes = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(bytes);
    } catch (_) { res.writeHead(404).end(); }
  });
  let browser;
  t.after(async () => {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {});
  return { browser, base, a, b };
}

test('production worker, two exact preview builds, and saves remain isolated in Chromium', { timeout: 90000 }, async (t) => {
  const { browser, base, a, b } = await launch(t);
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], sockets = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('websocket', (ws) => sockets.push(ws.url()));
  await page.goto(base + '/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(async () => {
    localStorage.setItem('sm2.best', '999');
    sessionStorage.setItem('sm2.resume', 'production-only');
    await caches.open('unrelated-application');
  });
  async function load(info) {
    await page.goto(base + info.basePath);
    await page.locator('#previewBuild').waitFor();
    assert.match(await page.locator('#previewBuild').innerText(), /PREVIEW · PR #27/);
    assert.deepEqual(await page.evaluate(() => window.SpaceManBuild.preview), info);
    assert.equal(await page.evaluate(() => appBaseUrl()), base + info.basePath);
    assert.equal(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.length)), 1, 'preview registered no worker');
    assert.equal(await page.locator('link[rel="manifest"]').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('sm2.best')), '999');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('sm2.resume')), 'production-only');
  }
  await load(a);
  await page.evaluate(() => { saveJSON(LS.best, 42); sessionStorage.setItem(RESUME_KEY, 'preview-a'); });
  await load(b);
  assert.equal(await page.evaluate(() => loadJSON(LS.best, 0)), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem(RESUME_KEY)), null);
  await load(a);
  assert.equal(await page.evaluate(() => loadJSON(LS.best, 0)), 42);
  assert.equal(await page.evaluate(() => sessionStorage.getItem(RESUME_KEY)), 'preview-a');
  assert.deepEqual(errors, []);
  assert.deepEqual(sockets, [], 'hosting checks make no relay connections');
  assert.ok(await page.evaluate(() => caches.has('unrelated-application')));
});

// Real browser layout, with injected visualViewport metrics for the iOS toolbar
// behavior Chromium cannot reproduce. Safe areas use Chromium's env() emulation.
test('preview status stays outside runner and arena touch controls through phone rotation and browser chrome', { timeout: 90000 }, async (t) => {
  const { browser, base, a } = await launch(t);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await context.addInitScript(() => {
    const native = window.visualViewport, viewport = new EventTarget();
    for (const name of ['width', 'height', 'offsetTop', 'offsetLeft', 'scale']) {
      Object.defineProperty(viewport, name, { get: () => window.__previewViewport?.[name] ?? native[name] });
    }
    Object.defineProperty(window, 'visualViewport', { value: viewport });
  });
  const page = await context.newPage(), errors = [], sockets = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('websocket', ws => sockets.push(ws.url()));
  const cdp = await context.newCDPSession(page);
  const cases = [
    { name: 'portrait', width: 390, height: 844, safe: { top: 47, bottom: 34, left: 0, right: 0 } },
    { name: 'portrait-chrome', width: 390, height: 844, safe: { top: 47, bottom: 34, left: 0, right: 0 }, visible: { offsetTop: 52, height: 680 } },
    { name: 'landscape', width: 844, height: 390, safe: { top: 0, bottom: 21, left: 47, right: 47 } },
    { name: 'short-landscape-chrome', width: 844, height: 390, safe: { top: 0, bottom: 21, left: 47, right: 47 }, visible: { offsetTop: 24, height: 260 } },
    { name: 'small-portrait', width: 320, height: 568, safe: { top: 0, bottom: 0, left: 0, right: 0 } },
  ];
  async function settleLayout() {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
  async function bounds(label, controls) {
    const badge = await page.locator('#previewBuild').boundingBox();
    const metrics = await page.evaluate(() => ({
      top: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--game-safe-top')),
      right: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--game-safe-right')),
      bottom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--game-safe-bottom')),
      left: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--game-safe-left')),
      uiTop: safeInset('top'), width: vpW(), height: vpH(),
      pointerEvents: getComputedStyle(document.getElementById('previewBuild')).pointerEvents,
    }));
    assert.ok(badge && badge.height <= 22 && badge.width <= 230, label + ': compact single-line badge');
    assert.ok(badge.x >= metrics.left && badge.y >= metrics.top, label + ': clears notch and top browser chrome');
    assert.ok(badge.x + badge.width <= metrics.width - metrics.right && badge.y + badge.height <= metrics.height - metrics.bottom, label + ': inside visible safe bounds');
    assert.ok(metrics.uiTop >= badge.y + badge.height + 4, label + ': shared HUD inset reserves status rail');
    assert.equal(metrics.pointerEvents, 'none', label + ': status never captures controls');
    for (const [name, r] of Object.entries(controls)) {
      assert.ok(r, label + ': ' + name + ' exists');
      assert.equal(overlaps(badge, r), false, label + ': badge must not overlap ' + name);
    }
  }
  for (const scenario of cases) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: scenario.safe });
    await page.goto(base + a.basePath + '#shot=play&touch=1');
    await page.locator('#previewBuild').waitFor();
    await page.evaluate(({ width, height, visible }) => {
      window.__previewViewport = { width, height, offsetTop: 0, offsetLeft: 0, scale: 1, ...visible };
      window.visualViewport.dispatchEvent(new Event('resize'));
      resize();
    }, scenario);
    await settleLayout();
    for (const lefty of [false, true]) {
      const controls = await page.evaluate(lefty => {
        settings.lefty = lefty; layoutTouch();
        const textBounds = {}, originalHUD = drawHUD, originalText = ctx.fillText;
        let inHUD = false, serial = 0;
        drawHUD = function () { inHUD = true; try { return originalHUD(); } finally { inHUD = false; } };
        ctx.fillText = function (text, x, y, ...rest) {
          if (inHUD) {
            const m = this.measureText(text), matrix = this.getTransform();
            const a = new DOMPoint(x - m.actualBoundingBoxLeft, y - m.actualBoundingBoxAscent).matrixTransform(matrix);
            const b = new DOMPoint(x + m.actualBoundingBoxRight, y + m.actualBoundingBoxDescent).matrixTransform(matrix);
            textBounds['HUD text ' + serial++] = { x: Math.min(a.x, b.x) / view.dpr, y: Math.min(a.y, b.y) / view.dpr, width: Math.abs(b.x - a.x) / view.dpr, height: Math.abs(b.y - a.y) / view.dpr };
          }
          return originalText.call(this, text, x, y, ...rest);
        };
        try { render(0); } finally { drawHUD = originalHUD; ctx.fillText = originalText; }
        const fire = input.shootBtn, w = vpW(), h = vpH(), bottom = safeInset('bottom');
        const disc = (cx, cy, r) => ({ x: cx - r, y: cy - r, width: r * 2, height: r * 2 });
        const hit = r => ({ x: r.x0, y: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0 });
        return { ...textBounds, pause: hit(G._pauseHit), mute: hit(G._muteHit), fire: disc(fire.cx, fire.cy, fire.r + 14), jump: disc(w * (lefty ? .26 : .74), h - bottom - 44, 29), move: disc(w * (lefty ? .78 : .22), h - bottom - (view.isTablet ? 92 : 76), 36) };
      }, lefty);
      await bounds(scenario.name + (lefty ? ' runner-lefty' : ' runner'), controls);
      for (const [name, text] of Object.entries(controls).filter(([name]) => name.startsWith('HUD text '))) {
        for (const button of ['pause', 'mute']) assert.equal(overlaps(text, controls[button]), false,
          scenario.name + ': ' + name + ' must clear the ' + button + ' hit target');
      }
    }
    if (process.env.SPACE_MAN_PREVIEW_SCREENSHOTS) {
      await fs.mkdir(process.env.SPACE_MAN_PREVIEW_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SPACE_MAN_PREVIEW_SCREENSHOTS, scenario.name + '-runner.png') });
    }
    // Return to the normal launcher and use the real arena UI.
    await page.goto(base + a.basePath + '?arena-layout');
    await page.evaluate(({ width, height, visible }) => {
      window.__previewViewport = { width, height, offsetTop: 0, offsetLeft: 0, scale: 1, ...visible };
      window.visualViewport.dispatchEvent(new Event('resize')); readSafeInsets();
    }, scenario);
    await page.locator('#btnArena').tap();
    await settleLayout();
    await bounds(scenario.name + ' arena lobby', {
      'lobby header': await page.locator('.arena-lobby-top').boundingBox(),
      'back button': await page.locator('#arenaBack').boundingBox(),
    });
    await page.locator('.arena-launch').tap();
    await page.locator('.arena-root[data-screen="match"]').waitFor();
    await settleLayout();
    for (const lefty of [false, true]) {
      await page.evaluate(lefty => { settings.lefty = lefty; }, lefty);
      await page.waitForFunction(lefty => document.getElementById('arenaRoot').dataset.lefty === String(lefty), lefty);
      await settleLayout();
      const controls = {};
      for (const name of ['jump', 'attack', 'dash']) controls[name] = await page.locator('.arena-touch-' + name).boundingBox();
      controls.move = await page.locator('.arena-stick-zone').boundingBox();
      controls.pause = await page.getByRole('button', { name: 'Pause match', exact: true }).boundingBox();
      controls.HUD = await page.locator('.arena-hud').boundingBox();
      controls.roster = await page.locator('.arena-roster').boundingBox();
      await bounds(scenario.name + (lefty ? ' arena-lefty' : ' arena'), controls);
    }
    if (process.env.SPACE_MAN_PREVIEW_SCREENSHOTS) {
      await page.screenshot({ path: path.join(process.env.SPACE_MAN_PREVIEW_SCREENSHOTS, scenario.name + '-arena.png') });
    }
    await page.getByRole('button', { name: 'Pause match', exact: true }).tap();
    await page.getByRole('button', { name: 'Resume match', exact: true }).waitFor();
    await settleLayout();
    await bounds(scenario.name + ' arena pause', {
      'pause panel': await page.locator('.arena-small-panel:visible').boundingBox(),
      resume: await page.locator('#arenaResume').boundingBox(),
    });
  }
  assert.deepEqual(errors, [], 'no uncaught errors across resize and mode changes');
  assert.deepEqual(sockets, [], 'overlay checks make no relay connections');
});
