const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Arena = require('../src/arena.js');
const C = Arena.constants;

function playing(options) {
  const state = Arena.create(options);
  for (let tick = 0; tick < C.COUNTDOWN_TICKS; tick++) Arena.step(state);
  state.actors.forEach((actor) => { actor.invulnerable = 0; });
  return state;
}
function commandStream(state, tick) {
  const commands = {};
  for (const actor of state.actors) commands[actor.id] = actor.controller === 'cpu' ? Arena.cpuInput(state, actor.id) : {
    moveX: tick % 190 < 95 ? 1 : -1,
    moveY: tick % 89 < 12 ? -1 : 0,
    jumpPressed: tick % 67 === 0, jumpHeld: tick % 67 < 43,
    attackPressed: tick % 31 === 0, dashPressed: tick % 157 === 0,
  };
  return commands;
}
function allCpuStep(state) {
  const commands = {};
  for (const actor of state.actors) commands[actor.id] = Arena.cpuInput(state, actor.id);
  return Arena.step(state, commands);
}
function place(actor, x, y, extra) {
  Object.assign(actor, { x, y, px: x, py: y, vx: 0, vy: 0, invulnerable: 0, stun: 0, onGround: false, supportId: null, coyoteTicks: 0, attackTicks: 0, dashTicks: 0 }, extra);
}
function duelAtRange(damage = 0, direction = 1) {
  const state = playing();
  const [a, b] = state.actors;
  place(a, 440, 420, { onGround: true, supportId: 'dock', facing: direction });
  place(b, 440 + direction * 44, 420, { onGround: true, supportId: 'dock', damage });
  return state;
}
function firstHit(state, commands) {
  Arena.step(state, commands);
  for (let i = 0; i < C.ATTACK_TICKS; i++) {
    if (state.events.some((e) => e.type === 'hit')) return state.events.find((e) => e.type === 'hit');
    Arena.step(state);
  }
  assert.fail('Attack should connect');
}

test('arena is a browser/Node pure UMD module with no DOM or clock dependencies', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/arena.js'), 'utf8'), context);
  const api = context.window.SpaceManArena;
  assert.equal(api.constants.TICK_RATE, 60);
  const state = api.create({ seed: 42 });
  api.step(state);
  assert.equal(state.tick, 1);
  const source = fs.readFileSync(require.resolve('../src/arena.js'), 'utf8');
  assert.doesNotMatch(source, /Math\.random\(|Date\.|performance\.|document\.|requestAnimationFrame|setTimeout/);
});

test('options sanitize, fighter identities remain stable, and all formats have correct teams', () => {
  const s = Arena.create({ arenaId: 'missing', format: 'chaos', seed: NaN, difficulty: 'toString' });
  assert.equal(s.arenaId, Arena.arenas[0].id);
  assert.equal(s.format, 'duel'); assert.equal(s.difficulty, 'normal'); assert.equal(s.seed, 1);
  assert.deepEqual(s.actors.map((a) => a.id), [1, 2]);
  assert.deepEqual(s.actors.map((a) => a.controller), ['human', 'cpu']);
  assert.equal(Arena.create({ seed: -1 }).seed, 4294967295);
  assert.equal(Arena.create({ seed: 0 }).seed, 0);
  for (const format of ['ffa', 'teams']) {
    const f = Arena.create({ format });
    assert.equal(f.actors.length, 4);
    assert.equal(new Set(f.actors.map((a) => a.profileId)).size, 4);
    assert.deepEqual(f.actors.map((a) => a.team), format === 'teams' ? [0, 0, 1, 1] : [0, 1, 2, 3]);
    assert.ok(f.actors.every((a) => a.w === 24 && a.h === 34 && a.stocks === 3));
  }
});

