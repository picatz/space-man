# Starlight feature simulation contract

This documents the public simulation API implemented for the first Starlight slice. The authored scope and acceptance gates are in [starlight-track-features.md](starlight-track-features.md). Pure simulation tests establish deterministic rules and counterplay, not that the game feels good to a human. Browser, real-input, impaired-network and human-feel validation remain separate release gates.

## Ownership and versions

`SpaceManRace` / `require('./race.js')` remains a standalone, DOM-free, deterministic UMD module. `Race.constants.VERSION` and created `state.version` are **2**. `Race.constants.CATALOG_REVISION`, `state.catalogRevision`, and feature catalog `revision` are **2**. Simulation is 60 Hz; visual frame rate does not advance mechanics. The host is the only writer of authoritative simulation fields. Local mode uses the same engine.

No new script dependency is needed. Ember and Bloom have empty feature catalogs and obtain no feature inventory from the track. All existing planar driving, kart contacts, ordered gate checks, rescue placement, timeout and result ordering rules remain in the original engine. Airborne karts retain planar contacts.

## Immutable catalog

`Race.features(courseOrId)` returns a cached, deeply frozen object:

- `revision`, `trackId`
- `ramps`: `{id,index,s,startS,d,width,gate}`
- `coins`: `{id,index,s,d,airborne}`
- `rows`: `{id,index,s,gate,choices:[{id,item,s,d}]}`

Coordinates use `p = Race.at(course, s)` and `x = p.x - p.ty*d`, `y = p.y + p.tx*d`. Catalog `s` is track-local distance. Positive `d` is the right/inside side in forward travel. `Race.nearest(course, actor.x, actor.y).s` provides track-local actor distance for read-only art; there is no additional actor `s` field.

Starlight catalog (unchanged geometry in catalog revision 2):

- `ramp-a`: index 0, lip `.175L`, start `.175L-60`, gate interval 3
- `ramp-b`: index 1, lip `.595L`, start `.595L-60`, gate interval 11
- Both ramps: d 0, width 180
- `entry-0` through `entry-3`: indices 0–3, s `L*[.055,.075,.095,.115]`, d +44, ground pickup
- `sky-a-0` through `sky-a-2`: indices 4–6, s `.175L+[54,108,162]`, d −44, airborne pickup
- `sky-b-0` through `sky-b-2`: indices 7–9, s `.595L+[54,108,162]`, d +44, airborne pickup
- `item-row-a`: index 0, `.275L`, gate interval 5
- `item-row-b`: index 1, `.705L`, gate interval 14
- Each row choices: `item-a-shield` / `item-a-pulse` or `item-b-shield` / `item-b-pulse`, d −44 / +44

Prism Canyon appends track index 3: one full-width ramp at .195, six coins (three entry, three airborne), and one Shield/Pulse row at .745. Its .58–.68 gallery is render-only architecture above continuous physical road. See [prism-canyon.md](prism-canyon.md).

The same catalog feeds physics, CPU routing, render geometry and decoder validation. Coin/row/ramp bit positions are their catalog indices. A view uses the followed actor's masks, never another actor's pickups.

## Added actor state

| Field | Values / meaning |
| --- | --- |
| `item` | `null`, `'shield'`, `'pulse'`; one held slot |
| `coinMask` | integer 0–1023; this pilot's collected coins this legitimate lap |
| `rowMask` | integer 0–3; rows already visited this lap |
| `rampMask` | integer 0–3; ramps already triggered this lap |
| `airRamp` | 0 grounded; 1 ramp A; 2 ramp B |
| `airTicks` | 0 grounded; otherwise elapsed flight steps 0–29 |
| `z` | 0 grounded; flight height from the fixed arc |
| `shieldTicks` | integer 0–240 |
| `slowTicks` | integer 0–24; remaining boost/pad-suppressed physics steps |
| `immunityTicks` | integer 0–90; remaining offensive hit immunity |
| `pulseSerial` | integer 0–65535; monotonic per-owner pulse serial, saturating |

`_itemHeld` and `_lastItemEdge` are host-only command bookkeeping. They are retained by full `Race.snapshot` replay copies but not sent as gameplay authority from a client. Incoming driving controls cannot submit any actor mechanic fields.

### Ramps and pickups

The forward lip sweep must be within the road width, have forward velocity at least 3.6, and occur in the specified accepted gate interval. Recovery, finish, forfeit, reverse crossings and already-consumed ramp bits cannot launch. Takeoff sets `airRamp`, `airTicks=0`, `z=10`, and cancels all unspent drift charge/exit reward. It adds no planar impulse.

