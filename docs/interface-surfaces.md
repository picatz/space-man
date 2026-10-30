# Interface surfaces

`src/space-theme.css` owns shared materials, type, focus and control sizing.
`home.css` owns the character-led launcher; `wardrobe.css` owns the Suit Studio.
Keep presentation changes separate from game authority and saved-profile data.

## Hierarchy

- Keep the game world visible as context, with enough dimming behind reading screens.
- Use one calm surface per dialog. Body text and controls use the shared body font;
  display lettering belongs to short game titles, not every label or number.
- Use gold for the main action, a quiet outlined surface for alternatives, and
  explicit subdued destructive copy. Do not make every action equally loud.
- Records use readable scores and aligned discovery rows. Locked hints remain
  readable; discovery state must not depend on color alone.
- Settings use named groups. Preserve the schema-driven controls, live audio
  preview and existing persistence callbacks when moving them between groups.

## Interaction contract

- A visible control has a real target of at least 44 CSS pixels in both axes.
  Small switch artwork may sit inside a larger target.
- Native buttons own both keydown and keyup. In particular, cancelling Space
  keyup prevents the browser from activating a focused button.
- Ranges, text fields and textareas retain their native keys. Controller focus
  includes these fields and skips hidden haptic inputs.
- Secondary dialogs move focus inside, contain Tab navigation, and expose named
  dialog semantics. Focus rings must cover textareas and non-button controls too.
- Tactile feedback must never move focus to the hidden iOS switch.
- Callsign Cancel discards the draft and returns to its origin. Use callsign saves
  once, dismisses the picker, then invokes the next step. A slow join must show its
  own cancellable connecting screen, never the already-committed picker.
- Room Back preserves the room; Leave disconnects it. Invite QR sizing follows its
  available width, while the encoded link and copy-link fallback remain unchanged.
- Reset confirmation must describe everything the existing reset action clears.

## Spectating

Every mode watches through one dock, `src/spectate.js` (`SpaceManSpectate`), styled
in `space-theme.css` (`.sm-watch`). The mode decides who is watchable, in what order
and how its camera follows; the dock owns the look, the wording and the gestures.

- While the dock shows, the mode hides its play controls (touch pads, item slot,
  emote button) and its driving hints. The dock owns the bottom edge.
- It always says who is on screen (eyebrow + name + one detail line) and the next
  steps: previous/next, the mode's wide view, join the next round, leave.
- Switching is the same everywhere: ‹ › buttons, a horizontal swipe on the play
  surface (left = next), ←/→, Q/E or [ ] on keys, LB/RB or d-pad on a controller.
  V or Y toggles the wide view (Star Circuit's race overview, Run's auto camera).
- Order follows the race (leader first) and the pick stays locked through
  overtakes; a target who goes out or finishes keeps the camera for a beat first.
- Who watches: a seatless spectator, an online racer who has finished while others
  still drive, a Run Together runner who sat out, and (Arena) a knocked-out fighter.
- Stable ids: `<prefix>Previous`, `<prefix>Next`, `<prefix>Name`, `<prefix>Overview`
  and `<prefix><Action>`, e.g. `raceWatchNext`, `runWatchJoin`.

## Responsive contract

Panels own vertical scrolling. Do not conceal inaccessible content by clipping it
or removing scrolling. Keep primary/Back actions reachable, account for the shared
safe-area/visual-viewport variables, and avoid a second logbook scroll region.
Use wider layouts for reading on desktop and one column when space is limited.
The selector `.secondary-panel` deliberately excludes the launcher and Studio.

## Acceptance map

`tests/browser/secondary-surfaces.test.cjs` covers Records, Settings, callsign,
runner results/initials, and Run Together entry/room return flows. It exercises
saved/empty profiles, real native keyboard actions, persistence, repeated opens,
Cancel, simulated controller Back, real runner death/retry and an isolated relay.
`home-shell.test.cjs` samples actual normal-motion hover/focus/press frames.
`menu-keys.test.cjs` and `haptics.test.cjs` protect input routing and tactile logic.
Existing mode-specific browser suites continue to cover Arena and Star Circuit.
`spectate.test.cjs` (identity suite) covers the Run Together dock at phone, landscape
and desktop sizes; `race-network-helper.cjs` covers the Star Circuit dock and overview.

Browser viewport and controller emulation are evidence for those environments;
they do not establish installed iOS/Android safe-area, physical haptic, camera
scanning or hardware-controller behavior. Check those on devices separately.
