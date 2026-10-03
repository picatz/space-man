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

## Star Expedition · Continuous adventure

Choose **Star Expedition** to launch directly into a continuous, seeded journey.
Runner escapes, short arena skirmishes, one-lap racing sprints and telegraphed
Guardian boss encounters flow into one another automatically. Each five-route
sector reshuffles its approaches before a boss climax; tracks and arenas vary.
There are no chapter cards, mandatory Continue buttons or recurring result menus.
Brief in-play cues introduce the next objective and controls without blocking play.

Every route is bounded, and a fall or loss still carries the journey forward.
Use Pause and **Finish expedition** whenever you want to stop. Runner records are
banked once per completed run; standalone modes keep their settings and lengths.
Route history lasts for the page session. **Expedition with friends** keeps up to
four players and four watchers in one room across every encounter. Open **Crew ·
seats & invite** from Pause to share the same invite or request a seat in the next
encounter. Late arrivals watch first; arcade vacancies get CPUs, and Guardian
fights give all four crew members a place alongside a distinct boss. A bounded
regrouping cue handles slow connections without trapping the rest of the crew.
The host owns arcade combat and the route clock; runner scores remain local.
Existing Run Together, Arena and Racing invites stay mode-locked.
[Lifecycle and encounter details](docs/star-expedition.md).

## Orbital Arena · CPU + Friends

Choose **Orbital Arena** from the title to enter a separate, opt-in
platform-fighting mode. Pulse attacks build damage and launch rivals toward the
edge of space. Double jump and dash to recover; each spacefarer has three lives.

- **Duel:** you against one CPU
- **Free-for-all:** you and three CPU rivals
- **Team up:** you and a CPU wingmate against two CPUs, with friendly fire off
- **Orbital Dock, Bloom Reactor, Ember Foundry:** three distinct, hand-authored
  layouts with their own space-inspired visual treatments
- Keyboard: A/D or arrows to move, Space/W/Up to jump, F/J to pulse,
  Shift/K to dash, Escape to pause. Existing remapped movement/jump/fire keys
  carry over. Controller: stick/D-pad, A, X, B/trigger, Menu. Touch: a floating
  stick plus Jump, Pulse and Dash; handedness, motion, mute and power preferences
  carry over

Play locally against CPUs, or open **Play with friends** to create, join or watch
an arena room. Up to four players and four spectators share authoritative combat,
lives and results. The host picks the stage, match format and team assignments;
empty fighter slots get CPUs. Share the invite link/QR or a production room code.
Preview invites use their full revision-specific links. Late arrivals watch until
the next lobby, where they can request a player seat.

The host browser runs all combat. Guests send inputs and display authoritative
snapshots, so relay latency affects guest responsiveness. Host pause or connection
loss freezes the shared match; guest menus release controls while play continues.
Same-tab reconnect keeps a seat for a short grace period. Host leave/reload ends
the room; no host migration is claimed. [Rules, limits and tests](docs/arena-online.md).

Run Together continues to be the existing shared-course runner. Leave its room
explicitly before opening Arena. Arena matches do not affect runner scores or
missions, and local CPU matches remain available offline.

The simulation lives in `src/arena.js`, with device-independent commands,
serializable state and CPU controllers using the same command interface. Its
presentation is lazy-created in `src/arena-ui.js`. See
[the foundation and next-milestone plan](docs/arena-foundation.md).

Run pure simulation/integration tests with the normal regression command below.
The additional `cd tests/browser && npm run test:arena` browser test exercises
keyboard/touch controls, matches, pause/restart, layout and returning to the
runner using local assets, without contacting a relay. Like the other browser
tests, it requires `npm ci` and Playwright Chromium; an existing Chromium can be
selected with `SPACE_MAN_CHROMIUM_PATH`.

## Star Circuit · Arcade Racing