test('commands clamp invalid axes and booleans without mutating input', () => {
  const input = { moveX: 1000, moveY: -1000, jumpPressed: 'false', attackPressed: {}, dashPressed: 1, jumpHeld: true };
  assert.deepEqual(Arena.normalizeCommand(input), { moveX: 1, moveY: -1, jumpPressed: false, attackPressed: false, dashPressed: true, jumpHeld: true });
  assert.equal(input.moveX, 1000);
  assert.equal(Arena.normalizeCommand({ moveX: Infinity, moveY: NaN }).moveX, 0);
  assert.equal(Arena.normalizeCommand(null).moveY, 0);
  const a = playing(), b = Arena.restore(Arena.snapshot(a));
  Arena.step(a, { 1: { moveX: Infinity, moveY: '1', jumpPressed: 'yes' } });
  Arena.step(b, {});
  assert.deepEqual(a, b);
});

test('countdown freezes fighters and timer, starts exactly after three seconds', () => {
  const s = Arena.create(), a = s.actors[0], x = a.x;
  for (let i = 0; i < C.COUNTDOWN_TICKS - 1; i++) Arena.step(s, { 1: { moveX: 1, jumpPressed: true } });
  assert.equal(s.phase, 'countdown'); assert.equal(s.countdownTicks, 1);
  assert.equal(a.x, x); assert.equal(s.timeLeftTicks, 10800);
  Arena.step(s); assert.equal(s.phase, 'playing');
  Arena.step(s, { 1: { moveX: 1 } });
  assert.ok(a.x > x); assert.equal(s.timeLeftTicks, 10799);
});

test('every stage is distinct, immutable, reachable and has safe spawns', () => {
  assert.equal(Arena.arenas.length, 3);
  assert.equal(new Set(Arena.arenas.map((a) => JSON.stringify(a.platforms))).size, 3);
  assert.equal(new Set(Arena.arenas.map((a) => a.theme.accent)).size, 3);
  for (const arena of Arena.arenas) {
    assert.equal(arena.width, 960); assert.equal(arena.height, 600);
    assert.ok(Object.isFrozen(arena.platforms));
    for (const spawn of arena.spawns) {
      assert.ok(arena.platforms.some((p) => spawn.x >= p.x && spawn.x + 24 <= p.x + p.w && spawn.y + 34 === p.y), arena.id);
    }
    const s = playing({ arenaId: arena.id, format: 'ffa' });
    for (let i = 0; i < 120; i++) Arena.step(s);
    assert.ok(s.actors.every((a) => a.stocks === 3 && a.onGround && Number.isFinite(a.x)));
  }
});

test('double jump is capped, jump release cuts height, landing restores jumps', () => {
  const s = playing(), actor = s.actors[0];
  Arena.step(s, { 1: { jumpPressed: true, jumpHeld: true } });
  assert.equal(actor.jumpCount, 1); assert.ok(actor.vy < -10);
  Arena.step(s, { 1: { jumpPressed: true, jumpHeld: true } });
  assert.equal(actor.jumpCount, 2);
  const velocity = actor.vy;
  Arena.step(s, { 1: { jumpPressed: true, jumpHeld: true } });
  assert.equal(actor.jumpCount, 2); assert.ok(actor.vy > velocity);
  Arena.step(s, { 1: { jumpHeld: false } });
  assert.ok(actor.vy > -6);
  for (let i = 0; i < 120; i++) Arena.step(s);
  assert.equal(actor.jumpCount, 0); assert.equal(actor.onGround, true);
});

test('coyote time permits a late ground jump and buffer fires after landing', () => {
  const s = playing(), a = s.actors[0];
  place(a, 805, 420, { onGround: true, supportId: 'dock', vx: 6.4, jumpCount: 0 });
  Arena.step(s, { 1: { moveX: 1 } });
  assert.equal(a.onGround, false);
  Arena.step(s, { 1: { jumpPressed: true, jumpHeld: true } });
  assert.equal(a.jumpCount, 1); assert.ok(a.vy < -10);
  place(a, 450, 416, { vy: 3, jumpCount: 2, jumpBufferTicks: 0 });
  Arena.step(s, { 1: { jumpPressed: true, jumpHeld: true } });
  assert.equal(a.jumpCount, 2); assert.ok(a.jumpBufferTicks > 0);
  for (let i = 0; i < 3; i++) Arena.step(s, { 1: { jumpHeld: true } });
  assert.equal(a.jumpCount, 1); assert.ok(a.vy < -10);
});

