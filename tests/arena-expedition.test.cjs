const test = require('node:test');
const assert = require('node:assert/strict');
const Arena = require('../src/arena.js');
const C = Arena.constants;

function encounter(options = {}) {
  const state = Arena.create({ encounter: 'boss', countdownTicks: 0, wingmate: false, ...options });
  for (const actor of state.actors) actor.invulnerable = 0;
  return state;
}
function place(actor, x, floor = 454) {
  Object.assign(actor, { x, y: floor - actor.h, px: x, py: floor - actor.h, vx: 0, vy: 0, invulnerable: 0, onGround: true, supportId: 'dock', stun: 0, attackTicks: 0, dashTicks: 0, jumpCount: 0 });
}
function readyBoss(options = {}) {
  const state = encounter(options), boss = state.actors.find((a) => a.boss);
  place(boss, 460); place(state.actors[0], 530);
  boss.boss.phaseTicks = 0;
  return { state, boss, human: state.actors[0] };
}
function startSpecial(state, boss) { Arena.step(state, { [boss.id]: { attackPressed: true } }); }
function until(state, condition, commands = () => ({}), max = 300) {
  for (let i = 0; i < max && !condition(); i++) Arena.step(state, commands());
  assert.ok(condition(), 'expected state reached within bounded ticks');
}
function cpuCommands(state) {
  const commands = {};
  for (const actor of state.actors) if (actor.controller === 'cpu') commands[actor.id] = Arena.cpuInput(state, actor.id);
  return commands;
}

test('expedition options are bounded canonical JSON and do not leak into standalone arena', () => {
  const ordinary = Arena.create({ seed: 91 });
  assert.deepEqual(Arena.create({ seed: 91, encounter: 'unknown', bossTier: 5, stocks: 1, durationTicks: 900, countdownTicks: 0 }), ordinary);
  assert.deepEqual(Arena.create({ seed: 91, stocks: 1, durationTicks: 900, countdownTicks: 0 }), ordinary);
  assert.equal(ordinary.encounter, undefined);
  assert.equal(ordinary.countdownTicks, C.COUNTDOWN_TICKS);
  assert.equal(ordinary.timeLeftTicks, C.MATCH_TICKS);
  const skirmish = Arena.create({ encounter: 'skirmish' });
  assert.deepEqual(skirmish.encounter, { type: 'skirmish', durationTicks: 2100, countdownTicks: 60, stocks: 2 });
  assert.deepEqual(skirmish.actors.map((a) => a.stocks), [2, 2]);
  const defaults = Arena.create({ encounter: 'boss', durationTicks: Infinity, bossTier: NaN });
  assert.deepEqual(defaults.encounter, { type: 'boss', durationTicks: 3300, countdownTicks: 60, stocks: 2, bossTier: 1, wingmate: true });
  const bounded = Arena.create({ encounter: 'boss', durationTicks: 1e9, countdownTicks: -1, stocks: 99, bossTier: 300, wingmate: false });
  assert.deepEqual(bounded.encounter, { type: 'boss', durationTicks: 5400, countdownTicks: 0, stocks: 3, bossTier: 5, wingmate: false });
  assert.equal(bounded.phase, 'playing');
  assert.deepEqual(Arena.restore(Arena.snapshot(bounded)), bounded);
  const minimum = Arena.create({ encounter: 'skirmish', durationTicks: -1, stocks: 0, countdownTicks: 999 });
  assert.equal(minimum.encounter.durationTicks, 900);
  assert.equal(minimum.encounter.stocks, 1);
  assert.equal(minimum.encounter.countdownTicks, 180);
});

test('boss encounter has one genuine larger enemy and optional friendly CPU with safe stage spawns', () => {
  for (const arena of Arena.arenas) for (const wingmate of [false, true]) {
    const state = Arena.create({ encounter: 'boss', arenaId: arena.id, format: 'ffa', wingmate });
    const boss = state.actors.find((a) => a.boss);
    assert.equal(state.format, 'teams');
    assert.equal(state.actors.length, wingmate ? 3 : 2);
    assert.deepEqual(state.actors.map((a) => a.team), wingmate ? [0, 0, 1] : [0, 1]);
    assert.equal(state.actors[0].controller, 'human');
    assert.equal(state.actors.filter((a) => a.boss).length, 1);
    assert.ok(boss.w > C.FIGHTER_W * 2 && boss.h > C.FIGHTER_H * 2);
    assert.equal(boss.stocks, 1);
    assert.equal(boss.boss.health, boss.boss.maxHealth);
    assert.ok(state.actors.every((a) => arena.platforms.some((p) => a.y + a.h === p.y && a.x >= p.x && a.x + a.w <= p.x + p.w)));
    assert.deepEqual(Arena.restore(Arena.snapshot(state)), state);
  }
});

