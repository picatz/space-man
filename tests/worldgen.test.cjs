// World gen 2 (src/worldgen.js + src/enemies.js). Like the other suites this runs
// the REAL game script in a vm (tests/harness.cjs); only browser APIs are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { client, relay, until } = require('./harness.cjs');

function solo(t, opts) { const c = client(relay(), opts); t.after(() => c.close()); return c; }
const json = (c, code) => JSON.parse(c.run(`JSON.stringify((() => { ${code} })())`));
const hash = (s) => createHash('sha256').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex').slice(0, 16);
function course() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'course.js'), 'utf8'), sandbox);
  return sandbox.window.SpaceManCourse;
}

// Stream a course to `meters` and keep EVERY slab, alien and pickup ever generated
// (the sim culls behind the player, so collect by identity as we go).
const STREAM = (start, meters, stride = 400) => `
  stats.mercy = false; stats.deadStreak = 0; ${start};
  const P = new Set(), E = new Set(), K = new Set(), lim = G.startX + ${meters} * 10;
  for (let x = 30; G.genX < lim; x += ${stride}) {
    G.player.x = x; generateAhead();
    for (const p of G.platforms) P.add(p); for (const e of G.enemies) E.add(e); for (const k of G.pickups) K.add(k);
  }
  const plats = [...P].sort((a, b) => a.x - b.x), foes = [...E], picks = [...K];`;

/* ---------------------------------------------------------------------------
   PLAYABILITY CHECKER — the real updatePlayer proves every slab is reachable.
   For each reachable slab A and each nearby slab B ahead of it, try real jumps
   off A (several takeoff points, hold lengths, holding right or coasting, and a
   plain walk-off) and see whether the sim lands on B SHRUNK by SAFETY px beyond
   cancelling ledge forgiveness on both sides — so every counted landing has at
   least SAFETY px to spare and never leans on the 12px forgiveness or coyote
   frames a real player also gets. Every generated slab must be reachable from
   the starters; a boost pad must never launch the player off its own slab. */
const SAFETY = 16;
const CHECKER = `
globalThis.__trial = (A, B2, tx, hold, coast) => {
  const p = G.player;
  Object.assign(p, { x: tx - p.w / 2, y: A.y - p.h, px: tx - p.w / 2, py: A.y - p.h, vx: CFG.maxRun, vy: 0, onGround: true, groundPlat: A,
    jumping: false, buffer: 0, coyote: 0, hang: null, dead: false, boostT: 0, airFrames: 0 });
  Object.assign(input, { right: true, left: false, jumpPressed: hold >= 0, jumpHeld: hold > 0, usingTouch: false, usingGamepad: false, down: false });
  for (let i = 0; i < 260; i++) {
    if (i >= hold) input.jumpHeld = false;
    if (coast && i >= 1) input.right = false;
    updatePlayer();
    if (p.onGround && i > 0) return p.groundPlat === B2;
    if (p.y > 900) return false;
  }
  return false;
};
globalThis.__edge = (A0, B) => {
  const A = Object.assign({}, A0, { boost: false, crumble: false }), cut = CFG.ledgeForgive + ${SAFETY};
  const B2 = newPlatform(B.x + cut, B.y, Math.max(12, B.w - 2 * cut));
  G.platforms = [A, B2];
  const lip = A.x + A.w, takeoffs = [lip];
  for (const d of [0, 50, 100, 150, 200, 260]) { const t = B.x - d; if (t > A.x + 8 && t < lip - 4) takeoffs.push(t); }
  for (const tx of takeoffs) for (const hold of [Infinity, 14, 8, 0, -1]) for (const coast of [false, true])
    if (__trial(A, B2, tx, hold, coast)) return true;
  return false;
};
globalThis.__check = (plats, first) => {
  G.mode = 'attract';                                    // no ledge-grab rescues: clean landings only
  const saved = G.platforms, reach = new Set([first]), bad = [];
  for (let i = plats.indexOf(first); i < plats.length; i++) {
    const A = plats[i];
    if (!reach.has(A)) continue;
    for (let j = i + 1; j < plats.length && j < i + 9; j++) {
      const B = plats[j];
      if (reach.has(B) || B.x - (A.x + A.w) > 420 || B.x + B.w < A.x + A.w - 40) continue;
      if (__edge(A, B)) reach.add(B);
    }
  }
  for (let i = plats.indexOf(first); i < plats.length; i++) if (!reach.has(plats[i])) bad.push([Math.round(plats[i].x), Math.round(plats[i].y), Math.round(plats[i].w)]);
  // Boost pads: running across one (jump held or not) must land back on the same slab.
  const boosts = [];
  for (const A0 of plats) if (A0.boost) for (const held of [false, true]) {
    const A = Object.assign({}, A0, { boostUsed: false }); G.platforms = [A];
    const p = G.player;
    Object.assign(p, { x: A.x + 2, y: A.y - p.h, px: A.x + 2, py: A.y - p.h, vx: CFG.maxRun, vy: 0, onGround: true, groundPlat: A, jumping: false, buffer: 0, coyote: 0, hang: null, dead: false, boostT: 0 });
    Object.assign(input, { right: true, left: false, jumpPressed: false, jumpHeld: held, usingTouch: false, usingGamepad: false });
    let launched = false, ok = false;
    for (let i = 0; i < 200; i++) { updatePlayer(); if (A.boostUsed) launched = true; if (launched && p.onGround) { ok = p.groundPlat === A; break; } if (p.y > 900) break; }
    if (launched && !ok) boosts.push([Math.round(A0.x), held]);
  }
  G.platforms = saved;
  return { bad, boosts, reached: reach.size };
};`;
function playable(c, start, meters) {
  c.run(CHECKER);
  return json(c, `${STREAM(start, meters)}
    const r = __check(plats, plats[3]);
    return Object.assign(r, { total: plats.length - 3, gen: G.gen, grav: G.gravMul });`);
}

