# Arcade cornering acceptance

## Diagnosis on production 5ab8379

The steering budget grows with speed, reaching roughly 270 degrees per second at
normal race speed. Brief digital inputs can swing the nose far into a bend,
while strong neutral edge assistance makes passive driving unusually effective.
Braking removes speed without a satisfying corner-exit payoff. The chase camera
follows the nose even when the craft is sliding sideways, obscuring its actual
travel direction.

A manual cloud-browser baseline exercised ordinary arrow inputs and pause/resume.
That browser used the supported 2D fallback: it is not evidence of WebGL camera
quality. Separate hosted Chromium/WebKit raster and input tests are required.

## Bounded improvement

- Calm the steering budget as speed rises, retaining prompt turn-in and immediate
  release. Keep the existing forgiving runoff, rescue cost, and ordered gates.
- Holding Brake while steering at speed starts a controlled, speed-preserving
  drift. Hold the same full-steer corner for at least 0.4 seconds (partial analog
  steering charges proportionally more slowly), then release Brake for a short exit
  boost. Brake alone still stops. Direction reversals, offroad, input expiry,
  rescue, and low speed discard the charge.
- Use the existing host-authoritative boost duration and event representation for
  the reward. No new input command, wire layout, or protocol version. Older
  clients can still drive and display the authoritative reward; they lack the
  new explanatory text. The host determines handling for everyone in its room.
- Keep the road framed around travel during a slide and add compact, contextual
  cornering feedback rather than another permanent dashboard.

## Release gates

Pure tests cover steering sensitivity, drift entry/exit and cancellation,
checkpoint fairness, deterministic replay, and existing mixed-client wire
contracts. Full regression tests cover standalone and continuous modes.
Hosted browser tests must exercise real keyboard and touch holds, cancellation,
portrait/landscape/tablet/desktop layouts, all camera modes, and friend rooms.
Manual driving must be reported separately from controller-driven completion;
neither an automated lap nor green CI establishes that the game is fun.

## Verification so far

The identity-integrated pass has 863 passing pure regression tests. Independent
review additionally reproduced and closed pause/cancel rewards, boost-strip
braking, edge-crossing rewards, shallow analog reward farming and stale-input
reacquisition before a host step. The fixed snapshot encoder and decoder remain
byte-compatible; an old production decoder accepted the new reward and a new
client accepted an old-host snapshot. The Chromium native partial-release injector was checked on two isolated
buttons before game acceptance. Both natural finger release and releasing Brake
while continuing to steer produce the reward through real native touch events;
cancellation does not. Chromium and WebKit pass the authored keyboard cases at
phone portrait/landscape, tablet and desktop sizes. Full browser suites are
rechecked on the final revision.

Manual cloud-browser top-down play covered short steering corrections, straight
braking, normal boost, an early missed drift, recovery without the rescue action,
and a deliberate 420 ms drift through a Starlight bend that stayed in lane and
released into a visible boost. The merged identity strip/marker and speed-meter
contrast were inspected while driving Ember. The cloud browser used 2D fallback;
WebGL framing evidence comes from hosted Chromium/WebKit raster tests and
independent screenshot review. This is not physical-device testing or a claim
that automated driving proves subjective fun.
