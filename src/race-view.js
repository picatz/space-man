/* Perspective presentation adapter. Consumes detached snapshots; never advances rules. */
(function (root) {
  "use strict";
  const modes = ["chase", "cockpit", "topdown"],
    names = { chase: "Chase", cockpit: "Cockpit", topdown: "Top-down" };
  const CSS = `
.race-world{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.race-view-controls{position:absolute;right:calc(var(--race-right) + 18px);top:calc(var(--race-top) + 78px);z-index:4;text-align:right}.race-view-toggle{background:#0b2033ed;min-width:103px;font-size:11px;min-height:44px}.race-view-menu{display:grid;gap:4px;padding:8px;margin-top:6px;width:175px;border:1px solid #4b6b80;border-radius:15px;background:#091c2ff5;box-shadow:0 8px 25px #0006}.race-view-menu .race-button{width:100%;text-align:left;min-height:44px}.race-view-menu [aria-pressed=true]{border-color:#c7f47d;color:#d4ffa4;background:#28403c}.race-view-note{font-size:9px;color:#a6c7d8;padding:4px 7px}.race-root[data-screen=lobby] .race-view-controls,.race-root[data-screen=results] .race-view-controls,.race-root[data-screen=pause]>.race-view-controls{display:none}.race-root[data-camera=chase] .race-warning,.race-root[data-camera=cockpit] .race-warning{top:calc(var(--race-top) + 134px)}.race-camera-options{display:flex;flex-wrap:wrap;gap:5px;margin:13px 0}.race-camera-options .race-button{flex:1;min-width:80px;padding:8px;font-size:10px}.race-camera-options [aria-pressed=true]{border-color:#c7f47d;color:#d4ffa4}.race-cockpit{pointer-events:none;position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:min(670px,75%);height:17%;z-index:1;border-radius:60% 60% 0 0 / 50% 50% 0 0;background:linear-gradient(180deg,#719dae 0%,#d8eff1 4%,#274555 8%,#0a192a 14%,#07121f 100%);border-top:2px solid #92e5ea;box-shadow:0 -8px 25px #07172566}.race-cockpit:before{content:'STAR CIRCUIT • FLIGHT SYSTEMS';position:absolute;left:25%;right:25%;top:18%;padding:9px 0;border:1px solid #416d7a;border-radius:8px;color:#90dfdc;background:#122b37;text-align:center;font:8px/1.4 ui-monospace,monospace;letter-spacing:.15em}.race-root[data-touch=true] .race-cockpit{height:13%;width:48%}
@media(max-width:600px){.race-view-controls{top:calc(var(--race-top) + 76px);right:calc(var(--race-right) + 12px)}.race-view-toggle{min-width:95px;padding:7px 10px}.race-view-menu{width:157px}.race-cockpit:before{font-size:6px;letter-spacing:0;left:15%;right:15%;padding:6px}}
@media(max-height:520px){.race-view-controls{top:calc(var(--race-top) + 65px)}.race-view-menu{display:grid;grid-template-columns:1fr 1fr;width:245px}.race-view-note{grid-column:1/-1}.race-cockpit{height:20%}}
@media(max-height:360px) and (min-width:480px){.race-view-menu{width:min(430px,calc(100vw - var(--race-left) - var(--race-right) - 24px));grid-template-columns:repeat(4,minmax(0,1fr))}.race-view-menu .race-button{font-size:10px;line-height:1.2;padding:6px;min-height:44px}}
`;
  function create(options) {
    const parent = options.root,
      base = options.canvas,
      camera = root.SpaceManRaceCamera.create(),
      timeline = root.SpaceManRacePresentation?.createTimeline(),
      key = (options.storageKey || "sm2.race.v1") + ".camera";
    let mode = "chase",
      renderer = null,
      attempted = false,
      pendingQuality = 1,
      scene = null,
      trackId = null,
      w = 1,
      h = 1,
      dpr = 1,
      quality = 1,
      slow = 0,
      fast = 0,
      lastTick = null,
      mesh = null,
      disposed = false,
      fallback = false;
    const canvas = document.createElement("canvas");
    canvas.className = "race-world";
    canvas.setAttribute("aria-hidden", "true");
    canvas.hidden = true;
    const style = document.createElement("style");
    style.textContent = CSS;
    parent.append(style, canvas);
    const cockpit = document.createElement("div");
    cockpit.className = "race-cockpit";
    cockpit.hidden = true;
    cockpit.setAttribute("aria-hidden", "true");
    parent.append(cockpit);
    const controls = document.createElement("div");
    controls.className = "race-view-controls";
    const menu = document.createElement("div");
    menu.className = "race-view-menu";
    menu.hidden = true;
    const buttons = [];
    function button(text, fn) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "race-button race-small";
      b.textContent = text;
      b.addEventListener("click", fn);
      return b;
    }
    const toggle = button("Chase ▾", () => {
      menu.hidden = !menu.hidden;
      toggle.setAttribute("aria-expanded", String(!menu.hidden));
    });
    toggle.className += " race-view-toggle";
    toggle.setAttribute("aria-label", "Camera view");
    toggle.setAttribute("aria-expanded", "false");
    const note = document.createElement("div");
    note.className = "race-view-note";
    note.textContent = "C switches view · steady horizon";
    function group(container) {
      for (const value of modes) {
        const b = button(names[value], () => setMode(value));
        b.dataset.camera = value;
        b.setAttribute("aria-pressed", String(value === mode));
        buttons.push(b);
        container.append(b);
      }
    }
    group(menu);
    menu.append(
      button("Reset camera", () => {
        camera.reset();
        menu.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        options.announce?.("Camera reset");
      }),
      note,
    );
    controls.append(toggle, menu);
    parent.append(controls);
    try {
      const saved = root.localStorage.getItem(key);
      if (modes.includes(saved)) mode = saved;
    } catch (_) {}
    function sync() {
      parent.dataset.camera = mode;
      if (toggle.textContent !== names[mode] + " ▾")
        toggle.textContent = names[mode] + " ▾";
      for (const b of buttons)
        b.setAttribute("aria-pressed", String(b.dataset.camera === mode));
    }
    function setMode(value) {
      if (!modes.includes(value)) return;
      mode = value;
      camera.reset();
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      try {
        root.localStorage.setItem(key, mode);
      } catch (_) {}
      sync();
      options.announce?.(names[mode] + " camera");
      base.focus({ preventScroll: true });
    }
    function fail(message) {
      fallback = true;
      canvas.hidden = true;
      cockpit.hidden = true;
      base.hidden = false;
      parent.dataset.renderer = "2d-fallback";
      note.textContent = message || "3D unavailable · using top-down";
      if (toggle.textContent !== "2D fallback ▾")
        toggle.textContent = "2D fallback ▾";
    }
    function init() {
      if (renderer || disposed || attempted) return;
      attempted = true;
      renderer = root.SpaceManRender3D?.create(canvas, {
        powerSaving: !!options.settings?.().batterySaver,
        onLost() {
          fail("Graphics interrupted · top-down active");
        },
        onRestored() {
          fallback = false;
          camera.reset();
          note.textContent = "3D restored · C switches view";
          resize(w, h, dpr);
        },
      });
      if (!renderer) fail();
      else {
        fallback = false;
        resize(w, h, dpr);
      }
    }
    function resize(width, height, ratio) {
      w = width;
      h = height;
      dpr = ratio;
      renderer?.resize(w, h, Math.min(dpr, 1.5) * quality);
    }
    function render(snapshot, config = {}) {
      if (disposed || !snapshot || mode === "topdown") {
        canvas.hidden = true;
        cockpit.hidden = true;
        base.hidden = false;
        parent.dataset.renderer = "2d";
        return false;
      }
      init();
      if (!renderer || renderer.status !== "ready") {
        fail();
        return false;
      }
      // A resolution change clears the drawing buffer. Apply it BEFORE the
      // next draw, never after a frame that will immediately be presented.
      const requestedQuality = options.settings?.().batterySaver
        ? 0.7
        : pendingQuality;
      if (requestedQuality !== quality) {
        quality = requestedQuality;
        slow = fast = 0;
        resize(w, h, dpr);
      }
      snapshot =
        config.network && timeline
          ? timeline.sample(snapshot, root.performance.now(), {
              paused: config.paused,
            })
          : root.SpaceManRacePresentation?.between(
              config.previous,
              snapshot,
              config.alpha,
            ) || snapshot;
      const a =
        snapshot.actors.find((a) => a.id === config.actorId) ||
        snapshot.actors[0];
      if (!a) return false;
      const course = root.SpaceManRace.course(snapshot.trackId);
      if (trackId !== snapshot.trackId) {
        scene = root.SpaceManRaceScene.course(course, root.SpaceManRace.at);
        trackId = snapshot.trackId;
        camera.reset();
        timeline?.reset();
        lastTick = null;
      }
      // Reuse immutable local-space craft meshes on the GPU. Only small model
      // transforms change each display frame, including interpolated frames.
      const moving = root.SpaceManRaceScene.actorMeshes(snapshot, {
        hideId: mode === "cockpit" ? a.id : null,
        calm: !!config.reduceMotion,
        chaseActor: mode === "chase" ? a : null,
      });
      const view = camera.update(a, course, root.SpaceManRace.at, {
        mode,
        dt: config.dt,
        aspect: w / h,
        reduceMotion: config.reduceMotion,
      });
      const started = root.performance.now();
      const ok = renderer.draw({
        ...scene,
        camera: view,
        meshes: [...scene.meshes, ...moving],
      });
      const cost = root.performance.now() - started;
      if (!ok) {
        fail();
        return false;
      }
      const lowPower = !!options.settings?.().batterySaver;
      if (cost > 17 || config.dt > 0.026) slow++;
      else slow = Math.max(0, slow - 1);
      if (cost < 7 && config.dt < 0.019) fast++;
      else fast = 0;
      const next = lowPower ? 0.7 : slow > 30 ? 0.65 : fast > 240 ? 1 : quality;
      pendingQuality = next;
      fallback = false;
      canvas.hidden = false;
      base.hidden = true;
      cockpit.hidden = mode !== "cockpit";
      parent.dataset.renderer = "webgl";
      if (toggle.textContent !== names[mode] + " ▾")
        toggle.textContent = names[mode] + " ▾";
      parent.dataset.quality = String(quality);
      return true;
    }
    sync();
    return {
      render,
      resize,
      setMode,
      cycle() {
        setMode(modes[(modes.indexOf(mode) + 1) % modes.length]);
      },
      reset() {
        camera.reset();
        timeline?.reset();
        lastTick = null;
      },
      panel(container) {
        const g = document.createElement("div");
        g.className = "race-camera-options";
        g.setAttribute("aria-label", "Camera view");
        group(g);
        container.append(g);
        sync();
      },
      close() {
        canvas.hidden = true;
        cockpit.hidden = true;
        menu.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        base.hidden = false;
        camera.reset();
        timeline?.reset();
        lastTick = null;
      },
      destroy() {
        disposed = true;
        renderer?.dispose();
        controls.remove();
        canvas.remove();
        cockpit.remove();
        style.remove();
      },
      get mode() {
        return mode;
      },
      get status() {
        return fallback ? "fallback" : renderer?.status || "idle";
      },
    };
  }
  root.SpaceManRaceView = Object.freeze({ create });
})(typeof window !== "undefined" ? window : globalThis);
