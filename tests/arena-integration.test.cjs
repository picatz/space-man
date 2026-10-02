const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { client, relay } = require('./harness.cjs');

test('arena launcher is lazy, parks the runner, and preserves its state and records', (t) => {
  const storage = new Map([['sm2.best', '9876']]);
  const c = client(relay(), { storage }); t.after(() => c.close());
  assert.equal(c.run('arenaUI'), null);
  assert.equal(c.net.active, false);
  c.run(`
    window.arenaCreates = 0;
    window.SpaceManArenaUI = { create(options) {
      window.arenaCreates++; window.arenaOptions = options;
      return { active: false, open() { this.active = true; }, close() { this.active = false; options.onClose(); } };
    }};
    window.runnerBefore = G.player;
    window.frameBefore = G.frameCount;
    input.left = true; input.jumpHeld = true;
    $('btnArena').onclick();
  `);
  assert.equal(c.run('arenaUI.active'), true);
  assert.equal(c.run('arenaCreates'), 1);
  assert.equal(c.run('arenaOptions.storageKey'), 'sm2.arena.v1');
  assert.equal(c.run('G.player === runnerBefore'), true);
  assert.equal(c.run('input.left || input.jumpHeld'), false);
  assert.equal(c.run('swSafeMoment()'), false, 'an arena never becomes a safe SW-reload moment');
  c.run('frame(1000); frame(2000)');
  assert.equal(c.run('G.frameCount === frameBefore'), true, 'runner does not advance behind arena');
  assert.equal(storage.get('sm2.best'), '9876');
  c.run('arenaUI.close()');
  assert.equal(c.run('G.mode'), 'attract');
  assert.equal(c.run('G.player === runnerBefore'), true);
  assert.equal(c.run('lastT'), 0);
  assert.equal(c.run('acc'), 0);
  c.run("$('btnArena').onclick(); arenaUI.close(); startRun(); G.mode = 'play'; input.right = true; update()");
  assert.equal(c.run('arenaCreates'), 1, 'opening twice reuses one UI instance');
  assert.ok(c.run('G.player.vx > 0'), 'runner remains playable after returning');
  assert.equal(c.net.active, false, 'CPU arena never starts relay transport');
});

test('arena never silently leaves or changes a live Run Together room', (t) => {
  const c = client(relay()); t.after(() => c.close());
  c.run(`
    window.SpaceManArenaUI = { create() { throw new Error('must not open while connected'); } };
    NET.mockActive = true;
    $('btnArena').onclick();
  `);
  assert.equal(c.run('arenaUI'), null);
  assert.equal(c.net.mockActive, true);
  assert.match(c.elements.get('srAnnounce').textContent, /room is still connected/);
  c.net.mockActive = false;
});

test('arena preferences inherit the exact preview build storage namespace', (t) => {
  const sha = 'a'.repeat(40), buildSha = 'b'.repeat(40);
  const preview = { schema: 1, pr: 28, sha, buildSha, basePath: `/pr/28/${sha}/${buildSha}/` };
  const c = client(relay(), { preview, pathname: preview.basePath }); t.after(() => c.close());
  c.run(`window.SpaceManArenaUI = { create(options) { window.arenaOptions = options; return { active: false, open() {} }; } }; $('btnArena').onclick()`);
  assert.equal(c.run('arenaOptions.storageKey'), `sm2.preview.28.${sha}.${buildSha}.sm2.arena.v1`);
});

test('a controller button held while leaving arena cannot start the runner', (t) => {
  const pad = { connected: true, mapping: 'standard', index: 0, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) };
  const c = client(relay(), { navigator: { getGamepads: () => [pad] } }); t.after(() => c.close());
  c.run(`window.SpaceManArenaUI = { create(options) { return { active: false, open() { this.active = true; }, close() { this.active = false; options.onClose(); } }; } }; $('btnArena').onclick()`);
  pad.buttons[0].pressed = true;
  c.run('arenaUI.close(); pollGamepad(); pollGamepad()');
  assert.equal(c.run('G.mode'), 'attract');
  assert.equal(c.run('arenaUI.active'), false);
  assert.equal(c.run('arenaPadNeutral'), true);
  pad.buttons[0].pressed = false;
  c.run('pollGamepad()');
  assert.equal(c.run('arenaPadNeutral'), false);
  assert.equal(c.run('G.mode'), 'attract');
});

test('arena isolation is explicit and uses only the shared art kit, not runner networking', () => {
  const root = path.resolve(__dirname, '..');
  const sim = fs.readFileSync(path.join(root, 'src/arena.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'src/arena-ui.js'), 'utf8');
  assert.doesNotMatch(sim, /\b(?:document|localStorage|sessionStorage|WebSocket)\s*\./);
  assert.doesNotMatch(ui, /\b(?:SpaceManNet|sessionStorage)\s*\./);
  assert.doesNotMatch(ui, /sm2\.(?:best|stats|resume|top5)/);
  assert.match(ui, /SpaceManArt/);
});
