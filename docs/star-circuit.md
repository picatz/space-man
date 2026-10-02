# Star Circuit

An original top-down arcade hoverkart racer alongside Space Man’s runner and
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
Portrait uses a forward-facing chase view; reduced motion keeps a fixed heading
and disables decorative parallax, flame pulsing and rescue blinking. Pilot labels
stay upright and crowded CPU names are omitted in favor of the player label.
The overlay consumes the shared safe-area/status-rail insets and the visual
viewport, so browser chrome is not reserved twice.

The top-down projection keeps actual two-dimensional course geometry and close
kart interaction while preserving the existing lightweight canvas stack. It
requires no external engine, paid service, third-party assets or branded kart
characters. The runner’s simulation and scores remain independent.

## Verification

- `node --test tests/race.test.cjs` for deterministic simulation rules
- `node --test tests/*.test.cjs` for the complete game regression suite
- In `tests/browser`, `npm ci`, install Playwright Chromium/WebKit, then run
  `node --test race.test.cjs`; choose WebKit with `SPACE_MAN_RACE_BROWSER=webkit`
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
