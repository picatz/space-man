// SOC-01/02/03 through the visible Arena UI: guests mark Ready, the host sees the tally and starts,
// everyone voting for a rematch starts one after a short countdown, and the last room code is
// offered for 20 minutes. Real Chromium, real crypto, SIMULATED opaque relay (as arena-online).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { simulatedRelay } = require('./arena-network-helper.cjs');
const ROOT = path.resolve(__dirname, '../..');
const STEP = 30000;

test('arena social UI: ready tally, auto-start, rematch votes and last-room memory', { timeout: 240000 }, async t => {
  const { chromium } = require('playwright');
  const hub = require('../harness.cjs').relay(), pages = [];
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname, file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!/^(?:index\.html|manifest\.json|favicon\.png|src\/[a-z-]+\.(?:js|css)|icons\/[a-z0-9-]+\.png)$/.test(file)) { res.writeHead(404).end(); return; }
    try {
      const type = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[path.extname(file)];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(await fs.readFile(path.join(ROOT, file)));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}/`;
  // Close the server if the browser cannot launch, or the open socket keeps the test process alive.
  const browser = await chromium.launch(process.env.SPACE_MAN_CHROMIUM_PATH ? { headless: true, executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : { headless: true })
    .catch(async e => { server.closeAllConnections(); await new Promise(r => server.close(r)); throw e; });
  t.after(async () => {
    for (const c of pages) if (!c.page.isClosed()) await Promise.race([c.page.evaluate(() => { window.SpaceManNet?.leave(); sessionStorage.clear(); }).catch(() => {}), new Promise(r => setTimeout(r, 1200))]);
    await new Promise(r => setTimeout(r, 80));
    for (const c of pages) for (const s of c.bridgeSockets?.values() || []) s.close();
    await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  });
  async function client(name, { seed, viewport = { width: 1280, height: 800 }, fast = false } = {}) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const c = { name, context, page: null, errors: [], sockets: 0, sent: 0, received: 0, encryptedSent: 0, encryptedReceived: 0, unexpectedSockets: 0, deliveryErrors: 0, sentTypes: {}, receivedTypes: {}, offline: false };
    await simulatedRelay(context, c, hub);
    await context.addInitScript(relay => {
      if (!localStorage.getItem('sm2.settings')) localStorage.setItem('sm2.settings', JSON.stringify({ netRelay: 'https://' + relay, autorun: false, music: false, sfx: false, haptics: false, reduceMotion: true }));
    }, 'relay.test');
    if (seed) await context.addInitScript(entry => { localStorage.setItem('sm2.lastroom.v1', JSON.stringify({ ...entry, ts: Date.now() - entry.ageMs })); }, seed);
    c.page = await context.newPage(); c.page.setDefaultTimeout(STEP); pages.push(c);
    c.page.on('pageerror', e => c.errors.push(String(e)));
    await c.page.goto(base); await c.page.locator('#btnArena').waitFor();
    if (fast) await c.page.evaluate(() => {   // shrink the match clock through the authority so results arrive quickly
      const o = SpaceManArenaOnline, make = o.createHost;
      window.SpaceManArenaOnline = Object.assign({}, o, { createHost(cfg) { const h = make(cfg), s = h.start; h.start = (...a) => { const ok = s.apply(h, a); if (ok) h.state.timeLeftTicks = 20; return ok; }; return h; } });
    });
    return c;
  }
  const wait = (c, fn, arg) => c.page.waitForFunction(fn, arg, { timeout: STEP, polling: 25 });
  const screen = (c, v) => c.page.locator(`.arena-root[data-screen="${v}"]`).waitFor();
  const text = (c, sel) => c.page.locator(sel).innerText();
  async function open(c) { await c.page.locator('#btnArena').click(); await screen(c, 'lobby'); await c.page.locator('.arena-online-panel > summary').click(); }

  const host = await client('host', { fast: true });
  const guest = await client('guest', { viewport: { width: 390, height: 844 } });
  await open(host); await host.page.locator('#arenaHost').click();
  await wait(host, () => document.querySelector('#arenaInvite')?.value.includes('#j='));
  const invite = await host.page.locator('#arenaInvite').inputValue();
  await open(guest); await guest.page.locator('#arenaRoomInput').fill(invite); await guest.page.locator('#arenaJoin').click();
  await wait(guest, () => SpaceManNet.active && SpaceManNet.roster().some(r => r.you));
  await wait(host, () => SpaceManNet.roster().length === 2);

  // SOC-02: Ready
  const ready = guest.page.locator('#arenaReady');
  await ready.waitFor({ state: 'visible' });
  assert.equal(await ready.evaluate(n => n.tagName), 'BUTTON', 'a real button');
  assert.equal(await ready.getAttribute('aria-pressed'), 'false');
  assert.equal(await ready.isDisabled(), false);
  await ready.focus(); assert.equal(await guest.page.evaluate(() => document.activeElement.id), 'arenaReady', 'focusable');
  await guest.page.keyboard.press('Enter');                                   // keyboard operable
  await wait(guest, () => document.querySelector('#arenaReady').getAttribute('aria-pressed') === 'true');
  await wait(host, () => /1 of 2 ready/.test(document.querySelector('#arenaReadyNote').textContent));
  assert.match(await text(host, '#arenaStart'), /\(1\/2 ready\)/);
  assert.match(await text(host, '#arenaRoomMembers'), /READY ✓/);
  assert.match(await text(guest, '#arenaReady'), /Ready ✓/);
  assert.match(await guest.page.locator('.arena-sr-only').innerText(), /ready/i, 'announced through the live region');
  // The host keeps control: with auto-start off a full tally never starts the match by itself.
  await host.page.locator('#arenaAutoStart').uncheck();
  await host.page.locator('#arenaReady').click();
  await wait(host, () => /\(2\/2 ready\)/.test(document.querySelector('#arenaStart').textContent));
  await new Promise(r => setTimeout(r, 3600));
  assert.equal(await host.page.locator('.arena-root').getAttribute('data-screen'), 'lobby', 'no auto-start while switched off');
  // Withdraw, then switch auto-start back on: everyone ready arms the countdown and starts the match.
  await guest.page.locator('#arenaReady').click();
  await wait(host, () => /1 of 2 ready/.test(document.querySelector('#arenaReadyNote').textContent));
  await host.page.locator('#arenaAutoStart').check();
  await guest.page.locator('#arenaReady').click();
  await wait(host, () => /Starting in/.test(document.querySelector('#arenaReadyNote').textContent));
  assert.equal(await host.page.locator('#arenaAutoCancel').isVisible(), true, 'the host can cancel the countdown');
  await Promise.all([host, guest].map(c => screen(c, 'match')));

  // SOC-01: Rematch
  await Promise.all([host, guest].map(c => screen(c, 'results')));
  const again = guest.page.locator('#arenaRematch');
  assert.equal(await again.isDisabled(), false, 'guests get a Rematch button');
  assert.equal((await again.innerText()).trim(), 'Rematch?');
  assert.match(await text(host, '#arenaRematch'), /Rematch together \(1\/2 want one\)/);
  await again.click();
  await wait(guest, () => document.querySelector('#arenaRematch').getAttribute('aria-pressed') === 'true');
  assert.match(await text(guest, '#arenaRematch'), /Waiting for host/);
  await wait(host, () => /Everyone wants a rematch/.test(document.querySelector('#arenaAgainNote').textContent));
  assert.equal(await host.page.locator('#arenaAgainCancel').isVisible(), true);
  await Promise.all([host, guest].map(c => wait(c, () => document.querySelector('.arena-root').dataset.screen === 'match')));   // started with no host tap

  // SOC-03: last room
  const fresh = await client('returning', { seed: { region: 'ord', code: 'COMET-ORBIT-42', mode: 'arena', ageMs: 5 * 60_000 } });
  await open(fresh);
  assert.equal(await fresh.page.locator('#arenaRejoin').isVisible(), true);
  assert.equal((await fresh.page.locator('#arenaRejoin').innerText()).trim(), 'Rejoin ORD-COMET-ORBIT-42');
  const stale = await client('stale', { seed: { region: 'ord', code: 'COMET-ORBIT-42', mode: 'arena', ageMs: 25 * 60_000 } });
  await open(stale);
  assert.equal(await stale.page.locator('#arenaRejoin').isVisible(), false, 'expired after 20 minutes');
  const runner = await client('runner', { seed: { region: 'nyc', code: 'COMET-ORBIT-42', mode: 'runner', ageMs: 60_000 } });
  await runner.page.evaluate(() => document.getElementById('btnTogether').click());
  await runner.page.locator('#btnRejoinLast').waitFor({ state: 'visible' });
  assert.equal((await runner.page.locator('#btnRejoinLast').innerText()).trim(), 'Rejoin NYC-COMET-ORBIT-42');
  await runner.page.locator('#btnRejoinLast').click();
  assert.equal(await runner.page.locator('#joinInput').inputValue(), 'NYC-COMET-ORBIT-42', 'rejoin fills the code and submits through the normal join path');
  for (const c of pages) assert.deepEqual(c.errors, [], c.name + ' had uncaught errors');
});