Choose **Star Circuit** from the title for an original perspective
hoverkart race against four CPU pilots, or open **Play with friends** to create,
join or watch an encrypted race room. Race three laps on **Starlight Speedway**,
**Ember Switchback**, or **Bloom Lagoon**, with Chill, Sport and Expert CPU pace.
Carve corners, catch boost strips, manage rechargeable boost and recover from a
missed bend. Ordered checkpoints, race position, timing and results are part of
the actual simulation. Race again, switch circuits or return to the runner.

Auto-drive is on. A/D or Left/Right steer. S/Down brakes; hold it while turning
to drift, then release after a sustained corner for a short exit boost. Space/Shift boosts,
R rescues and Escape pauses. Touch and standard controllers are supported;
existing left-handed, steering remaps, mute and reduced-motion preferences carry
over. Choose Chase (default), Cockpit or Top-down using the camera button,
C key or pause/setup options. A steady horizon and reduced-motion preferences
keep the view comfortable; the minimap keeps the full circuit visible. The
lightweight WebGL renderer falls back to top-down if graphics are unavailable. Leave an existing room before switching game modes.

Friend rooms support up to four racers plus four watchers, with CPUs filling
the five-kart grid. The host owns laps, collisions and results, and pauses the
whole race when stepping away. Guests can take a local pit-stop menu. A lost
connection releases controls and reserves the seat for ten seconds, then marks
it unfinished. New arrivals watch until the next lobby. There is no host
migration or page-reload restoration. Racing does not change runner scores or missions. See [rules, controls and architecture](docs/star-circuit.md).

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

## GitHub Actions PR previews (disabled until explicitly enabled)

The **Pages and PR previews** workflow can publish the existing Pages site as
one artifact: production from tested `main` at `/`, with playable development
snapshots under `/pr/<number>/<full-head-sha>/<trusted-builder-sha>/`. The extra
builder SHA prevents a later packaging change from reusing an old build URL.
Each preview displays its PR/source identity and includes `preview-build.json`.
After deployment, GitHub Actions posts a short **Play preview** comment on each
eligible PR and updates that same bot comment when its preview changes. The
comment links one exact source/builder revision and shows the source commit.
Links also appear in the workflow's assembly summary and the site's `/pr/`
index. Summary links are prepared links until the deployment job succeeds.

This feature is **off by default**. Merging its code does not enable the custom
publisher, change repository settings, or launch the opt-in real-relay smoke.
The existing branch-based production deployment still publishes merged runtime
changes, including the service-worker migration described below.

### Activation requires a separate approval

1. Review and merge the implementation, allowing the existing production Pages
   flow to publish the worker migration. Keep the preview variable unset.
2. Open the main game on each test browser, finish its update at the title/death
   screen, and reload. An older installed root worker intercepts every navigation;
   it can serve the old production game when a preview is first opened. New
   preview code cannot fix a navigation already intercepted by that old worker.
   Do this before opening preview links; do not clear saves to force an update.
3. In repository **Settings → Pages → Build and deployment**, select **GitHub
   Actions** as the source, preserving the existing custom domain/HTTPS setup.
   Keep the `github-pages` environment restricted to trusted default-branch
   deployments. The workflow needs `pages: write` and `id-token: write` only in
   its deployment job, and `pull-requests: write` only in its post-deploy comment
   job; it needs no PAT, provider account or new stored secret.
4. Set repository Actions variable `SPACE_MAN_PREVIEWS_ENABLED` to exactly `true`
   and manually run **Pages and PR previews** from `main`. These settings and the
   first deployment are explicit activation steps, not part of preparing a PR.
5. Verify production, `/pr/`, one preview, and a same-preview invitation in two
   browsers. The real-relay smoke can then be launched separately with an
   authorized relay host and the exact preview URL as `base_url`.

### Trust, isolation, and lifecycle

- Only open PRs authored by `picatz`, targeting `main`, with a head in
  `picatz/space-man` are eligible. Forks and other authors are not auto-published.
  Previews execute JavaScript on the production **origin**. Namespaced storage
  prevents accidental collisions, not hostile access; arbitrary contributor
  previews need a separate origin instead of loosening this filter.