test('playability: every generated slab is reachable with real jump physics and margin (many seeds)', (t) => {
  const c = solo(t);
  for (const seed of [1, 7, 99, 2024, 31337, 424242, 9001, 123456]) {
    const r = playable(c, `resetRun(${seed}, true)`, 5000);
    assert.equal(r.gen, 2);
    assert.ok(r.total > 90, `seed ${seed}: a real course (${r.total} slabs)`);
    assert.deepEqual(r.bad, [], `seed ${seed}: unreachable slabs [x, y, w]`);
    assert.deepEqual(r.boosts, [], `seed ${seed}: a boost pad threw the player off its slab`);
  }
});

test('playability: every daily theme is traversable, low gravity included', (t) => {
  const c = solo(t), C = course();
  // One date per theme (the theme rotates through all seven every week).
  const days = [], seen = new Set();
  for (let d = Date.UTC(2026, 9, 1); seen.size < C.THEMES.length; d += 86400000) {
    const day = new Date(d).toISOString().slice(0, 10), th = C.theme(day).id;
    if (!seen.has(th)) { seen.add(th); days.push(day); }
  }
  for (const day of days) {
    const r = playable(c, `resetRun(COURSE.daySeed('${day}'), true, courseWorld({ kind: 'daily', day: '${day}', gen: 2 }))`, 4000);
    assert.deepEqual(r.bad, [], `${day} (${C.theme(day).id}): unreachable slabs`);
    assert.deepEqual(r.boosts, [], `${day}: boost pads`);
    if (C.theme(day).grav) assert.equal(r.grav, C.theme(day).grav);
  }
});

test('the checker is a real test: an over-wide gap is caught', (t) => {
  const c = solo(t);
  c.run(CHECKER);
  const r = json(c, `resetRun(5, true);
    const A = newPlatform(0, 270, 300), B = newPlatform(300 + WORLD.reachAt(WORLD.physics(CFG, 1), 0) - 4, 270, 300);
    const C = newPlatform(300 + WORLD.reachAt(WORLD.physics(CFG, 1), 0) - 60, 270, 300);
    return { wide: __check([A, B], A).bad.length, fair: __check([A, C], A).bad.length };`);
  assert.equal(r.wide, 1, 'a gap inside true reach but inside the safety margin fails');
  assert.equal(r.fair, 0);
});

test('the generator’s physics table matches the real sim', (t) => {
  const c = solo(t);
  // Real updatePlayer: widest gap that a lip takeoff clears at each climb (no forgiveness).
  const r = json(c, `
    const lands = (gap, climb) => {
      resetRun(1); G.mode = 'attract';
      const A = newPlatform(0, 270, 400), B = newPlatform(400 + gap + CFG.ledgeForgive, 270 - climb, 300); G.platforms = [A, B];
      const p = G.player;
      Object.assign(p, { x: 400 - p.w / 2, y: 270 - p.h, vx: CFG.maxRun, vy: 0, onGround: true, groundPlat: A, hang: null, dead: false, boostT: 0, jumping: false, buffer: 0 });
      Object.assign(input, { right: true, left: false, jumpPressed: true, jumpHeld: true, usingTouch: false, usingGamepad: false });
      for (let i = 0; i < 200 && p.y < 700; i++) { updatePlayer(); if (p.onGround && i > 0) break; }
      return p.onGround && p.groundPlat === B;
    };
    const P = WORLD.physics(CFG, 1), out = [];
    for (const climb of [-120, -40, 0, 32, 80, 120]) { let g = 60; while (lands(g + 1, climb)) g++; out.push([climb, g, WORLD.reachAt(P, climb)]); }
    return out;`);
  for (const [climb, real, table] of r) assert.ok(Math.abs(real - table) <= 7, `climb ${climb}: real ${real} vs table ${table}`);
});

/* ---------------------------------------------------------------------------
   Determinism */
const TERRAIN = (start, noisy) => `
  stats.mercy = ${noisy}; stats.deadStreak = ${noisy ? 9 : 0}; ${start};
  const all = new Map(), foes = new Map(), picks = new Map();
  for (let x = 30; x < 42000; x += ${noisy ? 711 : 370}) {
    G.player.x = x;
    ${noisy ? `for (const e of G.enemies) if (!e.dead) killEnemy(e, 'stomp', false);
      burst(x, 200, 40, 3, 30, 3, '#fff', 0.1, 2); for (let j = 0; j < 53; j++) rng(); G.enemies = []; G.pickups = [];` : ''}
    generateAhead();
    for (const p of G.platforms) all.set(p.x, [p.x, p.y, p.w, !!p.boost, !!p.crumble]);
    for (const e of G.enemies) foes.set(e.type + e.x0 + ':' + e.x, [e.type, e.x0 ?? e.x, e.y, e.per ?? 0, e.ph ?? 0]);
    for (const k of G.pickups) picks.set(k.x + ',' + k.y, [k.type, k.x, k.y]);
  }
  const lim = (v) => v.filter((q) => (typeof q[0] === 'number' ? q[0] : q[1]) < 40000);
  return { p: lim([...all.values()]), e: ${noisy ? 'null' : 'lim([...foes.values()])'}, k: ${noisy ? 'null' : 'lim([...picks.values()])'}, gen: G.gen };`;

