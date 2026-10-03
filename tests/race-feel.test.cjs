// Human-scale tap/hold/release scenarios. These deliberately never ask cpuInput
// to steer the test pilot: an AI completing laps does not establish manual feel.
const test = require('node:test');
const assert = require('node:assert/strict');
const Race = require('../src/race.js');
const Online = require('../src/race-online.js');
const TrackMesh = require('../src/race-track-mesh.js');
const Scene = require('../src/race-scene.js');
const C = Race.constants;
const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
const yawBudget = (speed, brake = false) => (.052 + Math.min(speed, 8) * .0042) * (brake ? 1.22 : 1);
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${message}: ${actual} versus ${expected}`);
function playing(trackId = 'starlight') {
  const state = Race.create({ trackId, count: 1 });
  for (let tick = 0; tick < C.COUNTDOWN; tick++) Race.step(state);
  return state;
}
function place(actor, point, { lateral = 0, along = 0, speed = 6.4, turn = 0, steering = 0 } = {}) {
  const heading = angle(Math.atan2(point.ty, point.tx) + turn);
  Object.assign(actor, { x: point.x + point.tx * along - point.ty * lateral,
    y: point.y + point.ty * along + point.tx * lateral, heading, steering,
    vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, speed,
    padTicks: 0, padCooldown: 95, offroadTicks: 0 });
}
function drive(state, input = {}) {
  const actor = state.actors[0], old = { ...actor }, command = { throttle: 1, ...input };
  Race.step(state, { [actor.id]: command });
  return { old, actor, yaw: angle(actor.heading - old.heading),
    distance: Race.nearest(Race.course(state.trackId), actor.x, actor.y).distance };
}
function assertPose(actor, course, old) {
  assert.equal(actor.recoveries, 0, 'ordinary runoff should not invoke rescue');
  close(actor.speed, Math.hypot(actor.vx, actor.vy), 'reported speed tracks momentum');
  assert.ok(Race.nearest(course, actor.x, actor.y).distance <= course.width / 2 + C.RUNOFF + 1e-6);
  assert.ok(Math.hypot(actor.x - old.x, actor.y - old.y) <= 9.1, 'no correction teleport');
  assert.ok(actor.passed === old.passed || actor.passed === old.passed + 1, 'only the next gate can advance');
  assert.equal(actor.nextGate, (actor.passed + 1) % C.GATES);
  assert.equal(actor.lap, Math.floor(actor.passed / C.GATES) + 1);
  assert.ok(actor.progress >= actor.passed && actor.progress < actor.passed + 1);
}

for (const side of [-1, 1]) for (const ticks of [6, 12]) {
  test(`${ticks * 1000 / 60} ms ${side < 0 ? 'left' : 'right'} taps ramp smoothly and turn the moving kart`, () => {
    const state = playing(), actor = state.actors[0], point = Race.at(Race.course(state.trackId), 200);
    place(actor, point);
    const heading = actor.heading, samples = [];
    for (let tick = 0; tick < ticks; tick++) {
      const sample = drive(state, { steer: side });
      samples.push(sample.yaw * side);
      close(actor.steering, side * Math.min(1, (tick + 1) * .18), 'deterministic steering rise');
      assert.ok(sample.yaw * side > 0);
      assert.ok(Math.abs(sample.yaw) <= yawBudget(sample.old.speed) + 1e-9);
    }
    const turn = angle(actor.heading - heading) * side,
      lateral = (-(actor.x - point.x) * point.ty + (actor.y - point.y) * point.tx) * side;
    // Observable human-scale envelopes, not an exact replay of the integrator.
    assert.ok(turn > (ticks === 6 ? .25 : .70) && turn < (ticks === 6 ? .35 : .85), `${turn} rad turn`);
    assert.ok(lateral > (ticks === 6 ? 2 : 16), 'the travel path responds as well as the nose');
    assert.ok(actor.speed > 6, 'a normal tap retains cruise momentum');
    assert.ok(samples[0] < samples[5] / 4, 'a press must not snap immediately to maximum yaw');
    for (let tick = 0; tick < 4; tick++) drive(state, { steer: 0 });
    close(actor.steering, 0, 'release settles within 67 ms');
    const settled = actor.heading;
    for (let tick = 0; tick < 2; tick++) drive(state, { steer: 0 });
    close(actor.heading, settled, 'no on-road residual steering after release');
  });
}

for (const side of [-1, 1]) for (const heldTicks of [6, 12]) {
  test(`${heldTicks * 1000 / 60} ms hold reverses ${side < 0 ? 'left-to-right' : 'right-to-left'} without an instant snap`, () => {
    const state = playing(), actor = state.actors[0];
    place(actor, Race.at(Race.course(state.trackId), 200));
    for (let tick = 0; tick < heldTicks; tick++) drive(state, { steer: side });
    const expected = [.72, .44, .16, -.12, -.30, -.48];
    for (const [tick, value] of expected.entries()) {
      const sample = drive(state, { steer: -side });
      close(actor.steering, value * side, 'bounded reversal slew');
      assert.equal(Math.sign(sample.yaw), tick < 3 ? side : -side,
        'opposite yaw begins within four 60 Hz ticks, with no discontinuous flip');
      assert.ok(Math.abs(sample.yaw) <= yawBudget(sample.old.speed) + 1e-9);
    }
    for (let tick = 6; tick < 12; tick++) {
      const sample = drive(state, { steer: -side });
      assert.ok(sample.yaw * side < 0, 'a 200 ms countersteer is not cancelled by assistance');
    }
    close(actor.steering, -side, 'countersteer reaches full authority');
  });
}

test('assistance shares one yaw budget and cannot reverse a deliberately held steering direction', () => {
  let assisted = 0;
  for (const track of Race.tracks) for (const side of [-1, 1])
    for (const speed of [0, 4.2, 6.4, 9]) for (const steer of [-1, 0, 1])
      for (const brake of [false, true]) for (const turn of [-2.5, -1.2, 0, 1.2, 2.5]) {
        const state = playing(track.id), actor = state.actors[0], course = Race.course(track.id);
        place(actor, Race.at(course, 200), { lateral: side * (course.width / 2 + 24), speed, turn, steering: steer });
        const sample = drive(state, { steer, brake });
        assert.ok(Math.abs(sample.yaw) <= yawBudget(speed, brake) + 1e-9,
          `${track.id}: assisted yaw must not stack on top of the pilot's yaw budget`);
        if (steer) assert.ok(sample.yaw * steer >= .69 * yawBudget(speed, brake),
          `${track.id}: held steering retains at least 70% authority`);
        else if (!brake && Math.abs(sample.yaw) > .01) assisted++;
      }
  assert.ok(assisted > 50, 'exercise actual assistance, not only unassisted centerline driving');
});

