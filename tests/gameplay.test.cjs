// Solo gameplay regression tests. Like multiplayer.test.cjs these run the REAL
// game script inside a node vm (tests/harness.cjs); only browser APIs are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { client, relay } = require('./harness.cjs');

function solo(t, opts) {
  const c = client(relay(), opts);
  t.after(() => c.close());
  return c;
}
const json = (c, code) => JSON.parse(c.run(`JSON.stringify((() => { ${code} })())`));

// Every tuning row a course can roll: the eight bands plus each endgame ramp step.
const TUNINGS = 'BANDS.concat(RAMP.slice(1))';
// Pixels of slack a full-speed held jump must keep over the worst gap, measured
// with NO ledge forgiveness on either end (the real game adds 12px each side
// plus 6 coyote frames, so actual slack is larger).
const SAFETY = 24;

test('a full-speed held jump clears every band and ramp step with margin', (t) => {
  const c = solo(t);
  // Real updatePlayer(): run off the lip of A at max speed holding jump, and see
  // whether we land on B placed `gap` px further (its ledge forgiveness cancelled).
  c.run(`globalThis.__lands = (gap, climb) => {
    resetRun(1); G.mode = 'attract';                     // not 'play': no ledge grab rescue
    const A = newPlatform(0, 270, 400), B = newPlatform(400 + gap + CFG.ledgeForgive, 270 - climb, 300);
    G.platforms = [A, B];
    const p = G.player;
    Object.assign(p, { x: 400 - p.w / 2, y: 270 - p.h, vx: CFG.maxRun, vy: 0, onGround: true, groundPlat: A,
      hang: null, dead: false, boostT: 0, jumping: false, buffer: 0 });
    Object.assign(input, { right: true, left: false, jumpPressed: true, jumpHeld: true, usingTouch: false, usingGamepad: false });
    for (let i = 0; i < 200 && p.y < 700; i++) { updatePlayer(); if (p.onGround && i > 0) break; }
    return p.onGround && p.groundPlat === B;
  };
  globalThis.__reach = (climb) => { let g = 100; while (__lands(g + 1, climb)) g++; return g; };`);
  const rows = json(c, `return ${TUNINGS}.map((B) => ({ m: B.m, ramp: B.ramp || 0, gMax: B.gMax, dy: B.dy,
    reachSteep: __reach(B.dy), reachShallow: __reach(Math.min(B.dy, 32)) }));`);
  assert.equal(rows.length, 8 + json(c, 'return RAMP_CAP'));
  for (const r of rows) {
    // worldgen: a gap > gMax-40 may climb at most 32px; smaller gaps climb up to dy.
    assert.ok(r.reachShallow - r.gMax >= SAFETY, `band ${r.m}m ramp ${r.ramp}: gMax ${r.gMax} vs reach ${r.reachShallow}`);
    assert.ok(r.reachSteep - (r.gMax - 40) >= SAFETY, `band ${r.m}m ramp ${r.ramp}: gMax-40 climbing ${r.dy} vs reach ${r.reachSteep}`);
  }
  // Sanity: the sim really is the limit (a gap past reach fails).
  assert.equal(c.run('__lands(__reach(32) + 8, 32)'), false);
});

test('endgame ramp is gentle, capped, monotonic and keyed only on distance', (t) => {
  const c = solo(t);
  const r = json(c, `return {
    same: bandParams(7, 2500) === BANDS[7] && bandParams(7, 2999) === BANDS[7] && bandParams(3, 99999) === BANDS[3],
    steps: [2400, 2500, 3000, 3499, 3500, 4500, 9000, 1e9].map(rampStep),
    rows: RAMP.map((B) => [B.flare, B.gMin, B.gMax, B.narrow, B.shootIvl, B.ebSpeed, B.wMin]),
    maxRun: CFG.maxRun,
  };`);
  assert.ok(r.same, 'below 3000m (and every earlier band) tuning is the untouched BANDS row');
  assert.deepEqual(r.steps, [0, 0, 1, 1, 2, 4, 4, 4]);
  for (let i = 1; i < r.rows.length; i++) {
    const [f, gMin, gMax, narrow, ivl, eb, wMin] = r.rows[i], [f0, gMin0, gMax0, n0, ivl0, eb0, w0] = r.rows[i - 1];
    assert.ok(f > f0 && gMin > gMin0 && gMax > gMax0 && narrow > n0 && ivl < ivl0 && eb > eb0 && wMin === w0);
    assert.ok(gMin < gMax);
  }
  assert.ok(r.rows.at(-1)[0] < r.maxRun - 0.5, 'a flawless runner still outpaces the capped flare');
});