test('short expedition countdown freezes physics and time, including zero-countdown start', () => {
  const state = Arena.create({ encounter: 'skirmish', countdownTicks: 7 });
  const bodies = Arena.snapshot(state).actors;
  for (let i = 0; i < 7; i++) Arena.step(state, { 1: { moveX: 1 } });
  assert.equal(state.phase, 'playing');
  assert.deepEqual(state.actors, bodies);
  assert.equal(state.timeLeftTicks, 2100);
  Arena.step(state); assert.equal(state.timeLeftTicks, 2099);
  const zero = encounter();
  Arena.step(zero); assert.equal(zero.timeLeftTicks, 3299);
});

test('boss special requires explicit CPU command and its warning never damages early', () => {
  const { state, boss, human } = readyBoss();
  for (let i = 0; i < 120; i++) Arena.step(state);
  assert.equal(boss.boss.phase, 'idle'); assert.equal(boss.boss.cycle, 0);
  startSpecial(state, boss);
  assert.equal(boss.boss.phase, 'charging');
  assert.ok(boss.boss.phaseTicks >= 49);
  assert.ok(state.events.some((e) => e.type === 'boss-warning' && e.move === 'shockwave'));
  const box = Arena.bossAttackBox(boss);
  assert.equal(box.active, false); assert.equal(box.move, 'shockwave');
  box.x = 999999;
  assert.notEqual(Arena.bossAttackBox(boss).x, box.x, 'renderer receives a detached rectangle');
  while (boss.boss.phaseTicks > 1) {
    Arena.step(state);
    assert.equal(human.damage, 0);
  }
  Arena.step(state);
  assert.equal(boss.boss.phase, 'active');
  assert.equal(human.damage, 14);
  assert.ok(state.events.some((e) => e.type === 'boss-strike'));
  for (let i = 0; i < 5; i++) { place(human, 530); Arena.step(state); }
  assert.equal(human.damage, 14, 'each special hits a body once');
});

test('shockwave has a real jump opening and invulnerability respects active collision', () => {
  const jumping = readyBoss(); startSpecial(jumping.state, jumping.boss);
  while (jumping.boss.boss.phaseTicks > 16) Arena.step(jumping.state);
  Arena.step(jumping.state, { 1: { jumpPressed: true, jumpHeld: true } });
  until(jumping.state, () => jumping.boss.boss.phase === 'recover', () => ({ 1: { jumpHeld: true } }));
  assert.equal(jumping.human.damage, 0);
  const shielded = readyBoss(); startSpecial(shielded.state, shielded.boss);
  shielded.human.invulnerable = 100;
  until(shielded.state, () => shielded.boss.boss.phase === 'recover');
  assert.equal(shielded.human.damage, 0);
});

test('boss alternates a dodgeable locked column with the ground wave and exposes recovery', () => {
  const { state, boss, human } = readyBoss();
  boss.boss.cycle = 1;
  startSpecial(state, boss);
  assert.equal(boss.boss.move, 'lance');
  const locked = Arena.bossAttackBox(boss);
  assert.ok(locked.x < human.x + human.w / 2 && locked.x + locked.w > human.x + human.w / 2);
  assert.equal(locked.h, Arena.getArena(state.arenaId).bounds.bottom - Arena.getArena(state.arenaId).bounds.top);
  place(human, 280);
  Arena.step(state);
  assert.deepEqual(Arena.bossAttackBox(boss), locked, 'warning cannot follow a dodging player');
  until(state, () => boss.boss.phase === 'recover');
  assert.equal(human.damage, 0);
  assert.equal(boss.boss.phaseTicks, 78);
  assert.equal(Arena.bossAttackBox(boss), null);
  assert.ok(state.events.some((e) => e.type === 'boss-exposed'));
  until(state, () => boss.boss.phase === 'idle' && boss.boss.phaseTicks === 0);
  startSpecial(state, boss);
  assert.equal(boss.boss.move, 'shockwave');
});

