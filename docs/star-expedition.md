# Continuous Star Expedition

One launch starts a seeded route director. Five-encounter sectors remix runner,
racing and arena approaches, followed by a Guardian climax. Adjacent encounters
never repeat a control scheme. Each route starts automatically after the previous
engine releases its controls, animation, audio and focus. A short noninteractive
cue orients the player inside the new scene; there are no chapter/results gates.

## Pacing and agency

Runner rendezvous goals vary from 260 to 420 metres, with a 40-second active-play
cap. Arena skirmishes have two stocks and a 35-second cap; Guardian encounters
last at most 55 seconds. Racing uses one varied-track lap with a 90-second cap.
A failed encounter still continues. A solo pilot who loses all lives is rescued
within half a second instead of waiting for CPU teammates. Pause and Finish expedition remain available
in each mode. Backgrounding pauses local play, and returning never dismisses a
pause automatically. Standalone games retain their existing rules and choices.

Guardians have a distinct large body and health core. Ground shockwaves and aimed
columns lock their warning area before striking. Recovery exposes the core for
double pulse damage. A CPU wingmate helps solo pilots; victory is not required.
Warnings use shapes, text, sound and screen-reader announcements, not color alone.
Reduced motion does not remove the warnings or change the rules.

## Lifecycle

The pure src/expedition.js director exports encounterAt(seed,index) for shared
host-owned epochs, and create(seed) for local play. Its states are ready, playing,
transition and cancelled. Accepted results require the exact mode and monotonically
increasing token, and a cancelled or duplicate callback cannot advance or reward.
History is capped at 20 results. Completed-route count continues across sectors.
Held keyboard keys and controllers must return to neutral across transitions;
touch captures and stale input edges are released. A run is banked only once.
Service-worker updates wait until the expedition is explicitly finished.

Arena and Racing session adapters temporarily apply route settings. Local results
call the director without drawing result dialogs. Shared adapters attach to an
existing journey-owned authority and can detach without closing its transport.
The boss codec is an explicit journey-only revision; standalone version1 bytes
remain unchanged.

## One shared room

Expedition with friends negotiates its own invite bit (0x40), mode marker (3),
capability (1 << 9) and reserved encrypted application frame (0x42). It never
converts or reconnects an existing standalone room. The same authenticated keys,
room identifier, callsigns, four player roles and four watcher roles survive
encounter changes. Reloading is a fresh join; host migration is not supported.

Every journey packet has a bounded binary envelope carrying the host-generated
session ID, encounter epoch, deterministic route index/seed, revision, phase,
clock and active seat mask. Inner Arena/Race commands and snapshots are scoped
by that envelope. The client accepts only the authenticated host's increasing
revisions; the host binds inputs to the authenticated player's identity and
current epoch. Watchers cannot send gameplay packets. Runner samples are bounded
shared presence rather than authoritative scores. Host gameplay time decides
when the runner leg ends; remote scores cannot choose the next encounter.

At a transition the old controls are released and the new scene is prepared.
Active players acknowledge readiness; a normal barrier is at least 0.9 seconds
and never more than 3.5 seconds. A slow player watches that encounter, with CPUs
filling arcade vacancies, then can participate at the next boundary. The barrier
uses the existing transport, not a new invite. Late joins are watchers during
active play. Crew controls queue role requests until the next barrier; queued
admission is never mistaken for permission to control the current encounter.

Pause, Crew and Leave remain reachable in every engine, including a transition.
Opening Crew gives its dialog exclusive keyboard, touch and controller ownership.
The host's pause is shared; a guest's menu only releases that guest's commands.
A pause during a readiness barrier pauses the first live frame. Link interruption
releases commands and freezes affected clients; reconnect adopts the latest
encounter without replaying a transition. Closing the host ends the room for all.

Appearance uses a separate optional capability (1 << 10) and reserved frame0x43.
The payload is exactly seven allowlisted catalog bytes plus opcode/player ID.
Guest updates cannot choose another player's ID. Rapid changes coalesce into a
single latest profile; roster replay restores identities to late/rejoining peers.
No image URLs, assets, free text or invitation secrets are cosmetic profile data.
Standalone legacy suit/hat bytes remain available for older clients.

## Verification

Run node --test tests/*.test.cjs. The browser suite in tests/browser/expedition.test.cjs
plays two full sectors through ordinary controller inputs and real engine clocks,
with no forced result, teleport or shortened test-only segment. It checks automatic
continuity, real race finishes, two boss encounters, pause, repeated launch/exit,
four touch viewport sizes, and restoration of standalone preferences. Chromium
and WebKit plus exact deployed preview checks are required before release.


Shared acceptance runs tests/browser/journey.test.cjs in Chromium and WebKit.
The default replaces only the opaque relay hop; cryptography, controls, engine
clocks, roster and gameplay are real. SPACE_MAN_RELAY_HOST=default opts into an
actual public relay and never falls back to the simulated hop. The suite uses
visible Crew buttons for late-watcher seat requests and host closure, exercises
socket reconnect, follows five consecutive encounter transitions, and captures
all four crew slots plus the boss warning/strike/recovery at a narrow viewport.
Pure tests additionally traverse twelve epochs and reject forged/stale/duplicate
packets, while encrypted transport tests preserve standalone mode/version gates.
