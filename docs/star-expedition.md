# Star Expedition

## Solo itinerary

An optional solo itinerary links three existing games without replacing their
standalone menus: a 400m Endless Run (60-second active-play limit), an Orbital Arena duel,
then a one-lap Star Circuit race. Chapter briefings explain the next controls and keep the completed results
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

## Lifecycle and checks

`src/expedition.js` is a small, pure ordered itinerary. A monotonically increasing
leg token rejects duplicate, delayed and wrong-leg results. The page owns the
journey; the existing Arena/Racing UIs expose `openSession` for a bounded local
round and a result callback. They release listeners, held controls, animation,
audio and focus before handing back. Leaving a local chapter cancels the journey.
Standalone selections are restored and never overwritten by itinerary defaults.

Runner records are banked once when the leg ends. A successful rendezvous or
60-second extraction is not counted as a quick-death mercy trigger. The existing
mission, cosmetics and runner score rules still apply. The trip receipt is
in-memory only, and the UI states that reload starts fresh. Service-worker
updates wait until the player leaves the itinerary.

Run `node --test tests/*.test.cjs`. Run `node --test expedition.test.cjs` from
`tests/browser` after its existing `npm ci`/Playwright setup. The browser suite
plays a genuine runner loss and arena loss and drives a complete one-lap race
through standard gamepad commands; it never teleports racers or manufactures a
result. It also covers four touch viewport sizes, leaving/reopening, temporary
choices, complete receipts and standalone three-lap/runner return. CI checks
Chromium and WebKit. Online continuity is deliberately not claimed by this suite.
