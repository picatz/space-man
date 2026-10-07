# Friend arena

Arena rooms use the existing encrypted relay and admission system with a separate
mode/capability handshake. Run Together remains protocol 6 and retains its runner
rules; an arena room cannot silently become a runner room.

## Playing together

Open **Arena · CPU + Friends**, then **Play with friends**. Create a room and share
its link, QR or production room code. Preview builds require their full invite
link so every player uses the same revision. Friends can join as players or watch.

Rooms hold up to four players and four spectators. The host chooses Duel (up to
two players), Free-for-all or Teams, and one of the existing three stages. Empty
fighter slots use CPUs. Team assignments are shown before launch; the host can
switch a player’s team, swapping a member back when the destination is full.
Friendly fire is disabled. Joining during a round means watching until the host
returns everyone to the lobby; then spectators can request a player seat.

Spectators receive real shared combat, stocks and results with no invisible actor.
Previous/Next switches the watched fighter. Guests’ menus release their controls
while play continues. The host’s pause freezes the shared match. Only the host
can restart, change stage/rules or start the next round.

## Authority and latency

The host browser alone advances the 60 Hz simulation: movement, CPU decisions,
attacks, collision, damage, knockback, stock loss, respawns and results. Guests
send commands, never coordinates, damage or hit claims. Each seat is bound to
both the admitted player number and authenticated public-key identity.

Inputs carry a version, epoch, monotonic sequence, last observed authoritative
tick, bounded axes, a held-flags byte (bit 0 jump held, bit 1 attack held) and
cumulative action counters. Attack held is what lets a guest charge a pulse; a
press with it clear is an immediate tap, exactly as before. Counters retain
quick taps when newer packets replace queued input without replaying actions.
The host rejects spectators, wrong identities, stale/duplicate sequences, distant
ticks, cross-epoch commands, invalid fields and excess rate. Inputs expire to
neutral after 200 ms without a fresh accepted command.

Complete compact display snapshots repeat at 20 Hz. Four fighters occupy 283
bytes before presentation events, at most 499 bytes with the bounded 12-event
ring. Clients reject malformed/out-of-order states and deduplicate event IDs.
Rendering interpolates authoritative snapshots; it never decides hits. This is
casual host-authoritative WebSocket play, not competitive rollback or dedicated
server anticheat. Guests experience relay round-trip input delay and hosts have
a responsiveness advantage. Connection/latency state is visible during play.

The opaque arena lane caps messages at 1,024 bytes, fragments beneath the existing
256-byte encrypted wire limit and keeps bounded reassembly/send queues. Each peer
has at most one active and one latest pending send. Durable lobby/pause/result
state repeats, rather than relying on a one-off event. Explicit invite, HELLO and
WELCOME mode markers prevent old or runner-mode peers from joining an arena.

## Pulse commitment on the wire

Pulse recovery (10 ticks after a swing), the 8-tick post-hit guard, the hold-to-
charge tier and dash-cancel are all host simulation rules; guests only render
them. The wire carries what a guest needs to draw them and nothing else:

- each fighter record is 64 bytes: the old 63 plus one byte for the current charge
  (0 to 60 ticks), with bit 3 of the flags byte marking a released charged swing
  so the guest uses its longer, telegraphed timeline (`attackTicks` may now reach
  32). Recovery and hit guard are authority-only and are not transmitted.
- a new presentation event, `land`, is appended last in both event tables so every
  earlier event code keeps its index. Its impact (tenths of a pixel per tick) rides
  in the damage byte. Only heavy landings (impact 6 or more) enter the 12-event
  ring, so cosmetic landings can never push out a hit or knockout.
- versions: standalone snapshots/inputs are now version **3** and journey packets
  version **4** (previously 1 and 2). Older builds are rejected rather than
  misread, which matches the existing same-revision requirement for rooms.

Hit-stop, screen shake, KO slow-motion, squash and the edge-danger cue are local
presentation only: hit-stop and slow-motion run in local matches, never in
authoritative online rooms, so they cannot desynchronize anyone.

## Disconnects and lifecycle

- Lost guest input becomes neutral; same-tab socket reconnection retains identity
- Disconnected fighters have ten seconds to return before forfeiting their stocks
- Transport admission reserves absent arena seats for fifteen seconds; runner
  reconnect behavior is unchanged
- A reconnect after forfeiture cannot revive an eliminated fighter
- Host connection loss pauses authority; Resume/Start stay disabled until connected
- A hidden/paused host freezes the match; no automatic host migration occurs
- Explicit host leave ends the room for everyone; guest leave does not
- Host reload ends the match. Arena does not persist a running match or room key
  in browser storage. Reopening an invite joins the next available role
- Leaving/cancelling removes arena listeners and timers, releases inputs, and
  restores the runner without changing its records or actor

## Verification

`node --test tests/*.test.cjs` covers simulation, authority, adversarial input,
identity, teams, exact hits/stocks/results, event deduplication, encrypted transport,
fragmentation, cancellation, reconnect, and existing runner behavior.

`cd tests/browser && npm run test:arena-online` launches independent Chromium
contexts with real UI/input/crypto and a deliberately simulated opaque relay hop.
It checks a phone-sized player, host, spectator and late arrival; movement, hit,
damage, result agreement, shared/local pause, reconnect, team/role changes,
closure/reuse and runner return. Normal CI contacts no public relay.

`SPACE_MAN_RELAY_HOST=default npm run test:arena-relay` explicitly opts into the
shipped relay discovery. A permitted plain hostname can be selected instead.
`SPACE_MAN_BASE_URL` optionally tests one deployed preview. Missing opt-in skips;
an opted-in unreachable relay fails with no fake fallback. The **Arena live relay
smoke** workflow is manual; deliberately adding `arena-live-smoke` to an owner-
authored same-repository PR also requests one run. Later pushes do not repeat it.
Live tests use fresh temporary rooms, clean up, and suppress invite/key diagnostics.

All browser contexts still share one machine/network. Phone-sized Chromium and
Linux WebKit do not establish physical iOS, camera scanning, cellular handoff,
real phone lock/background behavior, or installed-PWA update coverage.
