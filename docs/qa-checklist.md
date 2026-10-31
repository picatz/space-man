# UI QA checklist

Run this before merging any change that touches a screen, HUD, overlay, CSS or 3D scene. The
automated part catches layout regressions; the manual part catches what tests cannot see yet.
Playtesters should never be the first to find any of these.

## Automated

```sh
cd tests/browser && SPACE_MAN_ENGINE=chromium ./ci-suite.sh layout-qa
```

`tests/browser/layout-qa.test.cjs` opens home, Run, the Arena lobby, the Star Circuit lobby, Play
Together, the wardrobe and records at 390x844, 844x390 and 667x375 (landscape phones), 768x1024
and 1280x800,
and fails on:

- horizontal page overflow (including a mobile browser widening its layout to fit content),
- a control extending past the left or right edge (outside a horizontal scroller),
- a control covered, even partly, by fixed or sticky chrome after it is scrolled into view (the
  center and four points 20% in from its corners are probed),
- a control or line of copy (card names, labels, captions) hidden behind a sticky footer or header
  when it is scrolled to either edge of its scroller, where keyboard focus and the last swipe leave it
  (WCAG 2.2 SC 2.4.11). Prefer a real flex footer under a scrolling body over a sticky overlay.

It also plays an Arena free-for-all at 390x844 and 844x390 until the pilot is knocked out, and
checks the in-match HUD: the phone scoreboard stays in the top fifth with untruncated names, the
DASH meter clears its label, fighter controls give way to the spectator dock, the dock never
overlaps the scoreboard (one slim row in landscape), the followed fighter is framed in the clear
area, and arrow keys, a swipe, a card tap and Rematch all work.

Held input gets its own pass: in a Star Circuit race (boost, steer and brake held) and an Arena match
(jump and pulse held) at 390x844, 844x390 and 667x375, every frame for two seconds, no HUD element blinks on
and off more than twice, no HUD chips overlap, and held buttons keep their pressed look until
released. Add a mode's in-match HUD to this pass when it gets touch controls.

`tests/race-grounded-props.test.cjs` checks that every piece of Star Circuit scenery stands on the
ground or on another piece that does; only a landmark's own art may float on purpose.

Add a screen to `screens` when you add one. A known failure goes in `KNOWN` with the issue to fix;
it runs as a todo until the fix lands, then remove the entry. Never add an entry to get green.
`SPACE_MAN_QA_SCREENSHOTS=<dir>` saves every screen for review.

## Manual, with screenshots

1. **Phone sizes.** Screenshot every screen you touched at 390x844 portrait and 844x390 landscape
   (plus 320x568 for dense screens). Nothing clipped, overlapping or under the notch/home bar; no
   text under 9 px. Check light and dark if colors changed.
2. **Touch-only hints.** With `hasTouch` and no keyboard or pad, no key or button glyphs show
   (`body[data-input]`, `[data-for=key|pad]`); with a pad connected, touch hints are gone.
3. **Grounded 3D props.** Trees, landmarks, items and characters sit on the ground with contact
   shadows: no floating, no sinking, no z-fighting, at every camera distance used in play. Seasonal
   sky decor stays on the skyline, never up in the band of the top HUD chips.
4. **Held-input HUD states.** Hold boost, charge, jump and fire for several seconds: meters fill
   and drain without flicker, held buttons show their pressed state, and releasing restores the
   idle HUD.
5. **Reduced motion and pause.** Screens still read with Reduce Motion on, and pausing or leaving
   mid-action returns focus to a sensible control.

Attach the screenshots (or a strip) to the PR so reviewers can verify art and layout.

## Traps we already hit

Each of these shipped once. Check for the class, not just the instance.

- **iOS home-screen app height.** Installed (black-translucent) on iPhone, `innerHeight`,
  `clientHeight` and `visualViewport.height` report about 59 pt short while `100dvh` is full. Never
  copy a measured window height into inline styles; measure the root's CSS height. Desktop emulation
  never shows this, so fake the short window in a test (PR 122, `home-shell.test.cjs`).
- **Sticky bars over content.** A sticky footer hid the last row and iOS WebKit misplaced it. Use a
  real flex footer under a scrolling body (PR 121).
- **Static copy that names inputs.** Text like "keyboard, controller & touch" or "Press Space" on a
  touch-only phone. Name inputs only in `[data-help]`/`[data-for]` blocks keyed to `body[data-input]`.
- **Ids assigned by button position.** Arena and Star Circuit dialogs set ids with
  `querySelectorAll('button')[n]`; adding a button shifts them and silently renames another control
  (PR 128 briefly turned Cancel auto-start into `arenaNext`). Update every index and keep the id
  checks in `arena.test.cjs` and `race.test.cjs` passing.
- **The first ten seconds.** A newcomer who has not touched a control yet must not lose a life or a
  race in the opening seconds (`an idle newcomer survives` in `tests/arena.test.cjs`). Tuning that
  makes the opening harsher needs a reason in the PR.
- **Hovering track props.** Star Circuit hazard debris was built from half its size up, so it
  floated above the road. Scenery is now checked for support in `race-grounded-props.test.cjs`.
- **Sky decor among the HUD.** Dusk Week lanterns floated up to 14 degrees high and read as HUD pips
  beside the timer chip. Keep sky decor within a few degrees of eye level (`render3d.test.cjs`).
- **Focus on a control that then hides.** A pending join hid Play/Watch while focus sat on Play
  (restored there when the callsign picker closed), so focus fell to `<body>` and a keyboard or pad
  player was stranded. It only showed on slow machines. When a state change hides a control, move
  focus to its replacement (`hideJoinChoices()` in `index.html`).
- **A taller home shrinks tablet targets.** The home zooms itself down to fit desktop and tablet
  windows (`SpaceManHome.fit`), so adding a home row on a 768x1024 iPad shrank Settings below 44 px.
  Anything new on the home must fit 768x1024 unzoomed; `theme.test.cjs` checks the targets there.