// Fingerprints captured from origin/main (76560f4) BEFORE the endgame ramp and
// DEBRIS FIELD landed. Every platform, enemy and pickup generated before 2500m —
// and the seeded mission — must stay byte-identical for existing seeds (#shot
// goldens, shared seeds). If you intentionally change early worldgen, update these.
// World gen 2 replaced the scatter for NEW courses; gen 1 must stay reachable and
// byte-identical so every link and daily shared before it still means the same course.
const EARLY = { 1: '09780bf9c2d6709b', 123456: '6ee88a2e931006a8', 12648430: '6ecf9e0734886187' };
const EARLY_ROOM = 'db8264476b48282d';
function earlyCourse(c, seed) {
  return c.run(`JSON.stringify((() => {
    stats.mercy=false; stats.deadStreak=0; resetRun(${seed}, false, { gen: 1 });
    const plats = new Map(), ents = new Map(), picks = new Map(); const lim = G.startX + 25000;
    const r = (v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
    for (let x = 30; G.genX < lim + 2000; x += 400) {
      G.player.x = x; generateAhead();
      for (const p of G.platforms) plats.set(r(p.x), [p.x,p.y,p.w,p.boost,p.boostX ?? null].map(r));
      for (const e of G.enemies) ents.set(r(e.x)+','+r(e.y), [e.type,r(e.x),r(e.y)]);
      for (const k of G.pickups) picks.set(r(k.x)+','+r(k.y), [k.type,r(k.x),r(k.y)]);
    }
    const pre = (a) => a.filter((v) => (typeof v[0] === 'number' ? v[0] : v[1]) < lim);
    return { m: G.mission.kind, p: pre([...plats.values()]), e: pre([...ents.values()]), k: pre([...picks.values()]) };
  })())`);
}
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

test('courses before 2500m are unchanged from main for fixed seeds (solo)', (t) => {
  const c = solo(t);
  for (const [seed, want] of Object.entries(EARLY)) assert.equal(hash(earlyCourse(c, seed)), want, `seed ${seed}`);
});

test('courses before 2500m are unchanged from main for fixed seeds (room world stream)', async (t) => {
  const c = solo(t);
  await c.net.openRoom({ relayHost: 'relay.test', code: false });
  const s = c.run(`JSON.stringify((() => {
    resetRun(123456, false, { gen: 1 }); const all = new Map(); const lim = G.startX + 25000;
    for (let x = 30; G.genX < lim + 2000; x += 400) { G.player.x = x; generateAhead(); for (const p of G.platforms) all.set(p.x, [p.x,p.y,p.w,p.boost,p.boostX ?? null]); }
    return [...all.values()].filter((p) => p[0] < lim);
  })())`);
  assert.equal(hash(s), EARLY_ROOM);
});

// Generate a long course (well into the ramp + DEBRIS FIELD) with a fixed stride.
const longCourse = (noisy = false) => `
  const all = new Map();
  for (let x = 30; x < 52000; x += ${noisy ? 711 : 370}) {
    G.player.x = x;
    ${noisy ? 'for (let j = 0; j < 53; j++) rng(); G.enemies = [];' : ''}
    generateAhead();
    for (const p of G.platforms) all.set(p.x, [p.x, p.y, p.w, p.boost, !!p.crumble]);
  }
  return [...all.values()].filter((p) => p[0] < 50000);`;

