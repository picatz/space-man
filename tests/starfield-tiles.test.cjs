const test = require('node:test');
const assert = require('node:assert/strict');
const { client, relay } = require('./harness.cjs');

function game(t, opts) { const c = client(relay(), opts); t.after(() => c.close()); return c; }

test('phase groups split the circle evenly and each pulses at its own midpoint', (t) => {
  const c = game(t);
  const r = JSON.parse(c.run(`JSON.stringify({ n: STAR_PHASES, g: [0, 0.1, Math.PI - 0.01, Math.PI, Math.PI + 0.01, TAU - 0.001, TAU, -0.5, 7].map(starGroup),
    mid: Array.from({ length: STAR_PHASES }, (_, g) => starGroupPhase(g) / TAU) })`));
  assert.equal(r.n, 2);
  assert.deepEqual(r.g, [0, 0, 0, 1, 1, 1, 0, 1, 0]);
  assert.deepEqual(r.mid, [0.25, 0.75]);
});

test('tile scroll matches the per-star wrap it replaces', (t) => {
  const c = game(t);
  // A star at tile x appears on screen at ((x - cam * f) mod W) in the old loop; the tile starts at starScroll.
  const result = JSON.parse(c.run(`JSON.stringify((() => {
    const out = [];
    for (const [cam, f] of [[0, 0.15], [123.456, 0.15], [-987.6, 0.3], [5000, 0.3], [-1e6, 0.15], [1600 / 0.15, 0.15]]) {
      const start = starScroll(cam, f);
      for (const x of [0, 1, 799.5, 1599]) {
        const old = (((x - cam * f) % STAR_W) + STAR_W) % STAR_W, tiled = (x + start) % STAR_W;
        out.push([start >= 0 && start < STAR_W, Math.abs(old - tiled) < 1e-6 || Math.abs(Math.abs(old - tiled) - STAR_W) < 1e-6]);
      }
    }
    return out;
  })())`));
  for (const [inRange, same] of result) { assert.ok(inRange); assert.ok(same); }
});

test('far and mid tiles are baked once and the mid tiles follow the sector hue', (t) => {
  const c = game(t);
  const r = JSON.parse(c.run(`JSON.stringify((() => {
    buildStars();
    const far = starTiles.far.slice(), farCount = far.length, midBefore = starTiles.mid.length;
    const drawn = starfield.far.length + starfield.mid.length;
    const total = starfield.far.length + starfield.mid.length;
    return { farCount, midBefore, midHue: starTiles.midHue, total, drawn, w: far[0].width, tall: far[0].height >= Math.max(...starfield.far.map((s) => s.y)) };
  })())`));
  assert.equal(r.farCount, 2);
  assert.equal(r.midBefore, 0, 'mid tiles wait for the hue');
  assert.equal(r.midHue, -1);
  assert.equal(r.total, 180, 'the same 180 stars as before');
  assert.equal(r.w, 1600);
  assert.ok(r.tall);
});

test('unplugged phones cap the backing store at 2x; charging, Sharp and #shot keep their ceilings', (t) => {
  const c = game(t, { dpr: 3 });
  const dprs = JSON.parse(c.run(`JSON.stringify((() => {
    const out = {};
    perf.cap = CFG.dprMax;
    batteryCharging = true; out.charging = targetDpr();
    batteryCharging = false; out.unplugged = targetDpr();
    const sharp = settings.sharp; settings.sharp = true; out.sharp = targetDpr(); settings.sharp = sharp;
    perf.cap = 1.5; out.adapted = targetDpr(); perf.cap = CFG.dprMax;
    batteryCharging = true;
    return out;
  })())`));
  assert.equal(dprs.charging, 3);
  assert.equal(dprs.unplugged, 2);
  assert.equal(dprs.sharp, 3, 'Sharp Rendering opts out of the unplugged cap');
  assert.equal(dprs.adapted, 1.5, 'the adaptive cap still wins when lower');
});
