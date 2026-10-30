# Art direction: one universe

Space Man is one small, warm universe seen through several games. Endless Run,
Orbital Arena, Star Circuit, the launcher, the Suit Studio and every result card
are windows onto the same place, the same crew and the same light. A new mode or
screen is finished when a player could not tell from a still frame that it was
built by a different team.

This guide is the contract. `docs/character-art.md` (the crew) and
`docs/interface-surfaces.md` (menus and dialogs) go deeper on their parts; where
they disagree with this file, this file wins and the other gets fixed.

## The universe

**The Lantern Reach** is a pocket of space around a young, restless star the crew
calls **Old Flare**. Old Flare is not evil, just too bright to stand next to: it
sheds solar flares that roll outward through the Reach, and everything here is
built to move, bounce and race ahead of the light. That is the reason the runner
runs, why the arenas float in orbit and why the circuits are flown, not driven.

**Spacefarers** are the people of the Reach: small pilots in oversized pressure
suits, with dark visors that show only two bright LED eyes. They are curious,
brave and a little clumsy. They never speak in full sentences; they emote through
eyes, posture and a short comms chirp. Every player is a Spacefarer, and so is
every rival. Rivals are friends you are competing with, never villains.

The named crew are the default rivals in every mode and keep one color each, so a
player meets the same faces everywhere:

| Pilot | Color | Personality |
|-------|-------|-------------|
| Nova  | cyan `#38E1FF`  | the steady one; the default player look |
| Moss  | green `#4EF07A` | gardener from the Bloom moons; patient, then sudden |
| Flare | amber `#FFB454` | foundry kid from Ember; loud, fast, first off the line |
| Luma  | violet `#B87BFF` | prism cartographer; takes the clever line |
| Comet, Echo | rotate | the wider crew for bigger lobbies |

**Hazards** are the Reach being itself: flare walls, meteor showers, drifting
debris, Guardians (old automated wardens of the gates), and the cold of the void.
The game has no gore, no death screams and no cruelty. A defeated pilot is
"sent starward" and floats back; a lost run is a rescue, not a funeral.

### Regions

Places are shared between modes. A region owns a palette and a mood, and each
mode visits it in its own way. `SpaceManArt.REGIONS` is the code copy of this table, and
`SpaceManArt.circuitSky` turns a region into a 3D sky dome (`scene.sky` in
`SpaceManRender3D`). Reuse a region before inventing a new one, and
when a new one is needed, add it here first.

| Region | Mood | Sky (top → horizon) | Accent | Run sector | Arena stage | Circuit |
|--------|------|---------------------|--------|------------|-------------|---------|
| Orbital Dock | home port, morning shift | `#060818` → `#18264A` | cyan `#38E1FF` | Orbital Dawn, Ion Drift | Orbital Dock | Starlight Speedway |
| Bloom | garden moons, humid, alive | `#061817` → `#173C36` | green `#4EF07A` | Night Bloom | Bloom Reactor | Bloom Lagoon |
| Ember | forge worlds near Old Flare | `#1A0C20` → `#46202D` | amber `#FFB454` | Red Shift | Ember Foundry | Ember Switchback, Forge Ring |
| Prism | crystal canyons, quiet | `#12152B` → `#2B2A4A` | lilac `#B4A6E8` | Violet Reach | (future) | Prism Canyon |
| Aurora | ice ridges, high wind | `#0B1D33` → `#1D3C55` | ice `#9FF1FF` | (future) | (future) | Aurora Ridge |
| Neon | the night market city | `#150A2B` → `#32124A` | magenta `#FF5FD2` | Event Horizon | (future) | Neon Gauntlet |
| Nebula | the deep drift, far side | `#1A0D2E` → `#3A2052` | violet `#B87BFF` | The Far Side, Last Light | (future) | Nebula Drift |

