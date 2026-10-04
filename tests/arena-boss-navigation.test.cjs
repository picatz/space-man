'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const arenaSource = process.env.SPACE_MAN_ARENA_SOURCE ? path.resolve(process.env.SPACE_MAN_ARENA_SOURCE) : require.resolve('../src/arena.js');
const Arena = require(arenaSource);
const Online = require(path.join(path.dirname(arenaSource), 'arena-online.js'));

const commands = state => Object.fromEntries(state.actors.map(actor => [actor.id, Arena.cpuInput(state, actor.id)]));
function geometricBossLoss(state, beforeHealth) {
  const boss = state.actors.find(actor => actor.boss);
  const damage = state.events.filter(event => event.type === 'hit' && event.targetId === boss.id).reduce((sum, event) => sum + event.damage, 0);
  // Health depletion uses loseStock too and legitimately emits a ringout event.
  return beforeHealth > damage && state.events.some(event => event.type === 'ringout' && event.actorId === boss.id);
}
function edgeState(side, difficulty = 'easy') {
  const state = Arena.create({ arenaId: 'ember-foundry', encounter: 'boss', wingmate: false, countdownTicks: 0, difficulty, seed: 13 });
  const human = state.actors[0], boss = state.actors[1];
  for (const [actor, x] of [[boss, side < 0 ? 155 : 749], [human, side < 0 ? 136 : 800]]) {
    Object.assign(actor, { x, px: x, y: 490 - actor.h, py: 490 - actor.h, vx: 0, vy: 0, onGround: true, supportId: 'hearth', invulnerable: 0 });
  }
  boss.boss.phaseTicks = 40; boss.boss.phaseDuration = 59;
  boss.ai.nextThinkTick = 0; boss.ai.nextAttackTick = 0;
  return { state, boss, human };
}
for (const side of [-1, 1]) for (const difficulty of Object.keys(Arena.difficulties)) {
  test(`${difficulty} Guardian at ${side < 0 ? 'left' : 'right'} edge keeps safe navigation instead of discarded fighter aim`, () => {
    const { state, boss, human } = edgeState(side, difficulty);
    const before = boss.ai.nextAttackTick, command = Arena.cpuInput(state, boss.id);
    assert.equal(command.attackPressed, false, 'idle special cooldown is not ready');
    assert.equal(command.dashPressed, false);
    assert.ok(command.moveX * side <= 0, 'no outward fighter-pulse steering survives');
    assert.equal(boss.ai.nextAttackTick, before, 'fighter attack scheduler is unused');
    assert.equal(boss.ai.targetId, human.id, 'fair nearest-enemy target is unchanged');
    assert.deepEqual(Arena.cpuInput(state, boss.id), command, 'same-tick input remains idempotent');
    const nextDecisionTick = boss.ai.nextThinkTick;
    while (state.tick < nextDecisionTick) Arena.step(state, { [boss.id]: Arena.cpuInput(state, boss.id) });
    assert.ok(boss.x >= 155 && boss.x + boss.w <= 805, 'cached intent leaves whole body supported');
  });
}

test('passive human Ember seed13 cannot win from the discarded-aim self-ringout', () => {
  const state = Arena.create({ arenaId: 'ember-foundry', encounter: 'boss', difficulty: 'easy', seed: 13 });
  while (state.phase !== 'over') {
    const health = state.actors[2].boss.health;
    Arena.step(state, commands(state));
    assert.equal(geometricBossLoss(state, health), false, `boss still had health at tick ${state.tick}`);
    if (state.tick === 1529) assert.equal(state.actors[2].stocks, 1, 'original failing tick');
  }
  assert.equal(state.tick, 3360);
  assert.equal(state.result.reason, 'time');
  assert.equal(state.result.winnerTeam, 1, 'surviving Guardian wins the existing timeout rule');
  assert.ok(state.actors[2].boss.health > 0);
});

test('passive-player boss navigation stays bounded across all arenas, difficulties and twenty seeds', () => {
  for (const arena of Arena.arenas) for (const difficulty of Object.keys(Arena.difficulties)) for (let seed = 1; seed <= 20; seed++) {
    const state = Arena.create({ arenaId: arena.id, encounter: 'boss', difficulty, seed });
    while (state.phase !== 'over') {
      const health = state.actors[2].boss.health;
      Arena.step(state, commands(state));
      assert.equal(geometricBossLoss(state, health), false, `${arena.id}/${difficulty}/${seed} tick ${state.tick}`);
      assert.ok(state.tick <= 3360);
    }
  }
});

