const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const Race = require("../src/race.js");
const TrackMesh = require("../src/race-track-mesh.js");

const tracks = ["starlight", "ember", "bloom"].map((id) => Race.course(id));
const makeCourse = (points, width) => Object.freeze({
  width, road: "#493447", edge: "#ffb26e", accent: "#ffc663",
  segments: Object.freeze(points.map(([x, y], index) => {
    const next = points[(index + 1) % points.length],
      dx = next[0] - x, dy = next[1] - y, length = Math.hypot(dx, dy);
    return Object.freeze({ x, y, dx, dy, length, tx: dx / length, ty: dy / length });
  })),
});
const hairpin = makeCourse([[0, 0], [160, 0], [160, 35], [0, 35], [0, 70],
  [160, 70], [160, 220], [0, 220]], 148);
const crossing = makeCourse([[0, 0], [220, 220], [0, 220], [220, 0]], 100);

// Order-independent hashes at fixed reference widths; Ember uses its rounded
// revision-3 route. Positions,
// normals, colors, winding, and triangle multiplicity must all stay exact.
const originalTriangles = {
  starlight: "6c51b8c39be0e0b90e786a40171020a651ced289f14665f83f4ba5c8f883e7f0",
  ember: "1c052269d65a8223ffa59c020d3ff13e8f8d7bb2284b96afbe6ef4269bd7c572",
  bloom: "bd8d303ccf11aebf874837b84458ed58c7539f18b4c947d99513935b28a29ae2",
};

function triangleHash(vertices) {
  const data = Buffer.from(vertices.buffer, vertices.byteOffset, vertices.byteLength),
    triangles = [], hash = createHash("sha256");
  for (let i = 0; i < data.length; i += 108) triangles.push(data.subarray(i, i + 108));
  triangles.sort(Buffer.compare);
  for (const triangle of triangles) hash.update(triangle);
  return hash.digest("hex");
}

function indexMesh(mesh) {
  const { cellSize, origin } = mesh.diagnostics, cells = new Map(), triangles = [];
  for (let i = 0; i < mesh.vertices.length; i += 27) {
    const triangle = [0, 9, 18].map((offset) => [
      mesh.vertices[i + offset], mesh.vertices[i + offset + 2],
    ]);
    triangle.height = mesh.vertices[i + 1];
    const cx = triangle.reduce((sum, p) => sum + p[0], 0) / 3,
      cz = triangle.reduce((sum, p) => sum + p[1], 0) / 3,
      column = Math.floor((cx - origin[0]) / cellSize),
      row = Math.floor((cz - origin[1]) / cellSize), key = column + ":" + row;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(triangle);
    triangles.push(triangle);
  }
  return { cells, triangles, contains(x, z, height) {
    const column = Math.floor((x - origin[0]) / cellSize),
      row = Math.floor((z - origin[1]) / cellSize);
    // Include neighbors when a physical test point lands exactly on a grid edge.
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
      for (const triangle of cells.get((column + dx) + ":" + (row + dz)) || []) {
        if (height !== undefined && triangle.height !== height) continue;
        if (triangle.every((a, i) => {
          const b = triangle[(i + 1) % 3];
          return (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) <= 0.0005;
        })) return true;
      }
    return false;
  } };
}

// Separating axes of convex triangles detect any positive-area overlap, even
// when no vertex is inside its neighbor (the old crossed-ribbon failure).
function overlapDepth(a, b) {
  let minimum = Infinity;
  for (const triangle of [a, b]) for (let i = 0; i < 3; i++) {
    const p = triangle[i], q = triangle[(i + 1) % 3],
      length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!length) continue;
    const nx = (q[1] - p[1]) / length, nz = (p[0] - q[0]) / length,
      pa = a.map((v) => v[0] * nx + v[1] * nz),
      pb = b.map((v) => v[0] * nx + v[1] * nz),
      depth = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
    minimum = Math.min(minimum, depth);
    if (minimum <= 0) return minimum;
  }
  return minimum;
}

