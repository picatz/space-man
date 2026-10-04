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
  assert.ok(art.meshes.length >= 3);
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
  const engine = models.find(m=>m.engineActorId===a.id), engines=[];
  assert.ok(engine && engine.emissive,'engine light is a separate emissive material');
  let maxY = 0;
  for(let i=0;i<vertices.length;i+=9)maxY=Math.max(maxY,vertices[i+1]);
  for(let i=0;i<engine.vertices.length;i+=9)engines.push(engine.vertices[i]);
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

test("all cached craft vertices fit their conservative local-space culling bounds", () => {
  const s = R.create();
  s.actors.forEach((a) => (a.boosting = true));
  for (const m of Scene.actorMeshes(s)) {
    assert.ok(m.bounds);
    for (let i = 0; i < m.vertices.length; i += 9)
      for (let k = 0; k < 3; k++)
        assert.ok(
          m.vertices[i + k] >= m.bounds.min[k] &&
            m.vertices[i + k] <= m.bounds.max[k],
        );
  }
});
test('slide framing follows travel without mutating authority or rolling the horizon',()=>{
  const actor={...R.create().actors[0],heading:0,speed:5,vx:5*Math.cos(-.35),vy:5*Math.sin(-.35)};
  const original=JSON.stringify(actor),h=Camera.travelHeading(actor);
  assert.ok(h<-.2&&h>-.3,'frame between travel and nose, biased toward the road');
  const camera=Camera.create().update(actor,R.course('starlight'),R.at,{reduceMotion:true});
  assert.ok(camera.target[1]<camera.eye[1]);assert.equal(JSON.stringify(actor),original);
  assert.equal(Camera.travelHeading({...actor,speed:0,vx:0,vy:0}),0);
});

test('hops leave Chase ground-relative and cap the Cockpit rise, removing it in reduced motion',()=>{
  const c=R.course('starlight'),a=R.create().actors[0],air={...a,airRamp:1,airTicks:14,z:29};
  const ground=Camera.create().update(a,c,R.at,{mode:'chase'}),jump=Camera.create().update(air,c,R.at,{mode:'chase'});
  assert.deepEqual(jump,ground);
  const cockpit=Camera.create().update(air,c,R.at,{mode:'cockpit'});
  assert.equal(cockpit.eye[1],42);assert.equal(cockpit.target[1],25);
  assert.equal(Camera.create().update(air,c,R.at,{mode:'cockpit',reduceMotion:true}).eye[1],34);
});
const landingViews = [320/568,390/844,568/320,844/390,820/1180,1280/720];
function launchActor(ramp, s, lane, speed = 6.4) {
  const c=R.course('starlight'),p=R.at(c,s),base=R.create().actors[0];
  return {...base,x:p.x-p.ty*lane,y:p.y+p.tx*lane,heading:Math.atan2(p.ty,p.tx),
    vx:p.tx*speed,vy:p.ty*speed,speed};
}
function assertLandingRoad(view,ramp,aspect,label) {
  const M=require('../src/render3d.js'),c=R.course('starlight');
  const matrix=M.multiply(M.perspective(view.fov,aspect,view.near,view.far),M.lookAt(view.eye,view.target));
  for(let offset=108;offset<=270;offset+=9) for(const d of [-c.width/2,0,c.width/2]) {
    const q=R.at(c,ramp.s+offset),shown=M.project([q.x-q.ty*d,0,q.y+q.tx*d],matrix);
    assert.ok(shown.visible,`${ramp.id} ${label}: landing ${offset}/${d}, projected ${shown.x}/${shown.y}`);
  }
}
test('the full landing road fits from center and both coin lanes in every camera and viewport',()=>{
  const c=R.course('starlight');
  for(const ramp of R.features(c).ramps) for(const s of [ramp.startS,ramp.s-30,ramp.s])
    for(const lane of [-44,0,44]) for(const speed of [3.6,6.4,9])
      for(const aspect of landingViews) for(const mode of ['chase','cockpit']) for(const reduceMotion of [false,true]) {
        const a=launchActor(ramp,s,lane,speed),before=JSON.stringify(a);
        const view=Camera.create().update(a,c,R.at,{aspect,mode,reduceMotion});
        assertLandingRoad(view,ramp,aspect,`${mode} aspect${aspect} lane${lane} speed${speed} calm${reduceMotion}`);
        assert.equal(JSON.stringify(a),before);
        const look=Math.atan2(view.target[2]-view.eye[2],view.target[0]-view.eye[0]);
        assert.ok(Math.abs(Camera.wrap(look-a.heading))<=.34,'lane framing cannot swing the horizon excessively');
        const baseFov=mode==='cockpit'?Math.max(68,Math.min(150,2*Math.atan(1/aspect)*180/Math.PI)):59;
        const expected=(baseFov+(reduceMotion?0:Math.min(4,speed*.5)))*Math.PI/180;
        assert.equal(view.fov,expected,'lane framing adds no field of view');
      }
});
test('lane framing stays ground-relative and repeatable through a reduced-motion hop',()=>{
  const c=R.course('starlight');
  for(const ramp of R.features(c).ramps) for(const lane of [-44,44]) for(const mode of ['chase','cockpit']) {
    const a=launchActor(ramp,ramp.s,lane),camera=Camera.create();
    const ground=camera.update(a,c,R.at,{mode,aspect:390/844,reduceMotion:true});
    for(const [airTicks,z] of [[0,10],[12,29],[29,3],[0,0]]) {
      const frame=camera.update({...a,z,airTicks,airRamp:z?ramp.index+1:0},c,R.at,
        {mode,aspect:390/844,reduceMotion:true,dt:1/30});
      assert.deepEqual(frame,ground,'height and airtime cannot steer or raise a reduced-motion camera');
    }
  }
});
test('rotation immediately fits the landing road while normal approach follow remains bounded',()=>{
  const c=R.course('starlight');
  for(const ramp of R.features(c).ramps) for(const lane of [-44,44]) for(const mode of ['chase','cockpit']) {
    const camera=Camera.create();
    for(let s=ramp.startS-120;s<=ramp.s;s+=3) {
      const a=launchActor(ramp,s,lane),view=camera.update(a,c,R.at,{mode,aspect:390/844,dt:1/60});
      if(s>=ramp.startS) assertLandingRoad(view,ramp,390/844,`${mode} moving lane${lane}`);
    }
    const a=launchActor(ramp,ramp.s,lane);
    for(const aspect of [844/390,390/844,820/1180,320/568,1280/720]) {
      const view=camera.update(a,c,R.at,{mode,aspect,dt:1/60});
      assertLandingRoad(view,ramp,aspect,`${mode} rotation lane${lane}`);
    }
  }
});

