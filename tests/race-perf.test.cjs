const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../src/race.js"), "utf8");
function load(src) {
  const context = { window: {} };
  vm.runInNewContext(src, context);
  return context.window.SpaceManRace;
}
const Fast = load(source);
// Same module, but every nearest() call is the original full segment scan.
const Slow = load(
  source.replace(
    /function nearest\(c, x, y\) \{/,
    "function nearest(c, x, y) { return nearestScan(c, x, y); }\n  function nearestFast(c, x, y) {",
  ),
);

function run(Race, trackId, ticks) {
  const state = Race.create({ trackId, count: 6, seed: 7 });
  for (let i = 0; i < ticks; i++) {
    const commands = {};
    for (const a of state.actors) commands[a.id] = Race.cpuInput(state, a);
    Race.step(state, commands);
  }
  return state;
}

test("windowed nearest equals the full scan for random points, jumps and off-track positions", () => {
  for (const def of Fast.tracks) {
    const c = Fast.course(def.id);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let x = c.segments[0].x, y = c.segments[0].y;
    for (let i = 0; i < 4000; i++) {
      if (i % 7 === 0) { x = (rnd() - .5) * 6000; y = (rnd() - .5) * 6000; }  // teleport
      else { x += (rnd() - .5) * 40; y += (rnd() - .5) * 40; }
      assert.deepEqual(Fast.nearest(c, x, y), Fast.nearestScan(c, x, y), `${def.id} #${i}`);
    }
    for (const g of c.segments) {  // segment joints are exact ties
      assert.deepEqual(Fast.nearest(c, g.x, g.y), Fast.nearestScan(c, g.x, g.y));
    }
  }
});

test("seeded 6-kart races are identical with the fast and full-scan nearest()", () => {
  for (const def of Fast.tracks) {
    const a = Fast.create({ trackId: def.id, count: 6, seed: 7 });
    const b = Slow.create({ trackId: def.id, count: 6, seed: 7 });
    for (let i = 0; i < 1500; i++) {
      const ca = {}, cb = {};
      for (const x of a.actors) ca[x.id] = Fast.cpuInput(a, x);
      for (const x of b.actors) cb[x.id] = Slow.cpuInput(b, x);
      assert.equal(JSON.stringify(ca), JSON.stringify(cb), `${def.id} commands tick ${i}`);
      Fast.step(a, ca);
      Slow.step(b, cb);
      if (i % 50 === 0) assert.equal(JSON.stringify(a), JSON.stringify(b), `${def.id} tick ${i}`);
    }
    assert.equal(JSON.stringify(a), JSON.stringify(b), `${def.id} final`);
  }
});

test("6-kart step plus cpuInput is much cheaper than the full-scan baseline", () => {
  const time = (Race) => {
    run(Race, "starlight", 200);  // warm-up
    const t0 = process.hrtime.bigint();
    run(Race, "starlight", 900);
    return Number(process.hrtime.bigint() - t0) / 1e6 / 900;
  };
  const slow = Math.min(time(Slow), time(Slow)), fast = Math.min(time(Fast), time(Fast));
  console.log(`# per tick: full scan ${slow.toFixed(3)} ms, fast ${fast.toFixed(3)} ms`);
  assert.ok(fast < slow * .6, `fast ${fast} ms vs baseline ${slow} ms`);
  assert.ok(fast < 3, `absolute budget ${fast} ms`);
});