test('platforms are one-way and down+jump drops only through the supporting ledge', () => {
  const s = playing(), a = s.actors[0];
  place(a, 250, 302, { onGround: true, supportId: 'port' });
  Arena.step(s, { 1: { moveY: 1, jumpPressed: true } });
  assert.equal(a.onGround, false); assert.equal(a.dropPlatformId, 'port');
  for (let i = 0; i < 70; i++) Arena.step(s);
  assert.equal(a.supportId, 'dock'); assert.equal(a.y, 420);
  place(a, 250, 345, { vy: -12, jumpCount: 1 });
  Arena.step(s, { 1: { jumpHeld: true } });
  assert.ok(a.y < 345); assert.equal(a.onGround, false);
});

test('directional pulse damages once per swing and damage scales knockback', () => {
  const low = duelAtRange(), high = duelAtRange(100);
  const lowHit = firstHit(low, { 1: { attackPressed: true } });
  const highHit = firstHit(high, { 1: { attackPressed: true } });
  assert.equal(low.actors[1].damage, 12); assert.equal(high.actors[1].damage, 112);
  assert.ok(highHit.knockback > lowHit.knockback);
  assert.ok(high.actors[1].vx > low.actors[1].vx);
  const a = low.actors[0], b = low.actors[1];
  for (let i = 0; i < 6; i++) {
    place(b, a.x + 42, a.y, { damage: 12, onGround: true, supportId: 'dock' });
    Arena.step(low);
  }
  assert.equal(b.damage, 12, 're-entering the same swing does not damage twice');
  const left = duelAtRange(0, -1);
  firstHit(left, { 1: { attackPressed: true } });
  assert.ok(left.actors[1].vx < 0);
  const upward = playing();
  place(upward.actors[0], 450, 380, { vy: 0 });
  place(upward.actors[1], 450, 332, { vy: 0 });
  firstHit(upward, { 1: { moveY: -1, attackPressed: true } });
  assert.ok(upward.actors[1].vy < -8);
});

test('simultaneous attacks trade and no actor has first-iteration immunity', () => {
  const s = duelAtRange();
  s.actors[1].facing = -1;
  firstHit(s, { 1: { attackPressed: true }, 2: { attackPressed: true } });
  assert.equal(s.actors[0].damage, 12); assert.equal(s.actors[1].damage, 12);
  assert.equal(s.events.filter((e) => e.type === 'hit').length, 2);
});

test('friendly fire is disabled only in team matches', () => {
  const s = playing({ format: 'teams' });
  place(s.actors[0], 440, 420, { onGround: true, supportId: 'dock' });
  place(s.actors[1], 484, 420, { onGround: true, supportId: 'dock' });
  place(s.actors[2], 490, 420, { onGround: true, supportId: 'dock' });
  place(s.actors[3], 700, 420, { onGround: true, supportId: 'dock' });
  firstHit(s, { 1: { attackPressed: true } });
  assert.equal(s.actors[1].damage, 0); assert.equal(s.actors[2].damage, 12);
  const ffa = playing({ format: 'ffa' });
  place(ffa.actors[0], 440, 420, { onGround: true, supportId: 'dock' });
  place(ffa.actors[1], 484, 420, { onGround: true, supportId: 'dock' });
  firstHit(ffa, { 1: { attackPressed: true } });
  assert.equal(ffa.actors[1].damage, 12);
});

test('dash is short, grants dodge frames, respects cooldown and has one air use', () => {
  const s = playing(), a = s.actors[0];
  place(a, 450, 280, { jumpCount: 1 });
  Arena.step(s, { 1: { moveX: 1, dashPressed: true } });
  assert.equal(a.dashTicks, C.DASH_TICKS); assert.equal(a.invulnerable, C.DODGE_TICKS);
  assert.equal(a.airDashAvailable, false); assert.equal(a.dashCooldown, C.DASH_COOLDOWN);
  const dash = a.dashTicks;
  Arena.step(s, { 1: { moveX: -1, dashPressed: true } });
  assert.equal(a.dashTicks, dash - 1); assert.ok(a.vx > 0);
  a.dashCooldown = 0; a.dashTicks = 0; a.vx = 0; a.vy = 0;
  Arena.step(s, { 1: { moveX: -1, dashPressed: true } });
  assert.equal(a.dashTicks, 0, 'air dash cannot be refreshed by cooldown alone');
  const duel = duelAtRange();
  duel.actors[1].invulnerable = 20;
  Arena.step(duel, { 1: { attackPressed: true } });
  for (let i = 0; i < 11; i++) Arena.step(duel);
  assert.equal(duel.actors[1].damage, 0);
});

