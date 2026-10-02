# Star Circuit

An original top-down arcade hoverkart racer alongside Space Man’s runner and
Orbital Arena. Five pilots race three laps around an authored circuit. Steering,
braking, soft kart contacts, boost strips and a rechargeable boost reserve make
corner entry and exit matter. The first release has one local player and four
CPU opponents; it does not yet offer friend racing.

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

## Friend racing next

The pure command/snapshot boundary is intentional: one room host can advance
rules and publish verified snapshots while peers send bounded input commands.
Online racing still needs an explicit race-mode room handshake, command
ownership/sequence validation, reconnection, host lifecycle and multi-browser
end-to-end tests. It must use the existing shared room transport instead of a
second network stack. Arena packets cannot be treated as race packets. No online
race capability should be advertised until those paths have been implemented
and tested.