test('topdown easing uses elapsed time: 60Hz and 120Hz have the same stationary-target response', () => {
  const actor = { id: 'pilot-0', x: 0, y: 0, heading: 0, recoveries: 0 };
  function run(hz) {
    const camera = Camera.createTopdown();
    camera.update(actor, { portrait: true });
    let shown;
    for (let frame = 0; frame < hz / 2; frame++) shown = camera.update(
      { ...actor, x: 100, y: 75, heading: 1 }, { portrait: true, dt: 1 / hz });
    return shown;
  }
  const a = run(60), b = run(120);
  for (const field of ['x', 'y', 'rotation']) assert.ok(Math.abs(a[field] - b[field]) < 1e-9);
});

test('topdown moving camera tracks the same path at 60/120Hz without changing the pilot', () => {
  function run(hz) {
    const camera = Camera.createTopdown(), path = [];
    for (let frame = 0; frame <= hz; frame++) {
      const t = frame / hz, actor = Object.freeze({ id: 'pilot-0', x: 180 * t,
        y: 45 * t, heading: .4 * t, recoveries: 0 });
      path.push(camera.update(actor, { portrait: true, dt: 1 / hz }));
    }
    return path;
  }
  const a = run(60), b = run(120);
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.hypot(a[i].x - b[i * 2].x, a[i].y - b[i * 2].y) < 1,
      'time-based tracking remains within one world unit across refresh rates');
    assert.ok(Math.abs(a[i].rotation - b[i * 2].rotation) < .002);
  }
});

test('topdown pause is stationary and rescue, watch, track, epoch and rotation reset cleanly', () => {
  const camera = Camera.createTopdown(), a = { id: 'pilot-0', x: 0, y: 0, heading: 0, recoveries: 0 },
    options = { trackId: 'starlight', epoch: 1, portrait: true };
  camera.update(a, options);
  const b = { ...a, x: 30, heading: .2 }, shown = camera.update(b, options);
  for (let i = 0; i < 100; i++) assert.deepEqual(camera.update(b,
    { ...options, paused: true, dt: .1 }), shown);
  for (const [actor, settings] of [
    [{ ...b, recoveries: 1 }, options], [{ ...b, id: 'pilot-1' }, options],
    [b, { ...options, epoch: 2 }], [b, { ...options, trackId: 'bloom' }],
    [b, { ...options, portrait: false }], [b, { ...options, reduceMotion: true }],
  ]) {
    const actual = camera.update(actor, settings), fresh = Camera.createTopdown().update(actor, settings);
    assert.deepEqual(actual, fresh);
  }
  camera.reset();
  assert.deepEqual(camera.update(a, options), Camera.createTopdown().update(a, options));
});

test('topdown redraws without elapsed frame time do not spend camera easing twice', () => {
  const camera = Camera.createTopdown(), actor = { id: 'pilot-0', x: 0, y: 0, heading: 0, recoveries: 0 };
  camera.update(actor);
  const moved = { ...actor, x: 100, heading: .5 }, shown = camera.update(moved, { dt: 1 / 60 });
  for (let i = 0; i < 10; i++) assert.deepEqual(camera.update(moved, { dt: 0 }), shown);
  const portrait = camera.update(moved, { dt: 0, portrait: true });
  assert.deepEqual(portrait, Camera.createTopdown().update(moved, { portrait: true }),
    'a genuine viewport orientation change still reframes immediately');
});
