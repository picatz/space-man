// Power-ups, player verbs and joy moments (src/powerups.js), exercised through the
// REAL game script in the vm harness: real updatePlayer / killEnemy / collisions /
// input handlers. Only browser APIs are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { client, relay, until } = require('./harness.cjs');

function solo(t, opts) {
  const c = client(relay(), opts);
  t.after(() => c.close());
  return c;
}
const json = (c, code) => JSON.parse(c.run(`JSON.stringify((() => { ${code} })())`));
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// A long flat slab with the player standing on it, run state live, POW bound to this run.
const STAGE = `resetRun(3); G.mode = 'play'; POW.update();
  const p = G.player; G.platforms = [newPlatform(-100, 270, 100000)]; G.enemies = []; G.ebullets = []; G.pickups = [];
  Object.assign(p, { x: 200, y: 270 - p.h, px: 200, py: 270 - p.h, vx: 0, vy: 0, onGround: true, groundPlat: G.platforms[0], facing: 1, jumping: false, buffer: 0 });
  Object.assign(input, { left: false, right: false, jumpHeld: false, jumpPressed: false, shoot: false, usingTouch: false, usingGamepad: false });
  G.flare.x = -1e6; const S = POW.state, T = POW.TUNE;`;

// ---- deterministic placement -------------------------------------------------------------

const places = (c, seed, stride, noisy) => json(c, `resetRun(${seed}, true); const out = new Map();
  for (let x = 30; x < 150000; x += ${stride}) {
    G.player.x = x; ${noisy ? 'for (let j = 0; j < 37; j++) rng();' : ''} generateAhead();
    const P = G.platforms;
    for (let i = 1; i < P.length; i++) { const it = POW.placeFor(P[i], P[i - 1], G.startX); if (it) out.set(it.c, [it.type, +it.x.toFixed(3), +it.y.toFixed(3), it.c]); }
  }
  return [...out.values()].sort((a, b) => a[3] - b[3]);`);

test('pickups are a pure function of the course: same seed → same pickups on any screen, any pace', (t) => {
  const wide = solo(t, { width: 1280, height: 720 }), phone = solo(t, { width: 390, height: 844 });
  const a = places(wide, 424242, 370), b = places(phone, 424242, 711, true);
  assert.deepEqual(a, b, 'viewport, generation stride and gameplay rng draws must not move a pickup');
  assert.ok(a.length >= 25, 'a 15km course carries plenty of pickups (' + a.length + ')');
  assert.equal(a[0][3], 1, 'chunk 1 (≈170m) always carries one: every run gets an early taste');
  assert.equal(new Set(a.map((r) => r[3])).size, a.length, 'at most one per chunk');
  const types = new Set(a.map((r) => r[0]));
  for (const k of ['jet', 'saber', 'shield', 'magnet']) assert.ok(types.has(k), k + ' appears');
  assert.notDeepEqual(places(wide, 7, 370), a, 'a different seed places them differently');
});

// Captured from origin/main: see tests/gameplay.test.cjs. Scanning for pickups every step
// (as a live run does) must neither touch the worldgen rng nor add to G.pickups.
test('scanning for power-ups leaves existing seeds, fingerprints and the rng stream untouched', (t) => {
  const c = solo(t);
  const run = (withPow) => c.run(`JSON.stringify((() => {
    stats.mercy=false; stats.deadStreak=0; resetRun(1); G.mode = 'play';
    const plats = new Map(), ents = new Map(), picks = new Map(); const lim = G.startX + 25000;
    const r = (v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
    for (let x = 30; G.genX < lim + 2000; x += 400) {
      G.player.x = x; generateAhead(); ${withPow ? 'POW.update(); POW.combat();' : ''}
      for (const p of G.platforms) plats.set(r(p.x), [p.x,p.y,p.w,p.boost,p.boostX ?? null].map(r));
      for (const e of G.enemies) ents.set(r(e.x)+','+r(e.y), [e.type,r(e.x),r(e.y)]);
      for (const k of G.pickups) picks.set(r(k.x)+','+r(k.y), [k.type,r(k.x),r(k.y)]);
    }
    const pre = (a) => a.filter((v) => (typeof v[0] === 'number' ? v[0] : v[1]) < lim);
    return { m: G.mission.kind, p: pre([...plats.values()]), e: pre([...ents.values()]), k: pre([...picks.values()]), next: rng(), items: POW.state.items.length + POW.state.rings.length };
  })())`);
  const plain = JSON.parse(run(false)), pow = JSON.parse(run(true));
  const fp = (o) => hash(JSON.stringify({ m: o.m, p: o.p, e: o.e, k: o.k }));
  assert.equal(fp(plain), '09780bf9c2d6709b', 'baseline matches the golden in gameplay.test.cjs');
  assert.equal(fp(pow), '09780bf9c2d6709b', 'with power-ups scanning, the course is byte-identical');
  assert.equal(pow.next, plain.next, 'the worldgen rng was never drawn from');
  assert.ok(pow.items > 0, 'the scan really ran');
});