for (const speed of [6.4, 9]) for (const side of [-1, 1]) {
  test(`${speed === 9 ? 'boost' : 'cruise'} late-entry ${side}: asphalt gives visible runoff before a momentum-preserving contact`, () => {
    const state = playing(), actor = state.actors[0], course = Race.course(state.trackId),
      half = course.width / 2, limit = half + C.RUNOFF;
    // An ordinary human misses a turn, then countersteers immediately. Starting
    // at the asphalt line must not be classified as an invalid teleported pose.
    place(actor, Race.at(course, 200), { lateral: side * (half - 1), speed, turn: side * Math.PI / 2 });
    let contactTick = null, offroadTicks = 0, minSpeed = speed;
    for (let tick = 0; tick < 60; tick++) {
      const sample = drive(state, { steer: -side, boost: speed === 9 });
      assertPose(actor, course, sample.old);
      if (sample.distance > half + 16) offroadTicks++;
      if (contactTick === null && sample.distance >= limit - 1e-6) {
        contactTick = tick;
        assert.ok(actor.speed >= 3.3, `impact preserves useful motion, got ${actor.speed}`);
        assert.ok(actor.speed < sample.old.speed, 'runoff contact still costs speed');
      } else if (contactTick === null) {
        assert.ok(sample.old.speed - actor.speed <= .205, 'offroad loss is gradual before physical contact');
      }
      if (tick === 5) {
        assert.ok(sample.distance > half + 28, 'a full hull-width of genuinely visible excursion');
        assert.ok(actor.speed > speed - 1.3, '100 ms of runoff must not erase speed');
      }
      minSpeed = Math.min(minSpeed, actor.speed);
    }
    assert.ok(contactTick !== null && contactTick >= 5, 'leave room to recover before meeting the outer contact');
    assert.ok(offroadTicks >= 8, 'runoff is a visible excursion, not a one-frame correction');
    assert.ok(minSpeed >= 3.2, 'the next frame must not erase preserved slide momentum');
    assert.ok(Race.nearest(course, actor.x, actor.y).distance < half, 'countersteering returns to asphalt without rescue');
  });
}

