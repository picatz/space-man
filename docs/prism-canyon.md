# Prism Canyon

One medium course with the existing hoverkart model. Centerline length is
4,296.22 units; the entire physical road is 208 wide (Starlight is 180).

## Authored sequence

- Broad opening sweep and three optional entry stars
- Boost pad at 15%, then one full-width shallow ramp at 19.5%
- A visible continuous-road landing; no hidden road or unsupported cliff-gap claim
- Long outer bend and second boost at 52%
- Open-sided prism gallery from 58–68%, with roof underside at least 210 units high
- Optional Shield/Pulse choice at 74.5%, then a final boost and spacious finish

Three long, low rock shelves connect ten varied faceted outcrops into the
violet-stone valley, with open skyline around the gallery and finish. Shared material
roles, mesa footprint rings, pickup glyphs and track geometry keep Canvas and
WebGL consistent. Gallery supports are outside the road, runoff and pilot
clearance. Canvas/Top-down cuts away the roof while keeping paired piers and
edge runners. Roof meshes are separately bounded for 3D culling.

## Compatibility and authority

The track is appended as wire ID 3; IDs 0–2 are unchanged. Catalog revision 2 is
shared by the simulation, feature catalogs and snapshot codec. Race capability
bit 13 and Journey bit 14 prevent older clients from joining an incompatible
catalog in either direction. Runner and Arena retain their existing protocol.
The new course is a standalone Circuit choice; Expedition's historical track
sequence remains unchanged.

Feature masks are bounded by the selected course's catalog (Prism: six coins,
one row, one ramp), while the existing byte schema and maximum packet size stay
unchanged. No acceleration, steering, drift, contact, jump-arc or CPU control
parameters are changed. CPUs drive the ordinary command interface. The same
ordered checkpoints, lap masks and off-track rescue rules apply.

## Acceptance

`node --test tests/prism-course.test.cjs` covers scale, route/catalog anchors,
full three-lap races at all three CPU difficulties, deterministic replay,
authoritative wire round-trips, malformed masks, structural clearance and roof
cutaway. Existing course/handling/network suites remain regression gates.

The `Prism Canyon course acceptance` workflow runs Chromium and WebKit. The
existing real-input perspective harness targets Prism via
`SPACE_MAN_RACE_COURSE=prism`: complete single-player race, complete warmed lap
in each camera, first-lap screenshots at boost, ramp, landing, gallery and finish
across portrait/landscape, plus small-phone cockpit and tablet chase. A second
step covers friends, CPU fill, spectators, pause, reconnect, results and rematch
using the production protocol with an opaque relay substitute.

Screenshots and full-lap timing JSON are separate evidence. Hosted software
browser pacing is not physical-device performance; physical phones/controllers
remain unverified. No screenshot is evidence of an unobserved gameplay event.