test('same seed builds the identical late course on phone and desktop viewports', (t) => {
  const wide = solo(t, { width: 1280, height: 720 }), phone = solo(t, { width: 390, height: 844 });
  const gen = (c) => json(c, `stats.mercy=false; stats.deadStreak=0; resetRun(424242); ${longCourse()}`);
  const a = gen(wide), b = gen(phone);
  assert.deepEqual(a, b);
  assert.ok(a.some((p) => p[4]), 'DEBRIS FIELD slabs appear past 2500m');
  const firstCrumble = a.find((p) => p[4]);
  assert.ok(firstCrumble[0] > json(wide, 'return G.startX') + 25000, 'no crumble slab before 2500m');
});

test('played frames with identical inputs stay in lockstep across viewports', (t) => {
  const wide = solo(t, { width: 1280, height: 720 }), phone = solo(t, { width: 390, height: 844 });
  const play = (c) => json(c, `
    stats.mercy=false; stats.deadStreak=0; startRun(); resetRun(777); G.mode = 'play';
    for (let f = 0; f < 900 && !G.player.dead; f++) {
      input.right = true; input.jumpHeld = f % 40 < 22; if (f % 40 === 0) input.jumpPressed = true;
      if (f % 25 === 0) input.shoot = true;
      update();
    }
    return { x: G.player.x, y: G.player.y, dead: G.player.dead, score: G.score,
      plats: G.platforms.map((p) => [p.x, p.y, p.w]), enemies: G.enemies.length };`);
  const a = play(wide);
  assert.ok(a.x > 400, 'the scripted runner actually moved');
  assert.deepEqual(play(phone), a);
});

test('room courses ignore gameplay rng and batching all the way through the ramp', async (t) => {
  const hub = relay(), host = client(hub), other = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); other.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false });
  await other.net.openRoom({ relayHost: 'relay.test', code: false });
  const gen = (c, noisy) => json(c, `stats.mercy=${noisy}; stats.deadStreak=${noisy ? 9 : 0}; resetRun(9001); ${longCourse(noisy)}`);
  const a = gen(host, false);
  assert.deepEqual(gen(other, true), a);
  assert.ok(a.some((p) => p[4]));
});

test('quick deaths arm graduated mercy, which shrinks opening gaps and slows the flare', (t) => {
  const c = solo(t);
  const r = json(c, `
    stats.mercy = false; stats.deadStreak = 0;
    const streaks = [];
    for (let i = 0; i < 4; i++) { resetRun(50 + i); G.mode = 'play'; G.runStart = G.time; G.dist = 40; finalizeDeath(); streaks.push([stats.deadStreak, stats.mercy]); }
    const firstGap = () => { G.player.x = 800; generateAhead(); const a = G.platforms[3], b = G.platforms[4]; return b.x - (a.x + a.w); };
    resetRun(99); const mercyLvl = G.mercyLvl, mercyGap = firstGap();
    G.flare.speed = 0; G.runStart = G.time; for (let i = 0; i < 600; i++) updateFlare(); const mercySpeed = G.flare.speed;
    stats.mercy = false; resetRun(99); const plainGap = firstGap();
    G.flare.speed = 0; G.runStart = G.time; for (let i = 0; i < 600; i++) updateFlare(); const plainSpeed = G.flare.speed;
    // A long run clears the streak again.
    resetRun(5); G.frameCount = 3600; G.runStart = G.time - 60; G.dist = 900; finalizeDeath();
    return { streaks, mercyLvl, mercyGap, plainGap, mercySpeed, plainSpeed, after: [stats.deadStreak, stats.mercy] };`);
  assert.deepEqual(r.streaks, [[1, false], [2, false], [3, true], [4, true]]);
  assert.equal(r.mercyLvl, 2);                                   // clamp(deadStreak - 2, 1, 3)
  assert.ok(Math.abs(r.mercyGap / r.plainGap - (1 - 0.05 * r.mercyLvl)) < 1e-9, `${r.mercyGap} vs ${r.plainGap}`);
  assert.ok(r.mercySpeed < r.plainSpeed);
  assert.deepEqual(r.after, [0, false]);
});