function pulseBoss(phase, wingmate = false) {
  const { state, boss, human } = readyBoss({ wingmate });
  place(human, 420); human.facing = 1;
  if (wingmate) place(state.actors[1], 430);
  boss.boss.phase = phase; boss.boss.phaseTicks = 60; boss.boss.phaseDuration = 78;
  const before = boss.boss.health;
  Arena.step(state, { 1: { attackPressed: true } });
  until(state, () => state.events.some((e) => e.type === 'hit' && e.targetId === boss.id));
  return { state, boss, human, damage: before - boss.boss.health };
}

test('pulses chip the boss core, recovery doubles damage and friendly wingmate cannot be hit', () => {
  const armored = pulseBoss('charging'), open = pulseBoss('recover', true);
  assert.equal(armored.damage, C.ATTACK_DAMAGE);
  assert.equal(open.damage, C.ATTACK_DAMAGE * 2);
  assert.equal(open.state.actors[1].damage, 0);
  assert.equal(armored.boss.stun, 0, 'telegraph cannot be stun-locked');
  assert.equal(armored.boss.boss.phase, 'charging');
  assert.equal(armored.boss.vx, 0);
});

test('depleting boss health wins once; surviving until timeout does not create a free team victory', () => {
  const { state, boss, human } = readyBoss();
  place(human, 420); human.facing = 1;
  boss.boss.health = 12; boss.boss.phaseTicks = 70;
  Arena.step(state, { 1: { attackPressed: true } });
  until(state, () => state.phase === 'over');
  assert.equal(boss.stocks, 0); assert.equal(boss.boss.phase, 'defeated');
  assert.deepEqual(state.result, { winnerIds: [1], winnerTeam: 0, tie: false, reason: 'stocks' });
  assert.equal(human.kos, 1);
  assert.equal(state.events.filter((e) => e.type === 'boss-defeated').length, 1);
  const ended = Arena.snapshot(state);
  Arena.step(state, { 1: { attackPressed: true } });
  assert.deepEqual(state.actors, ended.actors);
  assert.equal(state.tick, ended.tick);
  assert.deepEqual(Arena.restore(Arena.snapshot(state)), state);
  const timeout = encounter({ wingmate: true }); timeout.timeLeftTicks = 1;
  Arena.step(timeout);
  assert.deepEqual(timeout.result, { winnerIds: [3], winnerTeam: 1, tie: false, reason: 'time' });
});

test('crew loss and simultaneous final losses preserve ordinary stock result semantics', () => {
  const state = encounter({ stocks: 1 });
  state.actors[0].y = 900; Arena.step(state);
  assert.equal(state.result.winnerTeam, 1);
  const tie = encounter({ stocks: 1 });
  tie.actors.forEach((a) => { a.y = 900; }); Arena.step(tie);
  assert.equal(tie.result.tie, true);
  assert.deepEqual(tie.result.winnerIds, []);
});

test('boss snapshots resume every phase and cached commands without changing the seeded result', () => {
  const a = encounter({ wingmate: true, seed: 936 });
  a.actors[0].controller = 'cpu';
  const phases = new Set();
  while (a.phase !== 'over') {
    const boss = a.actors.find((actor) => actor.boss);
    if (!phases.has(boss.boss.phase)) {
      phases.add(boss.boss.phase);
      const cached = Arena.cpuInput(a, 2), copy = Arena.restore(Arena.snapshot(a));
      assert.deepEqual(Arena.cpuInput(copy, 2), cached);
      for (let i = 0; i < 20; i++) {
        const ca = cpuCommands(a), cb = cpuCommands(copy);
        assert.deepEqual(ca, cb);
        Arena.step(a, ca); Arena.step(copy, cb);
        assert.deepEqual(a, copy);
      }
    } else Arena.step(a, cpuCommands(a));
  }
  assert.ok(['idle', 'charging', 'active', 'recover'].every((phase) => phases.has(phase)));
  assert.deepEqual(Arena.restore(Arena.snapshot(a)), a);
});

