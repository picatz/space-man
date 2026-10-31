// Starlings befriending call: pure, seeded rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/starling.js');
const clean = s => S.respond(s, S.verse(s).map(() => 'perfect'));

test('a seed always calls up the same Starling, named from two different syllables', () => {
  for (let seed = 1; seed < 200; seed++) {
    const a = S.starling(seed), b = S.starling(seed);
    assert.deepEqual(a, b);
    assert.match(a.name, /^[A-Z][a-z]{3,5}$/);
    assert.ok(S.HUES.some(h => h.id === a.hue));
  }
  assert.notEqual(S.starling(1).name + S.starling(2).name + S.starling(3).name, S.starling(1).name.repeat(3));
});

test('the first call is two even, slow pulses; later verses grow by one and never pass six', () => {
  let s = S.start(42);
  const first = S.verse(s);
  assert.equal(first.length, 2);
  assert.equal(first[1].at - first[0].at, 500, 'two units at tempo 1');
  s = clean(s); assert.equal(S.verse(s).length, 3);
  s = clean(s); assert.equal(S.verse(s).length, 4);
  assert.equal(S.length(S.start(1, 4)), 4, 'a pilot with four friends hears longer calls');
  assert.equal(S.length({ ...S.start(1, 40), verse: 9 }), 6);
});

test('no point repeats back to back, and a verse sung again is the same song, only slower', () => {
  for (let seed = 1; seed < 300; seed++) {
    let s = S.start(seed, 4);
    for (let v = 0; v < 3; v++) {
      const beats = S.verse(s);
      for (let i = 1; i < beats.length; i++) assert.notEqual(beats[i].point, beats[i - 1].point, `seed ${seed} verse ${v}`);
      s = clean(s);
    }
  }
  const s = S.start(9), again = S.respond(s, ['perfect', 'miss']);
  assert.deepEqual(S.verse(again).map(b => b.point), S.verse(s).map(b => b.point));
  assert.ok(S.verse(again)[1].at > S.verse(s)[1].at, 'the Starling slows down for you');
});

test('timing windows: perfect, good, then a miss; the wrong point is always a miss', () => {
  const [, b] = S.answer([{ at: 100, point: 'left' }, { at: 600, point: 'up' }]);
  assert.equal(b.offset, 500);
  assert.equal(S.judge(b, 500 + S.PERFECT, 'up'), 'perfect');
  assert.equal(S.judge(b, 500 - S.GOOD, 'up'), 'good');
  assert.equal(S.judge(b, 500 + S.GOOD + 1, 'up'), 'miss');
  assert.equal(S.judge(b, 500, 'down'), 'miss');
  assert.equal(S.judge(undefined, 0, 'up'), 'miss', 'an extra tap past the verse');
});

test('three clean verses befriend it; three missed beats send it off shy', () => {
  let s = S.start(5);
  s = clean(s); s = clean(s); assert.equal(s.phase, 'call'); assert.equal(s.trust, 2);
  s = clean(s); assert.equal(s.phase, 'befriended');
  assert.equal(clean(s), s, 'a finished encounter ignores answers');

  let shy = S.start(5);
  shy = S.respond(shy, ['perfect', 'miss']); assert.equal(shy.phase, 'call'); assert.equal(shy.trust, 0);
  shy = S.respond(shy, ['good']); assert.equal(shy.misses, 2, 'an unanswered beat counts as missed');
  shy = S.respond(shy, ['miss', 'perfect']); assert.equal(shy.phase, 'shy');
});

test('one stumble costs a verse at most two missed beats, so a single slip never ends the encounter', () => {
  const s = { ...S.start(8), verse: 2 };
  assert.equal(S.length(s), 4);
  const after = S.respond(s, ['miss', 'miss', 'miss', 'miss']);
  assert.equal(after.misses, 2); assert.equal(after.phase, 'call');
});

test('a sloppy verse slows the call, but never past its slowest', () => {
  let s = S.start(3);
  for (let i = 0; i < 10; i++) s = { ...S.respond({ ...s, misses: 0 }, ['miss', 'good']) };
  assert.ok(s.tempo <= 1.4 + 1e-9);
});

test('the codex reads back only well-formed, unique entries', () => {
  const e = S.entry(77, 1000);
  assert.equal(e.name, S.starling(77).name);
  const list = S.readCodex([e, e, { seed: -1 }, { seed: 1.5 }, null, 'x', { seed: 12, at: 'later', name: '<img>' }]);
  assert.equal(list.length, 2);
  assert.equal(list[1].name, S.starling(12).name, 'names are derived from the seed, never trusted from storage');
  assert.equal(list[1].at, 0);
  assert.deepEqual(S.readCodex('nope'), []);
});
