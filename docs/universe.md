# The Space Man universe: vision and roadmap

Space Man should be one place, the Lantern Reach, that you can play many ways:
run it, brawl in it, race through it, out-think a friend across it, and one day
explore it. This file is the plan for growing past three modes without becoming
a pile of demos. It is opinionated on purpose. `docs/art-direction.md` stays the
contract for how things look and who lives here; this file decides what we
build next and what every new mode must stand on.

## What we learned before choosing

Market notes (October 2026) are in the project files at
`universe/market-research.md`, with sources. The parts that change our plans:

- **Instant play wins on the web.** Poki reports about 100M monthly players.
  Its best games load in under 3 seconds and hold 11 to 20 minute sessions, and
  accounts and long onboarding hurt retention
  ([PocketGamer.biz](https://www.pocketgamer.biz/inside-pokis-vision-for-the-future-of-browser-games/)).
  Space Man already has no account, no install and join by QR. Keep it that way.
- **Phone-as-controller party play is proven, and it is not free.** AirConsole
  joins by code ([AirConsole](https://www.airconsole.com/info)). Jackbox is moving to
  "any device" play in 2026
  ([Player2](https://www.player2.net.au/2025/10/jackbox-is-back-pax-aus-2025-interview-mike-bilder-and-allard-laban/)).
  A free, ad-free, encrypted party set that runs on whatever is in the room is a
  real gap. Jackbox's lessons apply: low performance pressure, players supply the
  content, a broad age range.
- **Collecting and cards have huge demand, and the money model is the problem.**
  Pokémon TCG Pocket passed $1B in about 200 days on gacha
  ([PocketGamer.biz](https://www.pocketgamer.biz/pokmon-tcg-pocket-surpasses-1bn-in-just-over-200-days/)).
  Balatro sold 3.5M+ as a premium solo game
  ([PocketGamer.biz](https://www.pocketgamer.biz/balatro-has-sold-over-35-million-copies)).
  Palworld reached 32M+ players
  ([VGC](https://www.videogameschronicle.com/news/over-32-million-players-have-played-palworld-in-its-first-year-developer-says)).
  We sell nothing, so our collection has to be earned by play and be fun to
  look at, not a slot machine.
- **Chess is crowded.** Chess.com has 250M+ members. A chess clone has no reason
  to exist here; an original asymmetric board game might.
- **Habits come from days, not features.** A daily shared seed with a
  spoiler-free result to paste in a chat is cheap and proven. Our runs and
  circuits are already seeded.

## The bar every mode clears

A mode ships when all of these are true, not when it runs:

1. **One sentence of fun.** Lantern Lines: "keep three lanterns lit, the oldest
   goes dark, make a line before your rival does." If it takes two sentences,
   cut a rule.
2. **First turn in under ten seconds** from the home card, without reading.
   Rules are drawn, not written: three picture cards at most.
3. **Every device, every input.** Touch, mouse, keyboard and a gamepad act on
   the same controls; screen readers hear every state change; reduced motion
   keeps the rules and drops the wobble.
4. **Solo and together.** A CPU rival from the named crew, and a Play Together
   room joined by code or QR with watchers welcome.
5. **One universe.** It lives in a region from the art guide, uses the shared
   Spacefarer rig, crew, FX kit and type, and a still frame could not be
   mistaken for another studio's game.
6. **Guarded by tests.** Rules as pure unit tests, rooms over the real encrypted
   relay, the screen in a browser test, and its lobby and match in `layout-qa`.

## Modes

Status: **shipped**, **next** (has a design and a slot), **design** (waits for
Kent to pick it).

### Lantern Lines (shipped): two-pilot duel of wits

Prism region. A 3x3 star chart. Each pilot keeps at most three lanterns lit;
lighting a fourth lets your oldest go dark, and it flickers the turn before so
you can plan around it. Three of yours in a line wins the round; first to two
takes the chart, and the loser of a round lights first next round.

Why it works: classic noughts and crosses dies in a draw. Here no board ever
fills, every move also schedules a loss, and the flicker turns that into a
readable threat. In 30 games of Hard against Hard, 28 ended in a line rather
than a stalemate, so the game is not solved at the top level.

Next for it: a **Daily Chart** (one seeded mid-game position, "light a line in
three", a result grid to share), and a **Comet** variant on 4x4 where a comet
crosses one row each round and snuffs what it touches.

### Daily across the Reach (next): one seed a day for every mode

Endless Run already has a Daily Course. Extend it to one daily card per mode
(a run seed, a circuit and ghost, a chart puzzle), a streak in Records, and a
copyable result like `Space Man 10/30 ✦ Run 4,210 · Circuit 1:12.4 · Chart ✓✓·`.
Small effort, the strongest retention evidence, and it sends players into
every mode.

### Dock Night (next): party pack for 2 to 8 on one screen plus phones

Host screen shows the game; phones are controllers in the same Play Together
room. Rounds are 60 to 90 seconds, nobody is eliminated for long, scores are
silly. Three to start, all original:

- **Flare Drift:** everyone steers a little hoverpod across the host screen while
  Old Flare's rings sweep outward; brush past friends to nudge them.
- **Lantern Relay:** the room builds one long chain of lanterns, each phone
  adding the next colour in the pattern before its light runs out.
- **Cargo Count:** crates tumble past the dock window; everyone guesses how many
  of their colour went by. Closest wins, wildly wrong guesses get a cheer.

Needs: a host-screen layout, a phone controller surface, a party round loop on
top of the room layer.

### Starlings (design): exploring the Reach and befriending its light

The large dream, and the one most likely to become a clone if rushed, so it
stays on paper until Kent picks it. Original pillars:

- **Starlings** are small creatures of light shed by Old Flare's flares. Each
  region's light shapes them: Bloom Starlings grow leaves, Ember ones crackle,
  Prism ones refract. They are not caught or owned. You **befriend** one by
  answering its light pattern in a short rhythm and pattern puzzle, and it
  chooses to ride in your lantern.
- **Exploration** is a hoverpod flight over a seeded hex star map of the seven
  regions, with Guardians at the gates, crew to meet and secrets per season.
- **Glow duels** reuse the tabletop board kit: Starlings take stars on a chart,
  and lines of matching light trigger their abilities. One rules engine, two
  modes, and every Lantern Lines player already knows the board.
- **The codex** fills from every mode: a Starling might appear in a run, an
  arena or a circuit, which gives the whole game a collection loop without
  selling anything.

Staged plan: codex and three Starlings that appear in existing modes, then the
befriending puzzle, then glow duels, then the explorable map.

### Star Charts (design): a solo roguelike voyage of cards

Each card is a leg of a voyage (a jump, a refuel, a Guardian, a market of
salvage). You plot a route through a seeded sector by playing cards, the
Reach's hazards push back, and a daily seed lets everyone race the same
sector. Solo first; a two-pilot draft later on the table room.

### Guardian Gambit (design): an asymmetric board game

One player is a lone Guardian with a few powerful moves; up to three
Spacefarers try to slip past it to the gate. Original, short, great with
watchers. Built on the board kit and table rooms.

### Hold the Dock (design): co-op waves in Arena

Two to four pilots defend the dock against drifting debris and a Guardian,
reusing Arena physics and items. Highest reuse of a realtime mode, but its
netcode load is the risk.

## Shared building blocks

| Block | Where | Status |
|---|---|---|
| Mode registry: names, regions, seats, wire mode, buttons | `src/modes.js` (`SpaceManModes`) | shipped |
| Turn-based kit: grid and lines, game registry, negamax CPU, best-of-N match reducer, validated match bytes | `src/tabletop.js` (`SpaceManTabletop`) | shipped |
| Table rooms: host-owned matches for any tabletop game, seats, watchers, rematch | `src/table-room.js`, wire mode 4, frame `0x44` | shipped |
| Realtime fixed-step loop and netcode | `src/arena*.js`, `src/race*.js`, `src/net.js` | shipped (per mode) |
| Spacefarer rig, crew, regions, seasons, FX | `src/art.js`, `src/fx.js`, `src/seasons.js` | shipped |
| Room invite card, QR scan, join by code | `src/room-invite.js`, `src/qr*.js` | shipped |
| Spectating | arena watch, race strip; tabletop watchers see the board | partial (thread "Build spectating for every mode") |
| Daily seeds and shareable results | runner only | next |
| Progression: logbook, cosmetics rewards, codex | `SpaceManLogbook`, `src/cosmetics.js` | partial; codex is design |
| Host screen + phone controller surfaces | none | next (Dock Night) |
| Mode shell: lobby, pause menu, results, input routing shared by every overlay | each mode builds its own | next; extract from Lantern Lines and Arena once a third mode needs it |

Rule of thumb: build a block when the second mode needs it, not before, and
put it where the third mode will find it.

## The harness that keeps quality up

Agents ship most of this game, so the guard rails are part of the product:

- **Rules are pure and tested first.** A game is data in, data out. CPU
  self-play tests catch a broken AI or a solved game before a player does.
- **Rooms run over the real relay in tests.** `tests/table-room.test.cjs` plays a
  whole match host to guest through the encrypted harness relay.
- **Layout QA** opens every screen, Lantern Lines included, at phone, tablet and
  laptop sizes (`tests/browser/layout-qa.test.cjs`).
- **Screenshot review.** Every UI change ships phone, tablet and desktop
  screenshots; a separate reviewer (Fable) critiques art and the game loop
  against `docs/art-direction.md` before merge, and must-fix items land in the
  same PR.
- **Lessons go into CLAUDE.md** ("Adding a mode"), so the next agent does not
  relearn them.

## Roadmap

1. Lantern Lines (this release): the tabletop kit, table rooms and registry.
2. Daily across the Reach, starting with the Daily Chart.
3. Dock Night with three party games, plus the shared mode shell.
4. Kent picks the large one: Starlings, Star Charts or Hold the Dock. Starlings
   is the recommendation because it ties every mode together, but it starts as a
   codex inside the existing modes, not as a new world.