test('same seed, same world: identical across viewports, gameplay noise, mercy history and batch sizes', (t) => {
  const a = solo(t, { width: 1280, height: 720 }), b = solo(t, { width: 390, height: 844 });
  const start = 'resetRun(8675309, true)';
  const quiet = json(a, TERRAIN(start, false)), again = json(b, TERRAIN(start, false)), noisy = json(b, TERRAIN(start, true));
  assert.equal(quiet.gen, 2);
  assert.deepEqual(again, quiet);
  assert.deepEqual(noisy.p, quiet.p);
  assert.ok(quiet.e.length > 35 && quiet.k.length > 60, `${quiet.e.length} aliens, ${quiet.k.length} pickups`);
  assert.notDeepEqual(json(a, TERRAIN('resetRun(8675310, true)', false)).p, quiet.p);
});

test('room courses: two peers generate the identical gen-2 world, aliens included', async (t) => {
  const hub = relay(), host = client(hub), other = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); other.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false });
  await other.net.openRoom({ relayHost: 'relay.test', code: false });
  const a = json(host, TERRAIN('resetRun(4242)', false)), b = json(other, TERRAIN('resetRun(4242)', false));
  assert.equal(host.run('G.sharedWorld'), true);
  assert.equal(a.gen, 2);
  assert.deepEqual(b, a);
  assert.deepEqual(json(other, TERRAIN('resetRun(4242)', true)).p, a.p);
});

test('legacy links keep their gen-1 course; new links name gen 2', (t) => {
  const c = solo(t);
  const legacy = json(c, TERRAIN('resetRun(77, true, { gen: 1 })', false));
  const viaLink = json(c, TERRAIN("challenge = COURSE.parse('#seed=77&beat=500', Date.now()); startRun()", false));
  assert.equal(viaLink.gen, 1);
  assert.deepEqual(viaLink, legacy, 'a #seed= link without &v= is the original course');
  const v2 = json(c, TERRAIN("challenge = COURSE.parse('#seed=77&beat=500&v=2', Date.now()); startRun()", false));
  assert.equal(v2.gen, 2);
  assert.notDeepEqual(v2.p, legacy.p);
  // A daily link from before gen 2 (no &v=) replays that day's original course, untouched by any theme.
  const day = c.run('COURSE.dayKey(Date.now())');
  c.run(`challenge = COURSE.parse('#daily=${day}&beat=10', Date.now()); startRun()`);
  assert.deepEqual(json(c, 'return [G.gen, G.theme, G.gravMul, G.course.target]'), [1, null, 1, 10]);
});

/* ---------------------------------------------------------------------------
   Daily Course */
test('the designed daily: deterministic per UTC date, themed, and a different course every day', (t) => {
  const a = solo(t), b = solo(t), C = course();
  const start = (d) => `startRun({ course: dailyCourse('${d}') })`;
  const d1 = json(a, TERRAIN(start('2026-10-03'), false));
  assert.deepEqual(json(b, TERRAIN(start('2026-10-03'), false)), d1);
  assert.deepEqual(json(b, TERRAIN(start('2026-10-03'), true)).p, d1.p);
  assert.notDeepEqual(json(a, TERRAIN(start('2026-10-04'), false)).p, d1.p);
  assert.equal(json(a, `${start('2026-10-03')}; return G.theme.id`), C.theme('2026-10-03').id);
  assert.equal(a.run('G.gen'), 2);
  // Themes: pure data per date; each seven-day block runs all of them, never the same two days running.
  let prev = null;
  for (let d = Date.UTC(2026, 0, 1); d < Date.UTC(2028, 0, 1); d += 86400000) {
    const id = C.theme(new Date(d).toISOString().slice(0, 10)).id;
    assert.notEqual(id, prev, new Date(d).toISOString());
    prev = id;
  }
  const n0 = Math.ceil(Date.UTC(2026, 9, 1) / 86400000 / 7) * 7;
  const block = new Set(); for (let i = 0; i < 7; i++) block.add(C.theme(new Date((n0 + i) * 86400000).toISOString().slice(0, 10)).id);
  assert.equal(block.size, C.THEMES.length);
  for (const th of C.THEMES) { assert.ok(th.title && th.blurb.length > 20, th.id); for (const id of th.opener || []) assert.ok(json(a, `return !!WORLD.SEGMENTS['${id}']`), id); }
});