Region names appear in player-facing copy exactly as written. Flavor text is one
short line in the present tense ("Twin garden rafts linked by a raised reactor
bridge."), written as if a Spacefarer is pointing at it.

## Palette

`SpaceManArt.C` (canvas) and the `:root` tokens in `index.html` and
`src/space-theme.css` (DOM) are the only sources of color. Do not type a new hex
into a mode file when a token fits; add a token instead.

- **Void and sky.** Backgrounds are deep blue-violet (`void #060818`), never pure
  black and never neutral gray. Every world view has a vertical sky gradient from
  a dark top to a lighter, region-tinted horizon, plus stars. A flat single-color
  sky reads as unfinished.
- **Semantic roles** (`SpaceManArt.ROLE`) are gameplay language and hold in every
  mode: hazards warm (coral `#FF4F66`), friends and the local player cool (cyan),
  rewards gold (`#FFC93C`), power-ups violet (`#B87BFF`). A hazard is never cyan
  and a reward is never coral.
- **Suits are pale.** Pressure suits stay near-white (`#F4F7FF`) with color only
  on trim, pack, cuffs and visor light. A suit never becomes saturated enough to
  compete with team color or hazards.
- **Value before hue.** Characters and pickups are the brightest values on screen;
  platforms and track mid; sky and parallax darkest. Check a grayscale screenshot:
  the pilot should still pop.
- **Saturation budget.** One saturated accent per region, plus the semantic roles.
  Everything else is a desaturated tint of the region sky.
- **Seasons** (`SEASON` in `index.html`) may tint a region, never replace its
  palette or push its sky into olive or brown. Test the season hue over the region.

## Shape language

- **Round and soft for life, chamfered for machines.** Characters, plants and
  pickups use circles and rounded rectangles. Platforms, gantries, track housings
  and Guardians use straight edges with chamfers and small rivet or light details.
  Nothing is sharp except hazards, which may use spikes and jagged edges.
- **Readable silhouettes.** Every gameplay object must be identifiable as a solid
  dark shape at play size. Details are a reward for looking, not a requirement.
- **Platforms** have a lit top edge in the region accent, a darker body and a
  simple underside (truss chevrons or crystal teeth). Run and Arena share this
  construction, so a player recognises "I can stand here" instantly in both.

## Characters

The crew is drawn by `SpaceManArt` (2D) and `SpaceManRaceScene.actorMeshes`
(WebGL). No mode draws its own Spacefarer from scratch.

**Proportions** (canvas units, as in `drawAvatar` and the runner):

- Helmet radius 11 on a 16-wide, 17-tall torso: the head is the largest shape.
- Arms are slim capsules about 4 units wide, the width of the runner's arms. The
  Endless Run astronaut is the reference for arms: narrow, springy, no bulky
  shoulder pads.
- The shoulder joint sits at the top of the torso, below the neck seal, at most
  as wide as the arm itself. A shoulder never shows above the visor line or in
  front of the face; the helmet always paints last.
- Legs are short (about 9 units hip to boot) and slightly wider than arms; boots
  and mittens are rounded and suit-white.
- The visor is dark navy with exactly two LED eyes and one highlight that never
  crosses the eyes.

### The Spacefarer rig

Every 2D astronaut is painted by one rig, `SpaceManArt.drawSpacefarer(c, x, y, scale,
appearance, pose)`. Home, wardrobe, tiles and the Arena lobby reach it through
`drawAvatar`; Arena matches and the Endless Run's `drawPlayer` call it directly (the Run
feeds its sim and presentation rig, and adds pistol tricks and arrival morphs through
the `gearFx`, `armBlend` and `frame` hooks). No mode adds its own body.

- **Frame.** The Run sprite's units: a 24 x 34 hitbox, origin at the body centre,
  helmet r 11 at y -9, boots on y 16. `(x, y)` is the ground contact point under
  the hitbox; `scale` multiplies the frame.
- **Parts, back to front.** IK legs (far, then near) with boots; the pack; the far
  arm; the 16 x 16 torso with `suitDetails`; the near arm and its gear; the head
  group (optional halo sprite, helmet, hat, frost). The helmet is always last.
- **Proportions.** Arms are two-bone limbs (upper arm and forearm, 6 each near, 6.6
  far) from shoulders at (+-6, -2.5), just inside the helmet rim, so a sleeve leaves
  the body at shoulder height rather than the neck and a short reach folds the
  elbow. Legs are two 6.4 segments from hips at (+-4.6, 4) to the ankle at y 15.2.
  One limb language: sleeves 3.7 and legs 4.5 wide inside a 1.3 hairline edge;
  cuffs are exactly one sleeve wide and boot shafts one leg wide, so wrists and
  ankles have no step. Mittens are a padded palm a little wider than the cuff with
  a tucked thumb; boots are rounded moon boots (shaft, toe cap, darker sole) whose
  shaft swallows the shin end. The torso is 16 x 15.
- **Motion.** Overlap and follow-through come from phase, not state: the head bobs
  a beat after the torso, arms swing a beat behind the legs and fold at the elbow
  as pace rises, an idle pilot shifts weight with the helmet trailing the hips, the
  wave flutters the wrist late, a jump stretches on the rise, celebrate is a
  victory hop that squashes on each touchdown, and the comms aerial whips behind
  lean, stride and hop.
