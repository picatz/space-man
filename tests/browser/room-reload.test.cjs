// Arena page reloads keep the room: a guest reload resumes its seat, a host
// reload reopens the same room and carries the guest back in. Real index.html
// wiring and crypto; only the opaque relay hop is simulated.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { simulatedRelay } = require('./arena-network-helper.cjs');
const ROOT = path.resolve(__dirname, '../..');
const STEP_MS = 45000;

test('arena reload: guest resumes its seat and a reloaded host reopens the same room', { timeout: 180000 }, async t => {
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

  async function client(name) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const c = { name, context, sockets: 0, sent: 0, received: 0, encryptedSent: 0, encryptedReceived: 0, unexpectedSockets: 0,
      deliveryErrors: 0, sentTypes: {}, receivedTypes: {}, errors: [], offline: false };
    await simulatedRelay(context, c, hub);
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

  const host = await client('host'), guest = await client('guest');
  try {
    await host.page.locator('#btnArena').click();
    await host.page.locator('.arena-root[data-screen="lobby"]').waitFor();
    await host.page.locator('.arena-online-panel > summary').click();
    await host.page.locator('#arenaHost').click();
    await wait(host, () => SpaceManNet.active && SpaceManNet.info().mode === 'arena' && SpaceManNet.info().isHost);
    const link = await host.page.evaluate(() => SpaceManNet.info().link);
    assert.ok(link && link.includes('#j='), 'host has an invite link');

    await guest.page.locator('#btnArena').click();
    await guest.page.locator('.arena-root[data-screen="lobby"]').waitFor();
    await guest.page.locator('.arena-online-panel > summary').click();
    await guest.page.locator('#arenaRoomInput').fill(link);
    await guest.page.locator('#arenaJoin').click();
    await wait(guest, () => SpaceManNet.active && SpaceManNet.info().mode === 'arena' && SpaceManNet.roster().some(r => r.you));
    await wait(host, () => SpaceManNet.roster().length === 2);
    const g0 = await state(guest);
    assert.ok(Number.isInteger(g0.info.myP) && g0.info.myP > 0, 'guest has a non-host seat');

    // Guest reload: automatically back in the same seat, no clicks.
    await guest.page.reload();
    await wait(guest, () => SpaceManNet.active && SpaceManNet.info().mode === 'arena' && SpaceManNet.roster().some(r => r.you));
    const g1 = await state(guest);
    assert.equal(g1.info.myP, g0.info.myP, 'guest keeps the same seat after reload');
    assert.equal(g1.info.role, g0.info.role, 'guest keeps its role after reload');
    await wait(host, () => SpaceManNet.roster().length === 2);

    // Host reload: the room reopens with the same link and the guest is carried back in.
    const h0 = await state(host);
    await host.page.reload();
    await wait(host, () => SpaceManNet.active && SpaceManNet.info().mode === 'arena' && SpaceManNet.info().isHost);
    const link1 = await host.page.evaluate(() => SpaceManNet.info().link);
    assert.equal(link1, link, 'host reopens the same invite link');
    await wait(host, () => SpaceManNet.roster().length === 2, undefined, 40000);
    await wait(guest, () => SpaceManNet.active && SpaceManNet.info().hostAway === false && SpaceManNet.roster().length === 2, undefined, 40000);
    const g2 = await state(guest);
    assert.equal(g2.info.myP, g0.info.myP, 'guest seat survives the host reload');
    assert.equal(h0.info.isHost, true);
  } catch (e) {
    e.message += '\n' + await dump();
    throw e;
  }
});