test('restore rejects malformed encounter options, boss roster, health and attack state', () => {
  const initial = Arena.create({ encounter: 'boss' });
  const invalid = [
    (s) => { s.encounter.durationTicks = Infinity; },
    (s) => { s.encounter.bossTier = 99; },
    (s) => { s.encounter.wingmate = 1; },
    (s) => { s.encounter.untrusted = true; },
    (s) => { s.format = 'ffa'; },
    (s) => { s.actors.pop(); },
    (s) => { delete s.actors[2].boss; },
    (s) => { s.actors[1].team = 1; },
    (s) => { s.actors[2].boss.health = -1; },
    (s) => { s.actors[2].boss.maxHealth = 9999; },
    (s) => { s.actors[2].w = 24; },
    (s) => { s.actors[2].boss.phase = 'charging'; },
    (s) => { s.actors[2].boss.phaseTicks = 999; },
    (s) => { s.actors[2].boss.hitIds = [1, 1]; },
    (s) => { s.actors[2].boss.attack = { x: NaN, y: 0, w: 4, h: 4 }; },
    (s) => { s.actors[2].boss.phase = 'defeated'; },
    (s) => { s.timeLeftTicks = 5500; },
  ];
  for (const corrupt of invalid) {
    const copy = Arena.snapshot(initial); corrupt(copy);
    assert.throws(() => Arena.restore(copy), /Invalid arena snapshot/);
  }
});

test('explicit CPU boss battles are bounded, varied and winnable across tiers and arenas', () => {
  for (const arena of Arena.arenas) for (const tier of [1, 5]) for (const wingmate of [false, true]) {
    const state = encounter({ arenaId: arena.id, bossTier: tier, wingmate, seed: 42 });
    state.actors[0].controller = 'cpu';
    const moves = new Set(); let coreHits = 0;
    while (state.phase !== 'over') {
      Arena.step(state, cpuCommands(state));
      for (const e of state.events) {
        if (e.type === 'boss-warning') moves.add(e.move);
        if (e.type === 'hit' && e.boss) coreHits++;
      }
      assert.ok(state.tick <= state.encounter.durationTicks);
      assert.ok(state.actors.every((a) => Number.isFinite(a.x) && Number.isFinite(a.y)));
    }
    assert.equal(state.result.winnerTeam, 0, `${arena.id}, tier ${tier}, wingmate ${wingmate}`);
    assert.ok(coreHits >= 10);
    assert.deepEqual([...moves].sort(), ['lance', 'shockwave']);
  }
});

test('support wingmate does not finish the encounter before the player has time to engage', () => {
  const state = encounter({ wingmate: true, seed: 42 });
  for (let i = 0; i < 25 * C.TICK_RATE; i++) Arena.step(state, cpuCommands(state));
  assert.equal(state.phase, 'playing');
  assert.ok(state.actors.find((a) => a.boss).boss.health > 0);
});

const Online = require('../src/arena-online.js');
const journey = { journey: true };
const crew = Array.from({ length: 4 }, (_, i) => ({ p: i + 1, identity: 'crew-' + (i + 1), role: 0 }));

test('shared boss supports four safe crew slots and one enemy without displacing friends', () => {
  for (const arena of Arena.arenas) {
    const state = encounter({ arenaId: arena.id, crewCount: 4 });
    assert.equal(state.actors.length, 5);
    assert.deepEqual(state.actors.map((a) => a.team), [0, 0, 0, 0, 1]);
    assert.ok(state.actors.every((a) => arena.platforms.some((p) => a.y + a.h === p.y && a.x >= p.x && a.x + a.w <= p.x + p.w)));
    assert.equal(new Set(state.actors.map((a) => a.x + ',' + a.y)).size, 5);
    assert.deepEqual(Arena.restore(Arena.snapshot(state)), state);
    const host = Online.createHost({ encounter: 'boss', arenaId: arena.id, crewCount: 4 }, journey);
    host.syncRoster(crew, 0);
    assert.equal(host.start(71), true);
    assert.deepEqual(host.seats.map((s) => [s.p, s.actorId]), [[1, 1], [2, 2], [3, 3], [4, 4]]);
    assert.deepEqual(host.state.actors.map((a) => a.controller), ['human', 'human', 'human', 'human', 'cpu']);
    assert.equal(host.setTeam(1, 1), false, 'no friend may take the Sentinel seat');
    const packet = host.packet();
    const copy = Online.decodeSnapshot(packet, journey);
    assert.ok(copy); assert.equal(copy.state.actors[4].boss.health, state.actors[4].boss.health);
    assert.deepEqual(copy.state.encounter, host.state.encounter);
  }
  const host = Online.createHost({ encounter: 'boss', crewCount: 4 }, journey);
  host.syncRoster(crew.slice(0, 2), 0);
  assert.deepEqual(host.state.actors.map((a) => a.controller), ['human', 'human', 'cpu', 'cpu', 'cpu']);
  const capped = encounter({ crewCount: 999 }); assert.equal(capped.actors.length, 5);
  const solo = encounter({ crewCount: 0, wingmate: true }); assert.equal(solo.actors.length, 2);
  assert.equal(solo.encounter.wingmate, false);
});

