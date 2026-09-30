// Run Together on bad links: the bench in tests/netbench.cjs drives the real
// game + real encrypted protocol through a shaped in-memory relay.
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');
const nb = require('./netbench.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function room(t, { guestGame = true } = {}) {
  const hub = nb.shape(relay()), host = client(hub), guest = client(hub, { width: 390, height: 844, game: guestGame });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  return { hub, host, guest };
}
async function running(t) {
  const r = await room(t);
  r.guest.run('startRun({sync:true})'); r.host.run('startRun()');
  await until(() => r.guest.net.roundClock()?.active, 'shared round');
  r.hub.advance(3100);
  return r;
}
const hostRow = (host) => [...host.net._n1.session().roster.values()][0];

test('ghosts stay smooth on a café link: no teleports, no rubber-banding, bounded delay', async (t) => {
  const r = await running(t);
  const s = await nb.ghostTrace(r, { profile: 'cafe', ms: 5000 });
  t.diagnostic('cafe ' + JSON.stringify(s));
  assert.equal(s.hidden, 0, 'the ghost never blinks out');
  assert.equal(s.teleports, 0);
  assert.equal(s.back, 0, 'never steps backwards');
  assert.ok(s.stepRms < 1.5, 'per-frame motion stays even (rms ' + s.stepRms + ' px)');
  assert.ok(s.delayP95 < 500, 'playout delay stays bounded (' + s.delayP95 + ' ms)');
});

test('ghosts degrade gracefully on a plane link (300 ms, heavy jitter, 5 % drops, stalls, capped uplink)', async (t) => {
  const r = await running(t);
  const s = await nb.ghostTrace(r, { profile: 'plane', ms: 6000, seed: 11 });
  t.diagnostic('plane ' + JSON.stringify(s));
  assert.equal(s.hidden, 0, 'a lossy link never hides a live runner');
  assert.equal(s.teleports, 0, 'no teleports');
  assert.ok(s.maxStep < 30, 'largest single-frame step ' + s.maxStep + ' px');
  assert.ok(s.back <= 10, 'at most a handful of tiny corrections backwards (' + s.back + ')');
  assert.ok(s.stepRms < 3, 'motion stays even (rms ' + s.stepRms + ' px)');
});

test('a dead socket (network switch, no FIN) is noticed and replaced in seconds, same seat, same round', async (t) => {
  const r = await running(t), { host, guest } = r;
  const gs = guest.net._n1.session();
  clearInterval(gs.pingTimer); gs.pingTimer = setInterval(gs._pingTick, 400);   // faster ticks so the test is quick; the logic is the same
  t.after(() => clearInterval(gs.pingTimer));
  nb.setLink(guest, 'cafe');
  let n = 0;
  const iv = setInterval(() => host.net.sendPresence(1000 + (n++), 250, 0, 9, 0, 1, 1), 100);
  t.after(() => clearInterval(iv));
  await sleep(700);
  const seat = guest.net.info().myP, runId = guest.net.info().runId, sock = gs.relay.ws;
  const events = [];
  guest.net.onEvent((e) => { if (e === 'reconnecting' || e === 'reconnected') events.push(e); });
  await nb.blackhole(guest, 1500, { dead: true });
  const before = gs.peers.get(1).receivedAt, t0 = Date.now();
  await until(() => gs.peers.get(1).receivedAt > before, 'ghost updates resume', 6000);
  t.diagnostic('resumed ' + (Date.now() - t0) + ' ms after the outage');
  assert.notEqual(gs.relay.ws, sock, 'a fresh socket');
  assert.equal(guest.net.info().myP, seat); assert.equal(guest.net.info().runId, runId);
  assert.ok(guest.net.roundClock().active, 'the shared round clock is re-anchored');
  assert.deepEqual(events, ['reconnecting', 'reconnected']);
  assert.equal(hostRow(host).strikes, 0);
});