test('daily themes change the rules they promise', (t) => {
  const c = solo(t), C = course();
  const dayOf = (id) => { for (let d = Date.UTC(2026, 9, 1); ; d += 86400000) { const day = new Date(d).toISOString().slice(0, 10); if (C.theme(day).id === id) return day; } };
  const stats = (day) => json(c, `${STREAM(`startRun({ course: dailyCourse('${day}') })`, 2500)}
    const by = {}; for (const e of foes) by[e.type] = (by[e.type] || 0) + 1;
    return { foes: foes.length, shards: picks.filter((k) => k.type === 'shard').length, narrow: plats.filter((p) => p.w < 130).length,
      crumble: plats.filter((p) => p.crumble).length, boosts: plats.filter((p) => p.boost).length, grav: G.gravMul, flare: G.flareMul, by,
      first: Object.fromEntries(['shield', 'brute', 'turret'].map((k) => [k, Math.min(...foes.filter((e) => e.type === k).map((e) => (e.x - G.startX) / 10))])) };`);
  const base = json(c, `${STREAM('resetRun(COURSE.daySeed("2026-10-02"), true)', 2500)}
    return { foes: foes.length, shards: picks.filter((k) => k.type === 'shard').length, crumble: plats.filter((p) => p.crumble).length };`);
  assert.equal(stats(dayOf('moon')).grav, 0.8);
  assert.equal(stats(dayOf('burn')).flare, 1.06);
  assert.ok(stats(dayOf('burn')).boosts >= 3);
  assert.ok(stats(dayOf('swarm')).foes > base.foes * 1.2, 'swarm: more aliens');
  assert.ok(stats(dayOf('stars')).shards > base.shards * 1.5, 'star rush: more stars');
  assert.ok(stats(dayOf('meteor')).crumble > 0 && base.crumble === 0, 'meteor: crumbling slabs before 2500m');
  assert.ok(stats(dayOf('bridges')).narrow >= 8, 'sky bridges: narrow ledges');
  // Heavy metal: the armored aliens arrive well before they would on the same seed unthemed.
  const md = dayOf('metal'), metal = stats(md).first;
  const plain = json(c, `${STREAM(`resetRun(COURSE.daySeed('${md}'), true)`, 3500)}
    return Object.fromEntries(['shield', 'brute', 'turret'].map((k) => [k, Math.min(...foes.filter((e) => e.type === k).map((e) => (e.x - G.startX) / 10))]));`);
  for (const k of ['shield', 'brute', 'turret']) assert.ok(metal[k] < plain[k] - 200, `heavy metal: ${k} at ${metal[k]}m vs ${plain[k]}m`);
});

test('the Daily card names today’s theme', (t) => {
  const c = solo(t), C = course();
  c.run('renderDailyCard()');
  const th = C.theme(c.run('COURSE.dayKey(Date.now())'));
  assert.equal(c.elements.get('dailyTheme').textContent, th.title);
  assert.equal(c.elements.get('dailyBlurb').textContent, th.blurb);
});

/* ---------------------------------------------------------------------------
   Pacing: teach first, ramp in waves, breathe */
test('pacing: the opening teaches, new elements arrive on schedule, and there are always breathers', (t) => {
  const c = solo(t);
  for (const seed of [3, 17, 4040, 777777]) {
    const r = json(c, `${STREAM(`resetRun(${seed}, true)`, 6000)}
      const first = {}; for (const e of foes) { const d = (e.x0 ?? e.x) - G.startX; if (!(e.type in first) || d / 10 < first[e.type]) first[e.type] = d / 10; }
      return { log: G.wg.S.log, first, unlock: WORLD.UNLOCK, script: WORLD.SCRIPT.map((s) => s[0]) };`);
    const ids = r.log.map((s) => s.id);
    assert.deepEqual(ids.slice(0, 3), r.script.slice(0, 3), 'every run opens with the same lesson');
    // Each new alien: never before its unlock, and introduced within ~500m of it by its own intro set piece.
    const map = { shoot: 'shooter', diver: 'diver', shield: 'shield', bomber: 'bomber', brute: 'brute', turret: 'turret' };
    for (const [type, el] of Object.entries(map)) {
      assert.ok(r.first[type] >= r.unlock[el], `seed ${seed}: ${type} at ${r.first[type]}m before unlock ${r.unlock[el]}`);
      assert.ok(r.first[type] <= r.unlock[el] + 500, `seed ${seed}: ${type} first at ${r.first[type]}m (unlock ${r.unlock[el]})`);
      const intro = r.log.find((s) => s.focus === el && s.beat === 'teach');
      assert.ok(intro && intro.id.startsWith('intro'), `seed ${seed}: ${el} introduced by a teach set piece`);
    }
    // Breathers: never more than 6 set pieces without a rest, and the course keeps changing.
    let run = 0, worst = 0;
    for (const s of r.log) { run = s.beat === 'rest' ? 0 : run + 1; worst = Math.max(worst, run); }
    assert.ok(worst <= 6, `seed ${seed}: ${worst} set pieces without a breather`);
    for (let i = 1; i < r.log.length; i++) assert.notEqual(r.log[i].id === 'twist' ? null : r.log[i].id, r.log[i - 1].id, `seed ${seed}: the same set piece twice in a row at ${i}`);
    assert.ok(new Set(ids).size >= 24, `seed ${seed}: only ${new Set(ids).size} distinct set pieces in 6km`);
  }
});