test('ringouts decrement one stock, award credit, wait, and respawn with a safe shield', () => {
  const s = playing(), a = s.actors[0];
  const arena = Arena.getArena(s.arenaId);
  a.damage = 120; a.lastHitBy = 2; a.y = arena.bounds.bottom + 1;
  Arena.step(s);
  assert.equal(a.stocks, 2); assert.equal(a.respawnTicks, C.RESPAWN_TICKS);
  assert.equal(s.actors[1].kos, 1); assert.equal(s.events[0].type, 'ringout');
  for (let i = 0; i < C.RESPAWN_TICKS - 1; i++) Arena.step(s);
  assert.equal(a.stocks, 2); assert.equal(a.respawnTicks, 1);
  Arena.step(s);
  assert.equal(a.respawnTicks, 0); assert.equal(a.damage, 0);
  assert.equal(a.invulnerable, C.RESPAWN_INVULNERABLE); assert.equal(a.onGround, true);
  assert.ok(s.events.some((e) => e.type === 'respawn'));
  assert.ok(arena.spawns.some((p) => p.x === a.x && p.y === a.y));
  Arena.step(s, { 1: { attackPressed: true } });
  assert.equal(a.invulnerable, 0, 'attacking ends the spawn shield');
});

test('last stock finishes; post-finish input cannot mutate the match or tick', () => {
  const s = playing();
  s.actors[1].stocks = 1; s.actors[1].x = 1200;
  Arena.step(s);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result, { winnerIds: [1], winnerTeam: null, tie: false, reason: 'stocks' });
  const tick = s.tick, actors = Arena.snapshot(s).actors;
  Arena.step(s, { 1: { jumpPressed: true }, 2: { attackPressed: true } });
  assert.equal(s.tick, tick); assert.deepEqual(s.actors, actors); assert.deepEqual(s.events, []);
});

test('same-tick final ringouts are a deterministic tie', () => {
  const s = playing();
  s.actors.forEach((a) => { a.stocks = 1; a.y = 900; });
  Arena.step(s);
  assert.deepEqual(s.result, { winnerIds: [], winnerTeam: null, tie: true, reason: 'stocks' });
  assert.equal(s.events.filter((e) => e.type === 'ringout').length, 2);
});

test('timeout ranks stocks then lower damage, exact ties stay ties, teams sum stocks', () => {
  const s = playing(); s.timeLeftTicks = 1;
  s.actors[0].damage = 35; s.actors[1].damage = 40;
  Arena.step(s); assert.deepEqual(s.result.winnerIds, [1]); assert.equal(s.result.reason, 'time');
  const tie = playing(); tie.timeLeftTicks = 1;
  Arena.step(tie); assert.equal(tie.result.tie, true); assert.deepEqual(tie.result.winnerIds, [1, 2]);
  const stocks = playing(); stocks.timeLeftTicks = 1;
  stocks.actors[0].stocks = 2; stocks.actors[1].damage = 200;
  Arena.step(stocks); assert.deepEqual(stocks.result.winnerIds, [2]);
  const teams = playing({ format: 'teams' }); teams.timeLeftTicks = 1;
  teams.actors[0].stocks = 0; teams.actors[1].stocks = 3;
  teams.actors[2].stocks = 1; teams.actors[3].stocks = 1;
  Arena.step(teams); assert.equal(teams.result.winnerTeam, 0); assert.deepEqual(teams.result.winnerIds, [1, 2]);
  const teamTie = playing({ format: 'teams' }); teamTie.timeLeftTicks = 1;
  Arena.step(teamTie); assert.equal(teamTie.result.tie, true); assert.equal(teamTie.result.winnerTeam, null);
});

