# Starlight Speedway: first track-experience slice

Design only, 3 October 2026. No implementation, publication, or gameplay validation is claimed.

## Decision

Build one coherent Starlight upgrade on PR #49's verified handling baseline: two low, automatic jump ramps; three optional star-coin lines that refill the existing boost reserve; two choice-based item rows feeding one item slot. The two items are a protective shield and a clearly warned forward lane pulse. Keep the existing course outline, forgiving apron, ordered gates, handling, cameras, five-kart grid, and race lengths. Apply the same Starlight catalog in local racing, friend racing, and expedition sprints. Leave Ember and Bloom without new objects for this slice.

This is a short authored hoverkart hop over a continuous road. It introduces authoritative height/airtime and meaningful item interactions without adding gaps, shortcuts, free jumping, aerial tricks, permanent coin currency, item roulette, or another progression system. Ramps launch automatically. One new Item action is the entire input expansion.

The figures below are concrete starting tuning, not measured fun or final balance. Human keyboard/touch driving is a release gate.

## Verified foundation and constraints

Baseline: merged PR #50 at `93ed2aa468fe6daf71d6852359349316c25fb465`, including PR #49 handling, player identity, Arena thumb controls and stable Crew buttons. Recheck the source as implementation advances.

- `src/race.js`: a 216-segment Catmull–Rom circuit, 60 Hz planar physics, width 180, kart radius 28, runoff 48, 20 ordered checkpoint planes. Starlight length is approximately 3,844.088 units; gates are 192.204 units apart. Current normal/boost speed ceilings are 6.4/9 units per tick. Existing strips are at lap fractions .14, .56, .85.
- `src/race-online.js`: only the host steps physics. Current wire v1 has a 19-byte input, 30-byte header, five 64-byte actors, at most twelve 8-byte events; packet ceiling 1,024 bytes. Input freshness is 200 ms, snapshots 50 ms, seat rejoin 10 seconds. Events are a bounded presentation history, not reliable gameplay state.
- `src/race-room.js` and `src/journey-room.js` both present detached authoritative race state. `src/journey-online.js` adds a 34-byte envelope with a 1,024-byte total ceiling: race packets used in an expedition must fit within 990 bytes.
- `src/net.js`: current standalone race capability is bit 8; journey capability is bit 9; appearance is bit 10. Journey admission does **not** negotiate the standalone race capability. Changing only CAP_RACE would leave mixed-build expedition clients admitted until their first incompatible sprint.
- `src/race-presentation.js` currently interpolates only x/y/heading. `src/race-camera.js` has a steady, ground-relative horizon. `src/race-scene.js` and the top-down path currently have no authoritative jump/item representation.
- Current controller X is Rescue, A/R2 Boost, B/L2 Brake. Do not silently repurpose them. Touch currently has left/right, Brake/Drift, Boost and Rescue.
- `src/expedition.js` specifies one-lap race encounters with a 90-second director cap. Preserve that contract, the shared encounter epoch, bounded readiness barrier and neutral-input handoff. Do not incidentally change its existing inner-race countdown behavior while adding track toys.

## Exact object catalog

Use immutable track-local IDs and longitudinal distance `s`, not hand-positioned collision rectangles in screen space. For a course sample `p = Race.at(course, s)`, signed lateral offset `d` maps to `(p.x - p.ty*d, p.y + p.tx*d)`. Positive d is the inside/right side when driving this clockwise circuit. Display geometry, CPU routing, pickup sweeps and protocol validation must consume the same catalog. The fractional anchors below are canonical; approximate world coordinates are inspection aids.

### Two ramps

