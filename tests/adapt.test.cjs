// Adaptive CPU skill (src/adapt.js): streaks at one level and the level offered next.
const test = require("node:test");
const assert = require("node:assert/strict");
require("../src/adapt.js");
const Adapt = globalThis.SpaceManAdapt;

test("two straight wins offer the next level up, two straight losses the next level down", () => {
  let s = null;
  s = Adapt.record(s, "normal", "win"); assert.equal(Adapt.suggestion(s), null);
  s = Adapt.record(s, "normal", "win"); assert.equal(Adapt.suggestion(s), "hard");
  s = Adapt.record(s, "normal", "loss"); assert.deepEqual({ ...s }, { level: "normal", n: -1 });
  s = Adapt.record(s, "normal", "loss"); assert.equal(Adapt.suggestion(s), "easy");
});

test("streaks reset on a tie, a mid-pack finish or a level change, and stop at the ends", () => {
  let s = Adapt.record(Adapt.record(null, "easy", "win"), "easy", "tie");
  assert.equal(s.n, 0);
  s = Adapt.record(Adapt.record(null, "easy", "win"), "normal", "win");
  assert.deepEqual({ ...s }, { level: "normal", n: 1 }, "a new level starts its own streak");
  assert.equal(Adapt.suggestion({ level: "hard", n: 5 }), null, "nothing above Ace");
  assert.equal(Adapt.suggestion({ level: "easy", n: -5 }), null, "nothing below Cadet");
  assert.deepEqual({ ...Adapt.record(null, "turbo", "win") }, { level: "normal", n: 0 });
});

test("stored streaks survive corrupt or missing storage", () => {
  const bag = new Map(), storage = { getItem: (k) => bag.get(k) ?? null, setItem: (k, v) => bag.set(k, v) };
  assert.equal(Adapt.load(storage, "k"), null);
  Adapt.save(storage, "k", { level: "hard", n: -2 });
  assert.deepEqual({ ...Adapt.load(storage, "k") }, { level: "hard", n: -2 });
  bag.set("k", "{nope"); assert.equal(Adapt.load(storage, "k"), null);
  bag.set("k", JSON.stringify({ level: "hard", n: 1.5 })); assert.equal(Adapt.load(storage, "k"), null);
  assert.doesNotThrow(() => Adapt.save({ setItem() { throw new Error("quota"); } }, "k", { level: "easy", n: 1 }));
});
