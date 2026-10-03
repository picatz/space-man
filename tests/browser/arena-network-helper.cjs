// Shared friend-arena browser acceptance. Chromium UI, gameplay and crypto are
// real in both modes. The default suite substitutes ONLY the opaque relay hop;
// it is explicitly a simulated-relay test, never evidence of a live relay run.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const ROOT = path.resolve(__dirname, '../..');
const STEP_MS = 30000;

function validateRelayHost(host) {
  assert.match(host, /^[A-Za-z0-9.-]+(?::\d{1,5})?$/, 'Use a relay hostname[:port], without scheme or path');
  const port = host.includes(':') ? Number(host.split(':')[1]) : 443;
  assert.ok(port >= 1 && port <= 65535, 'Relay port must be between 1 and 65535');
  return host;
}

async function simulatedRelay(context, c, hub) {
  // No state, input, crypto, DOM, timers, or frame-rate APIs are replaced.
  // Binary ciphertext is transported from the browser's actual WebSocket API
  // boundary into tests/harness.cjs, which authenticates and routes opaque data.
  const sockets = new Map(), deliveries = new Map();
  c.bridgeSockets = sockets;
  // Native WebSockets preserve order, including OPEN before the first frame.
  // Serialize CDP deliveries instead of relying on concurrent evaluate order.
  const deliver = (page, id, type, bytes) => {
    const next = (deliveries.get(id) || Promise.resolve()).then(() => page.evaluate(({ id, type, bytes }) => {
      window.__arenaRelayDispatch?.(id, type, bytes);
    }, { id, type, bytes })).catch(() => { c.deliveryErrors++; });
    deliveries.set(id,next); return next;
  };
  await context.exposeBinding('__arenaRelayHop', ({ page }, action, id, value) => {
    if (action === 'open') {
      c.sockets++;
      if (value !== 'wss://relay.test/derp') {
        c.unexpectedSockets++;
        setImmediate(() => { deliver(page,id,'error'); deliver(page,id,'close'); });
        return; // A substituted relay must never conceal an invalid endpoint.
      }
      if (c.offline) { setImmediate(() => deliver(page, id, 'close')); return; }
      const socket = new hub.Socket(); sockets.set(id, socket);
      socket.onopen = () => deliver(page, id, 'open');
      socket.onmessage = event => {
        c.received++;
        const b = new Uint8Array(event.data);
        c.receivedTypes[b[0]] = (c.receivedTypes[b[0]] || 0) + 1;
        if (b[0] === 5) c.encryptedReceived++;
        return deliver(page, id, 'message', Array.from(b));
      };
    } else if (action === 'send') {
      const socket = sockets.get(id);
      if (!socket || c.offline || socket.readyState !== 1) return;
      c.sent++;
      c.sentTypes[value[0]] = (c.sentTypes[value[0]] || 0) + 1;
      if (value[0] === 4) c.encryptedSent++;
      socket.send(Uint8Array.from(value));
    } else if (action === 'close') {
      const socket = sockets.get(id); sockets.delete(id); socket?.close();
      return deliver(page, id, 'close');
    }
  });
  await context.addInitScript(() => {
    let serial = 0;
    const sockets = new Map();
    class RelayHop extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url, protocol) {
        super(); this.url = String(url); this.protocol = typeof protocol === 'string' ? protocol : '';
        this.extensions = ''; this.binaryType = 'blob'; this.bufferedAmount = 0; this.readyState = 0;
        this.id = ++serial; sockets.set(this.id, this);
        window.__arenaRelayHop('open', this.id, this.url).catch(() => this.close());
      }
      send(data) {
        if (this.readyState !== 1) throw new DOMException('Socket is not open', 'InvalidStateError');
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        this.bufferedAmount += bytes.length;
        window.__arenaRelayHop('send', this.id, Array.from(bytes)).finally(() => { this.bufferedAmount -= bytes.length; });
      }
      close() {
        if (this.readyState >= 2) return;
        this.readyState = 2; window.__arenaRelayHop('close', this.id).catch(() => {});
      }
    }
    Object.assign(RelayHop.prototype, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.__arenaRelayDispatch = (id, type, bytes) => {
      const socket = sockets.get(id); if (!socket) return;
      if (type === 'open') { if (socket.readyState !== 0) return; socket.readyState = 1; }
      if (type === 'message' && socket.readyState !== 1) return;
      if (type === 'close') { socket.readyState = 3; sockets.delete(id); }
      const event = type === 'message' ? new MessageEvent(type, { data: Uint8Array.from(bytes).buffer }) : new Event(type);
      socket['on' + type]?.(event); socket.dispatchEvent(event);
    };
    window.WebSocket = RelayHop;
  });
}