| ID | Ramp start | Takeoff lip | Lip world x/y | Expected neutral landing region | Why here |
|---|---:|---:|---:|---|---|
| ramp-a | .175L − 60 = 612.72 | .175L = 672.72 | 1029.8 / 300.9 | approximately s=781–943 at entry speeds 3.6–9 | Upper straight, after the .14 strip; approximately 6.5° heading at takeoff, road remains visible before the east bend |
| ramp-b | .595L − 60 = 2227.23 | .595L = 2287.23 | 1067.1 / 1119.1 | approximately s=2395–2557 | Lower straight, after the .56 strip; approximately −177.4° heading, exceptionally gentle following road |

- Each ramp spans the 180-unit road, rises only 10 units over 60 units, and has a cyan upward-chevron lip distinct from the lime boost strips. Keep the road and apron continuous beneath it. Grounded slow/reverse traffic rolls over a shallow profile; there is no wall or mandatory minimum-speed failure.
- Trigger only a forward swept crossing of the lip, on-road, with forward speed at least 3.6, in the correct ordered-gate interval (A: passed % 20 = 3; B: 11). One trigger per ramp per completed lap. A rescue, reverse crossing or small loop cannot refresh it. Never launch recovering, finished or forfeited karts.
- Fixed airtime: 30 simulation ticks / 0.5 seconds. A practical authored vertical arc is `z = 10*(1-u) + 4*24*u*(1-u)`, u from 0 to 1. Peak is about 29 units above the road. Do not add a launch speed bonus; the preceding boost strip already supplies the approach payoff.
- Retain current planar acceleration, boost fuel, braking, corridor contacts and ordered checkpoint sweeps. Preserve existing yaw response rather than introducing a second unfamiliar control model. Takeoff discards unspent drift charge without awarding an exit boost; no drift charging during airtime. Braking/boosting can change horizontal landing distance, so the approximate table ranges describe neutral straight entries, not a rail or teleport destination.
- For this bounded slice, kart contacts remain the existing planar arcade contacts even during a hop. Jumping is not a way to phase through another kart. This avoids overlapping landing karts, new vertical collision stacks and surprise landing separation. Height does make a kart safe from the ground pulse while airborne. Keep this rule identical for humans and CPUs.
- Rescue cancels airtime and returns to the last verified gate with the existing cost/wait. Input expiry cancels held controls/charge, but host-owned airtime completes normally; an absent input must not strand a kart in the sky. Pause freezes the arc.
- Checkpoints use actual per-tick x/y sweeps throughout flight. Gate 4 lies in hop A; gate 12 can lie in hop B. Never award a gate from the landing marker, ramp endpoint or height animation.

### Ten star coins, three optional lines

| Line / IDs | Exact placements | Lateral offset | Intent |
|---|---|---:|---|
| entry-0…3 | s = L × [.055, .075, .095, .115] | +44 | A readable inside line on the opening straight; learn that stars fill Boost |
| sky-a-0…2 | s = .175L + [54, 108, 162] | −44 | Choose the outside launch lane on the upper straight |
| sky-b-0…2 | s = .595L + [54, 108, 162] | +44 | A mirrored inside line on the lower straight |

Each coin gives +6 fuel, capped at 100. No speed-stat stacking, count HUD, persistent balance, shop, or post-race obligation. A perfect lap therefore offers at most +60 fuel, in addition to the existing recharge. At full fuel the pickup still disappears for that pilot and makes a quiet acknowledgement; there is no banked overflow.

Use per-pilot, per-lap availability, including CPUs. Everyone has the same opportunity; the leader cannot empty the track for trailing racers. Maintain a 10-bit collected mask; reset only on a legitimately completed ordered lap. Rescue/backtracking does not restore pickups. Full race/encounter reset clears it.

Host uses swept x/y pickup checks with a 24-unit center-path tolerance (explicit collection tolerance, not kart-collision radius). A centerline kart at d=0 must not vacuum the ±44 lines. Test this at boost speed. Air-line coins require the authoritative airborne flag, not a client animation. They can use a consistent floating-star visual over a marked road bead; do not demand an exact z intersection because current boost/brake choices change airtime at each s. Ground coins need no jump.

