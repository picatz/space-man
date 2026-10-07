'use strict';
// Same-device 2-player Orbital Arena: sim roster, per-player command routing
// through the production arena-ui input functions, the keyboard split and the
// pad assignment. Only DOM/audio objects are stubs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Arena = require('../src/arena.js');
const C = Arena.constants;
const source = fs.readFileSync(require.resolve('../src/arena-ui.js'), 'utf8');
function between(a, b) {
  const start = source.indexOf(a), end = source.indexOf(b, start);
  assert.ok(start >= 0 && end > start, a);
  return source.slice(start, end);
}
function playing(options) {
  const state = Arena.create(options);
  for (let tick = 0; tick < C.COUNTDOWN_TICKS; tick++) Arena.step(state);
  state.actors.forEach((actor) => { actor.invulnerable = 0; });
  return state;
}
function place(actor, x, y, extra) {
  Object.assign(actor, { x, y, px: x, py: y, vx: 0, vy: 0, invulnerable: 0, stun: 0, onGround: true, supportId: 'dock', attackTicks: 0, dashTicks: 0 }, extra);
}
const idle = () => Arena.normalizeCommand();
const pulse = () => Arena.normalizeCommand({ attackPressed: true });

// ---- simulation ----
test('single-player creation is byte-for-byte unchanged by the localPlayers option', () => {
  for (const format of ['duel', 'ffa', 'teams']) {
    const base = Arena.create({ format, seed: 7 });
    assert.deepEqual(Arena.create({ format, seed: 7, localPlayers: 1 }), base);
    assert.deepEqual(Arena.create({ format, seed: 7, localPlayers: 3 }), base);
    assert.deepEqual(base.actors.map((a) => a.controller), base.actors.map((a, i) => i === 0 ? 'human' : 'cpu'));
    assert.ok(base.actors.every((a) => !/^P\d$/.test(a.name)));
  }
});

test('2P rosters: duel P1 vs P2, FFA P1+P2+2 CPU, team-up P1+P2 on one team', () => {
  const duel = Arena.create({ format: 'duel', localPlayers: 2 });
  assert.deepEqual(duel.actors.map((a) => [a.name, a.controller]), [['P1', 'human'], ['P2', 'human']]);
  const ffa = Arena.create({ format: 'ffa', localPlayers: 2 });
  assert.deepEqual(ffa.actors.map((a) => a.controller), ['human', 'human', 'cpu', 'cpu']);
  assert.equal(new Set(ffa.actors.map((a) => a.team)).size, 4);
  const teams = Arena.create({ format: 'teams', localPlayers: 2 });
  assert.deepEqual(teams.actors.map((a) => a.controller), ['human', 'human', 'cpu', 'cpu']);
  assert.equal(teams.actors[0].team, teams.actors[1].team);
  assert.notEqual(teams.actors[0].team, teams.actors[2].team);
  assert.equal(teams.actors[2].team, teams.actors[3].team);
});

test('expedition encounters and unknown values never seat a second human', () => {
  const boss = Arena.create({ localPlayers: 2, encounter: 'boss', bossTier: 1, crewCount: 2 });
  assert.equal(boss.actors.filter((a) => a.controller === 'human').length, 1);
});

test('two human command streams: each pilot lands the KO credit on the intended rival', () => {
  const state = playing({ format: 'duel', localPlayers: 2, seed: 3 });
  const [p1, p2] = state.actors;
  place(p1, 440, 420, { facing: 1 }); place(p2, 484, 420, { facing: -1 });
  let hit = null;
  for (let i = 0; i < 40 && !hit; i++) { Arena.step(state, { 1: i === 0 ? pulse() : idle(), 2: idle() }); hit = state.events.find((e) => e.type === 'hit'); }
  assert.ok(hit, 'P1 pulse connects');
  assert.ok(p2.damage > 0 && p1.damage === 0, 'only P2 took damage from P1');
  // P2 answers with its own stream.
  const second = playing({ format: 'duel', localPlayers: 2, seed: 3 });
  place(second.actors[0], 440, 420, { facing: 1 }); place(second.actors[1], 484, 420, { facing: -1 });
  for (let i = 0; i < 40 && !second.actors[0].damage; i++) Arena.step(second, { 1: idle(), 2: i === 0 ? pulse() : idle() });
  assert.ok(second.actors[0].damage > 0 && second.actors[1].damage === 0, 'only P1 took damage from P2');
});