test('the live scan spawns exactly what placeFor says', (t) => {
  const c = solo(t);
  const r = json(c, `resetRun(99); G.mode = 'play'; const want = new Map(), got = new Map();
    for (let x = 30; x < 20000; x += 300) {
      G.player.x = x; G.player.y = -5000; generateAhead(); POW.update();   // flying high: nothing is picked up
      const P = G.platforms;
      for (let i = 1; i < P.length; i++) { const it = POW.placeFor(P[i], P[i - 1], G.startX); if (it) want.set(it.c, it.type); }
      for (const it of POW.state.items) got.set(it.c, it.type);
    }
    return { want: [...want], got: [...got], picked: POW.state.picked };`);
  assert.deepEqual(r.got, r.want);
  assert.equal(r.picked, 0);
});

async function room(t) {
  const hub = relay(), host = client(hub), guest = client(hub, { width: 390, height: 844 });
  t.after(() => { host.close(); guest.close(); });
  await host.net.openRoom({ relayHost: 'relay.test', code: false, adjIdx: 0, nounIdx: 0 });
  await guest.net.acceptJoin(host.net.info().link.split('#j=')[1], { adjIdx: 1, nounIdx: 1 });
  await until(() => guest.net.roster().length === 2, 'complete roster');
  host.run('startRun()'); guest.run('startRun({ sync: true })');
  await until(() => guest.net.roundClock()?.active, 'shared round');
  hub.advance(3100);
  return { hub, host, guest };
}

test('in a room every player sees the same pickups', async (t) => {
  const { host, guest } = await room(t);
  const scan = (c) => json(c, `const out = [];
    for (let x = 30; x < 40000; x += 500) { G.player.x = x; generateAhead();
      const P = G.platforms; for (let i = 1; i < P.length; i++) { const it = POW.placeFor(P[i], P[i - 1], G.startX); if (it && !out.some((o) => o[2] === it.c)) out.push([it.type, it.x, it.c]); } }
    G.player.x = 30; return out;`);
  const a = scan(host), b = scan(guest);
  assert.ok(a.length >= 5);
  assert.deepEqual(a, b);
});

// ---- JETPACK --------------------------------------------------------------------------------

