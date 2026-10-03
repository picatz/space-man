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
remain unchanged. Shared session behavior requires separate end-to-end validation.

## Verification

Run node --test tests/*.test.cjs. The browser suite in tests/browser/expedition.test.cjs
plays two full sectors through ordinary controller inputs and real engine clocks,
with no forced result, teleport or shortened test-only segment. It checks automatic
continuity, real race finishes, two boss encounters, pause, repeated launch/exit,
four touch viewport sizes, and restoration of standalone preferences. Chromium
and WebKit plus exact deployed preview checks are required before release.