for (const track of Race.tracks) {
  test(`${track.id}: actual inward countersteering leaves the outer contact at every authored bend`, () => {
    const course = Race.course(track.id), limit = course.width / 2 + C.RUNOFF;
    let exercised = 0, worstEscape = 0;
    for (const [station, segment] of course.segments.entries()) for (const side of [-1, 1]) {
      const state = playing(track.id), actor = state.actors[0];
      place(actor, Race.at(course, segment.start), { lateral: side * limit, speed: 4.2 });
      const near = Race.nearest(course, actor.x, actor.y);
      // At a switchback the other branch can make this normal-offset point
      // interior. It is not an outer contact and must not inflate our coverage.
      if (near.distance < limit - .1) continue;
      const inward = Math.sign(near.tx * (near.y - actor.y) - near.ty * (near.x - actor.x));
      Object.assign(actor, { heading: Math.atan2(near.ty, near.tx), steering: -inward,
        vx: near.tx * 4.2, vy: near.ty * 4.2 });
      let escaped = false;
      for (let tick = 1; tick <= 30; tick++) {
        const n = Race.nearest(course, actor.x, actor.y),
          steer = Math.sign(angle(Math.atan2(n.y - actor.y, n.x - actor.x) - actor.heading)),
          sample = drive(state, { steer });
        assertPose(actor, course, sample.old);
        assert.ok(Math.abs(sample.yaw) <= yawBudget(sample.old.speed) + 1e-9);
        assert.ok(actor.speed > 3, `segment ${station}/${side}: countersteering must not become a stall`);
        if (sample.distance < limit - 16) {
          escaped = true; worstEscape = Math.max(worstEscape, tick); break;
        }
      }
      assert.ok(escaped, `segment ${station}/${side}: still stuck after half a second of actual inward steering`);
      exercised++;
    }
    assert.ok(exercised > course.segments.length, 'exercise both road sides throughout the course');
    assert.ok(worstEscape > 0);
  });
}

// Index the actual rendered triangles rather than trusting a declared radius.
function groundContains(mesh) {
  const size = mesh.diagnostics.cellSize, origin = mesh.diagnostics.origin, cells = new Map();
  for (let i = 0; i < mesh.vertices.length; i += 27) {
    const triangle = [0, 9, 18].map(offset => [mesh.vertices[i + offset], mesh.vertices[i + offset + 2]]),
      x = triangle.reduce((sum, p) => sum + p[0], 0) / 3,
      y = triangle.reduce((sum, p) => sum + p[1], 0) / 3,
      key = Math.floor((x - origin[0]) / size) + ':' + Math.floor((y - origin[1]) / size);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(triangle);
  }
  return (x, y) => {
    const column = Math.floor((x - origin[0]) / size), row = Math.floor((y - origin[1]) / size);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const triangle of cells.get(`${column + dx}:${row + dy}`) || [])
        if (triangle.every((a, i) => {
          const b = triangle[(i + 1) % 3];
          return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) <= .0005;
        })) return true;
    return false;
  };
}
for (const track of Race.tracks) {
  test(`${track.id}: the whole runoff hull stays above visible apron and clear of props`, () => {
    const course = Race.course(track.id), contains = groundContains(TrackMesh.build(course)),
      limit = course.width / 2 + C.RUNOFF;
    assert.equal(course.runoff, C.RUNOFF, 'physics and scene receive the same runoff contract');
    for (const segment of course.segments) for (const side of [-1, 1]) {
      const x = segment.x + segment.dx * .5 - segment.ty * limit * side,
        y = segment.y + segment.dy * .5 + segment.tx * limit * side;
      assert.ok(contains(x, y), 'the center of every reachable outer-contact pose has rendered ground');
      for (let spoke = 0; spoke < 16; spoke++) {
        const heading = spoke * Math.PI / 8;
        assert.ok(contains(x + Math.cos(heading) * C.KART_RADIUS, y + Math.sin(heading) * C.KART_RADIUS),
          `full hoverpod silhouette needs apron support at ${x},${y}`);
      }
    }
    const props = Scene.course(course, Race.at).clearances;
    assert.ok(props.some(prop => prop.type === 'pylon') && props.some(prop => prop.type === 'landmark'));
    for (const prop of props) assert.ok(TrackMesh.distance(course, prop.x, prop.z) - prop.radius >= limit + C.KART_RADIUS,
      `${prop.type} overlaps the expanded drivable hull corridor`);
  });
}

