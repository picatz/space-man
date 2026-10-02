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

test('production worker, two exact preview builds, and saves remain isolated in Chromium', { timeout: 90000 }, async (t) => {
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
