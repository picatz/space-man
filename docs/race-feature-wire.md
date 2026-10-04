# Starlight v2 authority and wire contract

This implementation complements [race-feature-contract.md](race-feature-contract.md).
The host alone runs the simulation. Authenticated inputs never contain inventory,
pickups, masks, height, effect motion, target identities, damage or results.

All multi-byte fields are little-endian. Packet type is 1 input or 2 snapshot.
Both packets require byte 0 = 2; schema 1 is rejected. Inputs are exact-length;
snapshots require an exact header-derived length. Unknown enums/flags, nonfinite
or out-of-range floats, duplicate ownership, inconsistent progress/results and
nonzero reserved bytes fail closed. Detached decoded state is for presentation,
never host restoration.

## Input: 33 bytes

| Offset | Type | Value |
| --- | --- | --- |
| 0,1 | u8,u8 | version2, input1 |
| 2,6,10 | u32 | race epoch, input sequence, latest observed host tick |
| 14 | i8 | normalized steer×127; -128 invalid |
| 15 | u8 | normalized throttle×255 |
| 16 | flags | Brake1, Boost2, explicit released4; no other bits |
| 17 | u16 | cumulative Rescue press count |
| 19 | u16 | cumulative Item press count |
| 21..30 | five u16 | displayed warning serial by owner pilot0..4 |
| 31 | u16 | cumulative interruption/release generation |

The transport supplies sender identity; no packet field can choose a victim or
seat. Epoch, identity/role, strictly increasing sequence, bounded tick skew,
monotonic counters and a per-seat token bucket are checked before any mutation.
At most one pending Rescue and one Item edge survive to a host physics step.
They expire after 200 ms; bursts coalesce and never bank multiple activations.
A held Item level cannot fire a later pickup. A fresh counter may activate on
consecutive ticks. Counters saturate rather than wrap.

Explicit release requires neutral axes/buttons and zero warning serials. Its
cumulative generation survives loss of the release packet: the next accepted
packet of that generation clears pending edges and that pilot's existing
warning eligibility, then acknowledges only newly displayed warnings. It
consumes old Item/Rescue counts without activating them. Repeated normal
zero-throttle driving preserves the original receipt clock. Interruption
counter exhaustion fails neutral until a new epoch.

## Snapshot: 32-byte header, five 84-byte actors, up to five 20-byte effects, twelve 8-byte events

Header offsets 0..28 retain their previous meanings: version/type,
revision/epoch/tick, raceTick, track/difficulty/laps, room status and race phase,
countdown, first-human-finish tick, finish reason, actor/seat/event counts.
Offset 29 is catalog revision 1; 30 is effect count 0..5; 31 is reserved zero.
The codec validates catalog revision independently of the schema revision.

Actor offsets 0..63 retain the established identity, accepted input metadata,
x/y/heading/velocity/speed/fuel/progress, gate/lap/recovery, callsign and final
rank fields. New fields are:

| Offset | Type | Value |
| --- | --- | --- |
| 64 | u8 | item:0 empty,1 shield,2 pulse |
| 65 | u16 | coin mask0..1023 |
| 67,68 | u8,u8 | row mask0..3, ramp mask0..3 |
| 69,70 | u8,u8 | airRamp0..2, elapsed airTicks0..29 |
| 71 | float32 | height matching the authoritative fixed arc |
| 75,76,77 | u8 | shield0..240, slow0..24, immunity0..90 |
| 78 | u16 | owner's pulse serial0..65535 |
| 80 | u16 | accepted Item count for this authenticated seat |
| 82 | u16 | accepted interruption generation for this seat |

Grounded means zero airTicks and height. Airborne requires the matching ramp
mask. Finished/forfeited pilots have no active item/timers/flight. Ember/Bloom
have no feature state. Seat counters cannot exceed accepted sequence; CPU seats
cannot claim client input metadata.

