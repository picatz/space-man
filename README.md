# space-man

An addictive arcade space platformer PWA. Outrun the solar flare, stomp aliens,
chain mid-air combos, and chase your personal best.

- Single self-contained `index.html` — canvas rendering, synthesized audio,
  zero external dependencies. Works offline once installed: the page and all its
  scripts launch from one versioned cache, so updates never mix old and new files.
  A **Battery saver** setting (also automatic on a low, unplugged battery where the
  browser reports it) caps play at 30 fps with lighter rendering; the simulation
  is identical at any frame rate.
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
  migrate automatically to the more precise controls. Haptics have their own
  strength slider (phones and controllers), a confirming buzz when switched on,
  and, where the browser can read the battery, an "Off on low battery" saver.
  On-screen touch controls recede to a quiet outline once you know them and
  wake when a thumb lands.
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
same course for everyone in the world that UTC day, under one of seven themes
(low gravity, alien swarm, star rush, sky bridges, meteor field, heavy metal,
afterburner) named on the card. The card shows today's best and attempts; they
start fresh each day, with nothing lost by skipping one.

**Share Run** on the death card sends a short, spoiler-free result plus a link
(the native share sheet where available, otherwise the clipboard). The link is a
challenge on the exact same course: `#daily=YYYY-MM-DD&beat=<score>&v=2` for a
Daily Course (accepted up to a week old), or `#seed=<n>&beat=<score>&v=2` for any
other run. `v` names the world generator that builds the course (2 = today's
designed set pieces). A link without `&v=` is the legacy form: it replays the
original (gen 1) course that links shared before generator 2 always meant.
Opening one shows the score to beat, the next start plays that course, and the
HUD carries the target beside your score. Course generation draws from its own
seeded stream, so kills, effects and misses can never change the course. Runs
where the mercy assist has eased the course share the game link without a seed.

## Run Together

Emotes live on a dedicated button (top right, under the race strip) that opens a small tray of six; on a keyboard the keys 1-6 send them. Holding jump never opens anything.

Choose **Run Together**, then **Create a room** or **Join a room**. Joining takes
a typed room code (for example `ORD-…`, or just the words on any device) or a
pasted link; hosting shows the code, a copy button, a share link and a QR.
Press **Start Together** once friends join. Accepting an invite enters the course directly; if the host has
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
and a late joiner all line up). Spectators see them move too. An alien any
player kills disappears for everyone (the host checks each report: near the
reporter, this round, once, rate-limited). Scores, missions, chains and pickups
are still each player's own, shots are aimed at and only ever hit their own
player, and watching is a live positional view, not a frame-perfect broadcast of
the runner's combat. Cooperative objectives would need a fuller authoritative
world-event protocol.

Rooms are built for bad links (trains, cafés, planes). Each ghost plays out
through a small jitter buffer keyed on the sender's own clock, so late or bunched
packets cost a little delay, never a teleport or a rubber band; the room card
shows an honest Good/Fair/Poor with the round trip (the host sees each member's
link), presence thins out on a poor link, and a connection that dies silently
(a network switch) is replaced in seconds, back in the same seat of the same
round with the aliens it missed. Offline, the title says single player is ready
and Run Together explains why it is unavailable instead of spinning.

Version 3.16 uses room protocol 6 (every room builds the designed world-gen-2 course with
its five new aliens; see `docs/wire-protocol.md`). Version 3.8 used protocol 5 (timestamped, quantized presence and a link
probe). Version 3.6 used room protocol 4 because
aliens are now shared (round-clock motion and shared kills); version 3.4 introduced protocol 3 (deep-run terrain:
the endgame ramp and DEBRIS FIELD past 2500m) and 3.3 protocol 2.
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

### Opt-in real-relay browser smoke

The separate smoke in `tests/browser/relay.test.cjs` runs the shipped page in
three isolated Chromium contexts: a desktop host, a 390×844 touch-capable
phone-sized player, and a spectator. It uses real browser WebSockets, crypto,
and relay packets, never the in-memory relay. It checks UI create/pasted-link
join, matching rosters and roles, player disconnect/reconnect, spectator reload
and session resume, shared countdown, live movement in both directions,
spectator follow without a player ghost, and host room closure.

Install the optional test-only dependencies (Node 22+), then explicitly choose
an accessible DERP relay you are permitted to use:

```sh
cd tests/browser
npm ci
npx playwright install chromium
SPACE_MAN_RELAY_HOST=your-relay.example.com npm test
```

Use a plain `hostname[:port]`, without `wss://` or `/derp`. Without
`SPACE_MAN_RELAY_HOST`, the test reports **skipped**, without loading Playwright
or contacting a relay. Normal `node --test tests/*.test.cjs` and CI remain
network-independent and need no installation. An unreachable relay **fails** an
opted-in run; it is never reported as a pass or silently replaced by a fake.

By default, an ephemeral loopback HTTP server serves this checkout. To test a
particular deployed build or PR preview instead, set
`SPACE_MAN_BASE_URL=https://preview.example.com/path/to/build/` as well. The
host's invite must point back to that same base URL. `SPACE_MAN_HEADED=1` shows
the browsers; `SPACE_MAN_CHROMIUM_PATH` optionally selects an existing Chromium
executable instead of Playwright's installed version.

The **Real relay browser smoke** Actions workflow offers the same explicit opt-in
with a required relay host and optional preview URL (once this workflow is on
the default branch). It never runs on a push or pull request, and does not deploy.

Every run uses fresh browser storage and newly generated room keys/invite.
Cleanup attempts an orderly room leave and closes the browser and server even
after failure. Diagnostics omit invite
and session secrets; no traces or screenshots are saved. Runs have a three-minute
limit and are deliberately not retried automatically against public relays.

The player reconnect is a real socket close plus Chromium offline/online
emulation while waiting at the start line; spectator resume is a page reload.
All three clients still share one machine and network. Phone sizing is **not**
physical iOS/Safari coverage, a real background/lock suspension, a cellular/Wi-Fi
handoff, camera QR scanning, or installed-PWA/update testing. Service workers are
blocked to keep this test on one build. Keep the separate-device release checks
above for those behaviors.