for (const track of Race.tracks) {
  test(`${track.id}: runoff crossings respect expected gate order, direction, and correction fairness`, () => {
    const course = Race.course(track.id);
    for (let gateIndex = 1; gateIndex < C.GATES; gateIndex++) for (const side of [-1, 1]) {
      const state = playing(track.id), actor = state.actors[0], gate = course.gates[gateIndex],
        lateral = side * (course.width / 2 + 24);
      Object.assign(actor, { passed: gateIndex - 1, nextGate: gateIndex, progress: gateIndex - 1 });
      place(actor, gate, { lateral, along: -1, speed: 4.2 });
      drive(state);
      assert.equal(actor.passed, gateIndex, 'a driven expected gate crossing in visible runoff counts');
      assert.equal(actor.nextGate, (gateIndex + 1) % C.GATES);
      place(actor, gate, { lateral, along: 1, speed: 4.2, turn: Math.PI });
      drive(state);
      assert.equal(actor.passed, gateIndex, 'reversing across the same gate never double-counts');
      place(actor, course.gates[(gateIndex + 3) % C.GATES], { along: -1, speed: 4.2 });
      drive(state);
      assert.equal(actor.passed, gateIndex, 'a physically crossed future gate cannot skip the required gate');
    }
    let corrections = 0;
    for (let gateIndex = 1; gateIndex < C.GATES; gateIndex++) for (const side of [-1, 1]) for (const extra of [12, 24, 40]) {
      const state = playing(track.id), actor = state.actors[0], gate = course.gates[gateIndex];
      Object.assign(actor, { passed: gateIndex - 1, nextGate: gateIndex, progress: gateIndex - 1 });
      place(actor, gate, { lateral: side * (course.width / 2 + C.RUNOFF + extra), along: -.005, speed: 0 });
      if (Race.nearest(course, actor.x, actor.y).distance <= course.width / 2 + C.RUNOFF + .01) continue;
      const old = { ...actor };
      drive(state, { throttle: 0 });
      assert.equal(actor.passed, gateIndex - 1, 'positional correction cannot award the expected gate');
      assert.ok(Math.hypot(actor.x - old.x, actor.y - old.y) <= 2.001, 'invalid-pose correction stays bounded');
      if ((actor.x - gate.x) * gate.tx + (actor.y - gate.y) * gate.ty > 0) corrections++;
    }
    assert.ok(corrections > 0, 'exercise a genuine correction-only crossing on a curved boundary');
  });
}

for (const runoff of [false, true]) {
  test(`human tap/reversal commands use identical local and authoritative-online ${runoff ? 'runoff' : 'road'} physics`, () => {
    const host = Online.createHost({ trackId: 'ember' });
    host.syncRoster([{ p: 1, role: 0, identity: 'human-fixture' }], 0);
    assert.equal(host.start(), true);
    while (host.state.phase === 'countdown') host.step(host.state.tick * 1000 / C.TICK_RATE);
    const course = Race.course(host.state.trackId), actor = host.state.actors[0];
    place(actor, Race.at(course, 200), { lateral: runoff ? course.width / 2 + 30 : 0,
      turn: runoff ? Math.PI / 2 : 0 });
    // Keep filler pilots in their stationary recovery wait so this proves the
    // human's input path, independently of AI corner selection or contacts.
    host.state.actors.slice(1).forEach(other => { other.recoveryTicks = 90; });
    const local = Race.snapshot(host.state), client = Online.createClient();
    assert.ok(client.accept(host.packet(), 1));
    const script = [[6, 1], [6, -1], [12, 1], [4, 0], [12, -1], [8, 0]];
    for (const [ticks, steer] of script) for (let tick = 0; tick < ticks; tick++) {
      const command = { throttle: 1, steer, boost: runoff }, beforeGuest = JSON.stringify(client.current.state),
        packet = client.input(command, 1);
      assert.ok(packet);
      assert.equal(JSON.stringify(client.current.state), beforeGuest, 'sending controls cannot simulate the guest pose');
      assert.ok(host.receive(1, 'human-fixture', packet, host.state.tick * 1000 / C.TICK_RATE));
      host.step(host.state.tick * 1000 / C.TICK_RATE);
      Race.step(local, { [actor.id]: command });
      assert.deepEqual(host.state.actors[0], local.actors[0], 'one simulation owns steering slew and momentum');
      const shown = client.accept(host.packet(), 1);
      assert.ok(shown, 'wire validation accepts every human-steered runoff pose');
      for (const field of ['x', 'y', 'vx', 'vy', 'heading', 'speed'])
        assert.ok(Math.abs(shown.state.actors[0][field] - actor[field]) < .0001, `authoritative ${field} reaches the guest`);
      assert.equal(shown.state.actors[0].passed, actor.passed);
    }
  });
}