test('jetpack: a tank is 96 frames of thrust, height is capped, the ground refills it', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE}
    POW.grant('jet', true);
    // Walk-off start: airborne, falling, jump held → thrust from the first frame.
    Object.assign(p, { y: 180, py: 180, onGround: false, groundPlat: null, vy: 2 });
    input.jumpHeld = true;
    let tank = 0, minY = 1e9, landedAt = -1, full = -1;
    for (let i = 0; i < 400; i++) {
      updatePlayer(); POW.update();
      if (S.thrust) tank++;
      minY = Math.min(minY, p.y);
      if (p.onGround && landedAt < 0) landedAt = i;
      if (landedAt >= 0 && full < 0 && S.fuel >= 1) full = i - landedAt;
    }
    return { tank, minY, ceil: G.groundY - T.jet.ceiling, landedAt, full, drain: T.jet.drain };`);
  assert.ok(Math.abs(r.tank - 1 / r.drain) <= 1, 'one full tank ≈ ' + (1 / r.drain) + ' thrust frames (' + r.tank + ')');
  assert.ok(r.minY >= r.ceil - 0.5, 'never above the soft ceiling (' + r.minY + ' vs ' + r.ceil + ')');
  assert.ok(r.minY < r.ceil + 8, 'but it really does reach the upper layer');
  assert.ok(r.landedAt > 0, 'an empty tank falls back to the ground');
  assert.ok(r.full >= 0 && r.full <= 25, 'the ground refills a tank in under half a second (' + r.full + ')');
});

test('jetpack: kills refuel it; it burns out on schedule and can never fly forever', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE}
    POW.grant('jet', true);
    p.onGround = false; S.fuel = 0.2; G.killsRun++; POW.update(); p.onGround = true;
    const refuel = S.fuel;
    // A player mashing the best loop there is: jump, fly, land, refill, repeat.
    let thrust = 0, lastThrust = -1;
    for (let i = 0; i < 3000; i++) {
      if (p.onGround && input.jumpHeld) input.jumpHeld = false;
      else if (p.onGround) { input.jumpPressed = true; input.jumpHeld = true; }
      updatePlayer(); POW.update();
      if (S.thrust) { thrust++; lastThrust = i; }
    }
    return { refuel, thrust, lastThrust, life: T.jet.life, jet: S.jet, fuel: S.fuel, drain: T.jet.drain };`);
  assert.ok(Math.abs(r.refuel - 0.5) < 1e-9, 'a kill adds 0.3 of a tank');
  assert.equal(r.jet, 0, 'the pack burned out');
  assert.ok(r.lastThrust < r.life, 'no thrust after burn-out (' + r.lastThrust + ' ≥ ' + r.life + ')');
  assert.ok(r.thrust < r.life, 'total flight is bounded by the pack\'s life');
  assert.ok(r.thrust > 1 / r.drain, 'landing refills let it fly more than one tank (' + r.thrust + ')');
});

test('without a jetpack, holding jump is the plain jump it always was', (t) => {
  const c = solo(t);
  const run = (withJet) => json(c, `${STAGE}
    ${withJet ? "POW.grant('jet', true); POW.grant('jet', true); S.jet = 0;" : ''}
    input.jumpPressed = true; input.jumpHeld = true; const ys = [];
    for (let i = 0; i < 90; i++) { updatePlayer(); POW.update(); ys.push(+p.y.toFixed(3)); if (S.thrust) return 'thrust'; }
    return ys;`);
  const plain = run(false);
  assert.notEqual(plain, 'thrust');
  assert.deepEqual(run(true), plain, 'an expired pack leaves the jump arc untouched');
});

// ---- LIGHTSABER -----------------------------------------------------------------------------

const MK = `const mk = (dx, dy, type) => ({ type: type || 'patrol', x: p.x + p.w / 2 + dx, y: p.y + p.h / 2 + dy, px: 0, py: 0, w: type === 'shoot' ? 26 : 24, h: type === 'shoot' ? 24 : 22,
  dir: 1, speed: 0, dead: false, squash: 0, walkPhase: 0, minX: -1e9, maxX: 1e9, lookX: 0, lookY: 0, telegraph: 0, fireT: 1, baseY: 0, bob: 0 });`;