Thirty subsequent simulation steps complete the hop. For flight `u=airTicks/30`, `z=10*(1-u)+96*u*(1-u)`. At step 30, all three air fields become zero. Grounded ramp approach height is a **read-only rendering profile** from 0 to 10 over the authored 60-unit ramp; authoritative grounded `z` stays zero. Cameras remain ground-relative. Never use render height for gameplay or gate credit.

Coins use a swept center-path radius of 24. Ground coins require no hop; sky coins require `airRamp != 0`. Collection grants +6 existing boost fuel, capped at 100, and consumes the bit even when full. Centerline does not collect d ±44 coins. Backtracking can collect a previously missed coin but cannot restore collected ones.

Rows use forward plane crossings in the correct gate interval and a swept choice radius of 26. Crossing visits the row even if the gap is used or inventory is full. Full inventory is never replaced. Where one sweep intersects both choices, earliest swept contact wins, then stable catalog ID. Use happens before pickup processing, so an Item press on the collection tick cannot fire the new item.

Only a legitimate ordered lap completion resets all three masks. Held inventory carries across that lap. Rescue, reverse traversal, input interruption and effect events do not reset masks.

## Commands and Item edges

`Race.command(raw)` returns fresh normalized data:

```js
{
  steer: -1..1,
  throttle: 0..1,
  brake: boolean,
  boost: boolean,
  recover: boolean,
  item: boolean,
  itemEdge: 0..65535,
  warnings: [uint16, uint16, uint16, uint16, uint16]
}
```

Only true/1 count as action booleans. Invalid/absent Item counters or warning serials become zero. Warning arrays are copied, padded and restricted to the five owner slots.

Local `item` is a level, consumed only on a false→true transition. Holding it through pickup, empty inventory, flight rejection or another active pulse does not queue an action. Release then press again. `itemEdge` is the authenticated online cumulative counter supplied **only for a fresh coalesced edge** by the authority adapter; zero means no network edge. A counter larger than `_lastItemEdge` may activate on consecutive simulation ticks without an intervening false level. Repeated/older positive counters cannot activate. The network adapter authenticates seat, epoch, sequence, freshness, rate and counter bounds; the simulation does not replace that boundary.

## Shield and Pulse

A fresh Shield edge consumes the slot, activates 240 ticks of protection, and can be used during flight. It does not change motion. It ends on timeout or one pulse block.

A grounded fresh Pulse edge consumes the slot and adds one effect for that owner. An airborne edge leaves the item held and emits `land-pulse`, without queuing. An existing owner effect or saturated serial leaves the new item held. There are at most five owner effects, one per `pilot-0` through `pilot-4` in the standard five-kart race.

Public `state.effects` entries:

```js
{ ownerId, serial, phase: 'charge'|'wave', age, s, d, originS }
```

- `serial`: owner's nonzero, monotonically increasing `pulseSerial`
- `d`: activation lane clamped to [−44,+44], immutable for the effect
- Charge: `age` 0–53; `s` tracks the owner's current **unwrapped** course distance; `originS` is activation distance
- Release after 54 steps: phase wave, age 0, `originS = s = current owner distance + 56`
- Wave: advance 12 units each step; `s = originS + 12*age`; snapshot ages 0–27; perform the final age-28 sweep, then expire

A wave follows the spline in its locked lane. It does not home. Relative swept collision uses the 10-unit lane half-width plus 28-unit kart radius, with longitudinal crossing and legal forward range checked together. It cannot hit a kart behind its origin or at a physically nearby coordinate on a different unwrapped lap. Earliest eligible contact consumes it, including a shield block; exact ties use actor ID.

Airborne, recovering, newly released, finished, forfeited or hit-immune pilots cannot be hit. A block consumes Shield and grants 90 immunity ticks. An unblocked impact multiplies current velocity by .8 once, updates scalar speed accordingly, suppresses boost/pad propulsion for all 24 subsequent physics steps, cancels charged drift without reward, and grants 90 immunity ticks. Steering, position, heading and ordinary throttle remain available. There is no spin, forced rescue, permanent stat or inventory theft.

## Displayed-warning guarantee

`Race.warningFor(state, actorOrId)` (also `Race.threats(state, actorId)`) returns a new array of potentially threatening effect objects, without mutating state. It depends on public actor/effect data and unwrapped forward geometry, not camera, lane color or future commands. The charge envelope extends from 30 units behind the owner to 900 ahead, covering maximum movement during charge plus bounded wave reach. The wave envelope follows its remaining forward reach. Being in another lane does not hide the warning.

