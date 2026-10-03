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