test('saber: the swing cuts what is in front within reach, never behind or out of reach', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE} ${MK}
    POW.grant('saber', true);
    G.enemies = [mk(40, 0), mk(-40, 0), mk(95, 0), mk(18, -50)];
    const ammo = G.ammo;
    tryShoot();                                   // FIRE → swing, not a bullet
    const swing = S.swingT, bullets = G.bullets.length;
    tryShoot(); const noRestart = S.swingT;       // a held button can't restart mid-swing
    for (let i = 0; i < 20; i++) POW.combat();
    return { dead: G.enemies.map((e) => e.dead), kills: G.killsRun, sk: S.saberKills, ammo: G.ammo - ammo, swing, bullets, noRestart, after: S.swingT, score: G.score };`);
  assert.equal(r.swing, 0);
  assert.equal(r.bullets, 0, 'no blaster shot');
  assert.equal(r.ammo, 0, 'the saber costs no ammo');
  assert.equal(r.noRestart, 0);
  assert.deepEqual(r.dead, [true, false, false, true], 'front and overhead cut; behind and out of reach live');
  assert.equal(r.kills, 2); assert.equal(r.sk, 2);
  assert.ok(r.score >= 40, 'kills score through killEnemy');
  assert.equal(r.after, -1, 'the swing finished');
});

test('saber: an early swing reflects a shot back to its shooter, a late one cuts it, none kills you', (t) => {
  const c = solo(t);
  const setup = `${STAGE} ${MK}
    POW.grant('saber', true);
    const sh = mk(230, -20, 'shoot'); G.enemies = [sh];
    const bx = p.x + p.w / 2 + 30, by = p.y + p.h / 2 - 3, d = Math.hypot(sh.x - bx, sh.y - by);
    G.ebullets = [{ x: bx, y: by, px: bx, py: by, vx: -(sh.x - bx) / d * 3, vy: -(sh.y - by) / d * 3, life: 220, grazed: true }];`;
  const early = json(c, `${setup}
    POW.fire(); POW.combat();
    const reflected = S.refl.some((q) => q.live), left = G.ebullets.length;
    for (let i = 0; i < 120 && !sh.dead; i++) POW.combat();
    return { reflected, left, parries: S.parries, shooter: sh.dead, kills: G.killsRun, alive: !p.dead };`);
  assert.deepEqual(early, { reflected: true, left: 0, parries: 1, shooter: true, kills: 1, alive: true }, 'RETURN TO SENDER');
  const late = json(c, `${setup}
    POW.fire(); S.swingT = T.saber.parry + 1; POW.combat();
    return { reflected: S.refl.some((q) => q.live), left: G.ebullets.length, parries: S.parries };`);
  assert.deepEqual(late, { reflected: false, left: 0, parries: 0 }, 'past the parry window the shot is only cut');
  const none = json(c, `${setup}
    for (let i = 0; i < 30 && !p.dead; i++) { POW.combat(); updateBullets(); }
    return { dead: p.dead, cause: G.deathCause };`);
  assert.deepEqual(none, { dead: true, cause: 'bullet' }, 'no swing, no save');
});

test('saber kills in a room go through the shared kill path: the other player sees the alien die', async (t) => {
  const { hub, host, guest } = await room(t);
  for (const c of [host, guest]) c.run('G.player.x = 60000; generateAhead(); G.player.x = 30;');
  hub.advance(20000);
  host.run('updateEnemies()'); guest.run('updateEnemies()');
  const ids = (c) => JSON.parse(c.run('JSON.stringify(G.enemies.filter((e) => !e.dead).map((e) => enemyId(e)))'));
  const id = ids(host).find((i) => ids(guest).includes(i) && i / 8 < 16000);
  assert.ok(id !== undefined, 'an alien on both screens');
  host.run(`(() => { const e = G.enemies.find((q) => enemyId(q) === ${id}), p = G.player;
    Object.assign(p, { x: e.x - p.w / 2 - 30, y: e.y - p.h / 2 + 2, facing: 1, dead: false });
    POW.update(); POW.grant('saber', true); POW.fire(); POW.combat(); })()`);
  assert.equal(host.run(`G.enemies.find((q) => enemyId(q) === ${id}).dead`), true, 'the host cut it');
  await until(() => guest.run(`G.enemies.some((e) => enemyId(e) === ${id} && e.dead)`), 'guest sees the saber kill');
  assert.equal(guest.run('G.killsRun'), 0, 'the kill is the host\'s own');
});

// ---- SHIELD + MAGNET ------------------------------------------------------------------------

test('shield: eats one contact (killing the alien) and one bullet window, never a fall', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE} ${MK}
    POW.grant('shield', true);
    const a = mk(12, 0); G.enemies = [a]; collisions();
    const first = { alive: !p.dead, alienDead: a.dead, shield: S.shield, invul: S.invul > 0 };
    Object.assign(p, { y: 270 - p.h, vy: 0 }); const b = mk(12, 0); G.enemies = [b]; collisions();
    const iframes = !p.dead && !b.dead;
    for (let i = 0; i < T.shield.iframes + 2; i++) POW.update();
    Object.assign(p, { y: 270 - p.h, vy: 0, onGround: true }); collisions();
    return { first, iframes, laterDies: p.dead };`);
  assert.deepEqual(r.first, { alive: true, alienDead: true, shield: 0, invul: true });
  assert.equal(r.iframes, true, 'i-frames after the pop');
  assert.equal(r.laterDies, true, 'one hit only');
  const fall = json(c, `${STAGE} POW.grant('shield', true); p.y = G.groundY + 400; collisions(); return G.deathCause;`);
  assert.equal(fall, 'void');
  const shot = json(c, `${STAGE} POW.grant('shield', true);
    G.ebullets = [{ x: p.x + p.w / 2 + 4, y: p.y + p.h / 2, px: 0, py: 0, vx: -1, vy: 0, life: 50, grazed: true }];
    updateBullets(); return { dead: p.dead, left: G.ebullets.length, shield: S.shield };`);
  assert.deepEqual(shot, { dead: false, left: 0, shield: 0 });
});