test('a reconnect catches up the round clock and the dead-alien set the guest missed', async (t) => {
  const r = await running(t), { host, guest } = r;
  const gs = guest.net._n1.session();
  const ids = [11111, 22222];
  host.net._n1.session().sendKill(ids[0]);
  await until(() => guest.run('G.deadAliens && G.deadAliens.has(' + ids[0] + ')'), 'first kill');
  nb.setLink(guest, { down: true });                      // silent outage: the host's KILLB is lost
  host.net._n1.session().sendKill(ids[1]);
  await sleep(100);
  assert.equal(guest.run('G.deadAliens.has(' + ids[1] + ')'), false);
  nb.setLink(guest, 'lan');
  gs.relay.kick('test');                                  // what the watchdog does after the silence
  await until(() => guest.run('G.deadAliens.has(' + ids[1] + ')'), 'the missed kill is replayed', 5000);
  const hc = host.net.roundClock(), gc = guest.net.roundClock();
  assert.ok(Math.abs(hc.elapsedMs - gc.elapsedMs) < 50, 'clocks agree after the rejoin');
});

test('reordered frames are accepted once, duplicates are refused, and nobody is struck for a slow path', async (t) => {
  const r = await running(t), { host, guest } = r;
  nb.setLink(guest, 'reorder', 3);
  nb.setLink(host, 'reorder', 5);
  const s = await nb.ghostTrace(r, { profile: 'reorder', ms: 3000 });
  t.diagnostic('reorder ' + JSON.stringify(s));
  let k = 0;
  const iv = setInterval(() => guest.net.sendPresence(40 + (k++) * 5, 250, 50, 11, 0, k, k / 2), 50);
  await sleep(1500); clearInterval(iv);
  assert.equal(hostRow(host).strikes, 0, 'no strikes on a reordering path');
  assert.equal(s.back, 0, 'the ghost never steps back');
  // The window itself, directly.
  const L = guest.net._n1.link, pair = { highSeen: -1, mask: 0 };
  for (const c of [0, 1, 3]) { assert.equal(L.replayCheck(pair, c), null); L.markSeen(pair, c); }
  assert.equal(L.replayCheck(pair, 2), null, 'a late frame inside the window is fresh');
  L.markSeen(pair, 2);
  assert.equal(L.replayCheck(pair, 2), 'replay', 'but only once');
  assert.equal(L.replayCheck(pair, 3), 'replay');
  L.markSeen(pair, 60);
  assert.equal(L.replayCheck(pair, 20), 'stale', 'beyond the window it is stale');
  assert.equal(L.replayCheck(pair, 40), null);
});

test('a genuine replay of a captured frame is still refused and struck', async (t) => {
  const { host, guest, hub } = await room(t, { guestGame: false });
  const captured = [];
  const orig = hub.shape;
  hub.shape = (socket, bytes, deliver, dir) => deliver();
  const hs = host.net._n1.session(), gs = guest.net._n1.session();
  const wire = await guest.net._n1.env.sealApp(gs.pair, guest.net._n1.frames.encPing(guest.net._n1.frames.makeScratch(), 1, 0, 0, 0));
  captured.push(wire);
  await hs._onPacket(gs.keys.pub, captured[0]);
  await hs._onPacket(gs.keys.pub, captured[0]);          // the relay (or anyone on the path) plays it again
  hub.shape = orig;
  assert.equal(hostRow(host).strikes, 1);
});

test('link quality is measured end to end and reads good / poor honestly on both sides', async (t) => {
  const r = await room(t, { guestGame: false }), { host, guest } = r;
  const gs = guest.net._n1.session();
  clearInterval(gs.pingTimer);
  guest.net._n1.TUNE.deadTicks = 60;                      // fast ticks here; keep the watchdog at its real ~8 s
  gs.pingTimer = setInterval(gs._pingTick, 150);
  t.after(() => clearInterval(gs.pingTimer));
  await until(() => guest.net.quality().level === 'good', 'good on a clean link');
  assert.ok(guest.net.quality().rttMs < 150);
  await until(() => host.net.quality().peers.length === 1 && host.net.quality().level === 'good', 'host sees the member link');
  nb.setLink(guest, { latency: 500, jitter: 300 });
  await until(() => guest.net.quality().level === 'poor', 'poor on a plane-grade link', 8000);
  t.diagnostic('guest ' + JSON.stringify(guest.net.quality()));
  await until(() => host.net.quality().peers[0]?.level === 'poor', () => 'the host sees it too ' + JSON.stringify(host.net.quality()), 8000);
  assert.equal(host.net.info().quality, 'poor');
});