test('boss pursuit and recovery remain deterministic through a snapshot at the old failure approach', () => {
  const a = Arena.create({ arenaId: 'ember-foundry', encounter: 'boss', difficulty: 'easy', seed: 13 });
  while (a.tick < 1400) Arena.step(a, commands(a));
  const b = Arena.restore(Arena.snapshot(a));
  while (a.phase !== 'over') {
    const ca = commands(a), cb = commands(b);
    assert.deepEqual(ca, cb);
    Arena.step(a, ca); Arena.step(b, cb);
    assert.deepEqual(a, b);
  }
});

for (const side of [-1, 1]) test(`Guardian ${side < 0 ? 'left' : 'right'} unrecoverable fall still awards the existing ringout`, () => {
  const { state, boss, human } = edgeState(side);
  Object.assign(boss, { x: side < 0 ? -145 : 1090, y: 788, vx: side * 8, vy: 15, onGround: false, supportId: null, coyoteTicks: 0, jumpCount: 2, lastHitBy: human.id });
  const health = boss.boss.health;
  Arena.step(state, commands(state));
  assert.equal(geometricBossLoss(state, health), true, 'navigation supplies no ringout immunity');
  assert.equal(boss.stocks, 0);
  assert.equal(state.result.winnerTeam, 0);
  assert.equal(state.events.filter(e => e.type === 'boss-defeated').length, 1);
  assert.equal(human.kos, 1, 'existing player credit survives');
});

test('journey authority uses the same boss decisions, freezes on pause, and publishes identical guest/watch poses', () => {
  const options = { arenaId: 'ember-foundry', encounter: 'boss', difficulty: 'easy', seed: 13 };
  const host = Online.createHost(options, { journey: true });
  host.syncRoster([{ p: 1, identity: 'host', role: 0 }, { p: 2, identity: 'watcher', role: 1 }], 0);
  assert.equal(host.start(13), true);
  const direct = Arena.create(options), guest = Online.createClient({ journey: true }), watcher = Online.createClient({ journey: true });
  let now = 0;
  while (direct.phase !== 'over') {
    if (direct.tick === 1450) {
      assert.equal(host.pause(true), true);
      const frozen = Arena.snapshot(host.state);
      for (let n = 0; n < 180; n++) host.step(now += 1000 / 60);
      assert.deepEqual(host.state, frozen, 'pause consumes no movement, AI or phase clocks');
      assert.equal(host.pause(false), true);
    }
    host.step(now += 1000 / 60); Arena.step(direct, commands(direct));
    assert.deepEqual(host.state.actors, direct.actors);
    if (direct.tick % 60 === 0 || direct.phase === 'over') {
      const bytes = host.packet(), g = guest.accept(bytes), w = watcher.accept(bytes);
      assert.ok(g && w);
      assert.deepEqual(g.state, w.state);
      const remote = g.state.actors.find(a => a.boss), authority = host.state.actors.find(a => a.boss);
      assert.ok(Math.abs(remote.x - authority.x) < .001 && Math.abs(remote.y - authority.y) < .001);
      const expectedBoss = JSON.parse(JSON.stringify(authority.boss));
      if (expectedBoss.attack) for (const key of ['x', 'y', 'w', 'h']) expectedBoss.attack[key] = Math.fround(expectedBoss.attack[key]);
      assert.deepEqual(remote.boss, expectedBoss, 'phase and warning geometry match the authoritative wire precision');
      assert.equal(watcher.input({ moveX: 1, attackPressed: true }, 2), null, 'watcher cannot steer boss or crew');
    }
  }
  assert.equal(host.state.tick, 3360);
  assert.deepEqual(host.state.result, direct.result);
});

for (const side of [-1, 1]) test(`Guardian ${side < 0 ? 'left' : 'right'} recoverable fall uses its ordinary remaining jump`, () => {
  const state = Arena.create({ arenaId: 'ember-foundry', encounter: 'boss', wingmate: false, countdownTicks: 0, seed: 13 });
  const boss = state.actors[1];
  Object.assign(boss, { x: side < 0 ? 85 : 819, y: 435, vx: side * 2, vy: 3, onGround: false, supportId: null, coyoteTicks: 0, jumpCount: 1, invulnerable: 0 });
  boss.boss.phaseTicks = 40; boss.ai.nextThinkTick = 0;
  let jumps = 0;
  for (let tick = 0; tick < 120 && !boss.onGround && state.phase !== 'over'; tick++) {
    Arena.step(state, commands(state));
    jumps += state.events.filter(e => e.type === 'jump' && e.actorId === boss.id).length;
  }
  assert.equal(jumps, 1, 'no extra recovery resource');
  assert.equal(boss.stocks, 1);
  assert.equal(boss.onGround, true);
  assert.equal(boss.supportId, 'hearth');
});