test('difficulty climbs with distance (averaged over seeds), monotonic within tolerance', (t) => {
  const c = solo(t);
  const buckets = json(c, `
    const PH = WORLD.physics(CFG, 1), B = [];
    for (const seed of [11, 22, 33, 44, 55, 66, 77, 88]) {
      ${STREAM('resetRun(seed, true)', 5000)}
      for (let i = 1; i < plats.length; i++) {
        const a = plats[i - 1], b = plats[i], d = (b.x - G.startX) / 10, k = Math.floor(d / 500);
        if (d < 180 || b.x < a.x + a.w) continue;
        const r = WORLD.reachAt(PH, a.y - b.y);
        (B[k] = B[k] || { gap: 0, n: 0, foes: 0, ranged: 0 }).gap += (b.x - a.x - a.w) / r; B[k].n++;
      }
      for (const e of foes) { const k = Math.floor(((e.x0 ?? e.x) - G.startX) / 5000); if (B[k]) { B[k].foes++; if (e.type === 'shoot' || e.type === 'turret' || e.type === 'bomber') B[k].ranged++; } }
    }
    return B.slice(0, 10).map((b) => ({ gap: b.gap / b.n, foes: b.foes / 8 }));`);   // 0..5000m, whole buckets only
  if (process.env.WG_DEBUG) console.log(buckets);
  const top = { gap: 0, foes: 0 };
  buckets.forEach((b, i) => {
    assert.ok(b.gap >= top.gap - 0.05, `gaps eased off at ${i * 500}m: ${b.gap.toFixed(3)} vs ${top.gap.toFixed(3)}`);
    assert.ok(b.foes >= top.foes * 0.75 - 1, `aliens thinned out at ${i * 500}m: ${b.foes} vs ${top.foes}`);
    top.gap = Math.max(top.gap, b.gap); top.foes = Math.max(top.foes, b.foes);
  });
  assert.ok(buckets[buckets.length - 1].gap > buckets[0].gap + 0.1, 'late gaps are clearly harder than the opening');
  assert.ok(buckets[buckets.length - 1].foes > buckets[0].foes * 2, 'late stretches are clearly busier');
});

/* ---------------------------------------------------------------------------
   Fair spawns */
test('no unwinnable spawns: every alien is placed where it can be read and beaten', (t) => {
  const c = solo(t);
  for (const seed of [5, 50, 500, 5000, 65535]) {
    const r = json(c, `${STREAM(`resetRun(${seed}, true)`, 6000)}
      const bad = [], ids = new Set();
      const under = (x0, x1) => plats.filter((p) => p.x < x1 && p.x + p.w > x0);
      // Grounding per body: patrol-bodied aliens stand at slab-22 (the original patrol's convention).
      const foot = { patrol: 22, shield: 22, brute: 17, turret: 10 };
      const on = (e) => plats.find((p) => Math.abs(e.y + foot[e.type] - p.y) < 1.5 && e.x >= p.x && e.x <= p.x + p.w);
      for (const e of foes) {
        const id = enemyId(e);
        if (ids.has(id)) bad.push(['duplicate id', e.type, e.x]); ids.add(id);
        if (e.type === 'patrol' || e.type === 'shield' || e.type === 'brute') {
          const p = on(e);
          if (!p) { bad.push(['walker off a slab', e.type, e.x]); continue; }
          if (p.crumble) bad.push(['walker on a crumbling slab', e.type, e.x]);
          if (p.w < 150 || e.minX < p.x || e.maxX > p.x + p.w) bad.push(['walker lane leaves its slab', e.type, e.x]);
          if (e.type === 'brute' && (p.w < 400 || e.platX0 !== p.x || e.platY !== p.y)) bad.push(['brute arena too small', e.x]);
        }
        if (e.type === 'turret' && !on(e)) bad.push(['turret floating', e.x]);
        if (e.type === 'diver') {
          // The swoop only ever crosses the air of a jump: never a grounded player.
          const low = e.hy + e.depth + 4 + e.h / 2;
          for (const p of under(Math.min(e.hx, e.hx + e.span) - 13, Math.max(e.hx, e.hx + e.span) + 13))
            if (low > p.y - CFG.ph - 4) bad.push(['diver clips grounded player', e.x, p.x]);
        }
        if (e.type === 'bomber') for (const p of under(e.minX - 15, e.maxX + 15)) if (e.baseY + 3 + e.h / 2 > p.y - CFG.ph - 60) bad.push(['bomber too low', e.x]);
      }
      // Pressure caps: at most 9 aliens in any 1400px stretch, at most 2 ranged in any 600px.
      const xs = foes.map((e) => [e.x0 ?? e.x, e.type]).sort((a, b) => a[0] - b[0]);
      let crowd = 0, ranged = 0;
      for (let i = 0, j = 0, k = 0; i < xs.length; i++) {
        while (xs[j][0] < xs[i][0] - 1400) j++;
        crowd = Math.max(crowd, i - j + 1);
      }
      const rx = xs.filter((q) => q[1] === 'shoot' || q[1] === 'turret' || q[1] === 'bomber').map((q) => q[0]);
      for (let i = 0, j = 0; i < rx.length; i++) { while (rx[j] < rx[i] - 600) j++; ranged = Math.max(ranged, i - j + 1); }
      return { bad: bad.slice(0, 6), crowd, ranged, types: [...new Set(foes.map((e) => e.type))].sort() };`);
    assert.deepEqual(r.bad, [], `seed ${seed}`);
    assert.ok(r.crowd <= 9, `seed ${seed}: ${r.crowd} aliens in one screen-and-a-half`);
    assert.ok(r.ranged <= 2, `seed ${seed}: ${r.ranged} ranged aliens within 600px`);
    assert.deepEqual(r.types, ['bomber', 'brute', 'diver', 'patrol', 'shield', 'shoot', 'turret']);
  }
});

/* ---------------------------------------------------------------------------
   New aliens: behavior and counters (real sim) */
