# Arena: first playable slice and the next boundary

This is the historical foundation/design note. The friend-room milestone is now
implemented; see [the current online contract and limits](arena-online.md). The
current casual client interpolates authoritative state without combat prediction.

## Intent

Space Man is growing into a small set of related games with the same spacefarers,
readable movement, playful space art and approachable controls. The existing runner
remains the default. Arena is an explicit, local CPU-battle option, not a replacement
for Run Together and not a claim that online combat is already supported.

This first slice contains three data-defined stages, duel/free-for-all/team formats,
one human participant and CPU participants. Pulse attacks build damage and launch
opponents toward the blast bounds; double jumps and a short dash provide recovery.
Stock loss, invulnerability, countdown, timeout and match results belong to the
simulation. A CPU teammate and team damage filtering exercise team rules before
introducing network peers.

## What the current foundation actually provides

Assessment baseline: main `65ea536c6d74affa822bb080e9cccca53db6b13f`.

- `index.html` has a 60 Hz accumulator with interpolated Canvas 2D rendering,
  mature keyboard/touch/gamepad handling, accessibility settings, audio, safe-area
  handling and battery-saving rendering. These are useful behaviors to preserve.
- `src/art.js` is a reusable palette and inexpensive drawing kit; `src/anim.js`
  already demonstrates presentation-only state. Arena shares the art kit.
- `src/worldgen.js` separates deterministic course construction, but its advancing
  frontier and culling follow one player. It is not an arena level system.
- `src/input-snapshot.js` is a gamepad action adapter, not yet a complete per-actor,
  per-tick command protocol. `index.html` still reads device state from physics.
- `src/net.js` provides encrypted host/guest relay transport, room identity,
  admission, roster, round control, reconnect and presence. It does **not** run an
  authoritative gameplay simulation. Its 10 Hz presence feed describes locally
  simulated runners. Local scores, pickups and projectiles are not shared combat
  state. `src/netsmooth.js` smooths display ghosts; smoothed positions must never
  become combat hitboxes.
- `tests/harness.cjs` provides independent JavaScript clients exchanging real wire
  packets over a substituted transport. This is a strong regression foundation,
  supplemented by explicit real-browser and opt-in real-relay tests.

The principal coupling is the large `G` object and functions such as `updatePlayer`,
`resetRun`, `updateCamera` and `update`: physics, one-player state, scoring, effects,
audio, local preferences and endless-run rules coexist. Adding arena conditionals
throughout them would make both games harder to reason about.

## Boundaries in this slice

`src/arena.js` is a DOM-free, fixed-tick simulation. Human input and CPU decisions
produce the same normalized command shape. Actors have stable IDs and team IDs;
stage definitions supply geometry, spawns and blast bounds. A serializable snapshot
contains the state needed to resume/replay a match, including deterministic CPU
state. Drawing never determines geometry, timing, damage or outcomes.

`src/arena-ui.js` owns the arena lobby, input adapters, camera, sound and rendering.
It is inert until opened. The arena UI parks the existing runner loop and releases
held inputs on transitions. Closing returns to the existing title. Arena matches
do not change runner records, mission progress or shared-room state. A live Run
Together room must be left explicitly before opening Arena.

This separate simulation is a migration seam, not permission to duplicate an
entire second app indefinitely. Do not extract the existing runner wholesale in
the same change. After arena behavior stabilizes, extract only demonstrated common
pieces: action normalization, actor movement/collision primitives, fixed clock,
input release semantics and presentation event dispatch. Keep runner-specific
flare, world generation, scoring and mercy rules inside a runner adapter.

The eventual mode contract should stay small:

- create a world from stage/rules/seed/participants
- step one fixed tick with normalized actor commands
- snapshot/restore complete simulation state
- emit bounded presentation events and one explicit completion result
- describe camera and control affordances without owning DOM or networking

A universal ECS, content plugin framework, new renderer or new engine is not a
prerequisite. Arena and future racing can share a session and command envelope
without pretending that platform motion and vehicle motion are identical.

## Next milestone: real friend and team arena

Start with two friends and then four total participants. Reuse room admission,
identity, encryption and reconnect after separating transport from runner presence.
Introduce a versioned arena channel/capability; never reinterpret protocol-6 PRES
packets as authoritative combat inputs.

