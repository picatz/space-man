const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { client, relay } = require("./harness.cjs");

test("race launcher is lazy, parks the runner, and preserves its state and records", (t) => {
  const storage = new Map([["sm2.best", "9876"]]);
  const c = client(relay(), { storage });
  t.after(() => c.close());
  assert.equal(c.run("raceUI"), null);
  assert.equal(c.net.active, false);
  c.run(`
    window.raceCreates = 0;
    window.SpaceManRaceUI = { create(options) {
      window.raceCreates++; window.raceOptions = options;
      return { active: false, open() { this.active = true; }, close() { this.active = false; options.onClose(); } };
    }};
    window.runnerBefore = G.player;
    window.frameBefore = G.frameCount;
    input.left = true; input.jumpHeld = true;
    $('btnRace').onclick();
  `);
  assert.equal(c.run("raceUI.active"), true);
  assert.equal(c.run("raceCreates"), 1);
  assert.equal(c.run("raceOptions.storageKey"), "sm2.race.v1");
  assert.equal(c.run("G.player === runnerBefore"), true);
  assert.equal(c.run("input.left || input.jumpHeld"), false);
  assert.equal(
    c.run("swSafeMoment()"),
    false,
    "an race never becomes a safe SW-reload moment",
  );
  c.run("frame(1000); frame(2000)");
  assert.equal(
    c.run("G.frameCount === frameBefore"),
    true,
    "runner does not advance behind race",
  );
  assert.equal(storage.get("sm2.best"), "9876");
  c.run("raceUI.close()");
  assert.equal(c.run("G.mode"), "attract");
  assert.equal(c.run("G.player === runnerBefore"), true);
  assert.equal(c.run("lastT"), 0);
  assert.equal(c.run("acc"), 0);
  c.run(
    "$('btnRace').onclick(); raceUI.close(); startRun(); G.mode = 'play'; input.right = true; update()",
  );
  assert.equal(c.run("raceCreates"), 1, "opening twice reuses one UI instance");
  assert.ok(
    c.run("G.player.vx > 0"),
    "runner remains playable after returning",
  );
  assert.equal(c.net.active, false, "CPU race never starts relay transport");
});

test("race never silently leaves or changes a live Run Together room", (t) => {
  const c = client(relay());
  t.after(() => c.close());
  c.run(`
    window.SpaceManRaceUI = { create() { throw new Error('must not open while connected'); } };
    NET.mockActive = true;
    $('btnRace').onclick();
  `);
  assert.equal(c.run("raceUI"), null);
  assert.equal(c.net.mockActive, true);
  assert.match(
    c.elements.get("srAnnounce").textContent,
    /room is still connected/,
  );
  c.net.mockActive = false;
});

test("race preferences inherit the exact preview build storage namespace", (t) => {
  const sha = "a".repeat(40),
    buildSha = "b".repeat(40);
  const preview = {
    schema: 1,
    pr: 28,
    sha,
    buildSha,
    basePath: `/pr/28/${sha}/${buildSha}/`,
  };
  const c = client(relay(), { preview, pathname: preview.basePath });
  t.after(() => c.close());
  c.run(
    `window.SpaceManRaceUI = { create(options) { window.raceOptions = options; return { active: false, open() {} }; } }; $('btnRace').onclick()`,
  );
  assert.equal(
    c.run("raceOptions.storageKey"),
    `sm2.preview.28.${sha}.${buildSha}.sm2.race.v1`,
  );
});

test("a controller button held while leaving race cannot start the runner", (t) => {
  const pad = {
    connected: true,
    mapping: "standard",
    index: 0,
    axes: [0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false })),
  };
  const c = client(relay(), { navigator: { getGamepads: () => [pad] } });
  t.after(() => c.close());
  c.run(
    `window.SpaceManRaceUI = { create(options) { return { active: false, open() { this.active = true; }, close() { this.active = false; options.onClose(); } }; } }; $('btnRace').onclick()`,
  );
  pad.buttons[0].pressed = true;
  c.run("raceUI.close(); pollGamepad(); pollGamepad()");
  assert.equal(c.run("G.mode"), "attract");
  assert.equal(c.run("raceUI.active"), false);
  assert.equal(c.run("arenaPadNeutral"), true);
  pad.buttons[0].pressed = false;
  c.run("pollGamepad()");
  assert.equal(c.run("arenaPadNeutral"), false);
  assert.equal(c.run("G.mode"), "attract");
});

test("mode launchers cannot layer racing and arena on top of one another", (t) => {
  const c = client(relay());
  t.after(() => c.close());
  c.run(
    `window.SpaceManRaceUI={create(o){return{active:false,open(){this.active=true},close(){this.active=false;o.onClose()}}}}; window.SpaceManArenaUI={create(o){return{active:false,open(){this.active=true},close(){this.active=false;o.onClose()}}}}; $('btnRace').onclick(); $('btnArena').onclick()`,
  );
  assert.equal(c.run("raceUI.active"), true);
  assert.equal(c.run("arenaUI"), null);
  c.run(`raceUI.close(); $('btnArena').onclick(); $('btnRace').onclick()`);
  assert.equal(c.run("arenaUI.active"), true);
  assert.equal(c.run("raceUI.active"), false);
});

for (const overlap of [false, true]) test('gamepad title launch parks runner in the same frame' + (overlap ? ' even with A + Menu' : ''), t => {
 const pad={connected:true,mapping:'standard',index:0,axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
 const c=client(relay(),{navigator:{getGamepads:()=>[pad]}});t.after(()=>c.close());
 c.run(`window.SpaceManRaceUI={create(o){return{active:false,open(){this.active=true},close(){this.active=false;o.onClose()}}}}; window.beforeRaceFrame=G.frameCount; window.beforeRacePlayer=G.player; pollMenuNav=()=>{$('btnRace').onclick();return true;}`);
 pad.buttons[0].pressed=true;pad.buttons[9].pressed=overlap;
 c.run('frame(1000)');
 assert.equal(c.run('raceUI.active'),true);assert.equal(c.run('G.mode'),'attract');assert.equal(c.run('G.frameCount===beforeRaceFrame'),true);assert.equal(c.run('G.player===beforeRacePlayer'),true);
 c.run('raceUI.close()');assert.equal(c.run('G.mode'),'attract');assert.equal(c.run('G.player===beforeRacePlayer'),true);
});