test('seeded explicit command streams reproduce every state, event and controller decision', () => {
  const a = Arena.create({ arenaId: 'bloom-reactor', format: 'ffa', seed: 746 }), b = Arena.create({ arenaId: 'bloom-reactor', format: 'ffa', seed: 746 });
  for (let tick = 0; tick < 1900; tick++) {
    const ca = commandStream(a, tick), cb = commandStream(b, tick);
    assert.deepEqual(ca, cb);
    Arena.step(a, ca); Arena.step(b, cb);
    assert.deepEqual(a.events, b.events);
  }
  assert.deepEqual(a, b);
  assert.notEqual(Arena.create({ seed: 1 }).actors[1].ai.rngState, Arena.create({ seed: 2 }).actors[1].ai.rngState);
});

test('snapshot/restore is detached JSON, including PRNG and pending CPU decisions', () => {
  const a = Arena.create({ arenaId: 'ember-foundry', format: 'teams', seed: 9001 });
  for (let i = 0; i < 437; i++) Arena.step(a, commandStream(a, i));
  // Snapshot in the middle of a tick after just one CPU has decided.
  const decided = Arena.cpuInput(a, 2);
  const saved = JSON.parse(JSON.stringify(Arena.snapshot(a))), b = Arena.restore(saved);
  assert.deepEqual(Arena.cpuInput(b, 2), decided);
  assert.notEqual(b.actors, saved.actors); assert.notEqual(b.actors[0].ai, saved.actors[0].ai);
  for (let i = 437; i < 2100; i++) {
    Arena.step(a, commandStream(a, i)); Arena.step(b, commandStream(b, i));
  }
  assert.deepEqual(a, b);
  saved.actors[0].x = 9999; assert.notEqual(b.actors[0].x, 9999);
  assert.throws(() => Arena.restore({}), /Invalid arena snapshot/);
  const invalid = Arena.snapshot(a); invalid.actors[0].x = NaN;
  assert.throws(() => Arena.restore(invalid), /Invalid arena snapshot number/);
});

test('CPU reads are cached per tick, order-independent and never implicit in step', () => {
  const a = playing({ format: 'ffa', seed: 19 }), b = Arena.restore(Arena.snapshot(a));
  const first = Arena.cpuInput(a, 2), after = Arena.snapshot(a);
  assert.deepEqual(Arena.cpuInput(a, 2), first); assert.deepEqual(a, after);
  first.moveX = 99; assert.notEqual(Arena.cpuInput(a, 2).moveX, 99);
  const orderA = {}, orderB = {};
  for (const id of [2, 3, 4]) orderA[id] = Arena.cpuInput(a, id);
  for (const id of [4, 3, 2]) orderB[id] = Arena.cpuInput(b, id);
  assert.deepEqual(orderA, orderB); assert.deepEqual(a, b);
  assert.deepEqual(Arena.cpuInput(a, 1), Arena.normalizeCommand());
  assert.deepEqual(Arena.cpuInput(a, 900), Arena.normalizeCommand());
  const still = playing(); const x = still.actors[1].x;
  for (let i = 0; i < 120; i++) Arena.step(still, {});
  assert.equal(still.actors[1].x, x);
});

test('30/60/120 Hz render schedules yield identical fixed-tick match state', () => {
  function run(renderHz) {
    const state = Arena.create({ arenaId: 'orbital-dock', format: 'teams', seed: 984 });
    let tick = 0, units = 0;
    for (let frame = 0; frame < renderHz * 25; frame++) {
      units += 120 / renderHz;
      while (units >= 2) { Arena.step(state, commandStream(state, tick++)); units -= 2; }
      // Render interpolation only reads values; no rendering input enters step.
      state.actors.map((a) => [a.px + (a.x - a.px) * units / 2, a.py + (a.y - a.py) * units / 2]);
    }
    assert.equal(tick, 1500);
    return state;
  }
  assert.deepEqual(run(30), run(60)); assert.deepEqual(run(60), run(120));
});