For the first casual online prototype, one host runs the 60 Hz simulation and all
CPU controllers. Guests send tick-numbered inputs, not positions or hit claims.
The host validates actor ownership, tick windows, command bounds and rates, and
owns hits, stock loss, spawns, scoring and results. Use a small explicit input
delay and batch contiguous commands. A starting measurement target is 20 full
snapshots/second for a four-actor world, with acknowledged input sequence and
authoritative tick. Measure the actual encoded bandwidth before selecting deltas.

Predict the local actor for immediate control; reconcile against host snapshots
and replay buffered inputs. Remote presentation interpolates recent authoritative
states. Collision always uses simulation state, never the interpolated display.
Snapshot restoration and bounded input history make this testable. Retain unique
event IDs so reconciliation cannot repeat audio, damage popups or stock messages.

Do not call this competitive rollback netcode. Full-world rollback needs exact
state, repeatable cross-runtime math, bounded late-input policy, side-effect-free
resimulation and extensive fairness tests. The relay uses WebSockets; reliable
ordered delivery and head-of-line blocking remain even if the simulation can
rollback. Test the casual prototype at real relay latency before choosing deeper
rollback or a dedicated-authority transport. Hosting on a player's browser also
creates host advantage, suspension and trust limitations. Pause/end cleanly on
host loss first; do not silently invent host migration.

Online acceptance: two actual clients agree on each hit, stock and final result;
four participants support FFA and 2v2 with CPU fill; late/repeated/out-of-order
inputs cannot double-hit or cross rounds; disconnect/rejoin gets an authoritative
snapshot; spectator state cannot issue actor commands; version mismatch fails
clearly. Test loss/jitter/congestion and actual separate devices/networks. A
phone-sized Chromium viewport is not iOS/Safari or physical-device verification.

## Toward a coherent adventure session

After standalone modes work, put a small session director above them. Session data
holds participant identity/teams, progression and the current segment. Mode state
is disposable and versioned. A host-issued transition includes session ID, segment
epoch, target mode/stage/rules hash, seed, transferred rewards and activation tick.
Clients prepare assets, acknowledge readiness and receive a committed activation
tick plus initial snapshot. Old-epoch packets are rejected. A bounded loading
barrier and clear reconnect policy are preferable to a falsely seamless desync.

Run → arena → run should be the first mixed session. Carry only explicit session
data across the boundary; do not carry leftover bullets, attack timers, held input,
runner death flags or camera offsets. One presentation fade can hide the boundary
while the simulation transition stays atomic. Race mode is deliberately outside
this implementation.

## Quality gates

- Existing runner, room, save migration, preview isolation and offline tests remain
  green. Precache every new script/style and bump the service-worker version.
- Simulation tests cover seeded repeatability, snapshot continuation, CPU behavior,
  arena definitions, attack hit deduplication, teams, damage, recovery, elimination
  and timeout. Equivalent tick streams produce equivalent outcomes independently
  of 30/60/120 Hz rendering.
- Browser checks exercise real launcher/input/pause/rematch/back flows, portrait
  and landscape layout, touch cancellation, held-key release, focus, and runner
  usability after leaving Arena. Check console errors and unwanted relay traffic.
- Preserve legibility over decorative complexity: distinguish teams by labels and
  outlines as well as color; keep controls at least 48 CSS pixels; respect reduced
  motion and mute; keep world geometry invariant across device sizes.
- Provisional performance targets, to measure on named physical devices: 60 fps
  default (16.7 ms frame), p95 simulation below 4 ms for four actors, bounded
  particle/event pools, no progressive memory growth in a 10-minute match/restart
  soak. Battery saver renders at 30 fps without changing simulation. Lower visual
  quality before changing competitive timing. These are targets, not benchmarks
  established by headless desktop CI.

## Iterative delivery

1. Local arena slice: playable movement/combat, three readable stages, CPU and team
   formats, tests and browser evidence, runner regression protection.
2. Combat refinement from playtesting: recovery fairness, directional attacks,
   CPU difficulty, portrait readability. Avoid adding many stages before each
   existing layout supports satisfying movement.
3. Two-to-four-person authoritative friend arena, latency instrumentation and
   actual multi-device acceptance. Extend to teams and CPU fill using the same
   actor commands.
4. Extract shared platforming primitives once both modes prove the seam, then build
   the first run → battle → run session. Design racing separately when this is
   stable; neither a pseudo-3D renderer nor real 3D is a free reskin of this slice.
