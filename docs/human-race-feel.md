# Human steering and forgiving runoff

## Why another handling pass

PR38 widened the road and improved many contact stalls, but human auto-throttle still had approximately121-unit cruise and163-unit boosted full-lock radii. Ember has several much tighter bends. Immediate binary steering plus additional rail assistance could produce7.6–8.3 degrees of yaw per tick and could oppose held steering. Ordinary auto-throttle on Ember reproduced6.26-to-0.19 and6.26-to-0.09 speed losses in a single frame at the hard road boundary. These are simulation probes, not a human usability pass.

The requested direction is more direct, smoother arcade steering and brief off-road freedom while remaining roughly on course. CPU/autopilot completion alone is not acceptance evidence.

## Work in progress

- Smooth deterministic steering buildup/reversal and a single total-yaw budget
- Natural cruise/boost turning radii around80–90/100–115 units
- Driveable slower runoff using the existing visible3D apron, with matching2D ground
- Preserve motion at the outer safety boundary; allow deliberate steering to turn through contact rather than freezing it
- Move decorative posts and arch supports out of driveable runoff
- Keep bounded escape/rescue, ordered checkpoint/lap fairness, CPU progression and authoritative online controls
- Atomically gate incompatible cached geometry if the visible driveable layout changes

Validation will include timed human-style taps/reversals, boost entry, late steering, inward escape from all bends, speed/yaw discontinuities, actual rendered controls and manual cloud-browser driving. Physical-device testing remains unavailable; no subjective human-quality claim is made yet.