test('CPUs react with delay, fight and reach a terminal result on every arena and format', () => {
  for (const arena of Arena.arenas) for (const format of ['duel', 'ffa', 'teams']) {
    const s = Arena.create({ arenaId: arena.id, format, seed: 42 });
    s.actors.forEach((a) => { a.controller = 'cpu'; });
    let hits = 0, jumps = 0;
    while (s.phase !== 'over' && s.tick <= C.MATCH_TICKS + C.COUNTDOWN_TICKS) {
      allCpuStep(s);
      hits += s.events.filter((e) => e.type === 'hit').length;
      jumps += s.events.filter((e) => e.type === 'jump').length;
      assert.ok(s.actors.every((a) => Number.isFinite(a.x) && Number.isFinite(a.y)));
    }
    assert.equal(s.phase, 'over', `${arena.id}/${format} ends`);
    assert.ok(hits >= 15, `${arena.id}/${format} has meaningful combat (${hits})`);
    assert.ok(jumps >= 5, `${arena.id}/${format} uses jumps (${jumps})`);
  }
  const s = playing(); Arena.cpuInput(s, 2);
  assert.ok(s.actors[1].ai.nextThinkTick > s.tick + 1);
});

test('CPU recovery steers toward a reachable ledge and uses ordinary jump commands', () => {
  for (const arena of Arena.arenas) {
    const s = playing({ arenaId: arena.id, seed: 8 }), bot = s.actors[1];
    const floor = arena.platforms[0];
    place(bot, floor.x - 70, floor.y - 65, { vx: -1, vy: 1, jumpCount: 1 });
    bot.ai.nextThinkTick = 0; bot.ai.lastTick = -1;
    const command = Arena.cpuInput(s, bot.id);
    assert.equal(command.moveX, 1, arena.id);
    assert.equal(command.jumpPressed, true, arena.id);
    let landed = false;
    for (let i = 0; i < 160; i++) {
      allCpuStep(s);
      if (bot.onGround) { landed = true; break; }
    }
    assert.ok(landed, `${arena.id} recovers to a platform`);
    assert.equal(bot.stocks, 3, `${arena.id} no recovery death`);
  }
});

test('CPU navigation climbs to a high target instead of running beneath forever', () => {
  for (const arena of Arena.arenas) {
    const s = playing({ arenaId: arena.id, seed: 8 }), [human, bot] = s.actors;
    const high = arena.platforms.reduce((a, b) => a.y < b.y ? a : b);
    place(human, high.x + high.w / 2 - 12, high.y - 34, { onGround: true, supportId: high.id });
    let reached = false;
    for (let i = 0; i < 1000; i++) {
      allCpuStep(s);
      if (bot.y <= high.y + 15) { reached = true; break; }
    }
    assert.ok(reached, `${arena.id} climbs into target height`);
    assert.equal(bot.stocks, 3, `${arena.id} does not chase into void`);
  }
});

test('remaining CPUs keep connecting attacks after a human runs out of stocks', () => {
  // Regression: full-speed pursuit crossed through a target during windup and
  // three synchronized bots could throw 1,000 misses until the match timed out.
  for (const arena of Arena.arenas) {
    const state = Arena.create({ arenaId: arena.id, format: 'teams', seed: 1 });
    let hitsAfterElimination = 0;
    while (state.phase !== 'over') {
      const commands = { 1: { moveX: 1 } };
      for (const actor of state.actors) if (actor.controller === 'cpu') commands[actor.id] = Arena.cpuInput(state, actor.id);
      Arena.step(state, commands);
      if (!state.actors[0].stocks) hitsAfterElimination += state.events.filter((e) => e.type === 'hit').length;
    }
    assert.equal(state.result.reason, 'stocks', `${arena.id} does not stall to timeout`);
    assert.ok(hitsAfterElimination > 10, `${arena.id} keeps fighting (${hitsAfterElimination} hits)`);
  }
});

test('all three CPU difficulties finish seeded duels and obey the shared command shape', () => {
  for (const difficulty of Object.keys(Arena.difficulties)) for (const arena of Arena.arenas) {
    const state = Arena.create({ arenaId: arena.id, difficulty, seed: 12 });
    state.actors.forEach((a) => { a.controller = 'cpu'; });
    let hits = 0;
    while (state.phase !== 'over') {
      const commands = {};
      for (const actor of state.actors) {
        const command = Arena.cpuInput(state, actor.id);
        assert.deepEqual(command, Arena.normalizeCommand(command));
        commands[actor.id] = command;
      }
      Arena.step(state, commands);
      hits += state.events.filter((e) => e.type === 'hit').length;
    }
    assert.equal(state.result.reason, 'stocks', `${arena.id}/${difficulty}`);
    assert.ok(hits >= 15, `${arena.id}/${difficulty} produces combat`);
  }
});