test('team-up friendly fire is off between P1 and P2 but CPUs are still hit', () => {
  const state = playing({ format: 'teams', localPlayers: 2, seed: 5 });
  const [p1, p2, c1] = state.actors;
  place(p1, 440, 420, { facing: 1 }); place(p2, 484, 420, { facing: -1 });
  place(c1, 396, 420, { facing: 1 });
  state.actors[3].x = 900; state.actors[3].px = 900;
  for (let i = 0; i < 40; i++) Arena.step(state, { 1: i === 0 ? pulse() : idle(), 2: idle(), 3: idle(), 4: idle() });
  assert.equal(p2.damage, 0, 'ally P2 is not hurt by P1');
  place(p1, 440, 420, { facing: -1, damage: 0 }); place(c1, 396, 420, { facing: 1, damage: 0 });
  for (let i = 0; i < 40 && !c1.damage; i++) Arena.step(state, { 1: i === 0 ? pulse() : idle(), 2: idle(), 3: idle(), 4: idle() });
  assert.ok(c1.damage > 0, 'a CPU rival still takes the hit');
});

test('cpuInput never drives a second human', () => {
  const state = playing({ format: 'ffa', localPlayers: 2 });
  assert.deepEqual(Arena.cpuInput(state, 1), idle());
  assert.deepEqual(Arena.cpuInput(state, 2), idle());
});

