'use strict';
// Lobby hero choreography is a pure function of time: deterministic, bounded,
// and it actually trades lunges (positions move, lean follows velocity, a
// burst fires once per half-loop).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/arena-ui.js'), 'utf8');
const start = source.indexOf('const HERO_LOOP'), end = source.indexOf('function paintHero');
assert.ok(start > 0 && end > start);
const ctx = vm.createContext({ TAU: Math.PI * 2, clamp: (v, a, b) => Math.min(b, Math.max(a, v)), Math });
vm.runInContext(source.slice(start, end) + '\nthis.heroPose = heroPose; this.HERO_LOOP = HERO_LOOP;', ctx);

test('pose is deterministic and loops', () => {
  assert.deepEqual(ctx.heroPose(1.7), ctx.heroPose(1.7));
  const a = ctx.heroPose(.9), b = ctx.heroPose(.9 + ctx.HERO_LOOP);
  assert.ok(Math.abs(a.hero.x - b.hero.x) < 1e-6 && Math.abs(a.rival.y - b.rival.y) < 1e-6);
});

test('both pilots lunge toward each other and stay bounded', () => {
  let heroReach = 0, rivalReach = 0, bursts = 0, last = null;
  for (let t = 0; t < ctx.HERO_LOOP * 2; t += 1 / 60) {
    const p = ctx.heroPose(t);
    for (const who of ['hero', 'rival']) {
      assert.ok(Number.isFinite(p[who].x + p[who].y + p[who].rot + p[who].stretch + p[who].squash));
      assert.ok(Math.abs(p[who].rot) < 1.2 && p[who].stretch >= 0 && p[who].stretch <= .25 && p[who].squash >= 0 && p[who].squash <= .2);
    }
    heroReach = Math.max(heroReach, p.hero.x - 150); rivalReach = Math.max(rivalReach, 440 - p.rival.x);
    if (p.burst && (!last || last.who !== p.burst.who || p.burst.age < last.age)) bursts++;
    last = p.burst;
  }
  assert.ok(heroReach > 80 && rivalReach > 80, 'lunges travel');
  assert.ok(bursts >= 3, 'a pulse burst lands each half-loop');
});

test('lean follows velocity direction during a lunge', () => {
  const lunging = ctx.heroPose(.12 * ctx.HERO_LOOP), resting = ctx.heroPose(.9 * ctx.HERO_LOOP);
  assert.ok(lunging.hero.stretch > resting.hero.stretch);
});
