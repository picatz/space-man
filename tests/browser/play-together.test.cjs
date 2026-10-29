// Play Together hub: a host picks a mode and is hosting with the QR in view; a
// friend scans that QR with the in-game camera and lands in the same room. Real
// index.html wiring and crypto; only the relay hop, the camera and the browser's
// QR detector are simulated.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { simulatedRelay } = require('./arena-network-helper.cjs');
const ROOT = path.resolve(__dirname, '../..');
const STEP_MS = 45000;

test('play together: host Arena from the hub, a friend scans the QR and joins', { timeout: 180000 }, async t => {
  const playwright = require('playwright');
  const engineName = process.env.SPACE_MAN_ARENA_BROWSER || 'chromium';
  assert.ok(['chromium', 'webkit'].includes(engineName), 'SPACE_MAN_ARENA_BROWSER must be chromium or webkit');
  const hub = require('../harness.cjs').relay();
  const clients = []; let browser, server;
  t.after(async () => {
    for (const c of clients) for (const s of c.bridgeSockets?.values() || []) s.close();
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  });
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!/^(?:index\.html|manifest\.json|favicon\.png|src\/[a-z-]+\.(?:js|css)|icons\/[a-z0-9-]+\.png)$/.test(file)) { res.writeHead(404).end(); return; }
    try {
      const bytes = await fs.readFile(path.join(ROOT, file));
      const type = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[path.extname(file)];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const baseURL = `http://127.0.0.1:${server.address().port}/`;
  browser = await playwright[engineName].launch({ headless: process.env.SPACE_MAN_HEADED !== '1',
    ...(engineName === 'chromium' && process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {}) });

  async function client(name, init) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const c = { name, context, sockets: 0, sent: 0, received: 0, encryptedSent: 0, encryptedReceived: 0, unexpectedSockets: 0,
      deliveryErrors: 0, sentTypes: {}, receivedTypes: {}, errors: [], offline: false };
    await simulatedRelay(context, c, hub);
    if (init) await context.addInitScript(init);
    await context.addInitScript(() => {
      if (!localStorage.getItem('sm2.settings')) localStorage.setItem('sm2.settings', JSON.stringify({ netRelay: 'https://relay.test',
        autorun: false, music: false, sfx: false, haptics: false, reduceMotion: true }));
    });
    c.page = await context.newPage(); c.page.setDefaultTimeout(STEP_MS); clients.push(c);
    c.page.on('pageerror', e => c.errors.push(String(e)));
    c.page.on('console', m => { if (m.type() === 'error') c.errors.push(m.text()); });
    c.page.on('dialog', d => d.accept().catch(() => {}));
    await c.page.goto(baseURL); await c.page.locator('#btnArena').waitFor();
    return c;
  }
  const wait = (c, fn, arg, timeout = STEP_MS) => c.page.waitForFunction(fn, arg, { timeout, polling: 50 });
  const state = c => c.page.evaluate(() => ({ active: SpaceManNet.active, info: SpaceManNet.info(), roster: SpaceManNet.roster().length }));
  const dump = async () => JSON.stringify(await Promise.all(clients.map(async c => ({ name: c.name, errors: c.errors, state: await state(c).catch(() => null) }))), null, 1);

  // A fake rear camera (an animated canvas) and a QR detector that "sees" whatever
  // the test puts in window.__qr, so the real scanner loop and join path run.
  const camera = () => {
    window.__qr = '';
    window.BarcodeDetector = class { constructor(o) { this.formats = o && o.formats; } async detect() { return window.__qr ? [{ rawValue: window.__qr, format: 'qr_code' }] : []; } };
    const fake = async () => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); let n = 0;
      setInterval(() => { g.fillStyle = n++ % 2 ? '#123' : '#456'; g.fillRect(0, 0, 64, 64); }, 50); return c.captureStream(15); };
    // WebKit's navigator.mediaDevices may not be redefinable; patch the method on it instead.
    try { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: fake } }); } catch (_) {}
    if (navigator.mediaDevices.getUserMedia !== fake) try { navigator.mediaDevices.getUserMedia = fake; } catch (_) {}
  };
  const host = await client('host'), guest = await client('guest', camera), plain = await client('no-detector');
  try {
    await host.page.locator('#btnTogether').click();
    await host.page.locator('#ovTogether.show').waitFor();
    await host.page.locator('#btnHostArena').click();
    await wait(host, () => SpaceManNet.active && SpaceManNet.info().mode === 'arena' && SpaceManNet.info().isHost);
    await host.page.locator('.arena-root[data-screen="lobby"]').waitFor();
    await host.page.locator('.sm-invite').waitFor({ state: 'visible' });
    await wait(host, () => { const r = document.querySelector('.sm-invite').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
    const link = await host.page.evaluate(() => SpaceManNet.info().link);

    await guest.page.locator('#btnTogether').click();
    await guest.page.locator('#ovTogether.show').waitFor();
    await guest.page.locator('#btnJoinScan').click();
    await guest.page.locator('.sm-scan video').waitFor({ state: 'attached' });
    await guest.page.evaluate(() => { window.__qr = 'https://example.com/menu'; });
    await guest.page.locator('.sm-scan-msg', { hasText: 'isn’t a Space Man invite' }).waitFor();
    assert.equal(await guest.page.locator('.sm-scan').count(), 1, 'a stray QR keeps the scanner open');
    await guest.page.evaluate(l => { window.__qr = l; }, link);
    await guest.page.locator('#ovJoin.show').waitFor();
    assert.equal(await guest.page.locator('.sm-scan').count(), 0, 'the scanner closes on an invite');
    assert.equal(await guest.page.evaluate(() => { const v = document.querySelector('.sm-scan video'); return v ? !!v.srcObject : false; }), false, 'camera is released');
    assert.match(await guest.page.locator('#joinTitle').innerText(), /Arena/, 'the scanned invite names the host’s mode');
    await guest.page.locator('#btnJoinPlay').click();
    if (await guest.page.locator('#ovCallsign.show').isVisible().catch(() => false)) await guest.page.locator('#btnCallsignDone').click();
    await wait(guest, () => SpaceManNet.active && SpaceManNet.info().mode === 'arena' && SpaceManNet.roster().some(r => r.you));
    await wait(host, () => SpaceManNet.roster().length === 2);

    // A browser that can't read QR codes says how to use the phone's Camera app instead.
    await plain.page.evaluate(() => { delete window.BarcodeDetector; });
    await plain.page.locator('#btnTogether').click();
    await plain.page.locator('#ovTogether.show').waitFor();
    await plain.page.locator('#btnJoinScan').click();
    await plain.page.locator('.sm-scan-title', { hasText: 'Camera app' }).waitFor();
    await plain.page.keyboard.press('Escape');
    assert.equal(await plain.page.locator('.sm-scan').count(), 0, 'Escape closes the scanner');
    await plain.page.locator('#ovTogether.show').waitFor();
  } catch (e) {
    e.message += '\n' + await dump();
    throw e;
  }
});