for (const course of tracks) {
  test(`${course.id}: full-course distance equals the immutable physics geometry`, () => {
    for (let i = 0; i < 400; i++) {
      const x = ((i * 1664525 + 1013904223) >>> 0) % 2100 - 100,
        z = ((i * 22695477 + 17) >>> 0) % 1700 - 100;
      assert.ok(Math.abs(TrackMesh.distance(course, x, z) - Race.nearest(course, x, z).distance) < 1e-9);
    }
  });

  test(`${course.id}: static union stays finite, upward, nondegenerate, and under its vertex budget`, () => {
    const before = JSON.stringify(course), mesh = TrackMesh.build(course), v = mesh.vertices;
    assert.equal(mesh.static, true);
    assert.ok(v instanceof Float32Array);
    assert.equal(v.length % 27, 0);
    assert.ok(v.length / 9 < 150000, `${v.length / 9} vertices`);
    assert.ok(mesh.diagnostics.coverageGuard < 0.7);
    assert.ok(mesh.diagnostics.bands.every((band) => band.triangleCount > 0));
    for (let i = 0; i < v.length; i += 27) {
      const area = (v[i + 11] - v[i + 2]) * (v[i + 18] - v[i]) -
        (v[i + 9] - v[i]) * (v[i + 20] - v[i + 2]);
      assert.ok(area > 0, `up-facing nondegenerate triangle at ${i}`);
      assert.equal(v[i + 1], v[i + 10]);
      assert.equal(v[i + 1], v[i + 19]);
      for (let j = 0; j < 27; j++) assert.ok(Number.isFinite(v[i + j]));
      for (const offset of [0, 9, 18]) {
        assert.deepEqual(Array.from(v.subarray(i + offset + 3, i + offset + 6)), [0, 1, 0]);
        for (let j = 6; j < 9; j++) assert.ok(v[i + offset + j] >= 0 && v[i + offset + j] <= 1);
      }
    }
    assert.equal(JSON.stringify(course), before, "no changes to physics course");
    assert.equal(TrackMesh.build(course), mesh, "one static build per immutable course");
  });

  test(`${course.id}: spatial packing preserves every original triangle and material byte`, () => {
    // Retain the original-width byte regression when authored track widths change.
    const original = Object.freeze({ ...course, width: { starlight: 156, ember: 148, bloom: 152 }[course.id] });
    assert.equal(triangleHash(TrackMesh.build(original).vertices), originalTriangles[course.id]);
  });
}