test('completing a mission pays the full reward package', (t) => {
  const c = solo(t);
  for (const m of json(c, 'return MISSIONS')) {
    const r = json(c, `
      resetRun(3); G.mode = 'play';
      G.mission = { kind: '${m.kind}', target: ${m.target}, label: '', progress: 0, done: false };
      G.ammo = 0; const before = { score: G.score, flare: G.flare.x, done: stats.missionsDone | 0 };
      for (let i = 0; i < ${m.target} - 1; i++) missionProgress('${m.kind}', 1);
      const midway = G.mission.done;
      missionProgress('${m.kind}', 1); missionProgress('${m.kind}', 1);
      return { midway, done: G.mission.done, progress: G.mission.progress, score: G.score - before.score,
        flareBack: before.flare - G.flare.x, ammo: G.ammo, companion: !!G.companion, count: (stats.missionsDone | 0) - before.done };`);
    assert.deepEqual(r, { midway: false, done: true, progress: m.target, score: 250, flareBack: 180, ammo: 9, companion: true, count: 1 }, m.kind);
  }
});

test('veteran missions complete through the real stomp, shard and landing paths', (t) => {
  const c = solo(t);
  const r = json(c, `
    const setMission = (kind, target) => { G.mission = { kind, target, label: '', progress: 0, done: false }; };
    resetRun(11); G.mode = 'play'; const p = G.player;
    // CHAIN 3 IN ONE LEAP: two air stomps, touch down (resets), then three in one leap.
    setMission('airchain', 3); G.chain = 0;
    const stompOnce = () => {
      const e = patrolAt(G.platforms[1], p.x + p.w / 2, 1, 0); e.golden = false; G.enemies = [e];
      p.onGround = false; p.vy = 4; p.y = e.y - e.h / 2 - p.h + 8; collisions();
    };
    stompOnce(); stompOnce(); const afterTwo = G.mission.progress;
    Object.assign(p, { vy: 3, onGround: false, hang: null }); G.chain = 0;
    const floor = G.platforms[0]; p.x = floor.x + 40; p.y = floor.y - p.h - 2; p.py = p.y; updatePlayer();
    const afterLanding = G.mission.progress;
    G.chain = 0; stompOnce(); stompOnce(); stompOnce(); const chainDone = G.mission.done;
    // SWEEP 2 FULL STAR TRAILS: a partial trail doesn't count, full ones do.
    resetRun(12); G.mode = 'play'; setMission('trail', 2);
    const grab = (trail, of) => { G.pickups = [{ type: 'shard', x: G.player.x + 12, y: G.player.y + 17, vy: 0, bob: 0, grabbed: false, trail, of }]; G.flare.x = G.player.x - 500; collisions(); };
    grab(1, 3); grab(1, 3); grab(2, 3); grab(2, 3); grab(2, 3); const oneTrail = G.mission.progress;
    grab(3, 5); grab(3, 5); grab(3, 5); grab(3, 5); grab(3, 5); const trailDone = G.mission.done;
    // LAND 3 BIG AIR JUMPS: BIG AIR scoring feeds the mission.
    resetRun(13); G.mode = 'play'; setMission('bigair', 3);
    const bigAir = () => {
      const p = G.player, A = G.platforms[0], B = newPlatform(A.x + A.w + 200, A.y, 300); G.platforms = [A, B];
      Object.assign(p, { x: B.x + 20, y: B.y - p.h - 3, py: B.y - p.h - 3, vy: 4, onGround: false, hang: null, airFrames: 40, jumpStartX: B.x - 230, jumpPlat: A });
      updatePlayer();
    };
    bigAir(); bigAir(); bigAir();
    return { afterTwo, afterLanding, chainDone, oneTrail, trailDone, bigAirDone: G.mission.done };`);
  assert.deepEqual(r, { afterTwo: 2, afterLanding: 0, chainDone: true, oneTrail: 1, trailDone: true, bigAirDone: true });
});