Each effect is 20 bytes: owner slot at 0, nonzero u16 serial at 1, phase 0 charge / 1 wave
at 3, age at 4, zero reserved 5..7, float32 s/d/originS at 8/12/16. Owners are unique,
serial matches the owner's pulseSerial, lane is[-44,+44], and distances are
bounded by course/lap length. Charge ages are 0..53; wave ages 0..27 and
s=originS+age×12 (within float32 precision). Only racing Starlight permits effects.
Host-only observedAt/input latches/CPU plans are never serialized.

The existing eight-byte event history adds bounded jump/land/coin/item/shield/
pulse/block/hit/land-pulse cue IDs. Events never establish inventory or warnings.
Full snapshots contain all persistent visible state after loss or rejoin.

Maximum: 32 + 5×84 + 5×20 + 12×8 = 648 bytes. The 34-byte journey wrapper produces 682 bytes,
well below 1024. The inner codec rejects packets over 990 bytes even standalone.

## Warning receipt and interrupted rooms

The browser calls room.observeWarnings(fiveSerials) only after the compact
screen-space warning was actually shown. Snapshot receipt, a world mesh or a
sound is insufficient. The normal input carries the displayed serial; the host
records its own raceTick for the authenticated submitting pilot only. Damage
requires 36 further host ticks. Wrong/stale/missing serials cannot create effects,
choose targets, acknowledge another pilot or cause a retrospective hit.

Menus, blur, stale input, disconnect and role loss clear pending commands and
warning eligibility without stopping host-owned flight. Pause freezes timers;
pause/resume creates a new race input epoch, resets counters/latches and clears
all observation eligibility, including CPUs. Held Item across an epoch/rejoin
stays suppressed until a neutral sample. Reconnect waits for a fresh full
snapshot and rebases to accepted seat counters; unsent pre-disconnect presses
cannot replay. Journey's outer encounter epoch destroys the old engine and its
effects before readiness for the next encounter.

Fairness deliberately allows a modified client to withhold warning observations
and avoid damage. This casual implementation does not claim competitive
anti-cheat. Tests cover missing/late observations, exact 35/36-tick eligibility,
lost release, unknown serials, other identities, packet loss/rejoin, saturation,
full-size snapshots, malformed/truncated input and deterministic binary fuzz.

## Queued native Item readiness

`RaceOnline.createClient().itemReady(p)` is a read-only readiness check. It is
true only for a connected, unfinished own pilot in a running race, after a
neutral Item sample has armed the local latch, no release/reconnect reset is
pending, and the latest authenticated snapshot acknowledges the locally sent
release generation. `RaceRoom.itemReady()` and the journey race adapter's
`itemReady()` bind that check to the local player; watchers, stale connections,
pauses and non-race encounters return false. Hosts use the same looped-back
snapshot acknowledgement path.

A fresh queued keyboard/touch press waits while this is false, continuing to
send Item=false with normal driving and displayed-warning observations. After
readiness, the native queue emits its neutral baseline and one Item press.
This prevents a lost release packet from consuming the new press alongside the
old cancelled generation. Menus/blur/epoch/ownership reset clear the UI queue;
held or pre-menu edges are never replayed. No UI-supplied counter or new wire
field is introduced.

## Atomic transport revision

Standalone race exclusively advertises capability bit 11; expedition exclusively
advertises bit 12. Bits 6/7/8(old race) and 9 (old journey) are never advertised.
Both HELLO and WELCOME, held approval and reconnect are checked for players and
watchers. Journey schema also advances to 2 without changing its 34-byte shape.
Runner/Arena, appearance bit 10, mode flags, encrypted frame IDs and app PROTO 6
remain independent. Browser/UI and human-feel release gates are separate from
codec/transport test success.

Actionable leave/refresh/new-invite errors are provided by updated clients only.
Historical journey clients retain their original different-mode admission error
or older coordinator message; capability-only legacy test peers run the current
error-handling code and do not model historical wording. Rejecting the old build
does not retroactively change text embedded in that build.
