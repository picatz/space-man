const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay, until } = require('./harness.cjs');

async function room(t) {
  const hub = relay(), host = client(hub), guest = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  return { hub, host, guest };
}

// A comparable identity for an enemy that doesn't depend on how it has moved: its
// lane + speed + spawn point (patrols in a chain train share a lane), or for a
// shooter its fixed hover point. `rs` holds the spawn state once the round clock drives it.
const snapshot = (c) => JSON.parse(c.run(`JSON.stringify(G.enemies.filter((e) => !e.dead).map((e) => e.type === 'patrol'
  ? { k: 'p:' + Math.round(e.minX) + ':' + Math.round(e.maxX) + ':' + e.speed.toFixed(3) + ':' + Math.round(e.rs ? e.rs.x0 : 0) + ':' + (e.rs ? e.rs.dir0 : 0), x: e.x, dir: e.dir }
  : { k: 's:' + Math.round(e.x) + ':' + Math.round(e.baseY), x: e.x, y: e.y, fireT: e.fireT, ivl: e.rs ? e.rs.ivl : 0 }))`));

test('aliens are in the same place for everyone, even when one screen simulates fewer frames', async (t) => {
  const { hub, host, guest } = await room(t);
  host.run('startRun()'); guest.run('startRun({ sync: true })');
  await until(() => guest.net.roundClock()?.active, 'shared round');
  hub.advance(3100);
  // A slow phone drops simulation steps and a backgrounded tab drops them all:
  // the host's aliens age 10 s of frames while the guest's age almost none.
  // Position must follow the shared round clock, not each screen's own age.
  // Both screens have generated the same stretch of course by now (one lookahead
  // step, exactly as running there would); only their own frame counts differ.
  for (const c of [host, guest]) c.run('G.player.x = 30000; generateAhead(); G.player.x = 30;');
  host.run('for (let i = 0; i < 600; i++) updateEnemies()');
  hub.advance(10000);
  host.run('updateEnemies()'); guest.run('updateEnemies()');
  const a = snapshot(host), b = snapshot(guest);
  const byKey = new Map(b.map((e) => [e.k, e]));
  const shared = a.filter((e) => byKey.has(e.k));
  assert.ok(shared.length >= 3, 'both screens should have the same aliens (' + shared.length + ')');
  assert.ok(shared.some((e) => e.k[0] === 'p') && shared.some((e) => e.k[0] === 's'), 'patrols and shooters are both covered');
  // Two screens' clocks agree to a few ms (host time vs. host time minus half an RTT). Time-to-next-shot
  // is a sawtooth that jumps by one interval at the instant of a shot, so compare it circularly (within
  // 50 ms of the same phase) rather than the on/off telegraph flag, which flips at its 0.4 s edge.
  const phase = (e) => { if (e.fireT === undefined) return 0; const d = Math.abs(e.fireT - byKey.get(e.k).fireT); return Math.min(d, e.ivl - d); };
  const drift = shared.map((e) => ({ k: e.k, dx: Math.abs(e.x - byKey.get(e.k).x), dy: Math.abs((e.y || 0) - (byKey.get(e.k).y || 0)), dt: phase(e) }));
  const bad = drift.filter((d) => d.dx > 12 || d.dy > 1.5 || d.dt > 0.05);
  assert.deepEqual(bad, [], 'aliens out of place between screens');
});

async function started(t) {
  const r = await room(t);
  r.host.run('startRun()'); r.guest.run('startRun({ sync: true })');
  await until(() => r.guest.net.roundClock()?.active, 'shared round');
  r.hub.advance(3100);
  for (const c of [r.host, r.guest]) c.run('G.player.x = 30000; generateAhead(); G.player.x = 30;');
  return r;
}
const shotCounts = (c) => Object.fromEntries(JSON.parse(c.run(`JSON.stringify(G.enemies.filter((e) => e.type === 'shoot' && e.rs).map((e) => [Math.round(e.rs.x0), e.rs.shots]))`)));

test('shooters fire on the round clock: the same number of shots on every screen', async (t) => {
  const { hub, host, guest } = await started(t);
  host.run('updateEnemies()'); guest.run('updateEnemies()');            // first sight: no burst of missed shots
  for (let i = 0; i < 400; i++) {                                        // 40 s of round time, in 100 ms polls
    hub.advance(100);
    host.run('updateEnemies()');
    if (i % 7 === 0) guest.run('updateEnemies()'); else if (i === 399) guest.run('updateEnemies()');   // guest polls far less often
  }
  const a = shotCounts(host), b = shotCounts(guest);
  const keys = Object.keys(a).filter((k) => k in b);
  assert.ok(keys.length >= 2, 'both screens have shooters (' + keys.length + ')');
  assert.ok(keys.some((k) => a[k] > 3), 'shooters actually fired over 40 s');
  // Same shots on every screen, give or take the one that straddles the final instant when the two
  // clocks are a few ms apart (never more than one, and most shooters exactly equal).
  const off = keys.map((k) => Math.abs(a[k] - b[k]));
  assert.ok(off.every((d) => d <= 1), 'shots per shooter differ by more than one: ' + JSON.stringify(keys.map((k) => [a[k], b[k]])));
  assert.ok(off.filter((d) => d === 0).length >= Math.ceil(keys.length * 0.6), 'most shooters should agree exactly');
});

test('a watcher sees aliens in their round-clock places and is never shot at by the bot', async (t) => {
  const { hub, host, guest } = await started(t);
  hub.advance(20000);
  host.run('updateEnemies()');
  guest.run('G.ebullets.length = 0; updateEnemies(true)');
  assert.equal(guest.run('G.ebullets.length'), 0, 'a spectator\'s stand-in never draws fire');
  const a = snapshot(host), b = new Map(snapshot(guest).map((e) => [e.k, e]));
  const shared = a.filter((e) => b.has(e.k) && e.k[0] === 'p');
  assert.ok(shared.length >= 3, 'aliens present (' + shared.length + ')');
  assert.deepEqual(shared.filter((e) => Math.abs(e.x - b.get(e.k).x) > 12).map((e) => e.k), []);
});

test('solo, daily and challenge runs keep their own per-frame alien motion', (t) => {
  const c = client(relay());
  t.after(() => c.close());
  c.run('startRun(); G.player.x = 20000; generateAhead(); G.player.x = 30;');
  assert.equal(c.run('G.sharedWorld'), false);
  c.run('for (let i = 0; i < 30; i++) updateEnemies()');
  assert.equal(c.run('G.enemies.length > 2 && G.enemies.every((e) => !e.rs)'), true);
});
