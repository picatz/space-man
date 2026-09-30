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

// Compare two screens' aliens: same lane/spawn identity → same place (patrol x, shooter y) and same phase
// of the shot cycle. Two clocks agree to a few ms (host time vs. host time minus half an RTT); time-to-next-shot
// is a sawtooth that jumps by one interval at the instant of a shot, so compare it circularly (within 50 ms
// of the same phase) rather than the on/off telegraph flag, which flips at its 0.4 s edge.
function drifts(a, b) {
  const byKey = new Map(b.map((e) => [e.k, e]));
  const shared = a.filter((e) => byKey.has(e.k));
  const phase = (e) => { if (e.fireT === undefined) return 0; const d = Math.abs(e.fireT - byKey.get(e.k).fireT); return Math.min(d, e.ivl - d); };
  const bad = shared.map((e) => ({ k: e.k, dx: Math.abs(e.x - byKey.get(e.k).x), dy: Math.abs((e.y || 0) - (byKey.get(e.k).y || 0)), dt: phase(e) }))
    .filter((d) => d.dx > 12 || d.dy > 1.5 || d.dt > 0.05);
  return { shared, bad };
}

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
  const { shared, bad } = drifts(snapshot(host), snapshot(guest));
  assert.ok(shared.length >= 3, 'both screens should have the same aliens (' + shared.length + ')');
  assert.ok(shared.some((e) => e.k[0] === 'p') && shared.some((e) => e.k[0] === 's'), 'patrols and shooters are both covered');
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
// Count real shots, not the schedule index: wrap enemyFire so every bullet an alien emits is tallied by alien.
const countFires = (c) => c.run('window.__fires = {}; { const real = enemyFire; enemyFire = (e) => { const k = enemyId(e); window.__fires[k] = (window.__fires[k] || 0) + 1; real(e); }; }');
const firesOf = (c) => JSON.parse(c.run('JSON.stringify(window.__fires)'));

test('shooters fire on the round clock: the same number of shots on every screen', async (t) => {
  const { hub, host, guest } = await started(t);
  host.run('updateEnemies()'); guest.run('updateEnemies()');            // first sight: no burst of missed shots
  countFires(host); countFires(guest);
  for (let i = 0; i < 400; i++) {                                        // 40 s of round time, in 100 ms polls
    hub.advance(100);
    host.run('updateEnemies()');
    if (i % 7 === 0 || i === 399) guest.run('updateEnemies()');          // guest polls far less often
  }
  const a = firesOf(host), b = firesOf(guest);
  const keys = Object.keys(a).filter((k) => k in b);
  assert.ok(keys.length >= 2, 'both screens fire from the same shooters (' + keys.length + ')');
  assert.ok(keys.some((k) => a[k] > 3), 'shooters actually fired over 40 s');
  // A slow poller can skip several intervals and fire once (that's the design: never a burst), so it may
  // emit fewer bullets than the host: it is always aligned to the same schedule, never ahead of it.
  assert.ok(keys.every((k) => b[k] <= a[k] + 1), 'a screen must never fire ahead of the round clock: ' + JSON.stringify(keys.map((k) => [a[k], b[k]])));
  const fast = firesOf(host);
  assert.ok(Object.keys(fast).length >= 2 && Object.values(fast).every((n) => n >= 1));
});

test('two screens that both poll often fire exactly the same shots', async (t) => {
  const { hub, host, guest } = await started(t);
  host.run('updateEnemies()'); guest.run('updateEnemies()');
  countFires(host); countFires(guest);
  for (let i = 0; i < 300; i++) { hub.advance(100); host.run('updateEnemies()'); guest.run('updateEnemies()'); }
  const a = firesOf(host), b = firesOf(guest);
  const keys = Object.keys(a).filter((k) => k in b);
  assert.ok(keys.length >= 2 && keys.some((k) => a[k] > 3), 'shooters fired (' + keys.length + ')');
  const off = keys.map((k) => Math.abs(a[k] - b[k]));
  assert.ok(off.every((d) => d <= 1), 'off by more than one shot: ' + JSON.stringify(keys.map((k) => [a[k], b[k]])));
  assert.ok(off.filter((d) => d === 0).length >= Math.ceil(keys.length * 0.6), 'most shooters agree exactly');
});

