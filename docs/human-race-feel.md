# Human steering and forgiving runoff

## Why another handling pass

PR38 widened the road and improved many contact stalls, but human auto-throttle still had approximately 121-unit cruise and 163-unit boosted full-lock radii. Ember has several much tighter bends. Immediate binary steering plus additional rail assistance could produce 7.6–8.3 degrees of yaw per tick and could oppose held steering. Ordinary auto-throttle on Ember reproduced 6.26-to-0.19 and 6.26-to-0.09 speed losses in a single frame at the hard road boundary. These are simulation probes, not a human usability pass.

The requested direction is more direct, smoother arcade steering and brief off-road freedom while remaining roughly on course. CPU/autopilot completion alone is not acceptance evidence.

## Work in progress

- Smooth deterministic steering buildup/reversal and a single total-yaw budget
- Natural cruise/boost turning radii around 80–90/100–115 units
- Driveable slower runoff using the existing visible 3D apron, with matching 2D ground
- Round Ember’s overly pinched slalom while preserving its overall route
- Preserve motion at the outer safety boundary; allow deliberate steering to turn through contact rather than freezing it
- Move decorative posts and arch supports out of driveable runoff
- Keep bounded escape/rescue, ordered checkpoint/lap fairness, CPU progression and authoritative online controls
- Atomically gate incompatible cached geometry if the visible driveable layout changes

Validation will include timed human-style taps/reversals, boost entry, late steering, inward escape from all bends, speed/yaw discontinuities, actual rendered controls and manual cloud-browser driving. Physical-device testing remains unavailable; no subjective human-quality claim is made yet.

## Prototype validation checkpoint

The current candidate uses 48 units of center-position runoff beyond the asphalt
edge, supported by the existing 88-unit apron under the full radius-28 hull.
Props and finish supports clear that whole envelope. A throttle-only 1.8-unit
minimum glide at the final safety edge prevents pinning; it never moves position
instantaneously and is disabled for brake/coast/invalid/recovery-release poses.

Steering rises by 0.18 per fixed tick, reverses by 0.28, and releases immediately.
The single yaw limit is `0.052 + min(speed, 8) * 0.0042`; road correction cannot
reverse an actively held steering direction. Runoff preserves scalar momentum
while travel direction catches the nose, avoiding a second speed collapse after
an otherwise successful sideways contact slide.

Independent normalized-input tests cover 100/200 ms taps and reversals, full-hull
apron triangles, prop clearance, ordered gates, correction-only crossings and
authority parity. Across more than 1,100 genuine outer-boundary poses, inward
steering cleared 16 units in at most 333 ms; tested cruise/boost late entries
retained at least 3.475 speed and returned to asphalt within 750 ms. All authored
centerline radii are above 60 units. These are deterministic probes, not a human
playability verdict. Browser/manual acceptance is still pending for this draft.
