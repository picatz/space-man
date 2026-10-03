# Forgiving circuit contact

## Diagnosis and checkpoint

The full kart envelope is correctly bounded to the same corridor drawn by the
renderer, but the old handling makes an ordinary grazing contact feel like a
crash: the 12-unit shoulder immediately clamps speed to 2.6, rail friction is
applied every contact tick, and a kart pointing directly outwards loses all
motion until the two-second rescue. A regression even requires that stationary
contact. Increasing track width alone would only postpone this problem.

This work will modestly widen the authored courses, ease shoulder slowdown,
and add bounded road-tangent guidance when a driven kart points into a rail.
The goal is a readable arcade slide and easy steering away from the edge, with
no bounce, hidden off-road driving, shortcut teleport, or checkpoint credit
from invalid-pose correction. Humans, CPUs and online authority keep one model.

Validation pending: held steering/boost, glancing and head-on contacts, release
and steer-away response, pileups, every CPU circuit/difficulty, ordered progress,
road/mesh agreement, and rendered portrait/landscape/tablet/desktop controls.

## Implemented tuning

- All circuits gain 24 units total authored width (12 per side), retaining the
  complete radius-28 hull and one shared physics/rendering geometry.
- The shoulder progressively eases the limit from 6.4 to 4.2, at no more than
  0.14 forward-speed units per tick. Sustained rail riding costs time; a scrape
  no longer throws away most momentum instantly.
- Outward throttle near the rail turns gradually toward a smoothed local tangent.
  There is no added forward speed or positional teleport. Steering away is
  immediate; braking/coasting disable guidance and reverse travel is preserved.
- Invalid poses still receive bounded inward correction with no correction gate
  credit; regaining the road resumes driving, and stuck/extreme poses retain the
  last-verified-gate rescue.

The complete Node regression suite passes. Focused checks cover both rail sides on all
three circuits, head-on escape, held outward steering, prompt steer-away,
boost-speed easing, brake/coast/reverse behavior, six-kart pileups, deterministic
replay/online poses, ordered gates, and every CPU circuit/difficulty. Original
mesh byte regressions retain their historical authored widths; all wider live
meshes pass the independent full-lane coverage/union/collision checks.

Hosted Chromium and WebKit both pass the eight audio/contact browser cases,
including 300 ticks of real held input on desktop, portrait phone, landscape
phone and tablet layouts, with zero near-stall ticks and successful release and
cancel. Screenshots were inspected at those sizes. A slow-WebKit test now holds
the actual R key until its fixed-tick input consumer sees it, instead of assuming
a zero-duration pulse spans a frame. The final combined-head browser matrix is
rerun after integration. Local Chromium cannot create its process socket and
local WebKit lacks required shared libraries; hosted engines provide rendering
coverage. No physical mobile device validation is claimed.

## Online compatibility

The width change lands atomically with exclusive race capability revision 2
(bit 7 replaces legacy bit 6). Host admission and guest WELCOME validation reject
mixed geometry for players and watchers; current clients explain how to refresh
both games and create a new invite. Same-version race, runner and Arena behavior
remain covered. The packet shapes remain unchanged. This prevents old cached
guest meshes from drawing a narrower road under new authoritative poses.