test('each new alien telegraphs before it acts, and its counter works', (t) => {
  const c = solo(t);
  const r = json(c, `
    resetRun(3, true); G.mode = 'play'; G.enemies = []; G.ebullets = []; G.bullets = [];
    const pl = newPlatform(0, 270, 520); G.platforms = [pl];
    const p = G.player; Object.assign(p, { x: 20, y: 270 - p.h, vx: 0, vy: 0, onGround: true, groundPlat: pl, dead: false, hang: null });
    const out = {};
    // DIVER: hover → telegraph (≥0.6 s) → swoop; the pose is a pure function of the clock.
    const dv = { type: 'diver', v2: true, x: 0, y: 0, px: 0, py: 0, x0: 300, w: 26, h: 20, hx: 300, hy: 100, span: 200, depth: 72, per: 200, ph: 0, ev: -1, state: -1, hurt: 0, hp: 1, telegraph: 0, dead: false };
    const seq = []; for (let T = 0; T < 400; T++) { FOES.step(dv, T, 0, 0); if (seq[seq.length - 1] !== dv.state) seq.push(dv.state); }
    const a = Object.assign({}, dv); FOES.step(a, 333.5, 0, 0); const b = Object.assign({}, dv, { state: -1 }); FOES.step(b, 12, 0, 0); FOES.step(b, 333.5, 0, 0);
    let telSteps = 0; const d2 = Object.assign({}, dv, { state: -1 }); for (let T = 0; T < 200; T++) { FOES.step(d2, T, 0, 0); if (d2.state === 1) telSteps++; }
    out.diver = { seq: seq.slice(0, 5), pure: a.x === b.x && a.y === b.y, telSteps, low: Math.max(...Array.from({ length: 400 }, (_, T) => (FOES.step(d2, T, 0, 0), d2.y))) };
    // SHIELD: a frontal shot bounces, a shot in the back or a stomp kills.
    const sh = () => ({ type: 'shield', v2: true, x: 200, y: 248, px: 200, py: 248, x0: 200, w: 24, h: 22, minX: 16, maxX: 504, dir0: -1, dir: -1, speed: 0, ph: 0, ev: -1, hurt: 0, hp: 1, telegraph: 0, dead: false, lookX: 0, lookY: 0 });
    const shoot = (e, fromLeft) => { G.enemies = [e]; G.bullets = [{ x: e.x + (fromLeft ? -8 : 8), px: e.x, y: e.y, vx: fromLeft ? CFG.pBulletSpeed : -CFG.pBulletSpeed, life: 90 }]; updateBullets(); return e.dead; };
    const s1 = sh(); const front = shoot(s1, true);
    const s2 = sh(); s2.dir = 1; const back = shoot(s2, true);
    const s3 = sh(); G.enemies = [s3]; Object.assign(p, { x: s3.x - p.w / 2, y: s3.y - s3.h / 2 - p.h + 6, vy: 4, dead: false }); collisions(); const stomped = s3.dead;
    out.shield = { front, back, stomped };
    // BRUTE: three shots, the first two soaked by armor.
    const br = { type: 'brute', v2: true, x: 300, y: 253, px: 300, py: 253, x0: 300, w: 36, h: 34, minX: 34, maxX: 486, dir0: -1, speed: 0.45, per: 220, ph: 0, ev: -1, hp: 3, hurt: 0, telegraph: 0,
      platX0: 0, platX1: 520, platY: 270, slamT: -1, waveL: NaN, waveR: NaN, dead: false, lookX: 0, lookY: 0 };
    const hits = []; for (let i = 0; i < 3; i++) { Object.assign(p, { dead: false }); hits.push(shoot(br, true)); }
    // Its shockwave: telegraph first, then a wave that kills a grounded player on the slab and passes under a jump.
    const bw = Object.assign({}, br, { hp: 3, dead: false, ev: -1 }); let tel = -1, slam = -1;
    for (let T = 0; T < 260; T++) { const ev = FOES.step(bw, T, 0, 0); if ((ev & FOES.EV.TEL) && tel < 0) tel = T; if ((ev & FOES.EV.SLAM) && slam < 0) slam = T; }
    FOES.step(bw, slam + 10, 0, 0);
    const wx = bw.waveR, grounded = FOES.waveHits(bw, wx, 270), airborne = FOES.waveHits(bw, wx, 230), elsewhere = FOES.waveHits(bw, wx, 200);
    G.enemies = [bw]; Object.assign(p, { x: wx - p.w / 2, y: 270 - p.h, vy: 0, onGround: true, dead: false }); collisions(); const killedByWave = p.dead;
    out.brute = { hits, tel, slam, grounded, airborne, elsewhere, killedByWave, telLead: slam - tel };
    // BOMBER: reticle (telegraph) then a bomb that falls onto the slab below and bursts.
    Object.assign(p, { dead: false, x: 100, y: 270 - p.h, onGround: true });
    const bm = { type: 'bomber', v2: true, x: 300, y: 130, px: 300, py: 130, x0: 300, w: 30, h: 16, minX: 300, maxX: 300, dir0: -1, speed: 0, baseY: 130, per: 120, f0: 60, ph: 0, ev: -1, age: 0, hurt: 0, hp: 1, telegraph: 0, dead: false, lookX: 0, lookY: 0 };
    G.enemies = [bm]; G.ebullets = []; let bt = -1, drop = -1;
    for (let i = 0; i < 70; i++) { updateEnemies(); if (bm.telegraph > 0 && bt < 0) bt = i; if (G.ebullets.length && drop < 0) drop = i; }
    let burst = false; for (let i = 0; i < 120 && G.ebullets.length; i++) updateBullets(); burst = G.ebullets.length === 0;
    Object.assign(p, { x: 300 - p.w / 2, dead: false }); G.ebullets = [{ x: 300, y: 250, px: 300, py: 250, vx: 0, vy: 3, g: 0.16, bomb: true, life: 100, grazed: false }];
    for (let i = 0; i < 30 && G.ebullets.length; i++) updateBullets();
    out.bomber = { bt, drop, burst, blast: p.dead };
    // TURRET: turns at a capped rate, paints a laser (telegraph) before each shot, two shots to drop.
    Object.assign(p, { dead: false, x: 60, y: 270 - p.h });
    const tu = { type: 'turret', v2: true, x: 400, y: 260, px: 400, py: 260, x0: 400, w: 26, h: 20, per: 100, f0: 50, ph: 0, ev: -1, aim: 0, hp: 2, hurt: 0, telegraph: 0, dead: false, lookX: 0, lookY: 0 };
    const aims = []; for (let T = 0; T < 5; T++) { FOES.step(tu, T, 72, 253); aims.push(tu.aim); }
    const tHits = [shoot(tu, true)]; Object.assign(p, { dead: false }); tHits.push(shoot(tu, true));
    out.turret = { turn: Math.max(...aims.slice(1).map((a, i) => Math.abs(a - aims[i]))), hits: tHits, hurtFirst: tHits[0] === false };
    return out;`);
  assert.deepEqual(r.diver.seq, [0, 1, 2, 0, 1], 'hover → telegraph → swoop, repeating');
  assert.ok(r.diver.pure, 'diver pose depends only on the clock');
  assert.ok(r.diver.telSteps >= 36, 'a readable telegraph (>0.6 s)');
  assert.deepEqual(r.shield, { front: false, back: true, stomped: true });
  assert.deepEqual(r.brute.hits, [false, false, true]);
  assert.ok(r.brute.telLead >= 40, 'fists up for 0.7 s before the slam');
  assert.deepEqual([r.brute.grounded, r.brute.airborne, r.brute.elsewhere, r.brute.killedByWave], [true, false, false, true]);
  assert.ok(r.bomber.bt >= 0 && r.bomber.drop > r.bomber.bt + 20, 'reticle well before the drop');
  assert.ok(r.bomber.burst && r.bomber.blast);
  assert.ok(r.turret.turn <= 0.0301, 'slow tracking');
  assert.deepEqual(r.turret.hits, [false, true]);
});