Only the followed pilot's collected mask drives availability in that view; other racers' pickup sparkles are optional, bounded effects. A single short “+6 BOOST” toast by the existing fuel meter is sufficient. In reduced motion use a static flash, not particles or camera effects.

### Two item choice rows

| Row | s / fraction | Shield at d=−44, approximate x/y | Pulse at d=+44, approximate x/y |
|---|---|---|---|
| item-row-a | 1057.12 / .275L | 1420.6 / 359.2 | 1378.3 / 436.3 |
| item-row-b | 2710.08 / .705L | 638.5 / 1119.3 | 655.2 / 1032.9 |

These follow the jump windows and precede distinct corner sections. Put the item symbols on unobtrusive road approach marks 120 units before each row, so the choice is readable before the pickup itself. Use a shield silhouette and a forward-pulse arrow; no mystery boxes or probability table.

- One stored item. Per-pilot row eligibility, once per forward lap crossing, with a 26-unit center-path pickup tolerance. The empty center gap is passable; objects are not obstacles. Full slots are never overwritten.
- A row is considered visited once crossed in the correct ordered-gate interval even if the pilot misses both choices or the slot is full. This prevents circling back to refill after firing. A pickup is an actual swept intersection, never granted just for crossing the plane. If a pathological sweep intersects both choices, choose the first swept contact, then stable catalog ID.
- Take and use are separate actions. No auto-fire on collection. Holding Item through a pickup or a transition cannot use the newly collected item. A fresh press is required.
- Inventory carries through a lap, but clears on race finish/rematch/encounter transition. Rescue keeps the held item but clears its active shield/pulse state; there is no new item reward for crashing.

## Item behavior, fairness and CPU competence

### Shield

A press consumes the held shield and protects for 240 ticks / four seconds, or until it blocks one pulse. It gives no speed advantage, collision ram, checkpoint advantage or rescue discount. It may activate during a hop. Show a thin, readable hexagonal ring plus remaining-time arc on the Item button. A block gets one distinct chime/optional haptic and “BLOCKED”. Both normal collision physics and road hazards remain unchanged.

### Forward pulse

A press while grounded consumes the item and begins a 54-tick / 0.9-second charge. Airborne presses leave the item held and show a brief “Land to pulse”; do not queue the shot. One active charge/projectile per owner, maximum five total.

Use a track-following **lane** pulse rather than target homing. Lock lateral d at activation, clamped to [−44,+44]. During charge show the forward lane from the owner's current longitudinal position, with explicit chevrons. On release launch 56 units ahead of the owner's current s, keep the locked d, travel 12 units/tick for at most 28 ticks / 336 units, and expire. The lane follows the road spline but never chases another kart laterally. The held slot can receive a later pickup, but another pulse cannot activate until the owner's existing effect ends.

Pulse half-width is 10 units; test contact against the kart radius. At lane d=0 a legal on-road escape at d=±52 clears it; an edge-lane target can escape toward the center. Only forward, unwrapped same-course progress is eligible; proximity across the loop never counts. No back shots, long-range shortcuts, wall bounces, endless projectiles or rear homing.

Impact removes 20% of current scalar speed once and suppresses boost/pad propulsion for 24 ticks. Maintain steering, throttle, position and heading; no spin, reverse impulse, stun-lock or forced rescue. Clear charged drift without awarding a boost. Add 90 ticks of per-victim hit immunity so a pack cannot chain punishment. Consume the wave on its first eligible hit or shield block. Airborne, recovering, finished and forfeited karts cannot be hit. A shield block also gains the hit-immunity window. Spawn/recovery release must be safe from immediate offensive hits.

### “No unavoidable offscreen hits” is a protocol requirement

A rear-origin forward pulse is often outside the victim's camera. World art alone is insufficient. For a potentially threatened local pilot, always draw a compact screen-space arrow/ring and “PULSE BEHIND · MOVE / SHIELD” (direction adjusted to threat), independent of camera and reduced-motion preference. The warning lane uses shape plus text, not color alone; audio/haptics are supplemental.

