# UI QA checklist

Run this before merging any change that touches a screen, HUD, overlay, CSS or 3D scene. The
automated part catches layout regressions; the manual part catches what tests cannot see yet.
Playtesters should never be the first to find any of these.

## Automated

```sh
cd tests/browser && SPACE_MAN_ENGINE=chromium ./ci-suite.sh layout-qa
```

`tests/browser/layout-qa.test.cjs` opens home, Run, the Arena lobby, the Star Circuit lobby, Play
Together, the wardrobe and records at 390x844, 768x1024 and 1280x800, and fails on:

- horizontal page overflow (including a mobile browser widening its layout to fit content),
- a control extending past the left or right edge (outside a horizontal scroller),
- a control covered by fixed or sticky chrome even after it is scrolled into view.
- a control or line of copy (card names, labels, captions) hidden behind a sticky footer or header
  when it is scrolled to either edge of its scroller, where keyboard focus and the last swipe leave it
  (WCAG 2.2 SC 2.4.11). Prefer a real flex footer under a scrolling body over a sticky overlay.

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
   shadows: no floating, no sinking, no z-fighting, at every camera distance used in play.
4. **Held-input HUD states.** Hold boost, charge, jump and fire for several seconds: meters fill
   and drain without flicker, held buttons show their pressed state, and releasing restores the
   idle HUD.
5. **Reduced motion and pause.** Screens still read with Reduce Motion on, and pausing or leaving
   mid-action returns focus to a sensible control.

Attach the screenshots (or a strip) to the PR so reviewers can verify art and layout.