test('veteran missions only enter the pool once a profile has earned them', (t) => {
  const c = solo(t);
  const kinds = (done) => json(c, `stats.missionsDone = ${done}; const s = new Set(); for (let i = 0; i < 300; i++) { resetRun(i * 7919); s.add(G.mission.kind); } return [...s].sort();`);
  assert.deepEqual(kinds(0), ['distance', 'graze', 'shard', 'shoot', 'stomp']);
  assert.deepEqual(kinds(3), ['airchain', 'bigair', 'distance', 'graze', 'shard', 'shoot', 'stomp', 'trail']);
});

test('DEBRIS FIELD slabs hold briefly, then drop out from under a standing player', (t) => {
  const c = solo(t);
  const r = json(c, `
    resetRun(21); G.mode = 'play'; let p = G.player;
    const A = newPlatform(0, 270, 400); A.crumble = true; G.platforms = [A];
    Object.assign(p, { x: 100, y: 270 - p.h - 2, py: 270 - p.h - 2, vx: 0, vy: 1, onGround: false, hang: null });
    Object.assign(input, { right: false, left: false, jumpPressed: false, jumpHeld: false });
    let heldFor = 0, atDrop = null;
    for (let f = 0; f < 120; f++) {
      updatePlayer(); updateCrumble();
      // The very step the slab goes, the player must already be off it — never floating.
      if (A.fallen && !atDrop) atDrop = { onGround: p.onGround, groundPlat: p.groundPlat === null };
      if (p.onGround) heldFor++; else if (heldFor) break;
    }
    // Coyote frames survive the drop: a jump just after it still launches.
    resetRun(23); G.mode = 'play'; p = G.player;
    const C = newPlatform(0, 270, 400); C.crumble = true; G.platforms = [C];
    Object.assign(p, { x: 100, y: 270 - p.h - 2, py: 270 - p.h - 2, vx: 0, vy: 1, onGround: false, hang: null });
    for (let f = 0; f < 120 && !C.fallen; f++) { updatePlayer(); updateCrumble(); }
    updatePlayer(); updateCrumble();
    input.jumpPressed = true; input.jumpHeld = true; updatePlayer();
    const coyoteJump = p.vy < 0;
    Object.assign(input, { jumpPressed: false, jumpHeld: false });
    // Jumping off during the countdown is always possible.
    resetRun(22); G.mode = 'play'; p = G.player;
    const B = newPlatform(0, 270, 400); B.crumble = true; G.platforms = [B];
    Object.assign(p, { x: 100, y: 270 - p.h - 2, py: 270 - p.h - 2, vx: 0, vy: 1, onGround: false, hang: null });
    for (let f = 0; f < CFG.crumbleDelay - 4; f++) { updatePlayer(); updateCrumble(); }
    input.jumpPressed = true; input.jumpHeld = true; updatePlayer();
    return { heldFor, atDrop, coyoteJump, fallen: A.fallen, y: A.y, delay: CFG.crumbleDelay, escaped: p.vy < 0, bFallen: !!B.fallen };`);
  assert.equal(r.fallen, true);
  assert.deepEqual(r.atDrop, { onGround: false, groundPlat: true });
  assert.equal(r.coyoteJump, true);
  assert.equal(r.y, 270, 'sim geometry never moves (the drop is render-only)');
  assert.ok(r.heldFor >= r.delay - 1 && r.heldFor <= r.delay + 1, `held ${r.heldFor} frames`);
  assert.ok(r.escaped && !r.bFallen);
});