for (const [name, course] of [...tracks.map((c) => [c.id, c]), ["tight hairpins", hairpin], ["crossing", crossing]]) {
  test(`${name}: bounded spatial chunks partition one shared buffer with exact enclosing bounds`, () => {
    const mesh = TrackMesh.build(course), size = mesh.diagnostics.chunkSize;
    assert.equal(size, 384);
    assert.equal(mesh.chunks.length, mesh.diagnostics.chunkCount);
    assert.ok(mesh.chunks.length > 1 && mesh.chunks.length <= 48);
    const occupied = new Set();
    let offset = 0, previous = null;
    for (const chunk of mesh.chunks) {
      assert.equal(chunk.static, true);
      assert.ok(chunk.vertices instanceof Float32Array);
      assert.ok(chunk.vertices.length > 0);
      assert.equal(chunk.vertices.length % 27, 0, "never split a triangle");
      assert.equal(chunk.vertices.buffer, mesh.vertices.buffer, "no retained geometry copy");
      assert.equal(chunk.vertices.byteOffset, mesh.vertices.byteOffset + offset * 4,
        "contiguous nonoverlapping views, with no omitted bytes");
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      let key = null;
      for (let i = 0; i < chunk.vertices.length; i += 27) {
        const v = chunk.vertices,
          column = Math.floor((v[i] + v[i + 9] + v[i + 18]) / (3 * size)),
          row = Math.floor((v[i + 2] + v[i + 11] + v[i + 20]) / (3 * size)),
          current = column + ":" + row;
        if (key === null) {
          key = current;
          assert.ok(!occupied.has(key), "exactly one chunk per spatial bucket");
          if (previous) assert.ok(row > previous.row || (row === previous.row && column > previous.column),
            "chunks have deterministic numeric row-major order");
          occupied.add(key);
          previous = { column, row };
        }
        assert.equal(current, key, "only nearby triangles share a chunk");
        for (let vertex = 0; vertex < 27; vertex += 9)
          for (let axis = 0; axis < 3; axis++) {
            const value = v[i + vertex + axis];
            assert.ok(value >= chunk.bounds.min[axis] && value <= chunk.bounds.max[axis]);
            min[axis] = Math.min(min[axis], value);
            max[axis] = Math.max(max[axis], value);
          }
      }
      assert.deepEqual(chunk.bounds, { min, max }, "bounds use final Float32 values exactly");
      offset += chunk.vertices.length;
    }
    assert.equal(offset, mesh.vertices.length, "the chunk union is the entire full mesh");
    assert.equal(mesh.vertices.byteLength, mesh.vertices.buffer.byteLength);
  });

  test(`${name}: the road covers the complete physical lane, including curved segment end caps`, () => {
    const mesh = TrackMesh.build(course), index = indexMesh(mesh), half = course.width / 2;
    let probes = 0;
    for (const segment of course.segments) {
      for (const fraction of [0, 0.37, 0.81])
        for (const offset of [-half, -half * 0.5, 0, half * 0.5, half]) {
          const x = segment.x + segment.dx * fraction - segment.ty * offset,
            z = segment.y + segment.dy * fraction + segment.tx * offset;
          assert.ok(index.contains(x, z, 0), `lane hole at ${x}, ${z}`);
          probes++;
        }
      for (let i = 0; i < 32; i++) {
        const angle = i * Math.PI / 16, x = segment.x + Math.cos(angle) * half,
          z = segment.y + Math.sin(angle) * half;
        assert.ok(index.contains(x, z, 0), `round end-cap hole at ${x}, ${z}`);
        probes++;
      }
    }
    assert.ok(probes > 0);
  });

  test(`${name}: bands tile each grid cell without crossed strips or coplanar overlap`, () => {
    const mesh = TrackMesh.build(course), { cells } = indexMesh(mesh),
      { cellSize, origin } = mesh.diagnostics;
    let pairs = 0;
    for (const [key, triangles] of cells) {
      const [column, row] = key.split(":").map(Number),
        x = origin[0] + column * cellSize, z = origin[1] + row * cellSize;
      for (const triangle of triangles) for (const point of triangle) {
        assert.ok(point[0] >= x - 0.0002 && point[0] <= x + cellSize + 0.0002);
        assert.ok(point[1] >= z - 0.0002 && point[1] <= z + cellSize + 0.0002);
      }
      for (let i = 0; i < triangles.length; i++) for (let j = i + 1; j < triangles.length; j++) {
        const depth = overlapDepth(triangles[i], triangles[j]);
        assert.ok(depth < 0.0002, `intersecting triangles in ${key}, overlap ${depth}`);
        pairs++;
      }
    }
    assert.ok(pairs > 1000);
    const bandHeights = mesh.diagnostics.bands.map((band) => band.height);
    assert.notEqual(bandHeights[0], bandHeights[1]);
    assert.notEqual(bandHeights[1], bandHeights[2]);
    assert.notEqual(bandHeights[3], bandHeights[4]);
  });
}

test("global clearance detects the other side of a switchback rather than only the local normal", () => {
  const course = makeCourse([[0, 0], [400, 0], [400, 180], [0, 180]], 148);
  // This location is safely outside the bottom straight's width, but is right
  // on the upper straight. Testing only the generating straight would miss it.
  assert.equal(TrackMesh.distance(course, 200, 180), 0);
  assert.equal(TrackMesh.distance(course, 200, 90), 90);
  assert.equal(TrackMesh.distance(course, -100, 0), 100);
});

test("the mesh is deterministic across builds and exports the same dependency-free browser API", () => {
  const course = tracks[1], browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/race-track-mesh.js"), "utf8"), browser);
  assert.equal(typeof browser.window.SpaceManRaceTrackMesh.build, "function");
  assert.equal(typeof browser.window.SpaceManRaceTrackMesh.distance, "function");
  const first = TrackMesh.build(course), second = TrackMesh.build({ ...course });
  assert.deepEqual(first.vertices, second.vertices);
  assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.deepEqual(first.chunks.map((chunk) => ({ bounds: chunk.bounds,
    offset: chunk.vertices.byteOffset, length: chunk.vertices.length })),
    second.chunks.map((chunk) => ({ bounds: chunk.bounds,
      offset: chunk.vertices.byteOffset, length: chunk.vertices.length })));
});

test("invalid fields fail explicitly and point segments remain well-defined", () => {
  assert.throws(() => TrackMesh.build({ width: 0, segments: [] }), /width/);
  assert.throws(() => TrackMesh.build({ width: 100, segments: [] }), /segments/);
  assert.throws(() => TrackMesh.distance({ segments: [{ x: NaN, y: 0, dx: 1, dy: 0 }] }, 0, 0), /finite/);
  assert.equal(TrackMesh.distance({ segments: [{ x: 3, y: 4, dx: 0, dy: 0 }] }, 0, 0), 5);
});