// ---- keyboard split & pad assignment ----
const consts = new Function(between('  const LOCAL_KEYS', '  function rounded(') + '\nreturn { LOCAL_KEYS, P2_JOIN_KEYS, assignPads };')();
test('keyboard split: the two layouts share no key and cover every action', () => {
  const [a, b] = [consts.LOCAL_KEYS[1], consts.LOCAL_KEYS[2]];
  assert.deepEqual(Object.keys(a).filter((k) => k in b), []);
  for (const set of [a, b]) for (const action of ['left', 'right', 'jump', 'down', 'fire', 'dash']) assert.ok(Object.values(set).includes(action), action);
  assert.ok(consts.P2_JOIN_KEYS.every((k) => b[k] && k !== 'ArrowUp' && !k.startsWith('Arrow')), 'joining never steals menu navigation arrows');
  assert.equal(SpaceManArenaUIExport().localKeys[1].KeyF, 'fire');
});
function SpaceManArenaUIExport() {
  const sandbox = { window: undefined, globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.SpaceManArenaUI;
}
test('pad assignment: pad 1 to P1 and pad 2 to P2; a lone pad goes to P2', () => {
  const { assignPads } = consts;
  assert.deepEqual(assignPads([]), { p1: null, p2: null });
  assert.deepEqual(assignPads([0]), { p1: null, p2: 0 });
  assert.deepEqual(assignPads([2]), { p1: null, p2: 2 });
  assert.deepEqual(assignPads([3, 1]), { p1: 1, p2: 3 });
  assert.deepEqual(assignPads([0, 1, 2]), { p1: 0, p2: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(SpaceManArenaUIExport().assignPads([1, 0]))), { p1: 0, p2: 1 });
});

// ---- production input functions ----
function ui(pads = []) {
  const state = Arena.create({ format: 'duel', localPlayers: 2 }); state.phase = 'playing'; state.tick = 100;
  const log = { joins: 0, escapes: 0 };
  const c = vm.createContext({ ...{}, arena: Arena, state, held: new Map(), touches: new Map(), moveX: 0, moveY: 0, jumpEdge: false, attackEdge: false, dashEdge: false,
    touchEdges: { jump: false, attack: false, dash: false }, stick: null, stickBase: null, stickKnob: null, recoveryTap: null, actionBuffer: Arena.createActionBuffer(),
    pad: { moveX: 0, moveY: 0, jump: false }, padPrevious: {}, padNeedsNeutral: true, lastPadId: null, currentPrefs: {},
    root: { navigator: { getGamepads: () => c.pads } }, pads, rootEl: { dataset: { epoch: '1' }, inert: false }, inputSuspended: false, active: true, activeModal: null,
    paused: false, roomPaused: false, localRoomMenu: false, roomStatus: null, view: 'match', matchSerial: 1, usingTouch: false, sharedSession: null, localSession: null,
    local2: null, playerCount: 2, p2Joined: false, lobby: { contains: () => false, querySelectorAll: () => [] }, resultPanel: {}, performance: { now: () => c.now }, now: 1000, log,
    onlineActive: () => false, canControl: () => true, localActor: () => c.state.actors.find((a) => a.controller === 'human'), isRunning: () => true, isMatch: () => true,
    clamp: (v, l, h) => Math.max(l, Math.min(h, v)), joinP2() { log.joins++; }, showLobby() {}, close() {}, resumeMatch() {}, pauseMatch() { log.escapes++; }, focusStep() {}, cycleWatch() {}, roomInput: null, roomJoin: null, document: { hidden: false } });
  const code = between('    function resetTouchInput(', '    function guardPointer(') + between('    function pollGamepad(', '    function guardRecoveryClick(');
  vm.runInContext(between('  const LOCAL_KEYS', '  function rounded(') + code + '\nlocal2 = makeLocal2();', c);
  const key = (code, type = 'down') => c['onKey' + (type === 'down' ? 'Down' : 'Up')]({ code, key: '', repeat: false, preventDefault() {}, stopImmediatePropagation() {} });
  const tick = () => { c.state.tick++; c.now += 1000 / 60; };
  const pad = (index, buttons = [], axes = [0, 0]) => ({ index, connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: buttons.includes(i) })) });
  return { c, key, tick, pad };
}
const sample = (x) => ({ p1: x.c.command(), p2: x.c.command2() });

test('keyboard commands route per player: P1 keys never drive P2 and vice versa', () => {
  const x = ui();
  x.key('KeyD'); let { p1, p2 } = sample(x);
  assert.equal(p1.moveX, 1); assert.equal(p2.moveX, 0);
  x.key('KeyD', 'up'); x.key('ArrowLeft'); ({ p1, p2 } = sample(x));
  assert.equal(p1.moveX, 0); assert.equal(p2.moveX, -1);
  x.key('ArrowLeft', 'up');
  x.key('KeyF'); ({ p1, p2 } = sample(x));
  assert.equal(p1.attackHeld, true); assert.equal(p2.attackHeld, false);
  x.key('KeyF', 'up'); sample(x);
  x.key('Period'); x.tick(); ({ p1, p2 } = sample(x));
  assert.equal(p2.attackHeld, true); assert.equal(p1.attackHeld, false); assert.equal(p1.attackPressed, false);
  x.key('Period', 'up');
});

test('both pilots hold keys at once and neither input is dropped', () => {
  const x = ui();
  for (const k of ['KeyD', 'KeyW', 'ArrowLeft', 'ArrowUp', 'KeyG', 'Slash']) x.key(k);
  const { p1, p2 } = sample(x);
  assert.equal(p1.moveX, 1); assert.equal(p1.jumpHeld, true); assert.equal(p1.moveY, -1);
  assert.equal(p2.moveX, -1); assert.equal(p2.jumpHeld, true); assert.equal(p2.moveY, -1);
  assert.equal(p1.jumpPressed, true); assert.equal(p2.jumpPressed, true);
  assert.equal(p1.dashPressed, true); assert.equal(p2.dashPressed, true);
});

