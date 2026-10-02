const test = require("node:test"),
  assert = require("node:assert/strict");
const Camera = require("../src/race-camera.js"),
  Scene = require("../src/race-scene.js"),
  R = require("../src/race.js");
test("perspective cameras use snapshot position and preserve immutable simulation", () => {
  const s = R.snapshot(R.create()),
    before = JSON.stringify(s),
    c = R.course(s.trackId),
    cam = Camera.create(),
    a = s.actors[0];
  const chase = cam.update(a, c, R.at, { mode: "chase", reduceMotion: true });
  assert.ok(chase.eye[1] > 50);
  assert.ok(
    (a.x - chase.eye[0]) * Math.cos(a.heading) +
      (a.y - chase.eye[2]) * Math.sin(a.heading) >
      100,
  );
  const cockpit = cam.update(a, c, R.at, { mode: "cockpit" });
  assert.equal(cockpit.eye[1], 34);
  assert.ok(cockpit.target[1] < cockpit.eye[1]);
  const art = Scene.course(c, R.at),
    moving = Scene.actors(s);
  assert.equal(art.meshes.length, 3);
  assert.ok(moving.vertices.length > 100);
  for (const mesh of [...art.meshes, moving]) {
    assert.equal(mesh.vertices.length % 9, 0);
    assert.ok(mesh.vertices.every(Number.isFinite));
  }
  assert.equal(JSON.stringify(s), before);
});
test("camera reset snaps after recovery and actor/mode switch, with no roll or speed zoom in reduced motion", () => {
  const c = R.course("starlight"),
    a = R.create().actors[0],
    cam = Camera.create();
  cam.update(a, c, R.at, {});
  const b = { ...a, x: a.x + 500, heading: a.heading + 1, recoveries: 1 };
  const frame = cam.update(b, c, R.at, {});
  assert.ok(Math.abs(frame.eye[0] - (b.x - Math.cos(b.heading) * 132)) < 1e-7);
  const stable = cam.update({ ...b, speed: 100 }, c, R.at, {
    reduceMotion: true,
  });
  assert.equal(stable.fov, (59 * Math.PI) / 180);
  cam.reset();
  assert.deepEqual(cam.update(b, c, R.at, {}), frame);
});
test("all authored tracks build finite render-only geometry", () => {
  for (const track of R.tracks) {
    const mesh = Scene.course(R.course(track.id), R.at);
    assert.ok(
      mesh.meshes.every((m) => m.static && m.vertices.every(Number.isFinite)),
    );
  }
});

test("generated road and model lighting normals face outward", () => {
  const box = Scene.builder();
  box.box(0, 0, 0, 10, 10, 10, [1, 1, 1]);
  const verts = box.mesh().vertices;
  for (let i = 0; i < verts.length; i += 27) {
    const middle = [0, 1, 2].map(
      (axis) =>
        (verts[i + axis] + verts[i + 9 + axis] + verts[i + 18 + axis]) / 3 -
        [0, 5, 0][axis],
    );
    assert.ok(
      middle.reduce((sum, value, j) => sum + value * verts[i + 3 + j], 0) > 0,
      "box face points outward",
    );
  }
  const sphere = Scene.builder();
  sphere.sphere(0, 0, 0, 8, [1, 1, 1], 10, 6);
  const sv = sphere.mesh().vertices;
  for (let i = 0; i < sv.length; i += 27) {
    const dot = [0, 1, 2].reduce(
      (sum, j) =>
        sum + (sv[i + j] + sv[i + 9 + j] + sv[i + 18 + j]) * sv[i + 3 + j],
      0,
    );
    assert.ok(dot > 0 || Math.abs(dot) < 1e-6);
  }
  const scene = Scene.course(R.course("starlight"), R.at).meshes[1].vertices;
  assert.ok(scene[4] > 0.99, "first road ribbon faces up");
});
test("portrait chase backs up enough to show the road and remains finite on resize", () => {
  const a = R.create().actors[0],
    c = R.course("starlight");
  const landscape = Camera.create().update(a, c, R.at, { aspect: 1280 / 800 });
  const portrait = Camera.create().update(a, c, R.at, { aspect: 390 / 844 });
  assert.ok(
    Math.hypot(portrait.eye[0] - a.x, portrait.eye[2] - a.y) >
      Math.hypot(landscape.eye[0] - a.x, landscape.eye[2] - a.y),
  );
  assert.ok([...portrait.eye, ...portrait.target].every(Number.isFinite));
});

