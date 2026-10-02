const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Race = require("../src/race.js");
const Camera = require("../src/race-camera.js");
const Scene = require("../src/race-scene.js");

const source = fs.readFileSync(require.resolve("../src/race-view.js"), "utf8");
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};

// Use the real camera and mesh builders with a minimal DOM/WebGL adapter.
// The fake drawing buffer follows the browser contract: resize clears pixels.
function harness({
  unavailable = false,
  batterySaver = false,
  width = 1280,
  height = 720,
} = {}) {
  const nodes = [],
    operations = [],
    frames = [],
    storage = new Map();
  const prefs = { batterySaver };
  const document = { activeElement: null, createElement: element };
  function element(tagName) {
    const listeners = new Map();
    const node = {
      tagName: tagName.toUpperCase(),
      children: [],
      attrs: {},
      dataset: {},
      hidden: false,
      append(...children) {
        this.children.push(...children);
      },
      setAttribute(name, value) {
        this.attrs[name] = String(value);
      },
      getAttribute(name) {
        return this.attrs[name] ?? null;
      },
      addEventListener(name, callback) {
        listeners.set(name, callback);
      },
      focus() {
        if (!this.hidden) document.activeElement = this;
      },
      click() {
        listeners.get("click")?.({ preventDefault() {} });
      },
      remove() {
        this.removed = true;
      },
    };
    nodes.push(node);
    return node;
  }
  const parent = element("section"),
    base = element("canvas");
  let attempts = 0,
    callbacks = null,
    hasPixels = false;
  const renderer = {
    status: "ready",
    draw(scene) {
      operations.push("draw");
      frames.push(scene);
      hasPixels = true;
      return true;
    },
    resize(w, h, dpr) {
      operations.push("resize");
      hasPixels = false;
      this.size = [w, h, dpr];
    },
    dispose() {
      this.status = "disposed";
      operations.push("dispose");
    },
  };
  const sandbox = {
    document,
    SpaceManRace: Race,
    SpaceManRaceCamera: Camera,
    SpaceManRaceScene: Scene,
    performance: { now: () => 0 },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    SpaceManRender3D: {
      create(canvas, options) {
        attempts++;
        callbacks = options;
        return unavailable ? null : renderer;
      },
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  const view = sandbox.SpaceManRaceView.create({
    root: parent,
    canvas: base,
    settings: () => prefs,
  });
  view.resize(width, height, 2);
  const snapshot = freeze(Race.snapshot(Race.create()));
  const config = {
    dt: 1 / 60,
    reduceMotion: true,
    actorId: snapshot.actors[0].id,
  };
  return {
    view,
    parent,
    base,
    renderer,
    snapshot,
    config,
    nodes,
    operations,
    frames,
    prefs,
    get attempts() {
      return attempts;
    },
    get hasPixels() {
      return hasPixels;
    },
    world: nodes.find((node) => node.className === "race-world"),
    menu: nodes.find((node) => node.className === "race-view-menu"),
    toggle: nodes.find((node) => node.className?.includes("race-view-toggle")),
    lose() {
      renderer.status = "lost";
      callbacks.onLost(renderer);
    },
    restore() {
      renderer.status = "ready";
      callbacks.onRestored(renderer);
    },
  };
}

test("unavailable WebGL is attempted once while repeated frames keep the top-down fallback playable", () => {
  const h = harness({ unavailable: true });
  for (let i = 0; i < 120; i++)
    assert.equal(h.view.render(h.snapshot, h.config), false);
  assert.equal(
    h.attempts,
    1,
    "permanent initialization failure must not retry every RAF",
  );
  assert.equal(h.parent.dataset.renderer, "2d-fallback");
  assert.equal(h.base.hidden, false);
  assert.equal(h.world.hidden, true);
  h.view.setMode("topdown");
  h.view.render(h.snapshot, h.config);
  h.view.setMode("chase");
  h.view.render(h.snapshot, h.config);
  assert.equal(
    h.attempts,
    1,
    "switching cameras does not resume an uncontrolled retry loop",
  );
  h.view.destroy();
});

test("battery-saver quality changes never resize away the successful final frame", () => {
  const h = harness({ batterySaver: true });
  for (let i = 0; i < 3; i++) {
    assert.equal(h.view.render(h.snapshot, h.config), true);
    assert.equal(
      h.operations.at(-1),
      "draw",
      "each successful frame ends with drawing",
    );
    assert.equal(
      h.hasPixels,
      true,
      "changing resolution cannot expose a blank drawing buffer",
    );
  }
  assert.equal(h.parent.dataset.quality, "0.7");
  assert.ok(h.renderer.size[2] < 1.5, "saver lowers the requested pixel ratio");
  h.view.destroy();
});

test("slow-frame downshift and fast-frame recovery resize before drawing", () => {
  const h = harness();
  h.view.render(h.snapshot, h.config);
  const initialRatio = h.renderer.size[2];
  for (let i = 0; i < 34; i++) {
    assert.equal(h.view.render(h.snapshot, { ...h.config, dt: 0.04 }), true);
    assert.equal(h.operations.at(-1), "draw");
    assert.equal(h.hasPixels, true);
  }
  assert.equal(h.parent.dataset.quality, "0.65");
  assert.ok(h.renderer.size[2] < initialRatio);
  for (let i = 0; i < 245; i++) {
    assert.equal(h.view.render(h.snapshot, h.config), true);
    assert.equal(h.operations.at(-1), "draw");
    assert.equal(h.hasPixels, true);
  }
  assert.equal(h.parent.dataset.quality, "1");
  assert.equal(h.renderer.size[2], initialRatio);
  h.view.destroy();
});

test("close hides the camera menu and resets its expanded accessibility state", () => {
  const h = harness();
  h.view.render(h.snapshot, h.config);
  h.toggle.click();
  assert.equal(h.menu.hidden, false);
  assert.equal(h.toggle.getAttribute("aria-expanded"), "true");
  h.view.close();
  assert.equal(h.menu.hidden, true);
  assert.equal(h.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(h.world.hidden, true);
  assert.equal(h.base.hidden, false);
  h.view.render(h.snapshot, h.config);
  assert.equal(h.menu.hidden, true);
  assert.equal(h.toggle.getAttribute("aria-expanded"), "false");
  h.view.destroy();
});

test("a deeply frozen snapshot can render, resize and change cameras without mutation", () => {
  const h = harness(),
    before = JSON.stringify(h.snapshot);
  for (const mode of ["chase", "cockpit", "topdown", "chase"]) {
    h.view.setMode(mode);
    for (const [w, height] of [
      [1280, 720],
      [390, 844],
      [844, 390],
    ]) {
      h.view.resize(w, height, 2);
      h.view.render(h.snapshot, h.config);
      assert.equal(JSON.stringify(h.snapshot), before);
    }
  }
  h.view.destroy();
});

test("camera switching while paused rebuilds actor geometry and redraws the unchanged tick", () => {
  const h = harness();
  h.view.render(h.snapshot, h.config);
  const chase = h.frames.at(-1),
    tick = h.snapshot.tick;
  // No simulation step or snapshot replacement occurs between camera changes.
  h.view.setMode("cockpit");
  assert.equal(h.view.render(h.snapshot, h.config), true);
  const cockpit = h.frames.at(-1);
  assert.notEqual(cockpit.meshes.at(-1), chase.meshes.at(-1));
  assert.equal(
    cockpit.meshes.at(-1).vertices.length,
    Scene.actors(h.snapshot, { hideId: h.snapshot.actors[0].id }).vertices
      .length,
    "cockpit omits the local pilot rather than reusing chase geometry",
  );
  assert.equal(cockpit.camera.eye[1], 34);
  assert.ok(chase.camera.eye[1] > 50);
  h.view.setMode("topdown");
  assert.equal(h.view.render(h.snapshot, h.config), false);
  assert.equal(h.base.hidden, false);
  assert.equal(h.world.hidden, true);
  h.view.setMode("chase");
  assert.equal(h.view.render(h.snapshot, h.config), true);
  assert.equal(h.base.hidden, true);
  assert.equal(h.world.hidden, false);
  assert.equal(
    h.frames.at(-1).meshes.at(-1).vertices.length,
    chase.meshes.at(-1).vertices.length,
  );
  assert.equal(h.snapshot.tick, tick);
  h.view.destroy();
});

test("context loss falls back and restoration redraws while paused without advancing simulation", () => {
  const h = harness(),
    before = JSON.stringify(h.snapshot);
  h.view.render(h.snapshot, h.config);
  h.lose();
  assert.equal(h.view.render(h.snapshot, h.config), false);
  assert.equal(h.parent.dataset.renderer, "2d-fallback");
  assert.equal(h.base.hidden, false);
  assert.equal(h.world.hidden, true);
  h.restore();
  assert.equal(h.view.render(h.snapshot, h.config), true);
  assert.equal(h.parent.dataset.renderer, "webgl");
  assert.equal(h.hasPixels, true);
  assert.equal(JSON.stringify(h.snapshot), before);
  h.lose();
  h.view.setMode("topdown");
  h.restore();
  assert.equal(
    h.view.render(h.snapshot, h.config),
    false,
    "restoration respects a top-down selection",
  );
  assert.equal(h.base.hidden, false);
  assert.equal(h.world.hidden, true);
  h.view.destroy();
});
