# space-man

An addictive arcade space platformer PWA. Outrun the solar flare, stomp aliens,
chain mid-air combos, and chase your personal best.

- Single self-contained `index.html` — canvas rendering, synthesized audio,
  zero external dependencies. Works offline once installed.
- Plays great on phone (portrait or landscape), tablet, and desktop.
- Touch: left side of the screen steers (floating stick), right side jumps
  (hold for higher), dedicated shoot button. Desktop: A/D or arrows, Space to
  jump, F/J or click to shoot, Esc to pause, M to mute.
- Every run rolls a bite-sized mission. Optional star-shard routes, big-air
  bonuses, rare lucky aliens, named deep-space sectors, and small cosmic
  surprises reward curiosity without currencies, ads, or purchases.
- Star-boost pads occasionally remix the platform rhythm. Finish a mission and
  a tiny comet companion joins the run, celebrates alongside you, and helps
  pull nearby star shards into reach.
- Music, sound effects, haptics, screen shake, and handedness are independently
  configurable from both the title and pause menus. Legacy SOUND preferences
  migrate automatically to the more precise controls.
- Standard gamepads are supported, including PS5 and Xbox-style layouts:
  left stick or D-pad to move, Cross/A to jump, Square/X or R1/R2 to fire, and
  Options/Menu to pause. Supported controllers use the optional haptics setting.

## History

Originally a simple space game made with OpenAI's `o1-preview` model, then
improved with `gpt-4o`, `o1-mini`, GitHub Copilot, and Claude 3.5 Sonnet.
Version 2.0 was a ground-up canvas rewrite designed and built by a Claude
Fable 5 agent team. It's a fun research project exploring the capabilities
of AI models for web game development.

## Daily Course and challenges

**Daily Course** on the title screen (or Y / Triangle on a controller) runs the
same course for everyone in the world that UTC day. The card shows today's best
and attempts; they start fresh each day, with nothing lost by skipping one.

**Share Run** on the death card sends a short, spoiler-free result plus a link
(the native share sheet where available, otherwise the clipboard). The link is a
challenge on the exact same course: `#daily=YYYY-MM-DD&beat=<score>` for a Daily
Course (accepted up to a week old), or `#seed=<n>&beat=<score>` for any other run.
Opening one shows the score to beat, the next start plays that course, and the
HUD carries the target beside your score. Course generation draws from its own
seeded stream, so kills, effects and misses can never change the course. Runs
where the mercy assist has eased the course share the game link without a seed.

## Run Together

Choose **Run Together**, share the QR/link, and press **Start Together** once
friends join. Accepting an invite enters the course directly; if the host has
not started yet, everyone waits at the start line. The host's three-second
countdown starts a shared course and flare clock. **New Round** resets the
participating crew together. Late arrivals and rejoins land on a platform near
a live runner when a plausible, recent position is available.

Teammates have callsign badges, a live race strip, and off-screen direction /
distance indicators. **Watch** follows a live runner without simulating an
invisible player. Use Previous/Next or Left/Right to switch runners, Tour to
follow the leader, and **Join Run** (Enter on keyboard) to play. Watching from
the death screen starts immediately; spectators remain spectators across
rounds until they choose to join.

Run Together is currently a **shared-course race**. Positions, round starts,
flare timing, identities and emotes are shared, and so are the aliens: every
patrol's position and every shooter's telegraph and firing schedule are a pure
function of the round clock, so everyone sees the same alien in the same place
however long their own screen has been running (a slow phone, a backgrounded tab
and a late joiner all line up). Spectators see them move too. Combat results
(who stomped or shot which alien), pickups, missions and scores are still
simulated locally, shots are aimed at and only ever hit their own player, and
watching is a live positional view, not a frame-perfect broadcast of the
runner's combat. Shared kills and cooperative objectives require an
authoritative world-event protocol.

Version 3.4 uses room protocol 3 because deep-run terrain (the endgame ramp
and DEBRIS FIELD past 2500m) changed; version 3.3 introduced protocol 2.
Refresh both devices and create a fresh room/link after upgrading. Old invites
show an update prompt instead of connecting incompatible courses.

## Regression tests

Run `node --test tests/*.test.cjs` with Node 22 or newer. No dependency
installation is needed. The harness runs the shipped game in independent JS
contexts, with real encryption and wire packets through an in-memory relay.
Only browser APIs and relay transport are substituted. It covers admission,
retry, complete/chunked rosters, countdowns, shared restart, presence expiry,
watching, role acknowledgements, late joining, terrain determinism, visibility
culling, version mismatch and solo behavior. `tests/gameplay.test.cjs` guards
solo play: jump reach for every band and endgame ramp step, seed determinism
across viewports, fingerprints of pre-2500m courses, mercy, missions, DEBRIS
FIELD slabs and save-migration fuzzing. `tests/solo.test.cjs` covers the Daily
Course (identical terrain for everyone on a date), shared-run challenges, strict
challenge-link parsing and the daily record.

These tests do not verify browser rendering or public relay connectivity. Before
release, exercise a desktop host + phone player + spectator on separate networks:
scan/join, move apart and reunite, die/watch/rejoin, change rounds, background a
phone, reconnect, and update an installed PWA. Check portrait/landscape controls
and verify that both devices run the same asset version.
