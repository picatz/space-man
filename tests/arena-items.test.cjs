'use strict';
// Opt-in Arena item drops: deterministic seeded spawns, pickup effects, surge
// scaling, snapshot round-trip and strict restore validation. Matches created
// without `items` must be byte-identical to before.
const test = require('node:test');
const assert = require('node:assert/strict');
const Arena = require('../src/arena.js');
const C = Arena.constants;

function run(options, ticks) {
  const state = Arena.create(options);
  const log = [];
  for (let i = 0; i < ticks; i++) { Arena.step(state); log.push(...state.events.filter((e) => e.type.startsWith('item-'))); }
  return { state, log };
}
function firstItem(state) {
  for (let i = 0; i < 2000 && !state.items.list.length; i++) Arena.step(state);
  assert.ok(state.items.list.length, 'an item should drop');
  return state.items.list[0];
}

test('items are absent unless requested, including for expeditions', () => {
  assert.equal(Arena.create({ seed: 4 }).items, undefined);
  assert.equal(Arena.create({ seed: 4, items: true, encounter: 'boss' }).items, undefined);
  const a = run({ seed: 4 }, 1500).state, b = run({ seed: 4, items: false }, 1500).state;
  assert.deepEqual(a, b);
});

test('spawns are seeded and land on free platform tops', () => {
  const one = run({ seed: 9, items: true }, 2400), two = run({ seed: 9, items: true }, 2400);
  assert.deepEqual(one.log, two.log);
  assert.ok(one.log.some((e) => e.type === 'item-spawn'));
  const arena = Arena.getArena(one.state.arenaId);
  for (const item of one.state.items.list) {
    const p = arena.platforms.find((q) => q.id === item.platformId);
    assert.ok(p && item.x >= p.x && item.x + C.ITEM_SIZE <= p.x + p.w);
  }
  assert.ok(one.state.items.list.length <= C.ITEM_MAX);
  assert.notDeepEqual(run({ seed: 10, items: true }, 2400).log, one.log);
});

test('unclaimed items expire', () => {
  const { state, log } = run({ seed: 3, items: true }, C.ITEM_FIRST_TICKS + C.ITEM_LIFE_TICKS + 5);
  state.actors.forEach((a) => { a.invulnerable = 0; });
  assert.ok(log.some((e) => e.type === 'item-expire' || e.type === 'item-pickup'));
});

function grab(kind) {
  const state = Arena.create({ seed: 5, items: true });
  const item = firstItem(state);
  item.kind = kind;
  const actor = state.actors[0];
  actor.damage = 80; actor.invulnerable = 0;
  Object.assign(actor, { x: item.x, y: item.y, px: item.x, py: item.y, vx: 0, vy: 0 });
  Arena.step(state);
  return { state, actor, events: state.events };
}

test('heal, shield and surge apply on pickup and consume the item', () => {
  let r = grab('heal');
  assert.ok(r.actor.damage <= 80 - C.ITEM_HEAL + 1 && r.state.items.list.length === 0);
  assert.ok(r.events.some((e) => e.type === 'item-pickup' && e.kind === 'heal' && e.actorId === 1));
  r = grab('shield');
  assert.ok(r.actor.invulnerable > C.ITEM_SHIELD_TICKS - 5);
  r = grab('surge');
  assert.ok(r.actor.surge > C.SURGE_TICKS - 5);
});

test('surge boosts pulse damage and knockback, then wears off', () => {
  const actor = { attackCharge: 0, surge: 0 };
  const base = Arena.pulseDamage(actor), kb = Arena.pulseKnockback(actor);
  actor.surge = 10;
  assert.equal(Arena.pulseDamage(actor), Math.round(base * C.SURGE_DAMAGE));
  assert.ok(Arena.pulseKnockback(actor) > kb);
  const { actor: a, state } = grab('surge');
  for (let i = 0; i < C.SURGE_TICKS + 2; i++) Arena.step(state);
  assert.equal(a.surge, 0);
});

test('snapshot round-trips and restore rejects corrupt items', () => {
  const state = Arena.create({ seed: 5, items: true });
  firstItem(state);
  assert.deepEqual(Arena.restore(Arena.snapshot(state)), state);
  const bad = (mutate) => { const s = Arena.snapshot(state); mutate(s); assert.throws(() => Arena.restore(s), TypeError); };
  bad((s) => { s.items.list[0].kind = 'nuke'; });
  bad((s) => { s.items.list[0].platformId = 'nowhere'; });
  bad((s) => { s.items.list[0].ttl = 99999; });
  bad((s) => { s.items.list.push(Object.assign({}, s.items.list[0])); });
  bad((s) => { s.items = null; });
  bad((s) => { s.actors[0].surge = -1; });
  const plain = Arena.create({ seed: 5 });
  const s = Arena.snapshot(plain); s.actors[0].surge = 5;
  assert.throws(() => Arena.restore(s), TypeError);
});