Guarantee at least 36 host ticks / 600 ms of actionable warning **after the victim's client has displayed it**, rather than assuming a 0.9-second host charge arrived on time. Add a small observation acknowledgement to normal inputs: last displayed warning serial for each of the five owner slots. IDs are epoch-scoped. The host records receipt, and permits that effect to damage that pilot only after 36 further ticks. A late/missing acknowledgement makes that pulse harmless to that pilot; it never causes a retrospective hit. Acknowledgements cannot create hits, change trajectories, award immunity to another identity, or choose damage.

This is an explicit fairness tradeoff: a modified client could withhold acknowledgements to avoid damage. This casual host-authoritative slice favors readable counterplay under packet loss over adversarial competitive anti-cheat. Do not market it as cheat-proof. If this observation contract is not implemented, the pulse is not release-ready; ship the shield path alone until offscreen/loss counterplay is proven.

CPU perception has the same 600 ms minimum reaction window. CPUs choose a lane before each item row using deterministic actor/lap decisions, prefer shield if threatened or leading, and prefer pulse with a rival ahead. They decide from public race state, never future human inputs. On a warning they move to a safe legal lane or use a held shield; difficulty changes decision quality, not hitboxes, fuel, airtime, pickup access or item power. Easy CPU must actually use and sometimes block/evade items. All actions go through the same command interface.

## Minimal controls and presentation

- Keep keyboard steering/brake/boost/rescue/pause/camera bindings. Add F/J for Item and honor the existing fire remap only when it does not collide with a higher-priority race binding. Document conflict precedence. No new Jump button.
- Keep controller A/R2 Boost, B/L2 Brake, X Rescue. Add R1/RB (standard button 5) Item; do not remap existing muscle memory.
- Add exactly one fixed-size Item button above the existing Boost button, with its own visible icon and short label, minimum 48×48 CSS px. Mirror the action cluster with handedness. It is muted/disabled when empty but keeps its space so collecting an item never shifts held controls. One touch is one edge, with the same pointer-cancel/global-release lifecycle as current actions. Never require a swipe, hold duration or two-finger gesture for item use.
- The Item button is also the sole inventory indicator. No duplicated hotbar, permanent coin counter or new modal. Keep the main road opening, minimap, pause and warning space clear on 320×568 and 568×320.
- First exposure cues: “Ramps launch you”, “Stars refill boost”, and item-name/action label. Show one cue at a time; no recurring tutorial overlay per lap. Expedition should reuse its short in-play controls cue.
- Keep the horizon ground-relative on jumps. Chase should not lift/pitch with the kart; cockpit may use a capped ≤8-unit vertical offset while looking at road ahead, with no roll/landing shake. Reduced motion removes that offset. Draw a clear ground shadow and a small landing-road ribbon, not a camera dive or a disappearing road. The full landing road must remain visible before takeoff in portrait, landscape and cockpit.
- Render ramps, pickups, item state, warnings and grounded/airborne distinction in WebGL **and** top-down/context-loss fallback. Extend authoritative pose interpolation to height/air progress, bounded by received samples; reset it on epoch/recovery/followed-pilot changes. Never infer real airtime from a visual bounce or extrapolate past the latest host state.

## Authority and wire contract

### Simulation ownership

Host alone decides swept ramp/pickup crossings, per-lap masks, slot changes, airtime, fuel gain, shield duration, projectile motion, eligibility, impacts, checkpoint credit and result order. Clients send normalized driving controls, a deduplicated Item press edge and warning-observation acknowledgements. They never submit coins, inventory, z, collisions or damage. CPUs use the same sim/command path.