test('magnet reels shards in from far beyond the normal reach', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE}
    const k = { type: 'shard', x: p.x + 170, y: p.y - 40, vy: 0, bob: 0, grabbed: false };
    G.pickups = [k]; const before = G.shards;
    for (let i = 0; i < 40; i++) { POW.update(); collisions(); }
    const without = G.shards - before;
    POW.grant('magnet', true); G.pickups = [Object.assign(k, { x: p.x + 170, y: p.y - 40, grabbed: false })];
    for (let i = 0; i < 40; i++) { POW.update(); collisions(); }
    return { without, withMagnet: G.shards - before };`);
  assert.equal(r.without, 0);
  assert.equal(r.withMagnet, 1);
});

// ---- input mapping: keyboard, touch, gamepad -----------------------------------------------

test('keyboard: hold jump flies the pack; the fire key swings the saber', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE}
    POW.grant('jet', true); POW.grant('saber', true);
    const key = (k, down) => onKey({ key: k, target: null, preventDefault() {} }, down);
    key('w', true); let flew = 0;
    for (let i = 0; i < 60; i++) { updatePlayer(); POW.update(); if (S.thrust) flew++; }
    key('w', false); updatePlayer(); const stops = S.thrust;
    key(' ', true); for (let i = 0; i < 30; i++) updatePlayer(); const spaceFlies = S.thrust; key(' ', false);
    key('f', true); key('f', false); if (input.shoot) { tryShoot(); input.shoot = false; }
    const swingF = S.swingT; for (let i = 0; i < 20; i++) POW.combat();
    key('x', true); key('x', false); if (input.shoot) { tryShoot(); input.shoot = false; }
    return { flew, stops, spaceFlies, swingF, swingX: S.swingT, bullets: G.bullets.length };`);
  assert.ok(r.flew > 20, 'held W thrusts once the jump\'s rise is spent (' + r.flew + ')');
  assert.equal(r.stops, false, 'letting go cuts thrust at once');
  assert.equal(r.spaceFlies, true, 'Space (the fixed alternate) flies too');
  assert.equal(r.swingF, 0); assert.equal(r.swingX, 0, 'J/X alternates swing as well');
  assert.equal(r.bullets, 0);
});

