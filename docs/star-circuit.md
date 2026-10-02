# Star Circuit

An original perspective arcade hoverkart racer alongside Space Man’s runner and
Orbital Arena. Five pilots race three laps around an authored circuit. Steering,
braking, soft kart contacts, boost strips and a rechargeable boost reserve make
corner entry and exit matter. Play locally against four CPUs, or create a friend
room with up to four human racers and CPU-filled empty slots.

## Circuits and controls

- **Starlight Speedway:** wide, flowing bends for a first race
- **Ember Switchback:** a winding volcanic slalom and fast outer sweep
- **Bloom Lagoon:** an emerald ribbon with alternating sweeping corners
- **Chill / Sport / Expert:** CPU pace, using the same kart physics and controls
- Auto-drive is on: A/D or Left/Right steer; S/Down brakes; Space/Shift boosts;
  R rescues; Escape pauses
- Touch: left/right steering buttons, brake and boost, plus a rescue button
- Standard controller: stick/D-pad steering, B/L2 brake, A/R2 boost, X rescue,
  Menu pause. Menus also support controller navigation and A activation
- Existing left-handed, remapped steering, mute/SFX volume and battery-saving
  preferences carry over. Race setup is stored separately from runner progress

Missing a bend slows the kart on the shoulder. Rescue places the kart just after
its **last accepted checkpoint**, drains 25 boost units and stops it for 1.5
seconds. It never grants checkpoint or lap credit. A kart that travels far beyond
the track is rescued automatically. CPUs invoke this same command if stuck.

## Simulation boundary

`src/race.js` contains pure, fixed 60 Hz rules and exports `create`, `command`,
`step`, `cpuInput`, `standings`, and `snapshot`, plus the read-only course data.
There are no DOM, storage, audio, timers, random numbers, or transport calls in
the simulation. Track control points generate a closed Catmull–Rom spline;
nearest-road queries and 20 ordered forward-only checkpoint planes determine
track position. A lap requires all 20 gates in sequence, including the finish
line. Collision resolution precedes the checkpoint sweep to avoid stranding a
pilot just past a gate because of a bump.

`src/race-ui.js` owns a lazy, isolated canvas/DOM presentation. `create(options)`
accepts `storageKey`, `settings()` and `onClose()` and returns `open`, `close`,
`destroy`, `active`, `screen`, and a detached `snapshot()`. Controls produce
normalized commands. Touch cancellation, lost capture, global release,
viewport changes, visibility, pause/restart and mode exit all clear held input.
The overlay consumes the shared safe-area/status-rail insets and the visual
viewport, so browser chrome is not reserved twice. Choose **Chase**, **Cockpit**
or **Top-down** in the setup, pause panel or camera menu. C cycles views unless
that key is remapped to steering; Reset camera is in the camera menu. Camera
selection is separate from race progress and uses the same build-specific save
namespace. Reduced motion removes speed-dependent field-of-view and follow lag;
no camera mode rolls the horizon or adds shake.

## Renderer boundary

The WebGL camera is genuine perspective rendering of lit, depth-tested 3D meshes.
Race rules remain **planar arcade physics**, so this does not add 3D collisions,
a full first-person game, stereoscopic output, headset tracking or VR support.
Cockpit is a first-person view of the same kart. Track walls, skyline structures
and the finish arch are presentation geometry, not newly introduced obstacles.

- `src/render3d.js`: reusable Y-up, right-handed WebGL 1 renderer, perspective /
  look-at / projection math, lighting, fog, depth testing and GPU lifetime
- `src/race-camera.js`: chase/cockpit poses, stable horizon, aspect-aware phone
  framing, render-only smoothing and reset on rescue or followed-pilot change
- `src/race-track-mesh.js`: one full-course distance field partitioned into
  disjoint road/curb/apron triangles, so tight corners cannot self-overlap
- `src/race-presentation.js`: fixed-tick local pose interpolation and a bounded
  received-snapshot playback clock; no physics prediction or extrapolation
- `src/race-scene.js`: original procedural road, boost strips, karts and three
  themed skylines; immutable course meshes plus per-snapshot actor meshes