test('in couch play remapped single-player keys and the old shared keys do nothing', () => {
  const x = ui(); x.c.currentPrefs = { keys: { left: 'j', right: 'l', jump: 'i', fire: 'o' } };
  x.c.onKeyDown({ code: 'KeyJ', key: 'j', repeat: false, preventDefault() {}, stopImmediatePropagation() {} });
  x.key('KeyK'); x.key('KeyJ'); x.key('ShiftRight');
  const { p1, p2 } = sample(x);
  assert.equal(p1.moveX, 0); assert.equal(p1.attackHeld, false); assert.equal(p1.dashPressed, false);
  assert.equal(p2.dashPressed, true, 'Right Shift is P2 dash');
});

test('pads route per player: two pads, and a single pad goes to P2 with P1 on the keyboard', () => {
  const two = ui([]);
  two.c.pads = [two.pad(1), two.pad(0)]; two.c.pollGamepad(); // first poll waits for neutral
  two.c.pads = [two.pad(1, [2]), two.pad(0, [], [0.9, 0])]; two.c.pollGamepad();
  let { p1, p2 } = sample(two);
  assert.ok(p1.moveX > 0, 'pad 0 moves P1'); assert.equal(p2.moveX, 0);
  assert.equal(p2.attackHeld, true, 'pad 1 pulses P2'); assert.equal(p1.attackHeld, false);
  const one = ui([]);
  one.c.pads = [one.pad(0)]; one.c.pollGamepad(); one.c.pads = [one.pad(0, [], [-0.9, 0])]; one.c.pollGamepad();
  ({ p1, p2 } = sample(one));
  assert.equal(p1.moveX, 0, 'the lone pad never moves P1'); assert.ok(p2.moveX < 0, 'the lone pad moves P2');
  one.key('KeyD'); assert.equal(one.c.command().moveX, 1, 'keyboard still drives P1');
});

test('Menu on either pad pauses', () => {
  const x = ui();
  x.c.pads = [x.pad(0), x.pad(1)]; x.c.pollGamepad();
  x.c.pads = [x.pad(0), x.pad(1, [9])]; x.c.pollGamepad();
  assert.ok(x.c.log.escapes >= 1);
});

test('the lobby join prompt: only P2 action keys or the P2 pad A join', () => {
  const x = ui(); x.c.local2 = null; x.c.activeModal = x.c.lobby;
  x.key('ArrowDown'); x.key('KeyF'); x.key('Enter'); assert.equal(x.c.log.joins, 0);
  x.key('Period'); assert.equal(x.c.log.joins, 1);
  const padJoin = ui(); padJoin.c.local2 = null; padJoin.c.activeModal = padJoin.c.lobby;
  padJoin.c.pads = [padJoin.pad(0), padJoin.pad(1)]; padJoin.c.pollGamepad();
  padJoin.c.pads = [padJoin.pad(0, [0]), padJoin.pad(1)]; padJoin.c.pollGamepad(); assert.equal(padJoin.c.log.joins, 0, 'pad 1 (P1) A does not join P2');
  padJoin.c.pads = [padJoin.pad(0), padJoin.pad(1, [0])]; padJoin.c.pollGamepad(); assert.equal(padJoin.c.log.joins, 1);
});

test('single-player input path is untouched when no couch match is loaded', () => {
  const x = ui(); x.c.local2 = null; x.c.playerCount = 1;
  x.key('ArrowLeft'); x.key('KeyK');
  const c = x.c.command();
  assert.equal(c.moveX, -1, 'arrows still move the lone pilot');
  assert.equal(c.dashPressed, true, 'K still dashes');
  x.c.onKeyDown({ code: 'KeyJ', key: 'j', repeat: false, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(x.c.command().attackHeld, true, 'J still pulses');
});