test('ledge catches and pull-ups arm DEBRIS FIELD slabs and end the one-leap mission', (t) => {
  const c = solo(t);
  const r = json(c, `
    resetRun(31); G.mode = 'play'; const p = G.player;
    Object.assign(input, { right: false, left: false, down: false, jumpPressed: false, jumpHeld: false, usingTouch: false, usingGamepad: false });
    G.mission = { kind: 'airchain', target: 3, label: '', progress: 0, done: false };
    // Two airborne kills bank progress on the mission...
    G.enemies = []; G.chain = 0;
    for (let i = 0; i < 2; i++) {
      const e = patrolAt(newPlatform(-400, 270, 200), -300, 1, 0); e.golden = false; G.enemies = [e];
      Object.assign(p, { x: e.x - p.w / 2, onGround: false, vy: 4, hang: null }); p.y = e.y - e.h / 2 - p.h + 8; collisions();
    }
    const beforeGrab = G.mission.progress;
    // ...then the player falls just short of an UNTOUCHED cracked slab and catches its lip.
    const A = newPlatform(0, 270, 400); A.crumble = true; G.platforms = [A];
    Object.assign(p, { x: -30, y: 278, py: 278, vx: 0.5, vy: 1, onGround: false, hang: null, hangCooldown: 0, dead: false });
    G.vigHold = false;
    updatePlayer();
    const grabbed = !!p.hang, armedAtGrab = A.crumbleT;
    updateCrumble();
    let pulledUpAt = -1, progressAfterPull = null;
    for (let f = 1; f < 200; f++) {
      updatePlayer(); updateCrumble();
      if (pulledUpAt < 0 && p.onGround) { pulledUpAt = f; progressAfterPull = G.mission.progress; }
    }
    // After a pull-up the next leap needs all three kills again (G.chain may carry over).
    const e3 = () => { const e = patrolAt(newPlatform(900, 270, 200), 1000, 1, 0); e.golden = false; G.enemies = [e];
      Object.assign(p, { x: e.x - p.w / 2, onGround: false, vy: 4, hang: null }); p.y = e.y - e.h / 2 - p.h + 8; collisions(); };
    e3(); e3(); const afterTwoMore = G.mission.done; e3();
    // Pull-up straight onto an untouched slab also arms it (no landing needed).
    const B = newPlatform(0, 270, 400); B.crumble = true; G.platforms = [B];
    p.hang = { plat: B, side: 1, t: 0 }; pullUpFromHang(p); const armedByPull = B.crumbleT;
    return { beforeGrab, grabbed, armedAtGrab, pulledUpAt, progressAfterPull, fallen: !!A.fallen, onSlabAtEnd: p.onGround && p.groundPlat === A,
      afterTwoMore, done: G.mission.done, armedByPull };`);
  assert.equal(r.beforeGrab, 2);
  assert.equal(r.grabbed, true, 'the scripted fall catches the lip');
  assert.equal(r.armedAtGrab, 0, 'the clock starts on the catch, not on a later landing');
  assert.ok(r.pulledUpAt > 0);
  assert.equal(r.progressAfterPull, 0, 'a pull-up is a touchdown for the one-leap mission');
  assert.equal(r.fallen, true);
  assert.equal(r.onSlabAtEnd, false, 'no standing on a cracked slab indefinitely');
  assert.equal(r.afterTwoMore, false);
  assert.equal(r.done, true);
  assert.equal(r.armedByPull, 0);
});

