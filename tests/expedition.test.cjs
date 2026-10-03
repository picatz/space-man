const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/expedition.js');

test('expedition advances once, in order, even without winning every leg', () => {
  const e = E.create(123), run = e.begin();
  assert.equal(run.id, 'runner'); assert.equal(run.seed, 123);
  assert.equal(e.begin(), null); assert.equal(e.advance(), false);
  assert.equal(e.finish('arena', run.token, {}), false);
  assert.equal(e.finish('runner', run.token + 1, {}), false);
  assert.equal(e.finish('runner', run.token, { distance: 87, score: 222 }), true);
  assert.equal(e.finish('runner', run.token, {}), false);
  assert.equal(e.advance(), true);
  const arena = e.begin(); assert.equal(arena.id, 'arena');
  assert.equal(e.finish('runner', run.token, {}), false);
  assert.equal(e.finish('arena', arena.token, { won: false, kos: 1 }), true);
  assert.equal(e.advance(), true);
  const race = e.begin(); assert.equal(race.id, 'race');
  assert.equal(e.finish('race', race.token, { position: 5, finished: false }), true);
  assert.equal(e.snapshot().phase, 'complete');
  assert.equal(e.advance(), false); assert.equal(e.begin(), null);
  assert.deepEqual(e.snapshot().records.map(x => x.id), ['runner', 'arena', 'race']);
});

test('cancel invalidates the running leg and snapshots cannot mutate the itinerary', () => {
  for (let index = 0; index < 3; index++) {
    const e = E.create(); let leg;
    for (let i = 0; i <= index; i++) { leg = e.begin(); if (i < index) { e.finish(leg.id, leg.token, {}); e.advance(); } }
    e.cancel(); assert.equal(e.finish(leg.id, leg.token, {}), false); assert.equal(e.advance(), false);
    const s = e.snapshot(); s.phase = 'playing'; s.records.push({ id: 'oops' });
    assert.equal(e.snapshot().phase, 'cancelled'); assert.equal(e.snapshot().records.length, index);
  }
});

test('receipt data is small and bounded, with no simulation or transport state', () => {
  const e = E.create(-1), l = e.begin();
  e.finish(l.id, l.token, { reached: true, distance: Infinity, score: -3, secret: 'not retained' });
  assert.deepEqual(e.snapshot().records, [{ id: 'runner', reached: true, distance: 0, score: 0 }]);
  assert.equal(e.snapshot().seed, 0xffffffff);
  const s = e.snapshot(); s.records[0].score = 444;
  assert.equal(e.snapshot().records[0].score, 0);
});