Use stable, bounded state: actor item enum; coin/row/ramp masks; air ramp ID and progress/height; shield/slow/hit-immunity timers; up to one bounded effect per owner; epoch-scoped effect serials. Host-only fields can hold trigger latches, warning receipt ticks and CPU plans. Full snapshots must suffice after loss/rejoin; recent events are only sound/toast cues. Do not make a consumed pickup or active warning depend on receipt of a one-off event.

Item presses follow recovery's monotonic edge-counter pattern with authenticated identity, epoch, sequence, freshness and rate validation. Coalesce to at most one fresh activation per host step; do not bank a burst of edges. Reset pending edges/held-state on blur, menu, stale input, disconnect, role loss, epoch change, finish and mode exit. A reconnect cannot replay a prior item action or reuse another seat's acknowledgement. Saturated counters fail safely rather than wrapping.

Host pause freezes mechanic clocks. Resuming clears pending commands and warning-observation eligibility; no effect may hit immediately from an unseen pre-pause warning. Local guest menus release commands and make offensive-hit eligibility wait for a newly displayed warning on return. Route transition destroys all race effects and observation state before the next engine becomes ready.

### Atomic revision change

1. Introduce race codec v2 for both input and snapshot; do not squeeze fields into v1 reserved bytes or pretend old decoders can represent the new state. Give the new Starlight object catalog an explicit ruleset/catalog revision.
2. Allocate a new exclusive standalone race capability (proposed unused bit 11) and a new exclusive journey capability (proposed unused bit 12), confirming availability at implementation. Do not advertise old bits 6/7/8 for new race rooms or old bit 9 for new journey rooms. Keep invite mode flags, encrypted frame IDs, runner, Arena, optional appearance and app PROTO 6 unchanged unless an independently verified need appears.
3. Bump journey envelope schema to v2 as the second strict guard; its shape can remain 34 bytes. Reject mixed builds before admission in HELLO, held-join approval, rejoin and WELCOME, for players **and** watchers. The journey guard must work before the first race encounter.
4. Use exact actionable errors: “This room uses a newer racing version. Leave the room, refresh all games, then ask the host for a new invite.” Expedition needs the equivalent expedition-specific message, not a misleading different-mode failure. Cover both new→old and old→new. Keep the failed session cleaned up and Join/Cancel responsive.
5. Ship sim, both render paths, input UI, codecs, transport gates, expedition adapters, help and service-worker cache VERSION in one release. Keep existing one-build-per-page caching and defer updates while in a room/expedition. Offer the normal update path after leaving; never auto-reload a live host or silently upgrade half a room.

### Bounded packet budget

Reserve a concrete ceiling before coding. Example sufficient allocation: 40-byte header + 5×96-byte actors + 5×32-byte effect records + 12×12-byte events = **824 bytes**. Wrapped in expedition: **858 bytes**, leaving 166 bytes below transport's 1,024 limit. This is a budget, not a mandatory byte-offset ABI; specify/freeze final offsets in wire docs and fixtures.

A 31-byte input is feasible: current 19 bytes + a 2-byte Item edge counter + five 2-byte warning serial acknowledgements. If more fields are necessary, keep the bounded formula and strict exact-length validation explicit. No JSON, free text, asset URL, unbounded effect list or client-chosen target list in race packets.

Validate enums, finite numbers, track/catalog IDs, known object IDs, masks, timer ranges, unique effect ownership/serials, legal effect phases, height/air-phase consistency, seat-bound edge counters, actual packet counts/length and reserved zeros. Validate empty mechanic state on unchanged tracks. Snapshot bounds must remain valid during pause, countdown, recovery, DNF and finish. Maximum fields/events/effects must round-trip inside the journey envelope without raising existing transport limits.

## Acceptance gates

### Pure/authority tests