- **Palette slots.** `suit` torso and helmet, `arm` near sleeve, `legF` near leg,
  `legB` outline, shade, far limbs and cuffs, `pack` canister, `visTop`/`visBot`
  blaster. The crew or team `accent` lights the cuffs, boots, pack vent, chest panel
  and helmet ring; it never recolours the suit.
- **Gear.** `blaster` (the Run's light pistol), `emitter` (the Arena pulse puck in
  `gearColor`) or none (mittens). Gear sits grip-at-origin in the near glove.
- **Poses.** A plain object: facing, speed, runCycle, onGround, air, lean,
  squashX/Y (feet-anchored on the ground), crouch, pop, launch, and the actions
  wave, aim, attack (windup, jab, settle by progress), hit, celebrate, hang and
  recoil. `SpaceManArt.spacefarerPose(input, out)` derives one from speed, vx, vy,
  onGround, time, world x (stride-locked feet) and a named action, so a surface gets
  Run motion without animation code. `calm` (reduced motion) keeps information
  (stride, squash, actions) and drops time-driven sway, breath and wave flutter.
- **Rules.** Pure and deterministic for a pose: no `Math.random`, no blur or filter,
  no per-frame gradients (glows are cached sprites passed in as `halo`).

**Outline and shading.** A thin outline (0.6 to 0.8 units) in the suit's shade
color `legB`, never black. Far-side limbs use the shade color plus a soft dark wash
so they recede. One shading step only: base and shade. No gradients on the body.

**Expression.** Eyes do the acting. Bright is the rest state; happy arcs on a
win, pickup or greeting; squeezed or wide on a hit; closed for a blink about every
four seconds. Every mode drives eyes through `facePose`, so a reaction looks the
same everywhere.

## Light, depth and FX

- **One light direction.** Key light comes from the upper left, Old Flare's side.
  Highlights sit top-left; contact shadows fall straight down and slightly right.
- **Three depth planes** in 2D: sky with stars and a planet or nebula, a parallax
  silhouette layer (ridges, gantries, city), and the play plane. 3D views use the
  same idea: a sky gradient dome, distant set dressing, then the track.
- **Glow is light, not decoration.** Glows come from cached sprites
  (`SpaceManArt.glow`) on things that emit light: visors, thrusters, pickups,
  hazards, boost pads. No `shadowBlur`, no CSS `filter` in the render loop, no
  per-frame gradients.
- **FX vocabulary**, shared across modes so a mechanic reads the same:
  - hit: a short white flash on the target, a ring burst in the attacker's color,
    and a few frames of hit-stop;
  - pickup or reward: gold sparkle burst and a rising number or icon;
  - boost or dash: cyan streaks behind the pilot and a widened thruster flame;
  - knock-out or fall: a star-shaped ping at the exit point in the pilot's color;
  - landing: a small dust puff in the region's mote color and a squash.
- **Screen shake** is small, short and optional (Settings), and never moves the
  HUD.

## Motion

- Easing lives in `SpaceManArt.ease` and the CSS `--ease-out` and `--ease-spring`
  tokens. UI enters with `outCubic` or `--ease-out` in 110 to 320 ms
  (`--dur-1` to `--dur-3`); celebrations may use `outBack` or `--ease-spring`.
  Nothing uses linear motion except scrolling parallax.
- Characters always have life: idle breathing, blinks, a look toward the action.
  Squash on landing, stretch on jump, anticipation before a big move.
- Reduced motion removes decorative motion (bob, parallax drift, shake, confetti)
  but keeps information: warnings, timers, hit flashes as a color change.
- Everything shared between peers is deterministic and lives in the fixed-step
  simulation; visual flourish lives in the render path and never feeds back.

## Type and HUD

- **Display face** (`--font`, Orbitron with rounded fallbacks) is for titles, mode
  names and short labels in caps. **Body face** (`--sm-font-body`, rounded system
  UI) is for sentences, buttons and settings. **Numerals** (`--font-num`) are for
  scores, timers, percentages and speed, always tabular and bold.
- In-game HUDs share one construction in every mode: small translucent
  slate panels (`--sm-panel` family, 12 px radius, 1 px `--sm-line` border) in the
  corners, numerals large and white, labels small caps in `--sm-muted`. The
  player's identity always shows their pilot helmet icon and callsign the same way.