test('presence thins out on a poor link, but a death always goes out at once', async (t) => {
  const { host, guest } = await room(t, { guestGame: false });
  const gs = guest.net._n1.session();
  clearInterval(gs.pingTimer);                            // hold the measured link where the test puts it
  const count = async (level) => {
    Object.assign(gs.link, level === 'poor' ? { n: 5, rtt: 600, jit: 200, loss: 0.2 } : { n: 5, rtt: 30, jit: 5, loss: 0 });
    for (let i = 0; i < 12; i++) { await gs.sendPresence(40 + i, 250, 50, 11, 0, i, i); await sleep(80); }
    await sleep(100);
  };
  hostRow(host).hist = [];
  await count('good');
  const good = hostRow(host).hist.length;
  hostRow(host).hist = [];
  gs.presN = 0;
  await count('poor');
  const poor = hostRow(host).hist.length;
  assert.ok(good === 12 && poor <= 5 && poor >= 3, 'good ' + good + ' vs poor ' + poor);
  hostRow(host).hist = [];
  await gs.sendPresence(200, 250, 0, 4, 0, 30, 30);       // the dead bit is essential
  await until(() => hostRow(host).pres && (hostRow(host).pres.state & 4), 'death arrives despite throttling');
});

test('an idle room costs about one packet a second per member instead of ten', async (t) => {
  const { hub } = await room(t, { guestGame: false });
  await sleep(300);
  const p0 = hub.packetCount;
  await sleep(2000);
  const perSec = (hub.packetCount - p0) / 2;
  t.diagnostic('idle packets/s ' + perSec);
  assert.ok(perSec <= 3, 'idle room ' + perSec + ' packets/s');
});

test('presence and snapshot codecs round-trip the v5 layout (timestamps, quantized y/vy)', async (t) => {
  const c = client(relay(), { game: false }); t.after(() => c.close());
  const F = c.net._n1.frames, s = F.makeScratch();
  assert.equal(c.net._n1.PROTO, 6);
  const pres = F.encPres(s, { t: 65530, x: 12345.5, y: -250.375, vx: -40, vy: -13.2, state: 11, chain: 3, score: 900, dist: 1234, runId: 7 });
  assert.equal(pres.length, F.PRES_LEN);
  const d = F.decPres(pres.slice(), null);
  assert.equal(d.t, 65530); assert.equal(d.x, 12345.5); assert.equal(d.y, -250.375);
  assert.equal(d.vx, -40); assert.ok(Math.abs(d.vy + 13.2) <= 1 / 16); assert.equal(d.runId, 7);
  const snap = F.decSnap(F.encSnap(s, 9, [{ p: 3, pres: d }]).slice());
  assert.equal(snap.rows[0].t, 65530); assert.equal(snap.rows[0].y, -250.375); assert.equal(snap.rows[0].p, 3);
  assert.ok(4 + F.SNAP_MAX * F.SNAP_ENTRY + 27 <= c.net._n1.WIRE_MAX, 'a full snapshot fits one envelope');
  const L = c.net._n1.link;
  assert.equal(L.presStale({ runId: 1, t: 10 }, { runId: 1, t: 9 }), true, 'older on the same trace');
  assert.equal(L.presStale({ runId: 1, t: 65535 }, { runId: 1, t: 2 }), false, 'wraps forward');
  assert.equal(L.presStale({ runId: 1, t: 9000 }, { runId: 1, t: 6 }), false, 'a restarted run is a new trace');
  assert.equal(F.decPing(F.encPing(s, 7, 123, 0.05, 40).slice()).rtt, 123);
});

test('a guest may not answer pings for the host (PONG is a host frame)', async (t) => {
  const { host, guest } = await room(t, { guestGame: false });
  const gs = guest.net._n1.session();
  gs.relay.send(gs.inv.hostPub, await guest.net._n1.env.sealApp(gs.pair, guest.net._n1.frames.encPong(guest.net._n1.frames.makeScratch(), 1)));
  await until(() => hostRow(host).strikes === 1, 'struck');
});

test('cancelling a join that is still waiting on the host returns at once', async (t) => {
  const hub = nb.shape(relay()), host = client(hub), guest = client(hub);
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, approve: true });
  const t0 = Date.now();
  const joining = guest.net.acceptJoin(host.net.info().link.split('#j=')[1]).catch((e) => e);
  await until(() => host.net._n1.session().pending.size === 1, 'waiting for approval');
  guest.net.leave();
  const e = await joining;
  assert.match(e.message, /cancel/i);
  assert.ok(Date.now() - t0 < 2000, 'returned promptly');
  assert.equal(guest.net.active, false);
});