test('both blast-zone sides, bottom and top consume stocks using the same rule', () => {
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const state = playing(), actor = state.actors[0], bounds = Arena.getArena(state.arenaId).bounds;
    if (side === 'left') actor.x = bounds.left - actor.w - 2;
    if (side === 'right') actor.x = bounds.right + 2;
    if (side === 'top') actor.y = bounds.top - actor.h - 2;
    if (side === 'bottom') actor.y = bounds.bottom + 2;
    Arena.step(state);
    assert.equal(actor.stocks, 2, side);
    assert.equal(state.events.filter((e) => e.type === 'ringout').length, 1, side);
  }
});

test('simultaneous opposing pulses combine independently of actor iteration order', () => {
  function hitInOrder(ids) {
    const s = playing({ format: 'ffa' });
    place(s.actors[0], 390, 420, { onGround: true, supportId: 'dock', facing: 1 });
    place(s.actors[1], 430, 420, { onGround: true, supportId: 'dock' });
    place(s.actors[2], 470, 420, { onGround: true, supportId: 'dock', facing: -1 });
    place(s.actors[3], 700, 420, { onGround: true, supportId: 'dock' });
    s.actors = ids.map((id) => s.actors.find((a) => a.id === id));
    Arena.step(s, { 1: { attackPressed: true }, 3: { attackPressed: true } });
    for (let i = 0; i < C.ATTACK_WINDUP; i++) Arena.step(s);
    return s;
  }
  const normal = hitInOrder([1, 2, 3, 4]);
  const reversed = hitInOrder([4, 3, 2, 1]);
  const mixed = hitInOrder([2, 4, 1, 3]);
  const target = normal.actors.find((a) => a.id === 2);
  assert.equal(target.damage, 24);
  assert.equal(target.vx, 0, 'opposing equal pulses cancel horizontal force');
  assert.ok(target.vy < 0);
  assert.equal(target.lastHitBy, 1, 'equal contributors tie by stable ID');
  for (const state of [reversed, mixed]) {
    assert.deepEqual(state.actors.slice().sort((a, b) => a.id - b.id), normal.actors);
    assert.deepEqual(state.events, normal.events);
  }
  assert.equal(normal.events.filter((e) => e.type === 'hit' && e.targetId === 2).length, 2);
  // The same deterministic credit is used if this combined impact rings out.
  for (const state of [normal, reversed, mixed]) {
    state.actors.find((a) => a.id === 2).y = 900;
    Arena.step(state);
    assert.equal(state.actors.find((a) => a.id === 1).kos, 1);
    assert.equal(state.actors.find((a) => a.id === 3).kos, 0);
  }
});

test('a final-tick ringout clears spent-stock damage before the timeout tiebreak', () => {
  const s = playing();
  s.actors[0].stocks = 2; s.actors[0].damage = 10;
  s.actors[1].stocks = 3; s.actors[1].damage = 100;
  s.actors[1].y = Arena.getArena(s.arenaId).bounds.bottom + 1;
  s.timeLeftTicks = 1;
  Arena.step(s);
  assert.equal(s.actors[1].stocks, 2);
  assert.equal(s.actors[1].respawnTicks, C.RESPAWN_TICKS);
  assert.equal(s.actors[1].damage, 0);
  assert.deepEqual(s.result, { winnerIds: [2], winnerTeam: null, tie: false, reason: 'time' });
  // With the same remaining stocks/damage after respawn, the outcome agrees.
  const afterRespawn = playing();
  afterRespawn.actors[0].stocks = 2; afterRespawn.actors[0].damage = 10;
  afterRespawn.actors[1].stocks = 2; afterRespawn.actors[1].damage = 0;
  afterRespawn.timeLeftTicks = 1;
  Arena.step(afterRespawn);
  assert.deepEqual(s.result, afterRespawn.result);
});