test('Run Together: new aliens are in the same place and act on the same beat on every screen', async (t) => {
  const hub = relay(), host = client(hub), guest = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  host.run('startRun()'); guest.run('startRun({ sync: true })');
  await until(() => guest.net.roundClock()?.active, 'shared round');
  hub.advance(3100);
  for (const c of [host, guest]) c.run('G.player.x = 60000; generateAhead(); G.player.x = 30;');
  const snap = (c) => JSON.parse(c.run(`JSON.stringify(G.enemies.filter((e) => e.v2 && !e.dead).map((e) => [enemyId(e), e.type, e.x, e.y, e.telegraph, e.ev, e.type === 'brute' ? [e.waveL, e.waveR] : 0]))`));
  host.run('updateEnemies()'); guest.run('updateEnemies()');
  host.run('for (let i = 0; i < 600; i++) updateEnemies()');            // the host simulates 10 s of frames, the guest none
  hub.advance(7000);
  host.run('updateEnemies()'); guest.run('updateEnemies()');
  const a = snap(host), b = new Map(snap(guest).map((e) => [e[0], e]));
  const shared = a.filter((e) => b.has(e[0]));
  assert.ok(shared.length >= 12, 'both screens have the new aliens (' + shared.length + ')');
  assert.deepEqual([...new Set(shared.map((e) => e[1]))].sort(), ['bomber', 'brute', 'diver', 'shield', 'turret']);
  // Two clocks agree to a few ms: positions to a few px, schedules to within one event at a boundary.
  const off = shared.filter((e) => { const g = b.get(e[0]); return Math.abs(e[2] - g[2]) > 12 || Math.abs(e[3] - g[3]) > 6 || Math.abs(e[5] - g[5]) > 1; });
  assert.deepEqual(off.map((e) => [e, b.get(e[0])]), [], 'aliens out of place between screens');
  assert.equal(guest.run('G.enemies.every((e) => !e.v2 || e.x0 !== undefined)'), true);
  // A kill travels by id like the originals: the guest's copy goes too.
  const id = shared.find((e) => e[1] === 'diver')[0];
  guest.run(`G.player.x = G.enemies.find((e) => enemyId(e) === ${id}).x - 200; netTick(0.2)`);
  host.run(`G.player.x = G.enemies.find((e) => enemyId(e) === ${id}).x - 200; netTick(0.2)`);
  host.run(`killEnemy(G.enemies.find((e) => enemyId(e) === ${id}), 'shoot', false)`);
  await until(() => guest.run(`G.enemies.some((e) => enemyId(e) === ${id} && e.dead)`), 'kill reaches the guest', 3000);
});

test('the new aliens and their effects draw without error', (t) => {
  const c = solo(t);
  const errs = json(c, `
    resetRun(8, true); G.mode = 'play';
    for (let x = G.player.x; x < G.startX + 30000; x += 400) { G.player.x = x; generateAhead(); }
    const types = new Set();
    for (const e of G.enemies) if (e.v2) { types.add(e.type); for (let T = 0; T < 400; T += 13) { FOES.step(e, T, e.x - 100, e.y); G.camX = e.x - 200; render(1); } }
    G.ebullets.push({ x: G.camX + 100, y: 100, px: G.camX + 100, py: 100, vx: 0, vy: 1, g: 0.16, bomb: true, life: 10, grazed: false }); render(1);
    return { errs: window.__errors, types: [...types].sort() };`);
  assert.deepEqual(errs.errs, []);
  assert.ok(errs.types.length >= 4, errs.types.join());
});