test('touch: holding the jump side flies, and FIRE becomes SABER', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE}
    POW.grant('jet', true); POW.grant('saber', true);
    const cv = document.getElementById('game'), down = cv.listeners.pointerdown[0];
    const ev = (id, x, y) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y, preventDefault() {} });
    layoutTouch();
    down(ev(1, window.innerWidth * 0.7, window.innerHeight * 0.4));   // jump side
    const zone = input.jumpZone.active && input.jumpHeld;
    let flew = 0; for (let i = 0; i < 60; i++) { updatePlayer(); POW.update(); if (S.thrust) flew++; }
    endPointer({ pointerId: 1 }); updatePlayer();
    const released = !S.thrust && !input.jumpHeld;
    down(ev(2, input.shootBtn.cx, input.shootBtn.cy));
    const btn = input.shootBtn.pressed && input.shoot;
    if (input.shoot || input.shootBtn.pressed) { tryShoot(); input.shoot = false; }
    const swing = S.swingT;
    endPointer({ pointerId: 2 });
    let drew = null; try { drawTouchControls(); drew = POW.drawFireButton(input.shootBtn.cx, input.shootBtn.cy, input.shootBtn.r); } catch (e) { drew = String(e); }
    return { zone, flew, released, btn, swing, drew, bullets: G.bullets.length };`);
  assert.equal(r.zone, true);
  assert.ok(r.flew > 20, 'the held jump zone thrusts (' + r.flew + ')');
  assert.equal(r.released, true);
  assert.equal(r.btn, true);
  assert.equal(r.swing, 0, 'the FIRE button swings');
  assert.equal(r.drew, true, 'the button repaints as SABER');
  assert.equal(r.bullets, 0);
});

test('gamepad: held A flies, X / RB / RT swing', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE}
    POW.grant('jet', true); POW.grant('saber', true);
    const pad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: [] };
    for (let i = 0; i < 17; i++) pad.buttons.push({ pressed: false, value: 0 });
    navigator.getGamepads = () => [pad];
    pollGamepad();
    pad.buttons[0].pressed = true; pollGamepad();
    let flew = 0; for (let i = 0; i < 60; i++) { pollGamepad(); updatePlayer(); POW.update(); if (S.thrust) flew++; }
    pad.buttons[0].pressed = false; pollGamepad(); updatePlayer(); const stops = !S.thrust;
    const swings = [];
    for (const b of [2, 5, 7]) {
      pad.buttons[b].pressed = true; pollGamepad();
      if (input.shoot) { tryShoot(); input.shoot = false; }
      swings.push(S.swingT); pad.buttons[b].pressed = false; pollGamepad();
      for (let i = 0; i < 20; i++) POW.combat();
    }
    return { flew, stops, swings };`);
  assert.ok(r.flew > 20, '(' + r.flew + ')');
  assert.equal(r.stops, true);
  assert.deepEqual(r.swings, [0, 0, 0]);
});

// ---- joy moments ----------------------------------------------------------------------------

test('joy: multi-kills, close-call streaks and milestones pay out; slow-mo obeys Reduce Motion', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE}
    const s0 = G.score; G.killsRun++; POW.update(); G.killsRun++; POW.update();
    const dbl = G.score - s0;
    for (let i = 0; i < 3; i++) { G.ebullets.push({ x: 0, y: 0, grazed: true }); POW.update(); }
    const dare = S.head.text;
    G.ebullets = []; S.head.t = 0; G.stinger = 0; G.celebrate = 0; G.dist = 520; POW.update();
    const mile = S.head.text;
    const stomp = (reduce) => {
      settings.reduceMotion = reduce; G.timescale = 1; G.slowTimer = 0;
      S.chain = 2; G.chain = 3; p.vy = CFG.stompBounce; p.onGround = false; POW.update();
      const ts = G.timescale; G.chain = 0; S.chain = 0; return ts;
    };
    return { dbl, dare, mile, slow: stomp(false), reduced: stomp(true) };`);
  assert.ok(r.dbl >= 25, 'DOUBLE! pays (' + r.dbl + ')');
  assert.equal(r.dare, 'DAREDEVIL!');
  assert.equal(r.mile, '★ 500m');
  assert.ok(r.slow < 1, 'a big stomp gets its slow-mo flourish');
  assert.equal(r.reduced, 1, 'Reduce Motion: no time dilation at all');
});

test('every power-up draws without error in world, HUD and touch layers', (t) => {
  const c = solo(t);
  const r = c.run(`(() => { ${STAGE}
    for (const k of POW.TYPES) POW.grant(k);
    S.thrust = true; S.swingT = 4; input.usingTouch = true;
    try { render(0.5); drawTouchControls(); showDeathCard(); return document.getElementById('deadStats').innerHTML; } catch (e) { return 'ERR ' + e.stack; }
  })()`);
  assert.doesNotMatch(r, /^ERR/, r);
  assert.match(r, /POWER-UPS 4/, 'the run-over card counts them');
});

// ---- review round: consistent reach, strict front arc, held fire on every input, guarded graze slow-mo ----------
test('saber: nothing even a hair behind the chest is cut, but straight overhead still is', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE} ${MK}
    POW.grant('saber', true);
    G.enemies = [mk(-5, 0), mk(-1, 0), mk(0, -40), mk(5, 0)];
    tryShoot(); for (let i = 0; i < 20; i++) POW.combat();
    return G.enemies.map((e) => e.dead);`);
  assert.deepEqual(r, [false, false, true, true], 'behind (-5, -1) lives; overhead (0) and just ahead (+5) are cut');
});

