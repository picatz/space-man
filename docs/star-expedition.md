# Star Expedition

## First playable slice (in development)

An optional solo itinerary links three existing games without replacing their
standalone menus: a short Endless Run, an Orbital Arena duel, then a Star Circuit
race. Chapter briefings explain the next controls and keep the completed results
visible. Finishing a leg, even without winning, advances the itinerary. Leaving
an expedition is explicit; held controls, audio, focus and animation loops must
be released between modes.

This first slice is **solo, with CPU opponents**. It does not move a live room.
All existing runner, arena and racing invites remain mode-locked. Friends and
spectators continue to use those standalone modes.

## Connected multiplayer follow-on

A shared expedition must negotiate an explicit journey capability and invite
mode. It must not reinterpret a runner/arena/race invite or weaken mode checks.
A host-owned chapter epoch needs to bind every command, snapshot and result to
one journey and chapter, with an authenticated idempotent transition and a
readiness barrier. The transport, peer identities and spectator roles should
survive that transition; stale chapter packets must never affect the next mode.

The runner currently shares course/presence/world events, while Arena and Star
Circuit have host-authoritative simulations. A journey director must own the
round clock and chapter outcome without pretending runner scores are fully
authoritative. Reconnect must restore the current chapter, not replay a stale
transition. Late arrivals watch the current leg and can request a seat at an
explicit intermission. Host loss freezes play and eventually ends the journey;
no migration or cross-reload restore is implied. Roster caps must be four
players/four spectators across the whole itinerary, not the runner's larger cap.

Required evidence before online release: real encrypted multi-client relay
run→arena→race transitions; unchanged identities/roles; delayed/duplicated/out-of-
order chapter packets; interruption at every transition; late join; role changes;
reconnect before/after barrier; host closure; desktop/mobile and CPU-only fallback.