test('standalone authority ignores expedition rules and preserves VERSION1 bytes exactly', () => {
  const crypto = require('node:crypto');
  // Recorded from the pre-expedition VERSION1 encoder for this seeded stream.
  const hashes = {
    duel: 'b46b628d2c9caaeaf72107f1db6b9cf42d5dd8ea3355c0e43157478a18c67a13',
    ffa: '9483f688b3823b94056199e6940afea315326d20c9ba9f32b2663ac9593e4627',
    teams: '4ee2bbb0fece8384b4294c9e7df91d2ad6bf93c450f6a3b8c890521d9827c102',
  };
  for (const format of ['duel', 'ffa', 'teams']) {
    const host = Online.createHost({ arenaId: 'ember-foundry', format, difficulty: 'hard', encounter: 'boss', crewCount: 4, stocks: 1, countdownTicks: 0 });
    assert.equal(host.state.encounter, undefined); assert.equal(host.state.format, format);
    host.syncRoster([{ p: 1, identity: 'a', role: 0 }, { p: 2, identity: 'b', role: 0 }], 0);
    host.start(47);
    for (let i = 0; i < 410; i++) host.step(i * 1000 / 60);
    const packet = host.packet();
    assert.equal(packet[0], 1);
    assert.equal(crypto.createHash('sha256').update(packet).digest('hex'), hashes[format]);
    assert.ok(Online.decodeSnapshot(packet));
    assert.equal(Online.decodeSnapshot(packet, journey), null);
  }
});

test('journey snapshot and input versions are opt-in and cannot cross standalone authority', () => {
  const config = { encounter: 'boss', crewCount: 4, countdownTicks: 0 };
  const host = Online.createHost(config, journey); host.syncRoster(crew, 0); host.start(12);
  const client = Online.createClient({ journey: true, config });
  const packet = host.packet();
  assert.equal(packet[0], 2);
  assert.equal(Online.decodeSnapshot(packet), null);
  assert.equal(Online.createClient().accept(packet), null);
  assert.equal(client.accept(packet, 2), null, 'only authenticated host sends authoritative state');
  assert.ok(client.accept(packet));
  const input = client.input({ moveX: 1, jumpPressed: true }, 1);
  assert.equal(input.length, Online.INPUT_BYTES); assert.equal(input[0], 2);
  assert.equal(Online.decodeInput(input), null);
  assert.ok(Online.decodeInput(input, journey));
  assert.equal(host.receive(1, 'crew-1', input, 0), true);
  assert.equal(host.receive(2, 'crew-1', input, 0), false);
  host.step(0); assert.ok(host.state.actors[0].x > 170);
  assert.equal(host.receive(1, 'crew-1', Uint8Array.from([1, ...input.slice(1)]), 17), false);
  assert.equal(Online.decodeSnapshot(packet, { journey: true, config: { ...config, bossTier: 5 } }), null);
});