- Corners: top-left is "you" (score, place, damage), top-right is time and pause,
  bottom corners are actions and the map. Never put text over the pilot's path.
- No text under 9 px; all small sizes multiply by `--ui-scale`.

## Screens

- Every reading screen keeps the world visible behind a dimmed scrim, so the
  player never leaves the universe.
- Primary actions are warm gold (`--sm-gold`) with a 4 px bottom lip; one per
  screen. Alternatives are quiet outlined slate.
- **Every action looks like a button at rest**, without hover: a fill, a border, or
  both, plus a 44 px target. Touch and gamepad players never see a hover state, so
  bare text is never an action. The quietest tier (back, "All games", "Choose a
  match", share, leave) is a ghost: a faint cyan wash and a 1 px slate border.
- Lobby heroes show the actual crew in the mode's pose (running, brawling,
  piloting), drawn by the shared renderer, never a static image.
- Results celebrate the player first: their pilot with happy eyes, then the
  numbers. Losses are gentle and point to the next try.

## Seasons and secrets

Every mode celebrates real holidays, and a player should recognise each one in a
second. `src/seasons.js` (`SpaceManSeasons`) is the single table, US holidays
first: New Year, Valentine's Day, St. Patrick's Day, the Fourth of July,
Halloween, Thanksgiving and the winter holidays, plus Lunar New Year, the spring
equinox and each player's own anniversary of their first run. The page computes
the season once at boot and on return to the tab; modes read
`SpaceManSeasons.current()` and only decorate.

- **The real holiday leads, lore is flavor.** Taglines and logbook stamps say
  "Halloween", never only "Dusk Week"; each row's `lore` name (Dusk Week, the
  Long Night, Lantern Week) can appear after it, never instead of it.
- **Iconic props, not abstract motifs.** Each holiday gets the thing a child
  would draw: a carved jack-o'-lantern, a turkey, a decorated tree and a Santa
  hat, a heart balloon, a pot of gold and clovers, red-white-and-blue fireworks.
  `SpaceManArt.homeSeason` paints them on the home hero in three layers (sky
  glow in the backdrop, a prop on the pad and things drifting through the scene,
  and a touch on the alien buddy that hops with it), and `#ovAttract[data-season]`
  tints the whole home sky. Colors come from `SpaceManSeasons.MOTIFS`.
- **Every mode joins in.** `SpaceManArt.seasonBackdrop` paints the static 2D
  version for cached backdrops; `circuitSky` floats lanterns over the 3D horizon;
  the runner keeps its animated versions.
- **Decor never changes play.** No season alters physics, scoring, unlocks or
  anything on the wire, and deterministic captures (`#shot`) never see a season.
- **Secrets** are found, not ground for: a rare lucky alien, a hidden route, a
  pilot who waves back. They reward curiosity with a moment of joy and a
  logbook line, never power. Each one should be discoverable without a guide
  and repeatable once found.
- **One logbook for the whole Reach.** The Records logbook (`DISCOVERIES` in
  `index.html`) takes entries from every mode through
  `SpaceManLogbook.discover(id)`: Untouched Orbit (win an Arena match without
  losing a life), Photo Finish (win a Circuit race by 0.15 s or less), and a
  stamp for each season, earned by finishing any game while it is on.

To add a holiday (another country's included), add a `CALENDAR` row (flag,
stamp, name, lore, tag, line, motif, `when`), a `DISCOVERIES` stamp, a test in
`tests/seasons.test.cjs`, and its props in `homeSeason` if the motif is new.

## Audio and haptics (cross-reference)

Sounds are synthesized and share one tonal center per region; impacts are short
and punchy, rewards bright and rising, hazards low and warning. A hit, a pickup
and a boost should sound like the same thing in every mode. Haptics follow the
same three tiers (light pickup, medium hit, heavy knock-out).

## Checklist for new work

1. Which region is this in? Use its sky, accent and mote color.
2. Are colors from `SpaceManArt.C`, `ROLE` or CSS tokens?
3. Does the pilot come from the shared renderer, with proportions above?
4. Does the grayscale screenshot read: pilot brightest, hazards obvious?
5. Do hit, pickup, boost and knock-out use the shared FX vocabulary?
6. Is motion eased, alive, and calm under reduced motion and battery saver?
7. Is the HUD in the shared construction and corners? Does every action read as a
   button without hover?
8. Screenshot it at 390x844, 844x390, 820x1180 and 1280x800 next to another mode.
   Same universe?
