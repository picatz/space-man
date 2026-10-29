'use strict';
// Combo read in the Arena UI: same attacker + same victim inside the window
// escalates "2 HIT", "3 HIT"; a new victim or a long gap restarts the count.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/arena-ui.js'), 'utf8');
const start = source.indexOf('const COMBO_WINDOW'), end = source.indexOf('function hitFeel');
assert.ok(start > 0 && end > start);

function harness() {
  const log = { effects: [], sfx: [], said: [] };
  const ctx = vm.createContext({
    feel: { combo: {}, trauma: 0 }, state: { tick: 0, actors: [{ id: 1 }] }, effects: log.effects,
    actorColor: () => '#38E1FF', sfx: (k) => log.sfx.push(k), announce: (t) => log.said.push(t),
    shakeOn: () => false, arena: { feel: { addTrauma: (t) => t } },
  });
  vm.runInContext(source.slice(start, end) + '\nthis.comboFeel = comboFeel;', ctx);
  return { ctx, log, hit: (tick, victim, involved = true) => { ctx.state.tick = tick; ctx.comboFeel({ actorId: 1, targetId: victim, x: 10, y: 20 }, involved); } };
}

test('consecutive hits on one victim escalate and announce from three', () => {
  const h = harness();
  h.hit(0, 2); assert.equal(h.log.effects.length, 0);
  h.hit(30, 2); h.hit(60, 2);
  assert.deepEqual(h.log.effects.map((e) => e.text), ['2 HIT', '3 HIT']);
  assert.deepEqual(h.log.said, ['3 hit combo!']);
  assert.equal(h.log.sfx.length, 2);
});

test('a new victim or a long gap restarts the count', () => {
  const h = harness();
  h.hit(0, 2); h.hit(20, 3); h.hit(40, 2);
  assert.equal(h.log.effects.length, 0);
  h.hit(40 + 200, 2);
  assert.equal(h.log.effects.length, 0);
  h.hit(250, 2);
  assert.equal(h.log.effects.length, 1);
});

test('uninvolved combos stay silent but still draw', () => {
  const h = harness();
  h.hit(0, 2, false); h.hit(10, 2, false);
  assert.equal(h.log.effects.length, 1);
  assert.equal(h.log.sfx.length, 0);
});