test('a real spectator sees aliens in their round-clock places and its stand-in never draws fire', async (t) => {
  const hub = relay(), host = client(hub), guest = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1, role: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  guest.run('startRun({ watch: true, sync: true })'); host.run('startRun()');
  await until(() => guest.net.roundClock()?.active, 'shared round');
  hub.advance(3100);
  assert.equal(guest.run('netSpectating()'), true);
  // The host runs somewhere with a good cluster of aliens; the spectator follows it, so its world (and
  // aliens) generate there. Pick the spot from the aliens themselves so the test doesn't depend on the seed.
  const X = JSON.parse(host.run(`JSON.stringify((() => {
    G.player.x = 30000; generateAhead(); G.player.x = 30;
    const xs = G.enemies.filter((e) => e.x > 4000 && e.x < 16000).map((e) => e.x);
    const shooters = G.enemies.filter((e) => e.type === 'shoot' && e.x > 4000 && e.x < 16000).map((e) => e.x);
    let best = shooters[0], bestN = -1;   // centre on a shooter (one is always in view) with the most company: the spectator sees [X-900, X+1400]
    for (const x of shooters) { const n = xs.filter((y) => y > x - 800 && y < x + 1300).length; if (n > bestN) { best = x; bestN = n; } }
    return Math.round(best);
  })())`));
  const showHost = async () => {
    for (let k = 0; ; k++) {
      host.net.sendPresence(X, 240, 0, 11, 0, 900, 797);
      await host.net._n1.session()._snapTick();
      try { await until(() => guest.net.presence().some((p) => p.x === X && p.state === 11), 'host ghost fresh', 1500); break; }
      catch (e) { if (k >= 3) throw e; }
    }
    guest.run('netTick(.1)');
  };
  await showHost();
  guest.run('update(); update()');                                       // the normal path: updateSpectator → updateEnemies(true)
  assert.equal(guest.run('watchedGhost() !== null'), true, 'the spectator is following the host');
  const shooters = () => JSON.parse(guest.run(`JSON.stringify(G.enemies.filter((e) => e.type === 'shoot' && e.rs).map((e) => e.rs.shots))`));
  const before = shooters();
  assert.ok(before.length >= 1, 'the spectator has shooters (' + before.length + ')');
  hub.advance(20000); await showHost();
  host.run('updateEnemies()'); guest.run('update()');
  hub.advance(3000); await showHost();
  host.run('updateEnemies()'); guest.run('update()');
  assert.ok(shooters().some((n, i) => n > before[i]), 'shot schedules advanced on the spectator, so the test crossed real shot boundaries');
  assert.equal(guest.run('G.ebullets.length'), 0, 'a spectator\'s stand-in never draws fire');
  const { shared, bad } = drifts(snapshot(host), snapshot(guest));
  assert.ok(shared.length >= 2, 'aliens present on both (' + shared.length + ')');
  assert.deepEqual(bad, [], 'the spectator\'s aliens sit where the host\'s do');
});

test('solo, daily and challenge runs keep their own per-frame alien motion', (t) => {
  const c = client(relay());
  t.after(() => c.close());
  c.run('startRun(); G.player.x = 20000; generateAhead(); G.player.x = 30;');
  assert.equal(c.run('G.sharedWorld'), false);
  c.run('for (let i = 0; i < 30; i++) updateEnemies()');
  assert.equal(c.run('G.enemies.length > 2 && G.enemies.every((e) => !e.rs)'), true);
});

// ---- shared kills ---------------------------------------------------------------------------
const aliveIds = (c) => JSON.parse(c.run(`JSON.stringify(G.enemies.filter((e) => !e.dead).map((e) => enemyId(e)))`));
const isDead = (c, id) => c.run(`G.enemies.some((e) => enemyId(e) === ${id} && e.dead)`);
async function killable(t) {
  const r = await started(t);
  r.hub.advance(20000);                                   // round time long enough that x≈10000 is reachable at run speed
  r.host.run('updateEnemies()'); r.guest.run('updateEnemies()');
  const ids = aliveIds(r.host).filter((id) => aliveIds(r.guest).includes(id) && id / 8 < 16000);
  assert.ok(ids.length >= 3, 'aliens on both screens (' + ids.length + ')');
  return { ...r, ids };
}
// Where the reporter says it is: hosts believe a kill only near the reporter's own last position.
async function standAt(r, c, id) {
  c.net.sendPresence(id / 8, 200, 0, 11, 0, 100, Math.round(id / 80));
  await until(() => r.host.net.presence().some((p) => p.p === 2 && Math.abs(p.x - id / 8) < 1), 'presence arrives');
}

