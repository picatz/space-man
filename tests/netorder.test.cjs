// Ordering and restart edge cases on a reordering / lossy link (review findings on PR #17).
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { client, relay, until } = require('./harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function room(t, { guestGame = false } = {}) {
  const hub = relay(), host = client(hub), guest = client(hub, { game: guestGame, width: 390, height: 844 });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  return { hub, host, guest, hs: host.net._n1.session(), gs: guest.net._n1.session() };
}
const hostRow = (hs) => [...hs.roster.values()][0];

test('a delayed full roster can not resurrect a player whose leave already arrived', async (t) => {
  const { host, guest, hs, gs } = await room(t);
  clearInterval(hs.snapTimer);                            // keep the host quiet so only our frames matter
  const R = host.net._room.roster, s = host.net._n1.frames.makeScratch(), row = hostRow(hs);
  const ghost = { p: 5, pub: new Uint8Array(32).fill(5), tag: 'GHO', suit: 0, hat: 0, role: 0, adjIdx: 2, nounIdx: 2 };
  const full = await host.net._n1.env.sealApp(row.pair, R.encRoster(s, 0, 0, 1, [
    { p: 1, pub: hs.keys.pub, tag: 'AAA', suit: 0, hat: 0, role: 0 }, { p: 2, pub: gs.keys.pub, tag: 'AAA', suit: 0, hat: 0, role: 0 }, ghost]).slice());
  const leave = await host.net._n1.env.sealApp(row.pair, R.encRoster(s, 2, 0, 1, [ghost]).slice());
  const drops = [];
  guest.net.onEvent((e, d) => { if (e === 'drop') drops.push(d.why); });
  await gs._onPacket(hs.keys.pub, leave);                 // the newer leave overtakes the full roster
  await gs._onPacket(hs.keys.pub, full);
  assert.equal(gs.rosterMap.has(5), false, 'the departed player stays gone');
  assert.deepEqual(drops, ['late'], 'the stale roster is dropped as late, not treated as an attack');
  await gs._onPacket(hs.keys.pub, leave);                 // and a true replay is still refused
  assert.deepEqual(drops, ['late', 'replay']);
});

test('an old ROLE request that arrives late can not revert a newer one, and is never struck', async (t) => {
  const { hub, guest, hs, gs } = await room(t);
  const Rl = guest.net._room.role, s = guest.net._n1.frames.makeScratch();
  hub.advance(2000);
  const toSpectator = await guest.net._n1.env.sealApp(gs.pair, Rl.encRole(s, 1, 1).slice());
  const toPlayer = await guest.net._n1.env.sealApp(gs.pair, Rl.encRole(s, 2, 0).slice());
  await hs._onPacket(gs.keys.pub, toPlayer);              // the newer request arrives first
  hub.advance(2000);                                      // past the role rate limit
  await hs._onPacket(gs.keys.pub, toSpectator);           // the older one straggles in
  assert.equal(hostRow(hs).role, 0, 'still a player');
  assert.equal(hostRow(hs).strikes, 0, 'reordering is not an attack');
  await hs._onPacket(gs.keys.pub, toPlayer);              // an exact replay is still struck
  assert.equal(hostRow(hs).strikes, 1);
});

test('presence and pings may still arrive out of order and are used', async (t) => {
  const { hs, gs, guest } = await room(t);
  const F = guest.net._n1.frames, s = F.makeScratch(), env = guest.net._n1.env;
  const a = await env.sealApp(gs.pair, F.encPres(s, { t: 100, x: 100, y: 250, vx: 0, vy: 0, state: 11, chain: 0, score: 0, dist: 0, runId: gs.welcomed.runId }).slice());
  const role = await env.sealApp(gs.pair, guest.net._room.role.encRole(s, 9, 0).slice());
  await hs._onPacket(gs.keys.pub, role);                  // a strict frame with a higher counter first
  await hs._onPacket(gs.keys.pub, a);                     // the earlier presence sample still counts
  assert.equal(hostRow(hs).pres.x, 100);
  assert.equal(hostRow(hs).strikes, 0);
});

test('join/rejoin catch-up carries every live runner, not just the first snapshot\'s worth', async (t) => {
  const { host, hs, gs } = await room(t);
  clearInterval(hs.snapTimer);
  const key = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const now = hs.started + 1e9;
  const t0 = host.run('performance.now()');
  for (let p = 3; p <= 26; p++) {
    const pub = new Uint8Array(32).fill(p);
    hs.roster.set('fake' + p, { p, pub, role: 0, absent: false, lastSeen: t0, pair: host.net._n1.env.makePair(key, hs.roomId, 0, 2), strikes: 0,
      pres: { t: 10, x: 100 + p, y: 250, vx: 0, vy: 0, state: 11, chain: 0, score: 0, dist: 0, runId: hs.runId } });
  }
  void now;
  host.net.sendPresence(90, 250, 0, 11, 0, 0, 0);
  await hs._snapTo(hostRow(hs));
  await until(() => gs.peers.size >= 25, () => 'guest knows ' + gs.peers.size + ' of 25 runners', 2000);
});

test('a ghost follows a restart whose frame clock reuses the previous run\'s timestamps', async (t) => {
  const { host, guest, hub } = await room(t, { guestGame: true });
  guest.run('startRun({sync:true})'); host.run('startRun()');
  await until(() => guest.net.roundClock()?.active, 'shared round');
  hub.advance(3100);
  const runId = guest.net.info().runId, hist = [];
  guest.context.__rows = [];
  guest.run('NET.presence = () => __rows');
  const feed = (tf, x, state) => {
    const at = guest.run('performance.now()');
    hist.push({ t: tf, x, y: 250, vx: 50, vy: 0, state, runId, at });
    if (hist.length > 12) hist.shift();
    guest.context.__rows = [{ p: 1, you: false, host: true, spectator: false, x, y: 250, vx: 50, vy: 0, t: tf, hist: hist.slice(), state, chain: 0, score: 0, dist: 0, runId, suit: 0, hat: 0, callsign: 'P1' }];
    guest.run('netTick(0.1); drawGhosts(1, G.camX)');
    hub.advance(100);
  };
  for (let i = 0; i < 12; i++) feed(1000 + i * 6, 5000 + i * 30, 11);   // alive, far down the course
  feed(1080, 5400, 4);                                                    // dies
  for (let i = 0; i < 10; i++) feed(1000 + i * 6, 40 + i * 30, 11);     // restarts at once: clock reset, same runId (still behind the death stamp)
  for (let i = 0; i < 20; i++) { guest.run('drawGhosts(1, G.camX)'); hub.advance(50); }
  const rx = guest.run('ghostByP.get(1).rx');
  assert.ok(rx < 1500, 'the ghost is on the new run (x=' + Math.round(rx) + '), not stuck where it died');
});

test('a guest takes the first live snapshot after a same-round restart even though its clock went back', async (t) => {
  const { host, hs, gs } = await room(t);
  clearInterval(hs.snapTimer);
  host.net.sendPresence(3000, 250, 0, 4, 0, 500, 300, 200);   // dies at frame 200
  await hs._snapTick();
  await until(() => gs.peers.get(1)?.state === 4, 'dead sample');
  host.net.sendPresence(40, 250, 0, 11, 0, 0, 0, 100);         // restarts: frame clock back to 100
  await hs._snapTick();
  await until(() => gs.peers.get(1)?.x === 40, () => 'guest still shows x=' + gs.peers.get(1)?.x, 1500);
});