async function runAcceptance(t, { live = false, relayHost = 'relay.test' } = {}) {
  // Live opt-in and hostname validation happen in the entrypoint BEFORE this
  // require. No Playwright loading or network is needed for an unrequested run.
  const { chromium } = require('playwright');
  const hub = live ? null : require('../harness.cjs').relay();
  const clients = []; let browser, server;
  let stage = 'starting independent browser contexts';
  t.after(async () => {
    for (const c of clients) {
      if (!c.page.isClosed()) await Promise.race([c.page.evaluate(() => {
        window.SpaceManNet?.leave(); sessionStorage.clear();
      }).catch(() => {}), delay(1200)]);
    }
    // Give encrypted host BYE time to leave before closing its browser context.
    await delay(80);
    for (const c of clients) for (const socket of c.bridgeSockets?.values() || []) socket.close();
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  let baseURL;
  if (process.env.SPACE_MAN_BASE_URL) {
    const url = new URL(process.env.SPACE_MAN_BASE_URL);
    assert.ok(/^https?:$/.test(url.protocol) && !url.username && !url.password && !url.search && !url.hash, 'Base URL must be an HTTP(S) directory URL without credentials, query or fragment');
    if (!url.pathname.endsWith('/')) url.pathname += '/'; baseURL = url.href;
  } else {
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
    baseURL = `http://127.0.0.1:${server.address().port}/`;
  }
  browser = await chromium.launch({ headless: process.env.SPACE_MAN_HEADED !== '1',
    ...(process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {}) });
  async function client(name, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', ...options });
    const c = { name, context, phone:!!options.isMobile, sockets: 0, sent: 0, received: 0, encryptedSent: 0, encryptedReceived: 0, unexpectedSockets: 0, deliveryErrors:0, sentTypes:{}, receivedTypes:{}, errors: [], offline: false };
    if (!live) await simulatedRelay(context, c, hub);
    await context.addInitScript(host => {
      const p = /^\/pr\/([1-9]\d*)\/([a-f0-9]{40})\/([a-f0-9]{40})\//.exec(location.pathname);
      const key = (p ? 'sm2.preview.' + p[1] + '.' + p[2] + '.' + p[3] + '.' : '') + 'sm2.settings';
      // Configure the same shipped custom-relay preference a human can choose.
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ netRelay: host === 'default' ? '' : 'https://' + host,
        autorun: false, music: false, sfx: false, haptics: false, reduceMotion: true }));
    }, relayHost);
    c.page = await context.newPage(); c.page.setDefaultTimeout(STEP_MS); clients.push(c);
    c.page.on('pageerror', () => c.errors.push('uncaught browser error'));
    c.page.on('websocket', ws => {
      c.sockets++;
      if (!live || (relayHost === 'default' ? !/^wss:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/derp$/.test(ws.url()) : ws.url() !== `wss://${relayHost}/derp`)) c.unexpectedSockets++;
      ws.on('framesent', event => { c.sent++; if (Buffer.from(event.payload)[0] === 4) c.encryptedSent++; });
      ws.on('framereceived', event => { c.received++; if (Buffer.from(event.payload)[0] === 5) c.encryptedReceived++; });
    });
    await c.page.goto(baseURL); await c.page.locator('#btnArena').waitFor();
    if (!process.env.SPACE_MAN_BASE_URL) assert.equal(await c.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sm-target').trim()), '44px', 'local browser checks load the shared stylesheet');
    await c.page.evaluate(() => {
      window.__arenaRunnerBefore = G.player;
      window.__arenaAcceptance = { events: [], uiEvents: [], lifecycle: [], inputs: {}, snapshots: 0 };
      const seen = new Set();
      const collect = state => {
        for (const event of state?.events || []) {
          const key = event.serial + ':' + event.type;
          if (seen.has(key)) continue; seen.add(key);
          window.__arenaAcceptance.events.push({ serial: event.serial, type: event.type, actorId: event.actorId, targetId: event.targetId });
        }
      };
      window.SpaceManNet.onEvent((event, data) => {
        if (['state','join-progress','welcomed','ok','join','rejoin','roster','role','leave','reconnecting','reconnected','hostaway','hostback','bye'].includes(event)) {
          // Never retain event payloads: they can contain identity/capability data.
          const item = {event};
          if (['established','down'].includes(data.state)) item.state=data.state;
          if (['relay','hello'].includes(data.stage)) item.stage=data.stage;
          for (const key of ['p','reason','detail']) if (Number.isInteger(data[key])) item[key]=data[key];
          __arenaAcceptance.lifecycle.push(item);
          if (__arenaAcceptance.lifecycle.length>40) __arenaAcceptance.lifecycle.shift();
        }
        if (event !== 'arena-data') return;
        const input = window.SpaceManArenaOnline.decodeInput(data.bytes);
        if (input) window.__arenaAcceptance.inputs[data.p] = { seq: input.seq, command: input.command };
        const snapshot = window.SpaceManArenaOnline.decodeSnapshot(data.bytes);
        if (snapshot) { window.__arenaAcceptance.snapshots++; collect(snapshot.state); }
      });
      const observe = () => {
        if (typeof arenaUI !== 'undefined' && arenaUI?.active) {
          const s = arenaUI.snapshot(); collect(s);
          for (const e of s?.events || []) __arenaAcceptance.uiEvents.push({type:e.type,actorId:e.actorId,serial:e.serial});
          if (__arenaAcceptance.uiEvents.length > 200) __arenaAcceptance.uiEvents.splice(0,__arenaAcceptance.uiEvents.length-200);
        }
        requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    });
    return c;
  }
  const wait = (c, fn, arg) => c.page.waitForFunction(fn, arg, { timeout: STEP_MS, polling: 25 });
  const screen = (c, value) => c.page.locator(`.arena-root[data-screen="${value}"]`).waitFor();
  const snapshot = c => c.page.evaluate(() => arenaUI.snapshot());
  async function capture(c, name) {
    if (live || !process.env.SPACE_MAN_ARENA_SCREENSHOTS) return;
    try {
      await fs.mkdir(process.env.SPACE_MAN_ARENA_SCREENSHOTS,{recursive:true});
      await c.page.screenshot({path:path.join(process.env.SPACE_MAN_ARENA_SCREENSHOTS,'arena-online-'+name+'.png'),timeout:5000,
        mask:[c.page.locator('#arenaInvite'),c.page.locator('#arenaRoomInput'),c.page.locator('.arena-room-qr'),c.page.locator('.arena-room-code')]});
    } catch { t.diagnostic('Optional simulated-relay screenshot unavailable: '+name); }
  }
  async function open(c) { await c.page.locator('#btnArena').click(); await screen(c, 'lobby'); await c.page.locator('.arena-online-panel > summary').click(); }
  async function join(c, invite, watch = false) {
    await open(c);
    if (c.phone) assert.equal(await c.page.locator('#arenaRoomHint').isVisible(),true,'phone lobby connection/help status is visible');
    await c.page.locator('#arenaRoomInput').fill(invite);
    await c.page.locator(watch ? '#arenaWatch' : '#arenaJoin').click();
    await wait(c, () => SpaceManNet.active && SpaceManNet.info().mode === 'arena' && SpaceManNet.roster().some(r => r.you));
    if (c.phone) assert.equal(await c.page.locator('#arenaRoomHint').isVisible(),true,'phone joined-room connection status is visible');
  }
  const identity = c => c.page.evaluate(() => {
    const n = SpaceManNet, info = n.info(), s = n._n1.session();
    return { p: info.myP, role: info.role, key: n._n1.bytes.hex(s.keys.pub) };
  });
  async function roster(count) {
    await Promise.all(clients.filter(c => c.joined).map(c => wait(c, n => SpaceManNet.roster().length === n, count)));
    const expected = await clients[0].page.evaluate(() => SpaceManNet.roster().map(({p,role,callsign}) => ({p,role,callsign})).sort((a,b) => a.p-b.p));
    await Promise.all(clients.filter(c => c.joined).map(c => wait(c, expected => JSON.stringify(SpaceManNet.roster().map(({p,role,callsign}) => ({p,role,callsign})).sort((a,b) => a.p-b.p)) === JSON.stringify(expected), expected)));
  }
  async function pausedAgreement(host, peers) {
    await Promise.all([host, ...peers].map(c => screen(c, 'pause')));
    const s = await snapshot(host);
    const expected = { tick: s.tick, phase: s.phase, actors: s.actors.map(a => ({ id: a.id, peerP: a.peerP, team: a.team, stocks: a.stocks, deaths: a.deaths, damage: a.damage, kos: a.kos })) };
    await Promise.all(peers.map(c => wait(c, expected => {
      const s = arenaUI.snapshot();
      return s && JSON.stringify({ tick: s.tick, phase: s.phase, actors: s.actors.map(a => ({ id:a.id,peerP:a.peerP,team:a.team,stocks:a.stocks,deaths:a.deaths,damage:a.damage,kos:a.kos })) }) === JSON.stringify(expected);
    }, expected)));
    await delay(220);
    for (const c of [host, ...peers]) assert.equal((await snapshot(c)).tick, expected.tick, `${c.name}: shared pause freezes simulation`);
    return s;
  }
  try {
    const host = await client('desktop host');
    const guest = await client('phone player', { viewport: { width:390,height:844 }, isMobile:true,hasTouch:true,deviceScaleFactor:2 });
    const watcher = await client('spectator'), late = await client('late player');
    stage = 'creating and joining an arena through visible controls';
    await open(host); await host.page.locator('#arenaHost').click();
    await wait(host, () => SpaceManNet.active && SpaceManNet.info().mode === 'arena');
    host.joined = true;
    await wait(host, () => document.querySelector('#arenaInvite')?.value.includes('#j='));
    const invite = await host.page.locator('#arenaInvite').inputValue();
    assert.ok(invite.startsWith(baseURL + '#j='), 'invite uses this checkout/build');
    // Capability link stays in memory. Never record traces, videos, screenshots,
    // console logs, storage dumps, packet contents, or invitation text in live mode.
    await join(guest, invite); guest.joined = true;
    await join(watcher, invite, true); watcher.joined = true;
    await roster(3);
    for (const c of [guest,watcher]) {
      assert.equal(await c.page.locator('#arenaInvite').isVisible(),false,'only host exposes invitation sharing');
      assert.ok((await c.page.locator('#arenaInvite').inputValue()) !== '[object Object]','guest invitation is never a malformed object');
    }
    assert.equal(await host.page.locator('#arenaRoomMembers li').count(), 3);
    const guestIdentity = await identity(guest), watchIdentity = await identity(watcher);
    assert.equal(guestIdentity.role, 0); assert.equal(watchIdentity.role, 1);
    assert.equal(await guest.page.locator('#arenaStart').isDisabled(), true);
    await capture(guest,'phone-lobby');
    t.diagnostic(`${live ? 'Live' : 'Simulated'} relay: isolated desktop, phone and spectator browsers agree on membership.`);

    stage = 'starting the shared duel and checking spectator controls';
    await host.page.locator('#arenaStart').click();
    await Promise.all([host,guest,watcher].map(c => wait(c, () => arenaUI.snapshot()?.phase === 'playing')));
    assert.equal((await snapshot(host)).actors[0].controller, 'human');
    assert.equal((await snapshot(guest)).actors[1].controller, 'human');
    assert.ok((await snapshot(watcher)).actors.every(a => a.controller !== 'human'));
    await capture(guest,'phone-fight');
    await watcher.page.locator('#arenaWatchNext').click();
    await watcher.page.locator('#arenaWatchPrevious').click();
    await watcher.page.keyboard.press('f'); await watcher.page.keyboard.press('Space');
    assert.equal(await host.page.evaluate(p => !!__arenaAcceptance.inputs[p], watchIdentity.p), false, 'watcher cannot emit fighter commands');

    stage = 'real phone touch movement and input-release';
    const cdp = await guest.context.newCDPSession(guest.page);
    const box = await guest.page.locator('.arena-stick-zone').boundingBox();
    assert.ok(box && box.width >= 48 && box.height >= 48, 'phone stick is touch-sized');
    const x = box.x + box.width * .55, y = box.y + box.height * .6;
    const before = (await snapshot(host)).actors[1].x;
    await cdp.send('Input.dispatchTouchEvent', { type:'touchStart',touchPoints:[{id:0,x,y}] });
    await cdp.send('Input.dispatchTouchEvent', { type:'touchMove',touchPoints:[{id:0,x:x-40,y}] });
    await wait(host, x => arenaUI.snapshot().actors[1].x < x - 8, before);
    await cdp.send('Input.dispatchTouchEvent', { type:'touchCancel',touchPoints:[] });
    await wait(host, p => __arenaAcceptance.inputs[p]?.command.moveX === 0 && Math.abs(arenaUI.snapshot().actors[1].vx) < .1, guestIdentity.p);
    assert.equal(await guest.page.locator('.arena-pressed').count(), 0);

    stage = 'guest menu releases held controls while the shared round keeps playing';
    await guest.page.keyboard.down('a');
    await wait(host, p => __arenaAcceptance.inputs[p]?.command.moveX < 0, guestIdentity.p);
    await guest.page.locator('#arenaPause').click(); await screen(guest,'pause');
    await guest.page.keyboard.up('a');
    await wait(host, p => __arenaAcceptance.inputs[p]?.command.moveX === 0, guestIdentity.p);
    const menuTick = (await snapshot(host)).tick;
    await wait(host, tick => arenaUI.snapshot().tick > tick + 12, menuTick);
    assert.equal(await host.page.locator('.arena-root').getAttribute('data-screen'), 'match');
    await guest.page.locator('#arenaResume').click(); await screen(guest,'match');

    stage = 'host shared pause and new late player admitted as watching';
    await host.page.locator('#arenaPause').click(); await pausedAgreement(host,[guest,watcher]);
    assert.equal(await guest.page.locator('#arenaResume').isDisabled(), true);
    await join(late,invite); late.joined = true; await roster(4);
    assert.equal((await identity(late)).role, 1);
    await pausedAgreement(host,[guest,watcher,late]);
    assert.ok((await snapshot(late)).actors.every(a => a.controller !== 'human'));

    stage = 'disconnecting and reconnecting the original player identity';
    const socketsBefore = guest.sockets;
    guest.offline = true; await guest.context.setOffline(true);
    await guest.page.evaluate(() => SpaceManNet._n1.session().relay.ws.close());
    await wait(host, p => !SpaceManNet.roster().some(r => r.p === p), guestIdentity.p);
    await wait(host, p => arenaUI.snapshot().actors.some(a => a.peerP === p && !a.connected), guestIdentity.p);
    guest.offline = false; await guest.context.setOffline(false);
    await roster(4);
    await wait(host, p => arenaUI.snapshot().actors.some(a => a.peerP === p && a.connected), guestIdentity.p);
    const after = await identity(guest);
    assert.ok(after.p === guestIdentity.p && after.role === guestIdentity.role && after.key === guestIdentity.key, 'reconnect preserves original key, role and fighter seat');
    assert.ok(guest.sockets > socketsBefore, 'reconnect creates a replacement socket');
    await pausedAgreement(host,[guest,watcher,late]);
    await host.page.locator('#arenaResume').click();
    await Promise.all(clients.map(c => screen(c,'match')));

    stage = 'positioning host for a real keyboard attack';
    await wait(host, () => arenaUI.snapshot().actors.every(a => a.invulnerable === 0));
    await host.page.keyboard.down('d');
    try { await wait(host, () => { const [a,b] = arenaUI.snapshot().actors; return a.x >= b.x - 62; }); }
    finally { await host.page.keyboard.up('d'); }
    await wait(host, () => Math.abs(arenaUI.snapshot().actors[0].vx) < .1);
    stage = 'waiting for authoritative keyboard-hit damage';
    await host.page.keyboard.press('f');
    await wait(host, () => arenaUI.snapshot().actors[1].damage > 0);
    stage = 'pausing immediately after hit and checking state agreement';
    await host.page.locator('#arenaPause').click();
    const hit = await pausedAgreement(host,[guest,watcher,late]);
    assert.ok(hit.actors[1].damage >= 12 && hit.actors[0].attackSerial > 0);
    stage = 'waiting for remote hit-event delivery after shared pause';
    await Promise.all([guest,watcher,late].map(c => wait(c, () => __arenaAcceptance.events.some(e => e.type === 'hit' && e.actorId === 1 && e.targetId === 2))));
    stage = 'checking shared hit-damage HUD';
    for (const c of clients) assert.match(await c.page.locator('.arena-roster [data-actor="2"] .arena-damage').innerText(), /^[1-9]\d*%$/);
    await host.page.locator('#arenaResume').click(); await screen(guest,'match');

    stage = 'ordinary movement loses stocks and all browsers agree on match result';
    await guest.page.keyboard.down('d');
    try { await Promise.all(clients.map(c => c.page.locator('.arena-root[data-screen="results"]').waitFor({timeout:45000}))); }
    finally { await guest.page.keyboard.up('d'); }
    const result = await snapshot(host);
    assert.equal(result.phase,'over'); assert.equal(result.actors[1].stocks,0);
    for (const c of clients) {
      const s = await snapshot(c);
      assert.deepEqual(s.result,result.result,`${c.name}: authoritative result`);
      assert.deepEqual(s.actors.map(a => [a.id,a.stocks,a.damage,a.deaths,a.kos]),result.actors.map(a => [a.id,a.stocks,a.damage,a.deaths,a.kos]),`${c.name}: authoritative stocks/damage`);
      assert.equal(await c.page.locator('.arena-roster [data-actor="2"] .arena-stocks').innerText(),'○○○');
      assert.equal(await c.page.locator('.arena-roster [data-actor="2"] .arena-damage').innerText(),'OUT');
    }
    await capture(guest,'phone-results');
    t.diagnostic(`${live ? 'Live' : 'Simulated'} relay: real touch/keyboard commands, release, hit, damage, stocks, result and same-seat reconnect passed.`);

    stage = 'rematch and lobby role/team changes through visible controls';
    await host.page.locator('#arenaRematch').click();
    await wait(host,() => arenaUI.snapshot()?.phase === 'countdown');
    await host.page.locator('#arenaPause').click(); await host.page.locator('#arenaLobby').click();
    await Promise.all(clients.map(c => screen(c,'lobby')));
    await guest.page.locator('#arenaRoomRole').click();
    await wait(guest,() => SpaceManNet.info().role === 1);
    await watcher.page.locator('#arenaRoomRole').click();
    await wait(watcher,() => SpaceManNet.info().role === 0); await roster(4);
    await host.page.locator('.arena-format-card[data-format="teams"]').click();
    const teamButton = host.page.locator('[data-team-peer="1"]');
    const teamBefore = await teamButton.locator('..').innerText(); await teamButton.click();
    await wait(host, old => document.querySelector('[data-team-peer="1"]').parentElement.textContent !== old, teamBefore);
    await host.page.locator('#arenaStart').click();
    await Promise.all(clients.map(c => wait(c,() => arenaUI.snapshot()?.format === 'teams')));
    const teams = await snapshot(host);
    assert.equal(teams.actors.length,4);
    assert.equal(teams.actors.filter(a => a.controller === 'cpu').length,2);
    assert.equal(teams.actors.find(a => a.peerP === 1).team,1);
    assert.ok((await snapshot(guest)).actors.every(a => a.controller !== 'human'));
    assert.ok((await snapshot(watcher)).actors.some(a => a.controller === 'human'));
    const viewport = guest.page.viewportSize();
    for (const id of ['arenaWatchPrevious','arenaWatchNext']) {
      await guest.page.locator('#'+id).waitFor({state:'visible'});
      const bounds = await guest.page.locator('#'+id).boundingBox();
      assert.ok(bounds && bounds.width>=44 && bounds.height>=44 && bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=viewport.width+1 && bounds.y+bounds.height<=viewport.height+1,'phone spectator control is visible, touch-sized and within viewport');
    }

    await capture(guest,'phone-watch');

    stage = 'departed fighter number reused by a watcher retains watch controls';
    await host.page.locator('#arenaPause').click();
    await pausedAgreement(host,[guest,watcher,late]);
    const departedP = (await identity(watcher)).p;
    await watcher.page.locator('#arenaLobby').click();
    await screen(watcher,'lobby'); watcher.joined = false;
    // A normal leave reserves its old number briefly for transport reconnect.
    // Wait for actual retirement, rather than advancing time or faking a kick.
    await wait(host, p => !Array.from(SpaceManNet._n1.session().roster.values()).some(r => r.p === p), departedP);
    await watcher.page.locator('#arenaRoomInput').fill(invite);
    await watcher.page.locator('#arenaWatch').click();
    await wait(watcher, () => SpaceManNet.active && SpaceManNet.info().role === 1 && SpaceManNet.roster().some(r => r.you));
    watcher.joined = true; await roster(4);
    assert.equal((await identity(watcher)).p, departedP, 'fresh spectator actually reuses the vacated number');
    await wait(watcher, () => arenaUI.snapshot()?.actors.every(a => a.controller !== 'human'));
    assert.equal(await watcher.page.locator('#arenaWatchNext').isVisible(),true,'recycled-number watcher retains spectator navigation');
    assert.equal(await watcher.page.locator('.arena-touch').count(),1,'fighter controls exist to check visibility');
    assert.equal(await watcher.page.locator('.arena-touch').isVisible(),false,'recycled-number watcher never gets fighter touch controls');
    t.diagnostic(`${live ? 'Live' : 'Simulated'} relay: recycled fighter number stays spectator-only after ordinary leave and rejoin.`);

    stage = 'host closure and clean runner return';
    await host.page.locator('#arenaPause').click(); await host.page.locator('#arenaLobby').click();
    await Promise.all(clients.map(c => screen(c,'lobby')));
    const confirmation = host.page.waitForEvent('dialog').then(async dialog => {
      assert.match(dialog.message(),/Close the arena room/); await dialog.accept();
    });
    await host.page.locator('#arenaRoomLeave').click(); await confirmation;
    await Promise.all(clients.map(c => wait(c,() => !SpaceManNet.active)));
    for (const c of [guest,watcher,late]) assert.match(await c.page.locator('#arenaRoomHint').innerText(),/host closed/i);
    stage = 'reusing the same arena UI for a new room and rendering its first event';
    await host.page.locator('.arena-format-card[data-format="duel"]').click();
    await host.page.locator('#arenaHost').click();
    await wait(host, () => SpaceManNet.active && document.querySelector('#arenaInvite')?.value.includes('#j='));
    const freshInvite = await host.page.locator('#arenaInvite').inputValue();
    assert.ok(freshInvite !== invite, 'reused UI creates fresh room capabilities');
    await guest.page.locator('#arenaRoomInput').fill(freshInvite); await guest.page.locator('#arenaJoin').click();
    await Promise.all([host,guest].map(c => wait(c, () => SpaceManNet.roster().length === 2)));
    await Promise.all([host,guest].map(c => c.page.evaluate(() => { __arenaAcceptance.uiEvents.length = 0; })));
    await host.page.locator('#arenaStart').click();
    await Promise.all([host,guest].map(c => wait(c,() => arenaUI.snapshot()?.phase === 'playing')));
    await host.page.keyboard.press('Space');
    await Promise.all([host,guest].map(c => wait(c,() => __arenaAcceptance.uiEvents.some(e => e.type === 'jump' && e.actorId === 1))));
    await host.page.locator('#arenaPause').click(); await host.page.locator('#arenaLobby').click();
    const freshConfirmation = host.page.waitForEvent('dialog').then(dialog => dialog.accept());
    await host.page.locator('#arenaRoomLeave').click(); await freshConfirmation;
    await Promise.all([host,guest].map(c => wait(c,() => !SpaceManNet.active)));
    stage = 'returning all browsers to the runner after room reuse';
    for (const c of clients) {
      await c.page.locator('#arenaBack').click();
      await wait(c,() => !arenaUI.active);
      assert.equal(await c.page.evaluate(() => G.player === __arenaRunnerBefore),true,'arena preserves the runner object');
      assert.equal(await c.page.evaluate(() => !!(input.left || input.right || input.jumpHeld)),false,'arena controls do not leak into runner');
      assert.equal(await c.page.evaluate(() => document.activeElement.id),'btnArena');
      assert.equal(c.errors.length,0,`${c.name}: no uncaught browser errors`);
      assert.equal(c.unexpectedSockets,0,`${c.name}: no other relay endpoints`);
      assert.ok(c.sockets >= 1 && c.sent > 0 && c.received > 0 && c.encryptedReceived > 0,`${c.name}: encrypted relay traffic observed`);
    }
    assert.ok(host.encryptedSent > 0 && guest.encryptedSent > 0);
    if (hub) assert.ok(hub.packetCount > 100,'simulated opaque relay forwarded encrypted app traffic');
    await host.page.locator('#btnPlay').focus(); await host.page.keyboard.press('Enter');
    await host.page.keyboard.down('d');
    try { await wait(host,() => G.mode === 'play' && G.player.vx > 0); }
    finally { await host.page.keyboard.up('d'); }
    t.diagnostic(`${live ? 'Live' : 'Simulated'} relay: role/team changes, host-close confirmation and runner return passed.`);
  } catch (error) {
    // Live capability links/keys must never escape through Playwright call logs
    // or assertion diffs. Stage names are deliberately constant and public.
    if (live) throw new Error(`Live arena acceptance failed while ${stage} (${error.name || 'Error'}). Private diagnostics suppressed.`);
    const redact = text => String(text || '').replace(/https?:\/\/\S+/gi,'[url]').replace(/(?:#j=)?[A-Za-z0-9_=-]{40,}/g,'[redacted]').slice(0,320);
    for (const c of clients) {
      const state = await c.page.evaluate(() => {
        const n=window.SpaceManNet, info=n?.info(), a=window.__arenaAcceptance;
        return {hint:document.querySelector('#arenaRoomHint')?.textContent || '',
          screen:document.querySelector('.arena-root')?.dataset.screen,
          active:!!n?.active,mode:info?.mode,p:info?.myP,role:info?.role,
          players:info?.players,spectators:info?.spectators,
          roster:n?.roster().map(r=>({p:r.p,role:r.role,host:!!r.host,you:!!r.you})),
          snapshots:a?.snapshots,lifecycle:a?.lifecycle || []};
      }).catch(() => ({unavailable:true}));
      if (state.hint) state.hint=redact(state.hint);
      await capture(c,'failure-'+c.name.replace(/[^a-z0-9]+/gi,'-'));
      t.diagnostic('Simulated-relay diagnostic '+JSON.stringify({client:c.name,...state,
        sockets:c.sockets,openBridgeSockets:c.bridgeSockets?.size || 0,sent:c.sent,received:c.received,
        sentTypes:c.sentTypes,receivedTypes:c.receivedTypes,encryptedSent:c.encryptedSent,encryptedReceived:c.encryptedReceived,
        unexpectedSockets:c.unexpectedSockets,deliveryErrors:c.deliveryErrors,browserErrors:c.errors.length,
        relayPackets:hub?.packetCount || 0}));
    }
    throw new Error(`Simulated-relay arena acceptance: ${stage}: ${redact(error.message)}`);
  }
}
module.exports = { runAcceptance, validateRelayHost };