test('an alien one player kills is gone for everyone (guest → host → other guests)', async (t) => {
  const r = await killable(t), { host, guest, ids } = r;
  const id = ids[0];
  await standAt(r, guest, id);
  guest.run(`killEnemy(G.enemies.find((e) => enemyId(e) === ${id}), 'shoot', false)`);
  await until(() => isDead(host, id), 'host sees the kill');
  assert.equal(host.run('G.killsRun'), 0, 'the host earns nothing for the guest\'s kill');
  assert.equal(host.run('G.score'), 0);
  assert.equal(isDead(guest, id), true);
});

test('and the other way: the host\'s kill reaches guests', async (t) => {
  const r = await killable(t), { host, guest, ids } = r;
  const id = ids[1];
  host.run(`killEnemy(G.enemies.find((e) => enemyId(e) === ${id}), 'stomp', false)`);
  await until(() => isDead(guest, id), 'guest sees the host\'s kill');
  assert.equal(guest.run('G.killsRun'), 0);
});

test('a kill for an alien this screen has not generated yet is remembered, never resurrected', async (t) => {
  const r = await killable(t), { host, guest, ids } = r;
  const id = ids[2];
  // The guest's copy doesn't exist yet: take it out, deliver the kill, then let it "spawn".
  guest.run(`window.__copy = G.enemies.find((e) => enemyId(e) === ${id}); G.enemies = G.enemies.filter((e) => enemyId(e) !== ${id});`);
  host.run(`killEnemy(G.enemies.find((e) => enemyId(e) === ${id}), 'stomp', false)`);
  await until(() => guest.run(`G.remoteKilled.has(${id})`), 'remembered');
  guest.run('const c = window.__copy; delete c.rs; c.dead = false; G.enemies.push(c); updateEnemies();');
  assert.equal(guest.run(`G.enemies.some((e) => enemyId(e) === ${id} && !(e.dead && e.squash > 2))`), false, 'it must not appear');
});

test('the host only believes kills near the reporter, in the current round, once, and from players', async (t) => {
  const r = await killable(t), { hub, host, guest, ids } = r;
  const hs = host.net._n1.session(), gs = guest.net._n1.session();
  const { kill } = guest.net._room, { sealApp } = guest.net._n1.env;
  const seen = [];
  host.net.onEvent((e, d) => { if (e === 'kill') seen.push(d.id); });
  const send = async (buf) => gs.relay.send(gs.inv.hostPub, await sealApp(gs.pair, buf));
  const near = ids[0], far = ids.reduce((a, b) => Math.abs(b / 8 - near / 8) > Math.abs(a / 8 - near / 8) ? b : a);
  assert.ok(Math.abs(far - near) / 8 > kill.KILL_REACH, 'a far alien exists for the test');
  await standAt(r, guest, near);
  const runId = host.net.info().runId;
  await send(kill.encKill(gs.out, runId, far).slice());                       // too far from the reporter
  await send(kill.encKill(gs.out, (runId + 1) & 0xff, near).slice());         // wrong round
  await send(kill.encKill(gs.out, runId, near).slice());                      // good
  await send(kill.encKill(gs.out, runId, near).slice());                      // duplicate
  await until(() => seen.length >= 1, 'the believable kill arrives');
  await new Promise((res) => setTimeout(res, 100));
  assert.deepEqual(seen, [near], 'only the near, current-round, first report is accepted');
  const strikes = [...hs.roster.values()][0].strikes;
  assert.equal(strikes, 0, 'unbelievable kills are dropped, not struck');
  await send(kill.encKillB(gs.out, 2, runId, near).slice());                  // a guest forging the host's fan-out
  await until(() => [...hs.roster.values()][0].strikes === 1, 'forged host frame is a strike');
});

test('a spectator that reports a kill is struck', async (t) => {
  const r = await killable(t), { host, guest } = r;
  const hs = host.net._n1.session(), gs = guest.net._n1.session();
  const { kill } = guest.net._room, { sealApp } = guest.net._n1.env;
  [...hs.roster.values()][0].role = 1;                                        // the host has this guest as a spectator
  gs.relay.send(gs.inv.hostPub, await sealApp(gs.pair, kill.encKill(gs.out, host.net.info().runId, 8000).slice()));
  await until(() => [...hs.roster.values()][0].strikes === 1, 'spectator-kill strike');
});