test('journey codecs preserve every telegraph, hit, recovery and defeat within the transport cap', () => {
  const host = Online.createHost({ encounter: 'boss', crewCount: 4, countdownTicks: 0, seed: 3 }, journey);
  host.start(3); // Empty seats are ordinary CPUs, making the combat reproducible.
  const phases = new Set(), events = new Set();
  const client = Online.createClient(journey);
  let biggest = 0;
  while (host.state.phase !== 'over') {
    host.step(host.state.tick * 1000 / 60);
    const packet = host.packet(), copy = client.accept(packet);
    biggest = Math.max(biggest, packet.length);
    assert.ok(copy); assert.ok(packet.length <= Online.JOURNEY_MAX_BYTES);
    assert.deepEqual(copy.state.encounter, host.state.encounter);
    const live = host.state.actors[4].boss, decoded = copy.state.actors[4].boss;
    phases.add(decoded.phase);
    for (const e of copy.state.events) events.add(e.type);
    for (const key of ['phase', 'move', 'phaseTicks', 'phaseDuration', 'health', 'maxHealth', 'cycle']) assert.equal(decoded[key], live[key]);
    if (live.attack) for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(decoded.attack[key] - live.attack[key]) < 0.001);
    assert.deepEqual(Arena.restore(Arena.snapshot(copy.state)).encounter, host.state.encounter);
  }
  assert.ok(['idle', 'charging', 'active', 'recover', 'defeated'].every((phase) => phases.has(phase)));
  assert.ok(['boss-warning', 'boss-strike', 'boss-exposed', 'boss-defeated'].every((type) => events.has(type)));
  assert.ok(biggest <= 620, 'five actors, boss state and twelve presentation events remain bounded');
  assert.deepEqual(client.current.state.result, host.state.result);
});

test('journey skirmish clocks and stock goals roundtrip with all four crew inputs', () => {
  const config = { encounter: 'skirmish', format: 'ffa', durationTicks: 900, countdownTicks: 0, stocks: 1 };
  const host = Online.createHost(config, journey); host.syncRoster(crew, 0); host.start(5);
  const clients = crew.map(() => Online.createClient({ journey: true, config }));
  for (let i = 0; i < 901 && host.state.phase !== 'over'; i++) {
    const packet = host.packet();
    for (let j = 0; j < clients.length; j++) {
      assert.ok(clients[j].accept(packet));
      const input = clients[j].input({ moveX: j % 2 ? -0.2 : 0.2, attackPressed: i % 80 === 0 }, j + 1);
      if (input) assert.equal(host.receive(j + 1, crew[j].identity, input, i * 1000 / 60), true);
    }
    host.step(i * 1000 / 60);
  }
  assert.equal(host.state.phase, 'over'); assert.ok(host.state.tick <= 900);
  const copy = Online.decodeSnapshot(host.packet(), { journey: true, config });
  assert.deepEqual(copy.state.encounter, host.state.encounter);
  assert.deepEqual(copy.state.result, host.state.result);
});

test('journey decoder rejects truncation, wrong configuration, boss ownership and invalid geometry', () => {
  const host = Online.createHost({ encounter: 'boss', crewCount: 4, countdownTicks: 0 }, journey); host.start(9);
  while (host.state.actors[4].boss.phase !== 'charging') host.step(host.state.tick * 1000 / 60);
  const packet = host.packet();
  for (let i = 0; i < packet.length; i++) assert.equal(Online.decodeSnapshot(packet.slice(0, i), journey), null);
  assert.equal(Online.decodeSnapshot(Uint8Array.from([...packet, 0]), journey), null);
  assert.equal(Online.decodeSnapshot(new Uint8Array(991), journey), null);
  const bossOffset = 35 + 5 * 63;
  for (const mutate of [
    (b) => { b[27] = 99; }, (b) => { b[31] = 9; }, (b) => { b[32] = 9; }, (b) => { b[34] = 5; },
    (b) => { b[35 + 4 * 63 + 1] = 1; },
    (b) => { b[bossOffset] = 99; }, (b) => { b[bossOffset + 1] = 99; },
    (b) => { b[bossOffset + 2] = 255; },
    (b) => { new DataView(b.buffer).setUint16(bossOffset + 4, 65535, true); },
    (b) => { new DataView(b.buffer).setFloat32(bossOffset + 13, Infinity, true); },
    (b) => { new DataView(b.buffer).setFloat32(bossOffset + 21, -1, true); },
    (b) => { b[bossOffset + 29] = 31; },
  ]) {
    const copy = packet.slice(); mutate(copy);
    assert.equal(Online.decodeSnapshot(copy, journey), null);
  }
  for (let i = 0; i < packet.length; i++) {
    const copy = packet.slice(); copy[i] ^= 255;
    const decoded = Online.decodeSnapshot(copy, journey);
    if (!decoded) continue;
    assert.ok(decoded.state.actors.every((a) => Number.isFinite(a.x) && Number.isFinite(a.y) && a.stocks <= 3));
    const boss = decoded.state.actors.find((a) => a.boss).boss;
    assert.ok(boss.health >= 0 && boss.health <= boss.maxHealth && boss.phaseTicks <= 78);
  }
});