test("chase occlusion hides close rear pilots but keeps subject and rivals ahead", () => {
  const s = R.snapshot(R.create()),
    a = s.actors[0];
  const culled = Scene.actors(s, { chaseActor: a }),
    full = Scene.actors(s);
  assert.ok(culled.vertices.length < full.vertices.length);
  const solo = { ...s, actors: [a] };
  assert.deepEqual(Scene.actors(solo, { chaseActor: a }), Scene.actors(solo));
  const front = {
    ...a,
    id: "front",
    x: a.x + Math.cos(a.heading) * 70,
    y: a.y + Math.sin(a.heading) * 70,
  };
  assert.deepEqual(
    Scene.actors({ ...s, actors: [a, front] }, { chaseActor: a }),
    Scene.actors({ ...s, actors: [a, front] }),
  );
});

test("craft geometry is reused on GPU while only per-frame pose matrices change", () => {
  const s = R.snapshot(R.create()),
    before = JSON.stringify(s),
    first = Scene.actorMeshes(s);
  const next = {
    ...s,
    actors: s.actors.map((a) => ({
      ...a,
      x: a.x + 3,
      y: a.y + 4,
      heading: a.heading + 0.01,
    })),
  };
  const second = Scene.actorMeshes(next);
  assert.ok(
    first.every((m, i) => m.static && m.vertices === second[i].vertices),
  );
  assert.ok(
    first.every(
      (m, i) =>
        m.model !== second[i].model &&
        Math.abs(second[i].model[12] - m.model[12] - 3) < 0.001,
    ),
  );
  assert.equal(JSON.stringify(s), before);
});

test("all scenery clears the entire playable road corridor, including other hairpin sections", () => {
  const Track = require("../src/race-track-mesh.js");
  for (const t of R.tracks) {
    const c = R.course(t.id),
      scene = Scene.course(c, R.at);
    assert.ok(scene.clearances.length > 20);
    for (const p of scene.clearances)
      assert.ok(
        Track.distance(c, p.x, p.z) - p.radius > c.width / 2 + 5,
        `${t.id} ${p.type} intersects road`,
      );
  }
});

test("rear thrusters point opposite travel and cockpit stays above vehicle geometry", () => {
  const s = R.snapshot(R.create()),
    a = s.actors[0],
    models = Scene.actorMeshes(s);
  const vertices = models[0].vertices;
  const engines = [];
  let maxY = 0;
  for (let i = 0; i < vertices.length; i += 9) {
    maxY = Math.max(maxY, vertices[i + 1]);
    if (
      Math.abs(vertices[i + 6] - 0.8) < 0.00001 &&
      vertices[i + 7] === 1 &&
      vertices[i + 8] === 1
    )
      engines.push(vertices[i]);
  }
  assert.ok(
    engines.length > 20 && engines.every((x) => x < -20),
    "bright engine discs are at the rear",
  );
  const view = Camera.create().update(a, R.course(s.trackId), R.at, {
    mode: "cockpit",
  });
  assert.ok(
    view.eye[1] > maxY + 1,
    "camera is above other hoverpod surfaces; own craft is omitted",
  );
  const m = models[0].model;
  assert.ok(
    Math.abs(m[0] - Math.cos(a.heading)) < 0.0001 &&
      Math.abs(m[2] - Math.sin(a.heading)) < 0.0001,
    "local nose axis matches simulation heading",
  );
});
