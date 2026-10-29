# Space Man: notes for agents

Arcade space PWA (Endless Run, Orbital Arena, Star Circuit, online rooms). No build step, no bundler,
no runtime dependencies: `index.html` loads `src/*.js` as plain `<script>` tags in order, and
`service-worker.js` precaches the shell. Read `README.md` for features and `docs/` for design notes
(`docs/wire-protocol.md` is the authoritative netcode spec, `docs/art-direction.md` the art, lore and
style contract every mode and screen follows). Audit findings live in the project
files under `audit/`, not in this repo.

## Run it

```sh
python3 -m http.server 8080   # then open http://localhost:8080/
```

Any static server works. Relays are optional; most flows are testable without one.

## Tests

Two layers, both on built-in `node:test` (Node 22).

**Unit and protocol tests** (`tests/*.test.cjs`, no install needed, about 100 s for all of them):

```sh
node --test tests/*.test.cjs            # everything
node --test tests/arena.test.cjs        # one file
```

`tests/harness.cjs` loads every `src/` module into a `vm` sandbox in `index.html` script order, with
fake DOM, timers and a simulated relay hub. Only browser APIs and the relay transport are faked; the
encrypted wire protocol is real. `tests/netbench.cjs` shapes latency, loss and reordering per client.

**Browser tests** (`tests/browser/*.test.cjs`, Playwright with a real browser):

```sh
cd tests/browser && npm ci
npx playwright install --with-deps chromium     # or webkit
node --test home.test.cjs                       # starts its own static server on a random port
```

- If a Chromium is already installed, skip the download and point at it:
  `SPACE_MAN_CHROMIUM_PATH=$(command -v chromium)`. In the cloud agent container Chromium is
  preinstalled at `/opt/pw-browsers/chromium`; do not run `playwright install` there.
- WebKit runs are selected per suite: `SPACE_MAN_HOME_BROWSER=webkit`, `SPACE_MAN_ARENA_BROWSER=webkit`,
  `SPACE_MAN_RACE_BROWSER=webkit`, `SPACE_MAN_SECONDARY_BROWSER=webkit`, etc. Needs
  `npx playwright install --with-deps webkit`.
- `SPACE_MAN_BASE_URL` tests an already-running deployment instead of the local server.
- `SPACE_MAN_*_SCREENSHOTS=<dir>` writes review screenshots. `SPACE_MAN_HEADED=1` shows the browser.
- `package.json` scripts cover only some suites (`test:previews`, `test:arena`, `test:arena-online`,
  `test:arena-relay`); run the rest with `node --test <file>`.
- CI runs every browser suite from one matrix, `.github/workflows/browser.yml`, which calls
  `tests/browser/ci-suite.sh <suite>` (the source of truth for which files run in each suite and
  per-engine skips). Locally: `cd tests/browser && SPACE_MAN_ENGINE=chromium ./ci-suite.sh home`.
  To add a suite, add a case to that script and its name to the matrix.

Browser suites are slow and timing-sensitive. Run only the suites for the area you changed, and rerun a
failing one once before assuming a real regression, but never skip or loosen a test to get green.

## Conventions

- Plain browser JavaScript (global-scope modules, no import/export, no TypeScript, no npm packages in
  the game itself). Tests are CommonJS `.cjs`. Match the surrounding style and comment density.
- **Adding or renaming a `src/` file:** add the `<script src>` to `index.html` (order matters) and the
  path to `SHELL` in `service-worker.js`. `tests/platform.test.cjs` enforces both and the harness reads
  load order from the page.
- **Any change to a shipped asset:** bump `VERSION` in `service-worker.js` in the same commit, or
  installed clients keep the old build.
- **Wire format changes** need a protocol version consideration and an update to
  `docs/wire-protocol.md`; keep old-client compatibility in mind (shared invites and sessions persist).
- The simulation is fixed-step and must be identical at any frame rate. Keep gameplay logic out of
  the render path and deterministic (seeded) where it is shared between peers.
- No external requests at runtime (the home tests assert this). No currencies, ads or purchases.
- Accessibility is a feature: keyboard and gamepad parity, screen-reader announcements for toasts,
  no text under 9 px, respect reduced motion.
- Prefer a test that fails first. New behavior gets a `tests/*.test.cjs` case; UI-only behavior gets
  a browser test.

## Git and PRs

Work on a feature branch, open a PR against `main`, and wait for CI and the AI review to finish before
merging. A PR runs `tests.yml` (unit tests plus preview and Arena browser checks) and `browser.yml`
(28 suite/engine jobs); expect several minutes. Opt-in live-relay and deployed-preview checks are
separate label- or dispatch-triggered workflows.