- The trusted workflow reconciles all eligible current heads. Each exact head
  and production commit is tested on a separate read-only runner. A fresh runner
  uses the trusted default-branch static packager; no PR build script, artifact,
  test output, secret, shared cache, or write-token job executes PR code.
  Assembly uses GitHub's job conclusions for this exact run/attempt. If retrying
  a partial failure, use **Re-run all jobs**, not just failed jobs.
- A failing or incompatible PR is omitted without blocking other passing
  previews. Production tests must pass. If `main` changes during verification,
  the run preserves the live site and waits for the queued reconciliation.
  The Pages write-token job runs only the official Pages deploy action, with no
  checkout or repository script execution. A separate comment job checks out
  the exact trusted default-branch revision and receives only contents-read and
  PR-comment-write access. It accepts the trusted assembly manifest, checks the
  publicly deployed manifest and each preview's build metadata, and rechecks
  the open PR's author, repository, target and full head SHA immediately before
  posting. It only updates comments bearing its marker and authored by
  `github-actions[bot]`; human comments are left alone. A short, bounded retry
  window tolerates Pages propagation. Failed/stale checks never post a link.
- The shared Pages deployment belongs to `main`, so GitHub's branch deployment
  panel may show no deployment for a PR branch. The bot's verified **Play preview**
  comment is the PR entry point. A failed/omitted preview does not update its
  previous comment; the visible source SHA identifies the old revision, whose
  URL can expire on the next publication.
- Publishing is serialized and always includes the full current live set.
  Superseded, closed, failing, or incompatible snapshots may be removed at the
  next publication; these links are revision-specific, not permanent archives.
  Closing a PR alone does not trigger publication. The next push, PR test
  completion, or manual run cleans it up. A retired URL is never reassigned to
  a newer revision. Each static build is capped at 20 MiB and the complete site
  at 200 MiB; temporary Pages artifacts retain for one day.
- Previews are online-only, do not install a service worker/PWA, and keep saves,
  settings, relay-directory cache, and room-resume state separate by both SHAs.
  The updated production worker bypasses `/pr` and `/pr/` and cleans only its
  own scoped caches plus legacy game caches.
- Use the full invite link or its QR to play together. Preview hosts do not
  publish room codes, since codes carry no build identity. Pasted full links
  are checked against the current preview before their payload is parsed.
  This does not change protocol 6 or provide new server-side build negotiation.
  Relay connectivity still needs a successful live smoke; hosting a preview
  alone is not evidence that a public relay accepts the connection.

### Verification

`node --test tests/*.test.cjs` includes packaging, trust filters, exact-SHA job
outcomes, bot-comment ownership/idempotency and deployed metadata checks,
storage/invite isolation, and simulated service-worker regression
checks. The **Regression tests** workflow also runs a localhost-only Chromium
check for production/preview navigation, caches and separate saves. It does not
contact a relay. To run that browser check explicitly:

```sh
cd tests/browser
npm ci
npx playwright install chromium
npm run test:previews
```

GitHub Pages remains the only host. Standard public-repository Actions runner
minutes are free; normal Pages and artifact-storage limits still apply. No paid
runner, provider subscription, or billing setting is added by this workflow.

## Shared visual language

`src/space-theme.css` is the shared chrome layer, using Orbital Arena's dark
panels, warm action buttons, compact labels and body-copy hierarchy as the
reference. The launcher names all three modes. Mode art, gameplay canvases,
input handlers and safe-area calculations stay local to each mode.

Run `node --test tests/*.test.cjs` for regressions. In `tests/browser`, run
`node --test theme.test.cjs` after installing Playwright. Set
`SPACE_MAN_THEME_BROWSER=webkit` for WebKit and `SPACE_MAN_THEME_SCREENSHOTS`
to retain real screenshots. Optional `SPACE_MAN_THEME_BASE_ROOT` points at an
older checkout for before screenshots. The dedicated workflow checks 320px
phones, browser-sized phone viewports, landscape, tablet and desktop, including
keyboard/controller focus styling, persisted settings and cross-mode return.