- Catalog assertions for exact s/d placements, clear road/apron and current boost-strip separation. Neutral normal/boost entries, both ramps, d=−44/0/+44: launch once, visible finite arc, land after 30 ticks, remain inside the existing corridor; slow/reverse entry stays safe.
- Brake/boost/steer during flight, full stop, release/expiry, rail contact, multi-kart collisions, rescue during each flight phase, pause at takeoff/apex/landing. No invisible collision, permanent airtime, positional teleport, false drift reward or gate skip. Existing `speed == hypot(vx,vy)` and contact tests remain valid.
- Each ordered gate crossed in the hop credits exactly once; no progress from height, rescue, catalog masks or a backward traversal. Race finishes and timeout semantics unchanged.
- At maximum speed, every intended line is sweep-collectable; centerline misses optional lines. Each coin/row/ramp at most once per pilot per legitimate lap; no farming through rescue/reverse/duplicate events. Fuel always ≤100 and runner/cosmetic saves unaffected.
- Item choice, full-slot crossing, simultaneous contacts, item press before pickup, held press across pickup, repeated keydown, two rapid presses, empty press, airborne pulse, same-owner effect cap. Shield blocks once; pulse obeys lane/range/height/first-hit rules; no chained slow/spin/forced rescue.
- All CPU difficulties complete races with the new catalog, collect/use items, react to telegraphs and demonstrably dodge or shield. Replays at 30/60/120 Hz presentation remain identical at 60 Hz sim.
- Codec invalid-input fuzzing, maximum 824-byte budget case, strict old/new refusal, stale/forged/duplicate/role-mismatched inputs, counter saturation, event loss, identity/P recycling, late watcher/rejoin during a hop/charge/block. Ensure snapshots recreate all visible state without event replay.
- Standalone and journey old/new matrices in both host directions, both roles, WELCOME revalidation and held approval/rejoin. Same-build rooms work; runner/Arena/appearance behavior remains intact. At least twelve expedition epochs including Starlight and a resumed connection; no mechanic leaks across engines.

### Browser and manual gates

- Run `node --test tests/*.test.cjs` plus applicable current Chromium/WebKit race, perspective, race-online, journey and expedition browser suites against the final revision. Add dedicated track-item cases; a gamepad controller that completes laps is not evidence that the new interactions feel good.
- Real keyboard and touch: one complete Starlight race at normal pace and boost; intentionally choose all coin lines, each item row, a shield block, a pulse dodge and a miss. Exercise simultaneous steering + brake/item, partial touch release, cancel/lost capture, pause/blur, rotation and neutral reacquisition. Keep both action buttons reachable without obscuring the landing road.
- Visually inspect 320×568, 390×844, 568×320, tablet and desktop, left-handed, all three cameras, reduced motion, battery saver, top-down fallback, context loss/restoration, spectator follow and repeated open/close. No HUD/button overlap or new horizontal scroll.
- Two/four-human friend-room tests and shared expedition with real inputs: host/guest/spectator see the same launch, pickup, inventory, warning, block and impact. Simulated relay and real relay results must be labeled separately.
- Network impairment gate: 200 ms round-trip, 100 ms jitter, packet loss/reordering and a 1-second burst loss. A victim is never damaged before its observed-warning acknowledgement plus 600 ms; a late effect is harmless instead of a surprise hit. No rejoin shot replay or jump snap-through-road. Only test the live relay when authorized; never substitute a simulated relay pass for it.
- Final feel check by a human: within one lap, can they explain what ramps, stars and the Item button do without opening Help? Can they deliberately choose a line, land while seeing the road, and avoid/block a warned pulse? Record observations and actual device/browser. Failing road visibility, mobile readability or warning fairness blocks this slice even with green automation.

## Suggested implementation order

1. Freeze catalog and codec/admission tests, then implement host mechanics and deterministic CPU behavior.
2. Extend both renderers, presentation sampling, warning acknowledgements and one Item control; update brief help/expedition cues.
3. Run pure, transport and interrupted-input tests; then browser/network/manual acceptance. Tune only within the stated scope.
4. Publish/release after independent review and final browser/network/manual acceptance on the integrated revision.