test('deep runs announce each ramp notch and render DEBRIS FIELD slabs without error', (t) => {
  const c = solo(t);
  const r = json(c, `
    stats.mercy = false; startRun(); resetRun(424242); G.mode = 'play'; G.deep1000 = true;
    const seen = [];
    for (const m of [2600, 3050, 3600, 4100, 4700, 6000]) {
      // Walk the course to m, then stand on the platform there and tick the real loop.
      for (let x = G.player.x; x < G.startX + m * 10; x += 400) { G.player.x = x; generateAhead(); }
      const pl = G.platforms.find((q) => q.x + q.w > G.startX + m * 10) || G.platforms.at(-1);
      Object.assign(G.player, { x: pl.x + 20, y: pl.y - G.player.h, vx: 0, vy: 0, onGround: true, groundPlat: pl, hang: null });
      G.maxX = G.player.x - 1; G.flare.x = G.player.x - 600; G.stingerText = '';
      G.band = bandFor(m);   // the teleport skipped the sector crossings themselves
      for (let f = 0; f < 3; f++) update();
      render(1);
      seen.push([G.rampStep, G.stingerText]);
    }
    // A shaking and a falling slab in view both draw.
    const crumbly = G.platforms.find((q) => q.x > G.player.x) || G.platforms[0];
    crumbly.crumble = true; crumbly.crumbleT = 10; render(1);
    crumbly.crumbleT = CFG.crumbleDelay + 20; crumbly.fallen = true; render(1);
    return seen;`);
  assert.deepEqual(r, [[0, ''], [1, 'LAST LIGHT +1'], [2, 'LAST LIGHT +2'], [3, 'LAST LIGHT +3'], [4, 'LAST LIGHT +4'], [4, '']]);
});

test('save migration never throws on garbage and always returns sane settings', (t) => {
  const c = solo(t);
  const r = json(c, `
    const migrate = window.SpaceManSave.migrate;
    let seed = 1234567; const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
    const atoms = [null, undefined, 0, -1, NaN, Infinity, -Infinity, 1e308, '', 'x', 'classic', 'crown', true, false, [], {}, '__proto__', 'constructor'];
    const keys = ['settings', 'cosmetics', 'discoveries', 'achievements', 'musicVol', 'sfxVol', 'muted', 'sound', 'suit', 'hat', 'unlocked', 'patches', '__proto__', 'constructor', 'toString', 'length'];
    const garbage = (d) => {
      const k = rand();
      if (d > 3 || k < 0.35) return atoms[(rand() * atoms.length) | 0];
      if (k < 0.55) return Array.from({ length: (rand() * 6) | 0 }, () => garbage(d + 1));
      const o = {}; const n = (rand() * 6) | 0;
      for (let i = 0; i < n; i++) Object.defineProperty(o, keys[(rand() * keys.length) | 0], { value: garbage(d + 1), enumerable: true, configurable: true, writable: true });
      return o;
    };
    const failures = [];
    const SUITS = ['classic', 'mint', 'rose', 'gold', 'lilac', 'coral', 'aurora', 'graphite'];
    for (let i = 0; i < 3000; i++) {
      const g = i % 3 === 0 ? JSON.parse(JSON.stringify({ settings: garbage(1), cosmetics: garbage(1), discoveries: garbage(1), achievements: garbage(1) }) ?? 'null') : garbage(0);
      try {
        const out = migrate(g);
        const s = out.settings;
        if (!(s.musicVol >= 0 && s.musicVol <= 1 && s.sfxVol >= 0 && s.sfxVol <= 1 && typeof s.muted === 'boolean')) failures.push(['settings', i]);
        if (SUITS.indexOf(out.cosmetics.suit) < 0 || !Array.isArray(out.cosmetics.unlocked) || out.cosmetics.unlocked.indexOf('classic') < 0) failures.push(['cosmetics', i]);
        if (!Array.isArray(out.discoveries) || out.discoveries.some((d) => typeof d !== 'string')) failures.push(['discoveries', i]);
        if (out.version !== window.SpaceManSave.VERSION) failures.push(['version', i]);
      } catch (e) { failures.push([String(e), i]); }
    }
    for (const s of ['{', '[1,2', '"str"', '42', 'null', '{"settings":"oops"}', '{"cosmetics":{"unlocked":"crown"}}']) {
      try { let v; try { v = JSON.parse(s); } catch (e) { v = s; } migrate(v); } catch (e) { failures.push([String(e), s]); }
    }
    return failures.slice(0, 5);`);
  assert.deepEqual(r, []);
});