/* ---------------------------------------------------------------------------
   Review follow-ups (PR #19) */
const dayWithTheme = (C, id) => { for (let d = Date.UTC(2026, 9, 1); ; d += 86400000) { const k = new Date(d).toISOString().slice(0, 10); if (C.theme(k).id === id) return k; } };

test('a same-day Daily record from the gen-1 Daily never becomes the gen-2 course’s best or target', (t) => {
  const c = solo(t);
  const day = c.run('COURSE.dayKey(Date.now())');
  // What the previous build wrote on an upgrade day: no generator field (= gen 1).
  c.run(`saveJSON(LS.daily, { day: '${day}', best: 777, bestDist: 90, runs: 4 })`);
  c.run('renderDailyCard()');
  assert.equal(c.elements.get('dailyInfo').textContent, 'NEW TODAY', 'the card must not show a best from a different course');
  assert.equal(c.run('dailyCourse().target'), 0, 'the old score is not the themed course’s target');
  c.run('startRun({ course: dailyCourse() }); G.score = 300; G.dist = 40; G.finalScore = undefined; finalizeDeath();');
  assert.deepEqual(json(c, 'return loadJSON(LS.daily, null)'), { day, best: 300, bestDist: 40, runs: 1, gen: 2 }, 'a fresh, versioned record');
  // An old gen-1 #daily= link for today replays gen 1 and leaves today's gen-2 record alone.
  c.run(`challenge = COURSE.parse('#daily=${day}&beat=5', Date.now()); startRun(); G.score = 9999; G.dist = 900; G.finalScore = undefined; finalizeDeath();`);
  assert.equal(c.run('G.gen'), 1);
  assert.deepEqual(json(c, 'return loadJSON(LS.daily, null)'), { day, best: 300, bestDist: 40, runs: 1, gen: 2 });
  // A record from any other generator is ignored the same way.
  c.run(`saveJSON(LS.daily, { day: '${day}', best: 50, bestDist: 5, runs: 1, gen: 7 })`);
  assert.equal(c.run('loadDaily().best'), 0);
});

test('every Daily theme opens with its own set piece, and the checker walks it', (t) => {
  const c = solo(t), C = course();
  c.run(CHECKER);
  for (const th of C.THEMES) {
    assert.ok(th.opener && th.opener.length > 0, `${th.id}: an opening set piece`);
    const day = dayWithTheme(C, th.id);
    const r = json(c, `${STREAM(`startRun({ course: dailyCourse('${day}') })`, 900)}
      const ids = G.wg.S.log.map((s) => s.id);
      return { ids: ids.slice(0, 6), check: __check(plats, plats[3]) };`);
    for (const id of th.opener) assert.ok(r.ids.includes(id), `${th.id}: opener ${id} runs early (${r.ids.join(', ')})`);
    assert.deepEqual(r.check.bad, [], `${th.id}: the opening is traversable`);
  }
});

test('METEOR FIELD keeps its promise: cracked slabs inside the first sector', (t) => {
  const c = solo(t), C = course(), day = dayWithTheme(C, 'meteor');
  assert.match(C.theme(day).blurb, /first sector/);
  const first = json(c, `${STREAM(`startRun({ course: dailyCourse('${day}') })`, 1200)}
    return Math.min(...plats.filter((p) => p.crumble).map((p) => (p.x - G.startX) / 10));`);
  assert.ok(first < 300, `first cracked slab at ${first}m, but the first sector ends at 300m`);
});

test('docs name the current protocol version everywhere the wire carries it', () => {
  const PROTO = +/const PROTO = (\d+);/.exec(fs.readFileSync(path.join(__dirname, '..', 'src', 'net.js'), 'utf8'))[1];
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'wire-protocol.md'), 'utf8'), lines = doc.split('\n');
  const hex = '0x' + PROTO.toString(16).padStart(2, '0');
  assert.match(doc, new RegExp('\\*\\*Protocol version:\\*\\* `' + PROTO + '`'));
  const layout = lines.filter((l) => /^\d+\s+1\s+0x[0-9a-f]{2}\s+(envelope )?version\b/i.test(l));
  assert.ok(layout.length >= 2, 'the S and C envelope layouts');
  for (const l of layout) assert.ok(l.includes(hex), 'layout byte must be ' + hex + ': ' + l);
  for (const l of lines.filter((l) => /`ver|byte 1 ≠/.test(l) && /(=|≠)\s*`?\d/.test(l) && !/PROTO/.test(l))) assert.fail('a version byte that does not name PROTO: ' + l);
  assert.ok(doc.includes('`ver(1)=PROTO (currently ' + hex + ')'), 'AAD version byte');
});

test('README documents the current link formats with &v=2 and the legacy form without it', () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8'), C = course(), now = Date.UTC(2026, 8, 30);
  const daily = /`(#daily=YYYY-MM-DD&beat=<score>&v=2)`/.exec(readme), seed = /`(#seed=<n>&beat=<score>&v=2)`/.exec(readme);
  assert.ok(daily && seed, 'both current formats carry &v=2');
  assert.equal(C.parse(daily[1].replace('YYYY-MM-DD', '2026-09-30').replace('<score>', '5'), now).gen, 2);
  assert.equal(C.parse(seed[1].replace('<n>', '7').replace('<score>', '5'), now).gen, 2);
  assert.match(readme, /without `&v=`[^.]*(original|legacy)/i, 'explains the legacy form');
});
