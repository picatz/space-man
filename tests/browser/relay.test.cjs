const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const ROOT = path.resolve(__dirname, '../..');
const relayHost = process.env.SPACE_MAN_RELAY_HOST;
const STEP_MS = 30000;

// This is intentionally outside tests/*.test.cjs. Even when invoked directly,
// it makes no network requests (or requires Playwright) without an explicit host.
test('real relay: desktop host, phone-sized player, spectator, and reconnect', {
  skip: !relayHost && 'Set SPACE_MAN_RELAY_HOST=hostname[:port] to opt in',
  timeout: 180000,
}, async (t) => {
  assert.match(relayHost, /^[A-Za-z0-9.-]+(?::\d{1,5})?$/, 'Use a relay hostname[:port], without scheme or path');
  const port = relayHost.includes(':') ? Number(relayHost.split(':')[1]) : 443;
  assert.ok(port >= 1 && port <= 65535, 'Relay port must be between 1 and 65535');
  const expectedSocketURL = new URL(`wss://${relayHost}/derp`).href;
  const { chromium } = require('playwright');
  let browser;
  const clients = [];
  let stage = 'starting browser';
  // Serve only shipped assets, on an ephemeral loopback port. No dependency on
  // a deployed version, another server, or a developer's existing browser data.
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!/^(?:index\.html|manifest\.json|favicon\.png|src\/[a-z-]+\.js|icons\/[a-z0-9-]+\.png)$/.test(file)) {
      res.writeHead(404).end(); return;
    }
    try {
      const body = await fs.readFile(path.join(ROOT, file));
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[path.extname(file)];
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  t.after(async () => {
    // Finally runs on assertion/timeout failures too. Close the host first so its
    // encrypted BYE can leave while the other sockets are still alive.
    for (const { page } of clients) {
      if (!page.isClosed()) await Promise.race([page.evaluate(() => {
        const relay = window.SpaceManNet?._n1.session()?.relay;
        window.SpaceManNet?.leave();
        sessionStorage.clear();
        return new Promise((resolve) => {
          const start = performance.now();
          const check = () => !relay || relay.closed || performance.now() - start > 1000 ? resolve() : setTimeout(check, 20);
          check();
        });
      }).catch(() => {}), delay(1500)]);
    }
    try { await browser?.close(); } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const target = new URL(process.env.SPACE_MAN_BASE_URL || `http://127.0.0.1:${server.address().port}/`);
  assert.ok(/^https?:$/.test(target.protocol) && !target.username && !target.password && !target.search && !target.hash, 'Base URL must be an HTTP(S) directory URL without credentials, query or fragment');
  if (!target.pathname.endsWith('/')) target.pathname += '/';
  const baseURL = target.href;
  browser = await chromium.launch({
    headless: process.env.SPACE_MAN_HEADED !== '1',
    ...(process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {}),
  });

  async function client(name, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', ...options });
    // Preferences only: no game/transport/crypto APIs, clocks, or packets mocked.
    await context.addInitScript((host) => {
      if (!localStorage.getItem('sm2.settings')) localStorage.setItem('sm2.settings', JSON.stringify({
        netRelay: host, autorun: false, music: false, sfx: false, haptics: false,
      }));
    }, relayHost);
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_MS);
    const c = { name, context, page, sockets: 0, sent: 0, received: 0, unexpectedSockets: 0, errors: [] };
    page.on('pageerror', (error) => c.errors.push(error.message));
    page.on('websocket', (ws) => {
      c.sockets++;
      if (ws.url() !== expectedSocketURL) c.unexpectedSockets++;
      ws.on('framesent', () => c.sent++);
      ws.on('framereceived', () => c.received++);
    });
    clients.push(c);
    await page.goto(baseURL);
    await page.locator('#btnTogether').waitFor({ state: 'visible' });
    return c;
  }
  async function wait(page, predicate, arg) {
    await page.waitForFunction(predicate, arg, { timeout: STEP_MS, polling: 100 });
  }
  async function rosterReady(page) {
    await wait(page, () => {
      const n = window.SpaceManNet;
      if (!n) return false;
      const info = n.info(), rows = n.roster();
      return n.active && !n.mockActive && info.players === 2 && info.spectators === 1
        && rows.length === 3 && rows.some((r) => r.you);
    });
  }
  async function rostersAgree() {
    await Promise.all(clients.map((c) => rosterReady(c.page)));
    // `you` differs by page; compare the shared identity fields, not just counts.
    const expected = await clients[0].page.evaluate(() => window.SpaceManNet.roster()
      .map(({ p, role, callsign, host }) => ({ p, role, callsign, host: !!host }))
      .sort((a, b) => a.p - b.p));
    await Promise.all(clients.map((c) => wait(c.page, (rows) => {
      const actual = window.SpaceManNet.roster()
        .map(({ p, role, callsign, host }) => ({ p, role, callsign, host: !!host }))
        .sort((a, b) => a.p - b.p);
      return JSON.stringify(actual) === JSON.stringify(rows);
    }, expected)));
  }
  async function join(c, invite, watch) {
    // Exercise pasted-link parsing, the Play/Watch choice, and first-run callsign.
    await c.page.locator('#btnTogether').click();
    await c.page.locator('#joinInput').fill(invite);
    await c.page.locator('#btnJoinGo').click();
    await c.page.locator(watch ? '#btnJoinWatch' : '#btnJoinPlay').click();
    await c.page.locator('#btnCallsignDone').click();
    await wait(c.page, () => window.SpaceManNet.active && G.mode === 'play');
  }
  const identity = (page) => page.evaluate(() => {
    const { myP, seed, runId, role } = window.SpaceManNet.info();
    return { myP, seed, runId, role };
  });

  try {
    const host = await client('host');
    const player = await client('phone-sized player', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const spectator = await client('spectator');
    stage = 'creating a fresh room through the UI';
    await host.page.locator('#btnTogether').click();
    await host.page.locator('#btnCreateRoom').click();
    await host.page.locator('#btnCallsignDone').click();
    await host.page.locator('#ovRoom.show').waitFor();
    const invite = await host.page.evaluate(() => window.SpaceManNet.info().link);
    // The app generates fresh random room id, keys and invite secret every run.
    // Keep that capability link in memory, never in logs, traces or screenshots.
    assert.ok(invite.startsWith(baseURL + '#j='), 'Invite points at this checkout');
    stage = 'joining player and spectator through the UI';
    await join(player, invite, false);
    await join(spectator, invite, true);
    await rostersAgree();
    assert.match(await host.page.locator('#roomCounts').innerText(), /players 2\/\d+ · spectators 1\/\d+/);
    assert.equal(await host.page.locator('#roomRoster .roster-row').count(), 3);
    const playerBefore = await identity(player.page), spectatorBefore = await identity(spectator.page);
    assert.equal(playerBefore.role, 0);
    assert.equal(spectatorBefore.role, 1);
    assert.notEqual(playerBefore.myP, spectatorBefore.myP);
    for (const c of clients) {
      assert.equal((await identity(c.page)).seed, playerBefore.seed, `${c.name}: shared world seed`);
      assert.equal((await identity(c.page)).runId, playerBefore.runId, `${c.name}: shared round`);
    }
    t.diagnostic('Real relay admitted all three isolated browser contexts; roster and roles agree.');

    // Reconnect at the start line so a slow relay cannot turn this transport test
    // into an unrelated death-by-flare test. Offline emulation alone need not
    // close an existing WebSocket, so explicitly close the real native socket.
    stage = 'disconnecting the player';
    const socketCount = player.sockets;
    await player.context.setOffline(true);
    await player.page.evaluate(() => window.SpaceManNet._n1.session()?.relay.ws?.close());
    await wait(host.page, (p) => !window.SpaceManNet.roster().some((r) => r.p === p), playerBefore.myP);
    await wait(host.page, (p) => !window.SpaceManNet.presence().some((r) => r.p === p), playerBefore.myP);
    stage = 'reconnecting the player to the same seat';
    await player.context.setOffline(false); // the app's real online handler nudges reconnect
    await rostersAgree();
    await wait(host.page, (p) => window.SpaceManNet.presence().some((r) => r.p === p), playerBefore.myP);
    assert.deepEqual(await identity(player.page), playerBefore, 'Reconnect preserves seat, role, seed and round');
    assert.ok(player.sockets > socketCount, 'A replacement WebSocket was opened');

    stage = 'reloading the spectator and resuming its seat';
    await spectator.page.reload();
    await rostersAgree();
    assert.deepEqual(await identity(spectator.page), spectatorBefore, 'Reload resumes spectator without a duplicate player');
    t.diagnostic('Player loss/reconnect and spectator page reload preserved the original seats and roles.');

    stage = 'starting the shared countdown';
    await Promise.all(clients.map((c) => c.page.evaluate(() => {
      window.__relaySmokeRounds = [];
      window.SpaceManNet.onEvent((event, data) => {
        if (event === 'round' || event === 'round-begin') {
          window.__relaySmokeRounds.push({ seed: data.seed, runId: data.runId, startInMs: data.startInMs });
        }
      });
    })));
    await host.page.locator('#btnRoomPlay').click();
    await Promise.all(clients.map((c) => wait(c.page, () => {
      const rc = window.SpaceManNet.roundClock();
      return rc?.active && rc.elapsedMs > 0 && G.mode === 'play';
    })));
    for (const c of clients) {
      const round = await c.page.evaluate(() => window.__relaySmokeRounds.find((r) => r.startInMs > 0));
      assert.ok(round, `${c.name}: received a positive countdown before running`);
      const current = await identity(c.page);
      assert.equal(round.seed, playerBefore.seed, `${c.name}: countdown uses the shared world`);
      assert.equal(round.runId, playerBefore.runId, `${c.name}: countdown uses the shared round`);
      assert.equal(current.seed, round.seed);
      assert.equal(current.runId, round.runId);
    }
    await wait(spectator.page, () => netSpectating() && validWatch() && spec.watchP > 0 && spec.cameraP === spec.watchP);
    // Actual keyboard input drives the shipped simulation; remote PRES/SNAP
    // samples must change on both the other player and the spectator.
    async function moveAndObserve(mover, observers) {
      const p = (await identity(mover.page)).myP;
      await wait(spectator.page, (p) => watchable(ghostByP.get(p)), p);
      if (await spectator.page.evaluate((p) => spec.watchP !== p, p)) {
        await spectator.page.keyboard.press('ArrowRight'); // two runners: select the other one
      }
      await wait(spectator.page, (p) => {
        const g = ghostByP.get(p);
        return spec.watchP === p && spec.cameraP === p && watchable(g)
          && Math.abs(G.camX - (g.x1 - view.w * 0.42)) < 3;
      }, p);
      const cameraBefore = await spectator.page.evaluate(() => G.camX);
      const before = await mover.page.evaluate(() => G.player.x + G.player.w / 2);
      await mover.page.keyboard.down('ArrowRight');
      try { await wait(mover.page, (x) => G.player.x + G.player.w / 2 > x + 12, before); }
      finally { await mover.page.keyboard.up('ArrowRight'); }
      await Promise.all(observers.map((c) => wait(c.page, ({ p, x }) =>
        window.SpaceManNet.presence().some((r) => r.p === p && !r.spectator && r.x > x + 8 && r.runId === window.SpaceManNet.info().runId), { p, x: before })));
      await wait(spectator.page, ({ p, x }) => {
        const g = ghostByP.get(p);
        return spec.watchP === p && spec.cameraP === p && watchable(g) && G.camX > x + 5
          && Math.abs(G.camX - (g.x1 - view.w * 0.42)) < 4;
      }, { p, x: cameraBefore });
    }
    stage = 'observing bidirectional live presence after reconnect';
    await moveAndObserve(host, [player, spectator]);
    await moveAndObserve(player, [host, spectator]);
    for (const c of clients) {
      assert.equal(await c.page.evaluate((p) => window.SpaceManNet.presence().some((r) => r.p === p), spectatorBefore.myP), false, `${c.name}: spectator produces no player ghost`);
      assert.deepEqual(c.errors, [], `${c.name}: no uncaught browser errors`);
      assert.equal(c.unexpectedSockets, 0, `${c.name}: only the selected real relay was used`);
      assert.ok(c.sent > 0 && c.received > 0, `${c.name}: real WebSocket traffic in both directions`);
    }
    t.diagnostic('Shared countdown, spectator follow, and fresh host/player movement reached the other browsers.');

    stage = 'closing the test room';
    await host.page.evaluate(() => leaveRoom());
    await Promise.all([player, spectator].map((c) => wait(c.page, () => !window.SpaceManNet.active)));
    t.diagnostic('Host closed the room; both guests received the closure.');
  } catch (error) {
    // Deliberately whitelist diagnostics: info().link and resumeToken() contain
    // room credentials, and must not be attached to public CI logs/artifacts.
    t.diagnostic(`Failed while ${stage}; relay=${relayHost}`);
    for (const c of clients) {
      const state = await c.page.evaluate(() => {
        const n = window.SpaceManNet, i = n?.info();
        return { active: n?.active, role: i?.role, seat: i?.myP, players: i?.players, spectators: i?.spectators, quality: i?.quality,
          join: document.querySelector('#joinState')?.textContent, create: document.querySelector('#joinHint')?.textContent };
      }).catch(() => ({ pageUnavailable: true }));
      t.diagnostic(JSON.stringify({ client: c.name, sockets: c.sockets, sent: c.sent, received: c.received, ...state }));
    }
    // Playwright action errors can include the value passed to fill().
    throw new Error(String(error.message).replace(/#j=[A-Za-z0-9_-]+/g, '#j=[redacted]'));
  }
});
