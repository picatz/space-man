// Browser acceptance for friend racing. The production UI, simulation, crypto,
// timers and controls run unchanged in independent Chromium/WebKit contexts.
// Default runs substitute ONLY the opaque relay hop. Live is explicit opt-in.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { validateRelayHost } = require('./arena-network-helper.cjs');
const ROOT = path.resolve(__dirname, '../..');
const STEP_MS = 30000;

function networkErrorCategory(value) {
  // Error text may contain endpoint or invitation URLs. Return only a fixed
  // category; never retain the text, regex match or an unrecognized code.
  const text = String(value), code = /\bnet::(ERR_[A-Z_]+)\b/.exec(text)?.[1];
  const allowed = ['ERR_INTERNET_DISCONNECTED','ERR_CONNECTION_REFUSED','ERR_CONNECTION_RESET','ERR_CONNECTION_CLOSED',
    'ERR_CONNECTION_FAILED','ERR_NETWORK_CHANGED','ERR_ADDRESS_UNREACHABLE','ERR_TIMED_OUT','ERR_FAILED','ERR_ABORTED',
    'ERR_WS_PROTOCOL_ERROR','ERR_TEMPORARILY_THROTTLED','ERR_CONNECTION_TIMED_OUT','ERR_WS_THROTTLE_QUEUE_TOO_LARGE',
    'ERR_NETWORK_ACCESS_DENIED','ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS',
    'ERR_CACHED_IP_ADDRESS_SPACE_BLOCKED_BY_LOCAL_NETWORK_ACCESS_POLICY'];
  if (allowed.includes(code)) return code;
  if (/\boffline\b|internet disconnected/i.test(text)) return 'offline';
  if (/\brefused\b/i.test(text)) return 'refused';
  if (/\bthrottl/i.test(text)) return 'throttled';
  if (/\baccess\b|\bblocked\b|\bsecurity\b/i.test(text)) return 'access';
  if (/\bwebsocket\b|\bsocket\b/i.test(text)) return 'socket';
  if (/\bnetwork\b/i.test(text)) return 'network';
  return 'other';
}

// Use the same opaque in-memory DERP hop as arena acceptance. A CI-only
// loopback WebSocket adapts native browser frames to harness.relay.Socket.
// This avoids automation-RPC latency without replacing browser socket events,
// frame ordering, timers, cryptography, UI, input or simulation behavior.
async function simulatedRelay(context, c, hub) {
  const { WebSocketServer, WebSocket } = require('ws');
  const server = new WebSocketServer({host:'127.0.0.1',port:0,path:'/derp',perMessageDeflate:false,maxPayload:1024*1024});
  await new Promise((resolve,reject) => { server.once('listening',resolve); server.once('error',reject); });
  c.loopbackURL = `ws://127.0.0.1:${server.address().port}/derp`;
  c.loopbackListening = () => server.address() !== null;
  c.bridgeEvents = [];
  const bridgeEvent = event => {
    c.bridgeEvents.push({event,atMs:Date.now()-c.createdAt});
    if (c.bridgeEvents.length > 30) c.bridgeEvents.shift();
  };
  const sockets = new Map(); c.bridgeSockets = sockets;
  c.closeBridge = async () => {
    for (const ws of server.clients) ws.terminate();
    for (const relay of sockets.values()) if (!relay.closed) relay.close();
    await new Promise(resolve => server.close(resolve));
  };
  server.on('connection',ws => {
    c.sockets++;
    bridgeEvent('connection');
    if (c.offline) { bridgeEvent('offline-rejected'); ws.terminate(); return; }
    const relay = new hub.Socket(); sockets.set(ws,relay);
    const startup = []; let startupBytes = 0;
    relay.onopen = () => {
      for (const bytes of startup) if (!c.offline && ws.readyState === WebSocket.OPEN) relay.send(bytes);
      startup.length = 0; startupBytes = 0;
    };
    relay.onmessage = event => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const bytes = new Uint8Array(event.data);
      c.received++; c.receivedTypes[bytes[0]] = (c.receivedTypes[bytes[0]] || 0)+1;
      if (bytes[0] === 5) c.encryptedReceived++;
      c.maxRelayBufferedBytes = Math.max(c.maxRelayBufferedBytes || 0,ws.bufferedAmount);
      ws.send(bytes,{binary:true});
    };
    ws.on('message',(bytes,isBinary) => {
      if (!isBinary) { c.unexpectedSockets++; ws.close(1003); return; }
      if (c.offline) return;
      c.sent++; c.sentTypes[bytes[0]] = (c.sentTypes[bytes[0]] || 0)+1;
      if (bytes[0] === 4) c.encryptedSent++;
      const frame = Uint8Array.from(bytes);
      if (relay.readyState === 0) {
        // The loopback handshake can beat the harness socket's deferred OPEN.
        // Preserve startup frames in order rather than discarding that race.
        if (startup.length >= 64 || startupBytes + frame.length > 1024*1024) {
          c.deliveryErrors++; ws.close(1009); return;
        }
        startup.push(frame); startupBytes += frame.length;
      } else if (relay.readyState === 1) relay.send(frame);
    });
    ws.on('close',() => { bridgeEvent('close'); sockets.delete(ws); if (!relay.closed) relay.close(); });
    ws.on('error',() => { bridgeEvent('error'); c.deliveryErrors++; });
  });
  await context.addInitScript(endpoint => {
    const NativeWebSocket = window.WebSocket;
    window.__raceUnexpectedSocketCount = 0;
    // Bounded event categories only. In particular, never retain constructor
    // arguments, error messages, close reasons, frame bytes or room identities.
    const transport = window.__raceNativeTransport = {counts:Object.create(null),events:[]};
    let nextId = 0;
    const record = (event,id,extra = {}) => {
      transport.counts[event] = (transport.counts[event] || 0)+1;
      const state = window.SpaceManNet?._n1.session()?.relay?.state;
      const relayState = ['idle','connecting','handshake','established','down','closed'].includes(state) ? state : 'none';
      transport.events.push({event,id,atMs:Math.round(performance.now()),online:navigator.onLine,relayState,...extra});
      if (transport.events.length > 40) transport.events.shift();
    };
    for (const event of ['online','offline']) window.addEventListener(event,() => record(event,0));
    class LocalRelaySocket extends NativeWebSocket {
      constructor(url,protocols) {
        const id = ++nextId;
        record('constructor',id);
        if (String(url) !== 'wss://relay.test/derp') {
          window.__raceUnexpectedSocketCount++;
          record('endpoint-rejected',id);
          throw new DOMException('Unexpected simulated relay endpoint','SecurityError');
        }
        // The local test application is HTTP. This is a native loopback socket,
        // never a TLS exception or a fallback from the opt-in public relay path.
        try {
          if (protocols === undefined) super(endpoint); else super(endpoint,protocols);
        } catch (error) {
          const category = ['SecurityError','SyntaxError','InvalidStateError','TypeError'].includes(error?.name) ? error.name : 'other';
          record('constructor-error',id,{category});
          throw error;
        }
        record('created',id);
        this.addEventListener('open',() => record('open',id));
        this.addEventListener('error',() => record('error',id,{readyState:this.readyState}));
        this.addEventListener('close',event => record('close',id,{code:event.code,clean:event.wasClean}));
      }
    }
    window.WebSocket = LocalRelaySocket;
  },c.loopbackURL);
}