After the screen-space warning has actually been displayed, the adapter sends the matching effect serial in its owner's `warnings` slot. Snapshot receipt, a world mesh or a sound alone is not an observation.

`Race.observeWarnings(state, victimId, serials)` records the current `raceTick` on first receipt of a matching active owner serial, only for that victim. Each effect owns host-only `observedAt`, one tick or −1 per victim; `_createdTick` is another host-only field. Repeated acknowledgements do not restart or shorten the clock. Damage requires `raceTick - observedAt[victim] >= 36`. Missing/wrong/late observations do not deal retrospective damage; waves expire normally.

This deliberately favors casual fairness during packet loss. A modified client can withhold acknowledgements to avoid damage. It is not an anti-cheat claim. CPU controllers send the same warning acknowledgements through `Race.command` and obey the same 36-tick damage eligibility.

## Interruption and cleanup helpers

`Race.cancelControl(state, actorId?, options?)`:

- Clears drift charge without reward and latches the Item level as held until neutral is seen
- By default clears that victim's observation eligibility on every active effect
- Leaves authoritative flight, active owner effects, held inventory, masks and timers intact
- `{keepWarnings:true}` preserves observation ticks for ordinary neutral driving, which is not the same as a menu/blur release
- `{resetEdges:true}` resets `_lastItemEdge` when the adapter creates a new input epoch; it does not reset pulse serials
- Omitted actor ID applies to all actors

`Race.clearFeatures(state, actorId?, {keepItem:false})`:

- Cancels flight, Shield, slow, owner effects and victim observations
- Default clears held inventory and immunity, for finish/forfeit/transition
- `{keepItem:true}` preserves inventory and sets 90 immunity ticks for rescue
- Does not reset masks or pulse serials; only a legitimate lap resets masks, and new race/encounter creation resets serials

A simultaneous Rescue and Item press gives Rescue precedence: inventory is kept and the Item edge is consumed, never queued. Recovery uses `keepItem:true`, retains the original stationary wait and last-verified-gate placement, then grants a fresh 90-tick immunity window on release. Race finish clears all remaining inventory/effects/transients. New race/encounter creation clears masks, serials, effects and observations.

The authority adapter pauses by not stepping, so all timers and arcs freeze. Pause/resume must call cancellation/reset hooks; no old observed-warning eligibility survives a hidden menu or stale input. Input expiry cancels controls/observations but lets existing flight complete. Route transitions dispose the old engine. These hooks must be used in local, standalone-room and expedition adapters.

## CPU contract and cues

`Race.cpuInput` is pure and independent of invocation order. CPUs use the same physics, pick-up rules, inventory, Item edge interface, warning delay and hitboxes. They route toward the optional coin lines and author-defined item rows. Public leading/threat/rival-ahead information selects Shield versus Pulse. Warning perception delay is 18/12/6 ticks for Easy/Normal/Hard; the chosen safe lane is the nearest legal lane that clears the pulse. They can actively shield, dodge, shoot and miss. No future human input is consulted.

New bounded presentation event types are `jump`, `land`, `coin`, `item`, `shield`, `pulse`, `block`, `hit`, and `land-pulse`; each needs only `type` and actor `id`. Events are expendable sound/toast cues. Snapshots, masks, actor timers and active effects are the complete visible state; loss/rejoin must never replay a required one-off event to reconstruct inventory or warnings.

## Tests and protocol boundary

`tests/race-features.test.cjs` covers catalog geometry, both ramps at multiple lanes/speeds, real planar contacts and gate progress, interruption/rescue/finish, all ten max-speed coin sweeps, row choices, held-through-pickup and consecutive network Item edges, exact timers, effect caps, serial saturation, forward/lap/range/height immunity, first-hit ownership, warning receipt+36 tick limits, wrong/late/missing acknowledgements, actual CPU dodge/block trajectories and deterministic full-state replay.

Existing `race.test.cjs` and `race-handling.test.cjs` continue to cover all tracks, contacts, ordered progress and 30/60/120 Hz render scheduling over the same 60 Hz simulation. Human fun, screen-space warning display, receipt timing under transport impairment, and road/HUD visibility require their separate integration/browser/manual gates.

The codec freezes its own strict binary offsets and bounded packet formula. It must encode the public fields above, exclude host-only observation/input bookkeeping, validate empty mechanics on unchanged tracks, and fit all five effects/events inside the expedition's **990-byte inner race ceiling** without changing transport limits. Incoming clients never submit inventory, masks, height, trajectories or damage.