- `src/race-view.js`: camera menu, preferences, resolution budget and safe fallback

The renderer receives a camera and colored triangle meshes. It knows nothing
about runner, arena, race, room authority or input. The race adapter reads a
**detached snapshot** plus the followed pilot ID. Future modes can supply other
scene builders/cameras without duplicating their simulation. It never moves a
kart, adds a checkpoint or advances time. Both renderer modules are inert until
a perspective view is actually requested; the runner retains its existing 2D
rendering path.

No runtime dependency, model download, texture asset, service or paid API is
required. Static course and per-color craft geometry stay on the GPU; only tiny actor
pose matrices change on each display frame. The exact road triangles are grouped
into spatial chunks sharing one CPU buffer, and conservative frustum checks
skip off-camera chunks before upload/draw. The hidden top-down canvas skips its
full-screen background pass while WebGL is shown. Scenery clearance is measured
against the entire course plus each prop footprint, including nearby hairpins. Pixel ratio is capped at 1.5, battery saving uses 70% resolution,
and sustained slow frames reduce resolution to 65%. Fast frames restore quality.
Context loss switches to the original playable top-down view and restoration
rebuilds graphics resources. A browser without WebGL attempts initialization once
and stays in fallback. Closed modes stop drawing; destruction releases buffers
and listeners. All modules are included in the versioned offline cache.

## Verification

- `node --test tests/race.test.cjs` for deterministic simulation rules
- `node --test tests/render3d.test.cjs tests/race-camera.test.cjs tests/race-view.test.cjs`
  for renderer, camera, immutable snapshot and graphics-lifecycle contracts
- `node --test tests/*.test.cjs` for the complete game regression suite
- In `tests/browser`, `npm ci`, install Playwright Chromium/WebKit, then run
  `node --test race.test.cjs race-perspective.test.cjs`; choose WebKit with `SPACE_MAN_RACE_BROWSER=webkit`
- `SPACE_MAN_RACE_SCREENSHOTS=/path` saves browser screenshots for visual review

The browser suite drives a complete three-lap race through ordinary gamepad
commands. It reads detached snapshots to steer but never mutates race state or
skips physics. It also covers real touch cancellation in Chromium, pointer
lifecycle in WebKit, mobile rotation, narrow viewports, pause/resume, settings,
rematch and repeat opening/closing. Browser-engine coverage is not a claim of
physical-device testing.

## Friend racing (v3.23)

Open **Star Circuit**, then **Play with friends**. Create a room and share its
invite (or production room code), or choose Join race / Watch race. The host
chooses the circuit and CPU pace and starts the grid. Up to four racers and four
spectators share a five-kart race; CPUs fill unused racing slots.

The existing encrypted room relay is reused with a separate race capability and
invite mode. Runner, Arena and Star Circuit rooms cannot be accidentally mixed.
The host owns the simulation: other racers send bounded steering/brake/boost/
rescue commands, never positions, lap counts or results. Each player sees their
own kart; spectators can switch the followed kart. A race waits for all humans,
with a 30-second finish window after the first human finishes and a five-minute
maximum. Disconnected racers coast without controls, have ten seconds to rejoin
their same seat, then receive a did-not-finish result.

The host's pause applies to everyone. A guest's menu only releases their own
controls. Keep the host tab open; a suspended host pauses the race and closing
it ends the room. New mid-race arrivals watch until the next lobby. There is no
host migration or page-reload race restoration. Local CPU racing still works
without a connection. The shared room has no voice or text chat.

Verification: Node authority/codec/transport/coordinator tests and separate
Chromium/WebKit multi-context acceptance cover real controls, laps/results,
watchers, touch interruption, reconnect, host closure and runner return. The
ordinary browser suite substitutes only the opaque relay hop. The separate
`race-live.test.cjs` entrypoint requires explicit `SPACE_MAN_RELAY_HOST=default` (or an authorized relay hostname) and
uses actual WebSockets to the existing relay; it never represents simulated
relay results as a live-network pass. Physical iPhone/cellular testing remains
separate.