function browserName() {
  const name = process.env.SPACE_MAN_RACE_BROWSER || 'chromium';
  assert.ok(['chromium', 'webkit'].includes(name), 'SPACE_MAN_RACE_BROWSER must be chromium or webkit');
  return name;
}

async function runAcceptance(t, { live = false, relayHost = 'relay.test' } = {}) {
  // Validation precedes loading Playwright and opening any network connection.
  validateRelayHost(relayHost);
  const name = browserName(), engine = require('playwright')[name];
  const hub = live ? null : require('../harness.cjs').relay();
  const clients = []; let browser, server;
  let stage = 'starting independent browser contexts';
  t.after(async () => {
    for (const c of clients) {
      if (!c.page.isClosed()) await Promise.race([c.page.evaluate(() => {
        clearInterval(window.__raceDriver);
        window.SpaceManNet?.leave(); sessionStorage.clear();
      }).catch(() => {}), delay(1200)]);
    }
    await delay(80); // Let the encrypted host BYE leave before destroying contexts.
    for (const c of clients) for (const socket of c.bridgeSockets?.values() || []) socket.close();
    await browser?.close();
    for (const c of clients) if (c.closeBridge) await c.closeBridge();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  let baseURL;
  if (process.env.SPACE_MAN_BASE_URL) {
    const url = new URL(process.env.SPACE_MAN_BASE_URL);
    assert.ok(/^https?:$/.test(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
      'Base URL must be an HTTP(S) directory URL without credentials, query or fragment');
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    baseURL = url.href;
  } else {
    server = http.createServer(async (req, res) => {
      const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
      if (!/^(?:index\.html|manifest\.json|favicon\.png|src\/[a-z-]+\.(?:js|css)|icons\/[a-z0-9-]+\.png)$/.test(file)) {
        res.writeHead(404).end(); return;
      }
      try {
        const bytes = await fs.readFile(path.join(ROOT, file));
        const type = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[path.extname(file)];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(bytes);
      } catch { res.writeHead(404).end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}/`;
  }
  browser = await engine.launch({ headless: process.env.SPACE_MAN_HEADED !== '1',
    ...(name === 'chromium' && process.env.SPACE_MAN_CHROMIUM_PATH ? { executablePath: process.env.SPACE_MAN_CHROMIUM_PATH } : {}) });
  async function client(label, options = {}) {
    const context = await browser.newContext({ viewport: { width:1280,height:800 }, serviceWorkers:'block', ...options });
    const c = { name:label,context,phone:!!options.isMobile,sockets:0,sent:0,received:0,encryptedSent:0,encryptedReceived:0,
      unexpectedSockets:0,deliveryErrors:0,sentTypes:{},receivedTypes:{},errors:[],offline:false,joined:false,
      socketEvents:[],socketAttempts:0,networkChanges:[],networkErrors:[],createdAt:Date.now() };
    if (!live) await simulatedRelay(context, c, hub);
    await context.addInitScript(host => {
      const preview = /^\/pr\/([1-9]\d*)\/([a-f0-9]{40})\/([a-f0-9]{40})\//.exec(location.pathname);
      const key = (preview ? 'sm2.preview.' + preview[1] + '.' + preview[2] + '.' + preview[3] + '.' : '') + 'sm2.settings';
      localStorage.setItem(key, JSON.stringify({ netRelay:host === 'default' ? '' : 'https://' + host,
        autorun:false,music:false,sfx:false,haptics:false,reduceMotion:true }));
      // Only the browser's normal gamepad-device boundary is supplied. Driver
      // commands go through the shipped UI; no simulation state/timer is changed.
      const pad = { connected:true,mapping:'standard',index:0,axes:[0,0],
        buttons:Array.from({length:17}, () => ({pressed:false,value:0})) };
      window.__racePad = pad;
      Object.defineProperty(navigator, 'getGamepads', { configurable:true,value:() => [pad] });
    }, relayHost);
    c.page = await context.newPage(); c.page.setDefaultTimeout(STEP_MS); clients.push(c);
    c.page.on('pageerror', () => c.errors.push('uncaught browser error'));
    c.page.on('console',message => {
      if (!['error','warning'].includes(message.type())) return;
      const category = networkErrorCategory(message.text());
      if (category === 'other') return;
      c.networkErrors.push({category,atMs:Date.now()-c.createdAt});
      if (c.networkErrors.length > 30) c.networkErrors.shift();
    });
    c.page.on('websocket', ws => {
      const id = ++c.socketAttempts;
      const record = (event,category) => {
        c.socketEvents.push({id,event,atMs:Date.now()-c.createdAt,...(category ? {category} : {})});
        if (c.socketEvents.length > 40) c.socketEvents.shift();
      };
      record('created');
      ws.on('close',() => record('close'));
      ws.on('socketerror',error => record('error',networkErrorCategory(error)));
      if (!live) {
        if (ws.url() !== c.loopbackURL) c.unexpectedSockets++;
        return; // Native loopback server counts opaque frames without RPCs.
      }
      c.sockets++;
      if (!live || (relayHost === 'default' ? !/^wss:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/derp$/.test(ws.url()) : ws.url() !== `wss://${relayHost}/derp`)) c.unexpectedSockets++;
      ws.on('framesent', event => { c.sent++; if (Buffer.from(event.payload)[0] === 4) c.encryptedSent++; });
      ws.on('framereceived', event => { c.received++; if (Buffer.from(event.payload)[0] === 5) c.encryptedReceived++; });
    });
    await c.page.goto(baseURL); await c.page.locator('#btnRace').waitFor();
    if (!process.env.SPACE_MAN_BASE_URL) assert.equal(await c.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--sm-target').trim()), '44px', 'local browser checks load the shared stylesheet');
    await c.page.evaluate(() => {
      window.__raceRunnerBefore = G.player;
      window.__raceAcceptance = { inputs:{},snapshots:0,lifecycle:[],visibility:[],buttonEvents:{},maxPassed:{},boosts:{} };
      const visibility = event => {
        const events = __raceAcceptance.visibility;
        events.push({event,hidden:document.hidden,state:document.visibilityState,focus:document.hasFocus()});
        if (events.length > 30) events.shift();
      };
      document.addEventListener('visibilitychange',() => visibility('visibilitychange'));
      window.addEventListener('focus',() => visibility('focus'));
      window.addEventListener('blur',() => visibility('blur'));
      visibility('initial');
      const actionButton = event => {
        const button = event.target?.closest?.('button');
        if (!button) return null;
        const id = button.id || (button.classList.contains('race-pause') ? 'racePause' : '');
        if (!['racePause','raceResume','raceRestart','raceRematch','raceRoomRole','raceLobby'].includes(id)) return null;
        const counts = __raceAcceptance.buttonEvents[id] ||= {pointerdown:0,pointerup:0,click:0,bubbledClick:0};
        return {button,counts};
      };
      for (const type of ['pointerdown','pointerup','click']) document.addEventListener(type,event => {
        const action = actionButton(event); if (!action) return;
        action.counts[type]++;
        action.counts.lastTrusted = !!event.isTrusted;
        action.counts.lastDisabled = !!action.button.disabled;
      },true);
      window.addEventListener('click',event => {
        const action = actionButton(event); if (!action) return;
        action.counts.bubbledClick++;
        action.counts.afterClickPlaying = document.querySelector('.race-root')?.dataset.screen === 'play';
      });
      SpaceManNet.onEvent((event, data) => {
        const a = __raceAcceptance;
        if (['state','welcomed','join','rejoin','roster','role','leave','reconnecting','reconnected','hostaway','hostback','bye'].includes(event)) {
          // Capabilities, identities and other raw payloads are never retained.
          const item = {event};
          if (['established','down'].includes(data.state)) item.state = data.state;
          if (typeof data.why === 'string') {
            const known = ['socket closed','connect timeout','handshake timeout','liveness','stale link',
              'short server key','bad magic','server info reject','rx overflow','frame too large','frame backlog'];
            item.category = known.includes(data.why) ? data.why : data.why.startsWith('ws ctor:') ? 'constructor' : data.why.startsWith('frame:') ? 'frame' : 'other';
            item.online = navigator.onLine;
          }
          for (const key of ['p','reason','detail']) if (Number.isInteger(data[key])) item[key] = data[key];
          a.lifecycle.push(item); if (a.lifecycle.length > 30) a.lifecycle.shift();
        }
        if (event !== 'race-data') return;
        const command = SpaceManRaceOnline.decodeInput(data.bytes);
        if (command) a.inputs[data.p] = {seq:command.seq,command:command.command};
        const snapshot = SpaceManRaceOnline.decodeSnapshot(data.bytes);
        if (snapshot) {
          a.snapshots++;
          a.lastSnapshot = {epoch:snapshot.epoch,revision:snapshot.revision,status:snapshot.status,tick:snapshot.state.tick,at:performance.now()};
        }
      });
      const observe = () => {
        const s = typeof raceUI !== 'undefined' && raceUI?.active ? raceUI.snapshot() : null;
        for (const actor of s?.actors || []) {
          const a = window.__raceAcceptance;
          a.maxPassed[actor.id] = Math.max(a.maxPassed[actor.id] || 0, actor.passed);
          if (actor.boosting) a.boosts[actor.id] = true;
        }
        requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    });
    return c;
  }
  const wait = (c, fn, arg, timeout = STEP_MS) => c.page.waitForFunction(fn, arg, {timeout,polling:25});
  async function network(c, offline) {
    c.offline = offline;
    const change = {requestedOffline:offline,phase:'requested',requestedAtMs:Date.now()-c.createdAt};
    c.networkChanges.push(change);
    if (c.networkChanges.length > 6) c.networkChanges.shift();
    await c.context.setOffline(offline);
    change.phase = 'protocol-acknowledged';
    change.acknowledgedAtMs = Date.now()-c.createdAt;
    // Confirm the native browser's network state instead of adding a delay or
    // dispatching a synthetic online event. The game still reconnects itself.
    await wait(c,online => navigator.onLine === online,!offline);
    change.phase = 'browser-confirmed';
    change.confirmedAtMs = Date.now()-c.createdAt;
  }
  const screen = (c, value) => c.page.locator(`.race-root[data-screen="${value}"]`).waitFor();
  const snapshot = c => c.page.evaluate(() => raceUI.snapshot());
  const identity = c => c.page.evaluate(() => {
    const n = SpaceManNet, info = n.info(), s = n._n1.session();
    return {p:info.myP,role:info.role,key:n._n1.bytes.hex(s.keys.pub)};
  });
  async function capture(c, suffix) {
    if (live || !process.env.SPACE_MAN_RACE_SCREENSHOTS) return;
    try {
      await fs.mkdir(process.env.SPACE_MAN_RACE_SCREENSHOTS, {recursive:true});
      await c.page.screenshot({ path:path.join(process.env.SPACE_MAN_RACE_SCREENSHOTS, `race-online-${name}-${suffix}.png`), timeout:5000,
        mask:[c.page.locator('#raceInvite'),c.page.locator('#raceRoomInput'),c.page.locator('.race-room-qr'),c.page.locator('.race-room-code')] });
    } catch { t.diagnostic('Optional simulated-relay screenshot unavailable: ' + suffix); }
  }
  async function open(c) {
    await c.page.locator('#btnRace').click(); await screen(c, 'lobby');
    const summary = c.page.locator('.race-online-panel > summary');
    if (await summary.count()) await summary.click();
    await c.page.locator('#raceHost').waitFor();
  }
  async function join(c, invite, watch = false, initialScreen = 'lobby') {
    await open(c); await c.page.locator('#raceRoomInput').fill(invite);
    await c.page.locator(watch ? '#raceWatch' : '#raceJoin').click();
    await wait(c, () => SpaceManNet.active && SpaceManNet.info().mode === 'race' && SpaceManNet.roster().some(r => r.you));
    c.joined = true;
    await screen(c, initialScreen);
    if (initialScreen === 'lobby') {
      assert.equal(await c.page.locator('#raceRoomHint').isVisible(), true, 'joined-lobby status remains visible');
    } else {
      // A late arrival enters the authoritative paused race, so the lobby and
      // its room hint are correctly hidden. Check the visible pause status.
      assert.equal(await c.page.getByText('The host paused the race. Everyone is safely parked.', {exact:true}).isVisible(), true, 'late watcher sees shared host-pause status');
    }
  }
  async function roster(count) {
    const joined = clients.filter(c => c.joined);
    await Promise.all(joined.map(c => wait(c, n => SpaceManNet.roster().length === n, count)));
    const expected = await joined[0].page.evaluate(() => SpaceManNet.roster().map(({p,role,callsign}) => ({p,role,callsign})).sort((a,b) => a.p-b.p));
    await Promise.all(joined.map(c => wait(c, expected => JSON.stringify(SpaceManNet.roster().map(({p,role,callsign}) => ({p,role,callsign})).sort((a,b) => a.p-b.p)) === JSON.stringify(expected), expected)));
  }
  async function pausedAgreement(host, peers) {
    await Promise.all([host,...peers].map(c => screen(c, 'pause')));
    const expected = await host.page.evaluate(() => {
      const s = raceUI.snapshot();
      return {tick:s.tick,phase:s.phase,actors:s.actors.map(a => [a.id,a.peerP,Math.fround(a.x),Math.fround(a.y),Math.fround(a.heading),a.passed,a.finishTick])};
    });
    await Promise.all(peers.map(c => wait(c, expected => {
      const s = raceUI.snapshot();
      return s && JSON.stringify({tick:s.tick,phase:s.phase,actors:s.actors.map(a => [a.id,a.peerP,Math.fround(a.x),Math.fround(a.y),Math.fround(a.heading),a.passed,a.finishTick])}) === JSON.stringify(expected);
    }, expected)));
    await delay(250);
    for (const c of [host,...peers]) assert.equal((await snapshot(c)).tick, expected.tick, `${c.name}: host pause freezes shared simulation`);
  }
  async function stableButtonText(c, selector) {
    // Holding a DOM node is read-only: snapshots must not replace the same text
    // target between a user's pointerdown and pointerup on WebKit.
    const initial = await c.page.evaluateHandle(selector => ({
      node:document.querySelector(selector).firstChild,
      revision:raceUI.roomStatus().current.revision,
    }),selector);
    try {
      const revision = await initial.evaluate(value => value.revision);
      await wait(c,revision => raceUI.roomStatus()?.current?.revision >= revision+3,revision);
      assert.equal(await initial.evaluate((value,selector) => value.node === document.querySelector(selector).firstChild,selector),true,
        `${selector}: repeated authoritative snapshots preserve the visible click target`);
    } finally { await initial.dispose(); }
  }
  async function stopDriver(c) {
    await c.page.evaluate(() => {
      clearInterval(window.__raceDriver); __racePad.axes[0] = 0;
      __racePad.buttons.forEach(b => { b.pressed = false; b.value = 0; });
    });
  }
  async function drive(c) {
    await stopDriver(c);
    await c.page.evaluate(() => {
      window.__raceDriver = setInterval(() => {
        const s = raceUI.snapshot(), pad = __racePad;
        const actor = s?.actors.find(a => a.controller === 'human');
        if (!actor || s.phase !== 'racing' || raceUI.screen !== 'play' || actor.finishTick !== null) {
          pad.axes[0] = 0; pad.buttons.forEach(b => { b.pressed = false; b.value = 0; }); return;
        }
        // Pure, read-only steering calculation, then genuine gamepad commands.
        // No checkpoints, actor positions, ticks, finishes or state are written.
        const cmd = SpaceManRace.cpuInput(s, actor);
        pad.axes[0] = cmd.steer;
        for (const [i,held] of [[0,cmd.boost],[1,cmd.brake]]) { pad.buttons[i].pressed = !!held; pad.buttons[i].value = held ? 1 : 0; }
      }, 16);
    });
  }
  async function closeHost(host) {
    const dialog = host.page.waitForEvent('dialog').then(async d => {
      assert.match(d.message(), /close.*room/i); await d.accept();
    });
    await host.page.locator('#raceRoomLeave').click(); await dialog;
  }
  try {
    const host = await client('desktop host');
    const guest = await client('phone racer', {viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
    const watcher = await client('spectator');
    stage = 'creating and joining a race room through title controls';
    await open(host); await host.page.locator('#raceHost').click();
    await wait(host, () => SpaceManNet.active && SpaceManNet.info().mode === 'race'); host.joined = true;
    await wait(host, () => document.querySelector('#raceInvite')?.value.includes('#j='));
    const invite = await host.page.locator('#raceInvite').inputValue();
    assert.ok(invite.startsWith(baseURL + '#j='), 'invitation uses the tested build');
    // Capability lives only in browser/test memory. No live screenshots, traces,
    // videos, console dumps, raw frame payloads or raw assertion diffs are saved.
    await join(guest, invite); await join(watcher, invite, true); await roster(3);
    const guestIdentity = await identity(guest), watcherIdentity = await identity(watcher);
    assert.equal(guestIdentity.role,0); assert.equal(watcherIdentity.role,1);
    assert.equal(await host.page.locator('#raceRoomMembers li').count(),3);
    assert.equal(await guest.page.locator('.race-launch').isDisabled(),true,'only host may start');
    assert.equal(await watcher.page.locator('.race-launch').isDisabled(),true,'watcher may not start');
    for (const c of [guest,watcher]) assert.equal(await c.page.locator('#raceInvite').isVisible(),false,'only host shares invitation');
    await capture(guest,'phone-lobby');
    t.diagnostic(`${live ? 'Live' : 'Simulated'} relay (${name}): desktop, phone and spectator agree on race-room membership.`);

    stage = 'starting five authoritative racers with CPU fill and read-only spectating';
    await host.page.locator('.race-launch').click();
    await Promise.all(clients.map(c => wait(c, () => raceUI.snapshot()?.phase === 'racing')));
    const first = await snapshot(host);
    assert.equal(first.actors.length,5); assert.equal(first.actors.filter(a => a.controller === 'cpu').length,3);
    assert.equal(first.actors.filter(a => a.controller === 'human').length,1);
    assert.equal((await snapshot(guest)).actors.filter(a => a.controller === 'human').length,1);
    assert.ok((await snapshot(watcher)).actors.every(a => a.controller !== 'human'));
    const watched = await watcher.page.locator('#raceWatchName').innerText();
    await watcher.page.locator('#raceWatchNext').click();
    assert.notEqual(await watcher.page.locator('#raceWatchName').innerText(),watched,'watcher changes followed racer');
    await watcher.page.locator('#raceWatchPrevious').click();
    assert.equal(await watcher.page.locator('#raceWatchName').innerText(),watched);
    await watcher.page.keyboard.press('ArrowRight'); await watcher.page.keyboard.press('Space');
    assert.equal(await host.page.evaluate(p => !!__raceAcceptance.inputs[p],watcherIdentity.p),false,'spectator emits no driver commands');

    stage = 'phone steering and cancellation release through browser input';
    const right = guest.page.locator('[data-action="right"]'), b = await right.boundingBox();
    assert.ok(b && b.width >= 44 && b.height >= 44,'phone steering is touch-sized');
    const x = b.x + b.width/2, y = b.y + b.height/2;
    const before = (await snapshot(host)).actors.find(a => a.peerP === guestIdentity.p).heading;
    if (name === 'chromium') {
      const cdp = await guest.context.newCDPSession(guest.page);
      try {
        await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{id:0,x,y}]});
        await wait(host,p => __raceAcceptance.inputs[p]?.command.steer > 0,guestIdentity.p);
        await wait(host,({p,heading}) => Math.abs(raceUI.snapshot().actors.find(a => a.peerP === p).heading-heading) > .01,{p:guestIdentity.p,heading:before});
        await cdp.send('Input.dispatchTouchEvent', {type:'touchCancel',touchPoints:[]});
      } finally { await cdp.detach(); }
    } else {
      await right.dispatchEvent('pointerdown',{pointerId:18,pointerType:'touch',isPrimary:true,clientX:x,clientY:y});
      await wait(host,p => __raceAcceptance.inputs[p]?.command.steer > 0,guestIdentity.p);
      await wait(host,({p,heading}) => Math.abs(raceUI.snapshot().actors.find(a => a.peerP === p).heading-heading) > .01,{p:guestIdentity.p,heading:before});
      await guest.page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:18,pointerType:'touch'})));
    }
    await wait(host,p => __raceAcceptance.inputs[p]?.command.steer === 0,guestIdentity.p);
    assert.equal(await guest.page.locator('.race-pressed').count(),0,'cancellation releases pressed styling');
    const after = (await snapshot(host)).actors.find(a => a.peerP === guestIdentity.p).heading;
    assert.ok(Math.abs(after-before) > .005,'phone input genuinely steered authoritative racer');
    // Rotation is itself another interruption while a touch control is held.
    await right.dispatchEvent('pointerdown',{pointerId:19,pointerType:'touch',isPrimary:true,clientX:x,clientY:y});
    await wait(host,p => __raceAcceptance.inputs[p]?.command.steer > 0,guestIdentity.p);
    await guest.page.setViewportSize({width:844,height:390});
    await wait(host,p => __raceAcceptance.inputs[p]?.command.steer === 0,guestIdentity.p);
    assert.equal(await guest.page.locator('.race-pressed').count(),0,'rotation releases held touch');
    await delay(200);
    for (const action of ['left','right','brake','boost']) {
      const box = await guest.page.locator(`[data-action="${action}"]`).boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.y >= 0 && box.x+box.width <= 845 && box.y+box.height <= 391,'landscape touch control fits');
    }
    await capture(guest,'phone-landscape'); await guest.page.setViewportSize({width:390,height:844});

    stage = 'guest interruption clears controls while host continues racing';
    await guest.page.keyboard.down('ArrowLeft'); await guest.page.keyboard.down('Space');
    await wait(host,p => __raceAcceptance.inputs[p]?.command.steer < 0 && __raceAcceptance.inputs[p]?.command.boost,guestIdentity.p);
    stage = 'opening the guest local pause menu with held steering and boost';
    await guest.page.getByRole('button',{name:'Pause race',exact:true}).click(); await screen(guest,'pause');
    await guest.page.keyboard.up('ArrowLeft'); await guest.page.keyboard.up('Space');
    stage = 'checking guest pause clears steering and boost while host advances';
    await wait(host,p => __raceAcceptance.inputs[p]?.command.steer === 0 && !__raceAcceptance.inputs[p]?.command.boost,guestIdentity.p);
    const menuTick = (await snapshot(host)).tick;
    await wait(host,tick => raceUI.snapshot().tick > tick+12,menuTick);
    assert.equal(await host.page.locator('.race-root').getAttribute('data-screen'),'play');
    stage = 'checking repeated snapshots preserve the guest Resume click target';
    await stableButtonText(guest,'#raceResume');
    stage = 'resuming the guest local pause menu';
    await guest.page.locator('#raceResume').click(); await screen(guest,'play');

    stage = 'host pause, late spectator admission and original-seat reconnect';
    await host.page.getByRole('button',{name:'Pause race',exact:true}).click(); await pausedAgreement(host,[guest,watcher]);
    assert.equal(await guest.page.locator('#raceResume').isDisabled(),true,'guest cannot resume shared pause');
    const late = await client('late player'); await join(late,invite,false,'pause'); await roster(4);
    assert.equal((await identity(late)).role,1,'late player watches current race');
    await pausedAgreement(host,[guest,watcher,late]);
    const socketsBefore = guest.sockets;
    stage = 'confirming the phone network is offline';
    await network(guest,true);
    // Network interruption only; neither room/simulation state nor actor data changes.
    await guest.page.evaluate(() => SpaceManNet._n1.session().relay.ws.close());
    if (!live) {
      // Offline Chromium can stall the graceful close handshake until the
      // loopback server's 30s timeout, racing the host-removal assertion. Cut
      // the simulated transport too; its normal close handler notifies DERP.
      for (const ws of guest.bridgeSockets.keys()) ws.terminate();
    }
    stage = 'waiting for the disconnected phone to leave the host roster';
    await wait(host,p => !SpaceManNet.roster().some(r => r.p === p),guestIdentity.p);
    stage = 'confirming the phone network is online again';
    await network(guest,false);
    stage = 'waiting for the original phone seat to reconnect';
    await roster(4);
    const rejoined = await identity(guest);
    assert.ok(rejoined.p === guestIdentity.p && rejoined.role === guestIdentity.role && rejoined.key === guestIdentity.key,'reconnect preserves key, driver role and seat');
    assert.ok(guest.sockets > socketsBefore,'reconnect opens replacement socket');
    await pausedAgreement(host,[guest,watcher,late]);

    stage = 'restarting, then driving both humans through three complete ordered laps';
    await host.page.locator('#raceRestart').click();
    await Promise.all(clients.map(c => wait(c,() => raceUI.snapshot()?.phase === 'countdown')));
    await Promise.all([host,guest].map(drive));
    await Promise.all([host,guest].map(c => wait(c,() => raceUI.snapshot()?.actors.find(a => a.controller === 'human')?.passed >= 20,undefined,90000)));
    t.diagnostic(`${live ? 'Live' : 'Simulated'} relay (${name}): both human racers completed a genuine first lap using standard controller inputs.`);
    await capture(guest,'phone-racing');
    await Promise.all(clients.map(c => c.page.locator('.race-root[data-screen="results"]').waitFor({timeout:120000})));
    await Promise.all([host,guest].map(stopDriver));
    const result = await snapshot(host);
    assert.equal(result.phase,'finished'); assert.equal(result.results.length,5);
    const humans = result.actors.filter(a => Number.isInteger(a.peerP) && a.peerP > 0);
    assert.equal(humans.length,2,'both original human seats remain');
    for (const actor of humans) {
      assert.equal(actor.passed,60,'each human crossed all 60 ordered gates');
      assert.ok(actor.finishTick > 600,'each human raced to a real finish');
    }
    for (const c of clients) {
      const s = await snapshot(c);
      assert.deepEqual(s.results,result.results,`${c.name}: identical authoritative final standings`);
      assert.deepEqual(s.actors.map(a => [a.id,a.passed,a.finishTick]),result.actors.map(a => [a.id,a.passed,a.finishTick]),`${c.name}: identical checkpoints and finish times`);
      assert.equal(await c.page.locator('.race-result-row').count(),5,'all five racers shown in results');
    }
    await capture(guest,'phone-results');
    t.diagnostic(`${live ? 'Live' : 'Simulated'} relay (${name}): both human three-lap finishes, CPU fill, shared results, pause and same-seat reconnect passed.`);

    stage = 'shared rematch, lobby and spectator/driver role changes';
    stage = 'starting the host rematch from shared results';
    await host.page.locator('#raceRematch').click();
    await Promise.all(clients.map(c => wait(c,() => raceUI.snapshot()?.phase === 'countdown')));
    stage = 'returning the shared rematch to its room lobby';
    await host.page.getByRole('button',{name:'Pause race',exact:true}).click(); await host.page.locator('#raceLobby').click();
    await Promise.all(clients.map(c => screen(c,'lobby')));
    stage = 'checking repeated lobby snapshots preserve role-button click targets';
    await Promise.all([guest,watcher].map(c => stableButtonText(c,'#raceRoomRole')));
    stage = 'switching the original guest from racer to watcher';
    await guest.page.locator('#raceRoomRole').click(); await wait(guest,() => SpaceManNet.info().role === 1);
    stage = 'switching the original spectator into a racer seat';
    await watcher.page.locator('#raceRoomRole').click(); await wait(watcher,() => SpaceManNet.info().role === 0); await roster(4);
    stage = 'launching the changed circuit with swapped player and watcher roles';
    await host.page.locator('[data-track="ember"]').click(); await host.page.locator('.race-launch').click();
    await Promise.all(clients.map(c => wait(c,() => raceUI.snapshot()?.trackId === 'ember')));
    assert.equal((await snapshot(host)).actors.length,5);
    assert.equal((await snapshot(host)).actors.filter(a => a.controller === 'cpu').length,3);
    assert.ok((await snapshot(guest)).actors.every(a => a.controller !== 'human'));
    assert.equal((await snapshot(watcher)).actors.filter(a => a.controller === 'human').length,1);
    for (const id of ['raceWatchPrevious','raceWatchNext']) {
      const box = await guest.page.locator('#'+id).boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.y >= 0 && box.x+box.width <= 391 && box.y+box.height <= 845,'phone spectator control fits and is touch-sized');
    }
    await capture(guest,'phone-watching');

    stage = 'host closure, fresh room reuse and preserved runner return';
    await host.page.getByRole('button',{name:'Pause race',exact:true}).click(); await host.page.locator('#raceLobby').click();
    await Promise.all(clients.map(c => screen(c,'lobby'))); await closeHost(host);
    await Promise.all(clients.map(c => wait(c,() => !SpaceManNet.active)));
    for (const c of [guest,watcher,late]) assert.match(await c.page.locator('#raceRoomHint').innerText(),/host closed/i);
    await host.page.locator('#raceHost').click();
    await wait(host,() => SpaceManNet.active && document.querySelector('#raceInvite')?.value.includes('#j='));
    const freshInvite = await host.page.locator('#raceInvite').inputValue();
    assert.ok(freshInvite !== invite,'reused UI has new room capabilities');
    await guest.page.locator('#raceRoomInput').fill(freshInvite); await guest.page.locator('#raceJoin').click();
    await Promise.all([host,guest].map(c => wait(c,() => SpaceManNet.roster().length === 2)));
    await closeHost(host); await Promise.all([host,guest].map(c => wait(c,() => !SpaceManNet.active)));
    for (const c of clients) {
      await c.page.getByRole('button',{name:'← All games',exact:true}).click();
      await wait(c,() => !raceUI.active);
      assert.equal(await c.page.evaluate(() => G.player === __raceRunnerBefore),true,'racing preserves runner object');
      assert.equal(await c.page.evaluate(() => !!(input.left || input.right || input.jumpHeld)),false,'racing controls do not leak into runner');
      assert.equal(await c.page.evaluate(() => document.activeElement.id),'btnRace');
      assert.equal(c.errors.length,0,`${c.name}: no uncaught browser errors`);
      assert.equal(c.unexpectedSockets + await c.page.evaluate(() => window.__raceUnexpectedSocketCount || 0),0,`${c.name}: only selected relay endpoints`);
      assert.ok(c.sockets > 0 && c.sent > 0 && c.received > 0 && c.encryptedReceived > 0,`${c.name}: encrypted relay traffic observed`);
    }
    assert.ok(host.encryptedSent > 0 && guest.encryptedSent > 0);
    if (hub) assert.ok(hub.packetCount > 100,'opaque relay forwarded encrypted race traffic');
    await host.page.locator('#btnPlay').focus(); await host.page.keyboard.press('Enter'); await host.page.keyboard.down('d');
    try { await wait(host,() => G.mode === 'play' && G.player.vx > 0); } finally { await host.page.keyboard.up('d'); }
    t.diagnostic(`${live ? 'Live' : 'Simulated'} relay (${name}): role changes, host closure, room reuse and clean runner return passed.`);
  } catch (error) {
    // Playwright call logs and assertion values can contain private invites.
    if (live) {
      for (const c of clients) {
        const interaction = await c.page.evaluate(() => ({
          hidden:document.hidden,focused:document.hasFocus(),online:navigator.onLine,
          buttonEvents:window.__raceAcceptance?.buttonEvents || {},
        })).catch(() => ({unavailable:true}));
        // Only controlled IDs/categories, event counts, timing and booleans. Never include
        // invitation values, identity material, text, URLs, frames or traces.
        t.diagnostic('Live-relay interaction diagnostic '+JSON.stringify({client:c.name,...interaction,
          networkChanges:c.networkChanges,socketEvents:c.socketEvents,networkErrors:c.networkErrors}));
      }
      throw new Error(`Live racing acceptance failed while ${stage} (${error.name || 'Error'}). Private diagnostics suppressed.`);
    }
    const redact = value => String(value || '').replace(/https?:\/\/\S+/gi,'[url]').replace(/(?:#j=)?[A-Za-z0-9_=-]{40,}/g,'[redacted]').slice(0,350);
    for (const c of clients) {
      const state = await c.page.evaluate(() => {
        const n = window.SpaceManNet, info = n?.info(), a = window.__raceAcceptance;
        const s = typeof raceUI !== 'undefined' ? raceUI?.snapshot() : null;
        const current = typeof raceUI !== 'undefined' ? raceUI?.roomStatus()?.current : null;
        const relay = n?._n1.session()?.relay;
        return {screen:document.querySelector('.race-root')?.dataset.screen,hidden:document.hidden,visibilityState:document.visibilityState,hasFocus:document.hasFocus(),focusId:document.activeElement?.id || '',visibility:a?.visibility || [],buttonEvents:a?.buttonEvents || {},hint:document.querySelector('#raceRoomHint')?.textContent || '',
          online:navigator.onLine,nativeTransport:window.__raceNativeTransport,
          nativeUnexpectedSockets:window.__raceUnexpectedSocketCount || 0,
          relayState:['idle','connecting','handshake','established','down','closed'].includes(relay?.state) ? relay.state : 'none',
          relaySocketState:relay?.ws?.readyState ?? null,relayAttempts:relay?.attempts ?? 0,
          active:!!n?.active,mode:info?.mode,p:info?.myP,role:info?.role,
          roster:n?.roster().map(r => ({p:r.p,role:r.role,host:!!r.host,you:!!r.you})),
          phase:s?.phase,tick:s?.tick,actors:s?.actors.map(r => ({id:r.id,peerP:r.peerP,controller:r.controller,passed:r.passed,finishTick:r.finishTick})),
          snapshots:a?.snapshots,lastDecoded:a?.lastSnapshot ? {...a.lastSnapshot,ageMs:Math.round(performance.now()-a.lastSnapshot.at),at:undefined} : null,
          accepted:current ? {epoch:current.epoch,revision:current.revision,status:current.status,tick:current.state.tick} : null,lifecycle:a?.lifecycle || []};
      }).catch(() => ({unavailable:true}));
      state.hint = redact(state.hint);
      await capture(c,'failure-'+c.name.replace(/[^a-z0-9]+/gi,'-'));
      t.diagnostic('Simulated-relay diagnostic '+JSON.stringify({client:c.name,...state,sockets:c.sockets,sent:c.sent,received:c.received,
        encryptedSent:c.encryptedSent,encryptedReceived:c.encryptedReceived,unexpectedSockets:c.unexpectedSockets,
        deliveryErrors:c.deliveryErrors,transport:'native-loopback-websocket',maxRelayBufferedBytes:c.maxRelayBufferedBytes || 0,
        loopbackListening:c.loopbackListening?.() ?? false,bridgeOffline:c.offline,
        bridgeEvents:c.bridgeEvents,networkChanges:c.networkChanges,socketEvents:c.socketEvents,networkErrors:c.networkErrors,
        browserErrors:c.errors.length,relayPackets:hub?.packetCount || 0}));
    }
    throw new Error(`Simulated-relay racing acceptance: ${stage}: ${redact(error.message)}`);
  }
}
module.exports = { runAcceptance, validateRelayHost, browserName };