test('minimum outer-edge glide respects coast, brake, invalid-pose correction, and recovery-release stops', () => {
  for (const track of Race.tracks) for (const side of [-1, 1]) {
    const course = Race.course(track.id), point = Race.at(course, 200), limit = course.width / 2 + C.RUNOFF;
    for (const input of [{ throttle: 0 }, { throttle: 1, brake: true }]) {
      const state = playing(track.id), actor = state.actors[0];
      place(actor, point, { lateral: side * (limit - .01), speed: 1, turn: side * Math.PI / 2 });
      const first = drive(state, input);
      assert.ok(first.distance >= limit - 1e-6, 'exercise a real physical contact');
      assert.ok(actor.speed < 1, 'a non-driving contact cannot inject the 1.8 minimum glide');
      for (let tick = 0; tick < 20; tick++) drive(state, input);
      assert.ok(actor.speed < 1, 'coasting/braking does not acquire safety assistance propulsion');
      if (input.brake) close(actor.speed, 0, 'braking can stop fully on the runoff');
    }
    const invalid = playing(track.id), corrected = invalid.actors[0];
    place(corrected, point, { lateral: side * (limit + 12), speed: 0, turn: side * Math.PI / 2 });
    const correction = drive(invalid);
    assert.ok(corrected.speed < .15, 'invalid-pose correction receives no minimum forward glide');
    assert.ok(Math.hypot(corrected.x - correction.old.x, corrected.y - correction.old.y) < 2.1);
    assert.equal(corrected.passed, correction.old.passed);
    const release = playing(track.id), released = release.actors[0];
    place(released, point, { lateral: side * (limit + 1), speed: .5, turn: side * Math.PI / 2 });
    released.recoveryTicks = 1;
    const old = { ...released };
    drive(release);
    assert.equal(released.recoveryTicks, 0);
    assert.ok(released.speed <= .5, 'the release frame cannot get a driving glide');
    assert.equal(released.passed, old.passed, 'contact on release never grants a gate');
  }
});


for (const track of Race.tracks) {
  test(`${track.id}: authored bends retain turnable curvature without near-cusps`, () => {
    const course = Race.course(track.id);
    let minimumRadius = Infinity;
    for (const [i, segment] of course.segments.entries()) {
      const next = course.segments[(i + 1) % course.segments.length],
        turn = Math.abs(Math.atan2(segment.tx * next.ty - segment.ty * next.tx,
          segment.tx * next.tx + segment.ty * next.ty)),
        radius = (segment.length + next.length) / (4 * Math.sin(turn / 2));
      assert.ok(turn < .2, `segment ${i}: adjacent road samples cannot abruptly turn the lane`);
      minimumRadius = Math.min(minimumRadius, radius);
    }
    // Rounded Ember used to have a ~10-unit cusp, substantially tighter than
    // the kart's ~81-unit cruise turn radius even after using all lane width.
    assert.ok(minimumRadius > 60, `minimum sampled bend radius ${minimumRadius} is too tight for manual driving`);
    assert.ok(minimumRadius + course.width / 2 - C.KART_RADIUS > 6.4 / yawBudget(6.4),
      'the available asphalt line accommodates the human cruise turning radius');
  });
}