test('magnet: capsules are drawn in from the same 190 px as shards and ammo', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE}
    POW.grant('magnet', true);
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    S.items = [{ type: 'jet', x: cx + 180, y: cy, bob: 0, taken: false, t: 0 }, { type: 'jet', x: cx + 200, y: cy, bob: 0, taken: false, t: 0 }];
    const before = S.items.map((i) => i.x); POW.update();
    return { moved: S.items.map((i, k) => before[k] - i.x), reach: T.magnet.reach, pull: T.magnet.pull };`);
  assert.equal(r.reach, 190);
  assert.ok(r.moved[0] > 20, 'a capsule 180 px away is pulled (' + r.moved[0] + ')');
  assert.equal(r.moved[1], 0, 'one 200 px away is not');
});

test('saber: holding FIRE keeps swinging on a keyboard key, the mouse button and a controller, until let go', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE}
    POW.grant('saber', true);
    const swingsIn = (frames) => { let n = 0, dir = S.swingDir; for (let i = 0; i < frames; i++) { POW.combat(); if (S.swingDir !== dir) { n++; dir = S.swingDir; } } return n; };
    const out = {};
    for (const src of ['fireKey', 'fireMouse', 'firePad']) {
      S.swingT = -1; input[src] = true;
      out[src] = swingsIn(90);                       // 1.5 s held
      input[src] = false; S.swingT = -1;
      out[src + 'Released'] = swingsIn(60);
    }
    return out;`);
  for (const src of ['fireKey', 'fireMouse', 'firePad']) {
    assert.ok(r[src] >= 3, `${src}: held through re-arm swings repeatedly (${r[src]})`);
    assert.equal(r[src + 'Released'], 0, `${src}: and stops when let go`);
  }
});

test('held FIRE state follows the real inputs: key up/down, mouse, and the controller', (t) => {
  const c = solo(t);
  const r = json(c, `${STAGE}
    const out = {};
    onKey({ key: 'f', target: {}, preventDefault() {} }, true); out.keyDown = input.fireKey;
    onKey({ key: 'f', target: {}, preventDefault() {} }, false); out.keyUp = input.fireKey;
    const pad = { index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    navigator.getGamepads = () => [pad]; pollGamepad();
    pad.buttons[7].pressed = true; pollGamepad(); out.padDown = input.firePad;
    pad.buttons[7].pressed = false; pollGamepad(); out.padUp = input.firePad;
    pad.buttons[7].pressed = true; pollGamepad(); out.heldBeforeUnplug = input.firePad;
    navigator.getGamepads = () => [null]; input.pad.index = -1; pollGamepad(); out.afterUnplug = input.firePad;
    S.saber = 600; S.swingT = -1; S.player = G.player; let swung = 0; for (let i = 0; i < 90; i++) { POW.combat(); if (S.swingT >= 0) swung++; } out.swingsAfterUnplug = swung; S.saber = 0;
    input.fireKey = input.fireMouse = input.firePad = true; clearInput(); out.cleared = [input.fireKey, input.fireMouse, input.firePad];
    return out;`);
  assert.deepEqual(r, { keyDown: true, keyUp: false, padDown: true, padUp: false, heldBeforeUnplug: true, afterUnplug: false, swingsAfterUnplug: 0, cleared: [false, false, false] });
});

test('a real graze slows time in solo play, but never in a room or with Reduce Motion', (t) => {
  const c = solo(t);
  const graze = (setup) => json(c, `${STAGE} ${setup}
    G.timescale = 1; G.slowTimer = 0;
    G.ebullets = [{ x: p.x + p.w / 2 + 12, y: p.y + p.h / 2, px: 0, py: 0, vx: 0, vy: 0, life: 50, grazed: false }];
    updateBullets();
    return { scale: G.timescale, grazed: G.ebullets.length ? G.ebullets[0].grazed : 'gone', dead: G.player.dead };`);
  assert.equal(graze('settings.reduceMotion = false; G.sharedWorld = false;').scale, 0.35, 'solo: the skill beat');
  assert.equal(graze('settings.reduceMotion = true; G.sharedWorld = false;').scale, 1, 'Reduce Motion: no slow-mo');
  assert.equal(graze('settings.reduceMotion = false; G.sharedWorld = true;').scale, 1, 'a room: one screen\'s clock can\'t wait');
});
