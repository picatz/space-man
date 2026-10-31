'use strict';
// Grounded props (docs/qa-checklist.md, "Grounded 3D props"): every piece of
// Star Circuit scenery stands on the ground or on another piece that does.
// Only a landmark's own art may float, on purpose (Nebula's orb gates and their
// studs, Forge's cinder shards); anything else that hovers reads as a bug.
const test = require('node:test'), assert = require('node:assert/strict');
const R = require('../src/race.js'), Scene = require('../src/race-scene.js');

// Splits a triangle soup (9 floats per vertex) into pieces that share
// vertices and returns each piece's bounding box.
function pieces(v) {
  const key = i => [v[i], v[i + 1], v[i + 2]].map(n => Math.round(n * 20)).join(','), parent = new Map();
  const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const tris = [];
  for (let t = 0; t < v.length; t += 27) {
    const ks = [key(t), key(t + 9), key(t + 18)];
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    parent.set(find(ks[1]), find(ks[0])); parent.set(find(ks[2]), find(ks[0]));
    tris.push([t, ks[0]]);
  }
  const boxes = new Map();
  for (const [t, k] of tris) {
    const r = find(k);
    if (!boxes.has(r)) boxes.set(r, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    const b = boxes.get(r);
    for (let j = 0; j < 3; j++) for (let a = 0; a < 3; a++) { const n = v[t + j * 9 + a]; b.min[a] = Math.min(b.min[a], n); b.max[a] = Math.max(b.max[a], n); }
  }
  return [...boxes.values()];
}
// A piece rests on another when their footprints meet and its base lies
// within the other's height range (sitting on top, or set into its side).
const rests = (p, on) => p.min[0] <= on.max[0] + .5 && on.min[0] <= p.max[0] + .5 && p.min[2] <= on.max[2] + .5 && on.min[2] <= p.max[2] + .5 &&
  p.min[1] <= on.max[1] + 1.5 && p.min[1] >= on.min[1] - 1.5;

for (const { id } of R.tracks) {
  test(`${id}: scenery near the racing line stands on the ground`, () => {
    const c = R.course(id), scene = Scene.course(c, R.at), scenery = scene.meshes[scene.meshes.length - 1];
    const all = pieces(scenery.vertices), standing = all.filter(p => p.min[1] <= 1);
    let loose = all.filter(p => p.min[1] > 1);
    for (let grew = true; grew;) {
      grew = false;
      loose = loose.filter(p => { if (!standing.some(s => rests(p, s))) return true; standing.push(p); grew = true; return false; });
    }
    const landmarks = scene.clearances.filter(l => l.type === 'landmark');
    const floating = loose.filter(p => {
      const x = (p.min[0] + p.max[0]) / 2, z = (p.min[2] + p.max[2]) / 2;
      return !landmarks.some(l => Math.hypot(x - l.x, z - l.z) <= (l.radius || 0) + 10);
    });
    assert.deepEqual(floating.map(p => `${p.min.map(Math.round)}..${p.max.map(Math.round)}`), [], `${id} has props hovering off the ground`);
  });
}
