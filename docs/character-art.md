# One crew across Space Man

Orbital Arena is the reference for character identity: an oversized pale helmet,
dark curved visor, bright expressive LED eyes, small life-support chest panel,
colored trim, and compact rounded limbs. This pass carries that identity into
the runner and Star Circuit while retaining their different cameras and controls.

## Rendering contract

- `SpaceManCosmetics` owns the normalized, allowlisted appearance and palette.
- Appearance is cosmetic only. Collision geometry, simulation, scoring and CPU
  behavior never depend on a chosen suit, helmet, eyes, accessory or ship.
- Arena team/seat colors remain gameplay markers; equipped suit colors are not
  allowed to obscure team identity.
- `SpaceManArt` provides shared 2D helmet, LED eyes, suit-detail and hat drawing.
  Existing runner IK, recoil, squash, ragdoll and eye reactions stay intact.
- Star Circuit adapts the same helmet, panel and trim into inexpensive geometry.
  Its face and accessories must remain readable in a camera suited to viewing
  them. Chase naturally shows the back of the pilot; we do not paint a second
  face onto the rear of a helmet.
- Reduced motion removes decorative bob/lean; battery saver keeps the same
  character identity with less glow. No randomized rendering, per-frame
  gradients, downloaded assets or changed hitboxes.

## Verification gate

Real canvas/WebGL pixels at phone, tablet and desktop sizes, actual keyboard,
touch and simulated standard-controller input, reduced-motion/saver checks,
cache bounds, immutable snapshot tests and the full existing regression suite.
Passing tests alone is not evidence of polished art; inspect screenshots and
record which views and input methods were actually exercised.

## Suit studio

The studio is the same small universe as the home screen, rather than a modal
painted over a live runner scene. Slate-blue surfaces, pale pressure suits,
cyan glass and warm gold primary actions give the character room to breathe.
A single scroll container must retain all controls at small sizes and zoom;
portrait stacks the workbench beneath the pilot, while landscape splits them.

Every option uses the shared renderer to show the actual item. Equipped is an
outlined cool tile; available is quiet; locked uses a dashed border and written
label. A locked click previews without equipping or touching the saved profile.
Successful equip earns one short wave and delighted eyes, not a looping reward.
The existing runner animation clock owns the studio; no extra frame loop is
created. Reduced motion freezes decorative motion, and hidden/mode transitions
keep the original scheduler ownership. Appearance never changes mechanics.
