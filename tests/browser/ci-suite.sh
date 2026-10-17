#!/usr/bin/env bash
# Runs one browser CI suite: ci-suite.sh <suite>. The engine comes from
# SPACE_MAN_ENGINE (chromium|webkit) and screenshots/traces go to $SHOTS.
# Used by .github/workflows/browser.yml; runnable locally from tests/browser
# (SPACE_MAN_ENGINE=chromium SHOTS=/tmp/shots ./ci-suite.sh home).
set -euo pipefail
suite=${1:?usage: ci-suite.sh <suite>}
engine=${SPACE_MAN_ENGINE:?SPACE_MAN_ENGINE must be chromium or webkit}
SHOTS=${SHOTS:-$(mktemp -d)}
mkdir -p "$SHOTS"
# Every suite selects its engine through its own variable; set them all.
for v in ARENA ART COSMETICS PAUSE EXPEDITION HOME SECONDARY JOURNEY IDENTITY RACE THEME; do
  export "SPACE_MAN_${v}_BROWSER=$engine"
done
# Screenshot and trace directories also differ per suite.
for v in ARENA ART COSMETICS PAUSE EXPEDITION HOME SECONDARY JOURNEY IDENTITY RACE_IDENTITY RACE THEME RACE_TRACES; do
  export "SPACE_MAN_${v}_SCREENSHOTS=$SHOTS" 2>/dev/null || true
done
export SPACE_MAN_RACE_TRACES=$SHOTS

# Arena regressions shared by suites that guard the input layer. WebKit skips
# the cases that need Chromium-only CDP multi-touch.
arena_all() {
  if [ "$engine" = webkit ]; then
    node --test --test-skip-pattern='^(arena phone:|arena touch recovers|arena native touch)' arena.test.cjs
  else
    node --test arena.test.cjs
  fi
}

case "$suite" in
  action-buffer) node --test arena-action-buffer.test.cjs ;;
  characters)
    node --test character-art.test.cjs
    if [ "$engine" = webkit ]; then
      # Three native multi-touch cases use Chromium-only CDP; the shared-art
      # run above also exercises real phone taps.
      node --test --test-name-pattern='^(arena desktop:|arena browser gamepad|arena mobile setup|arena mobile pointer|arena desktop focus)' arena.test.cjs
    else
      node --test arena.test.cjs
    fi ;;
  cosmetics) node --test cosmetics.test.cjs runner-pause.test.cjs ;;
  expedition) node --test expedition.test.cjs ;;
  home) node --test home.test.cjs home-shell.test.cjs secondary-surfaces.test.cjs ;;
  identity) node --test player-identity.test.cjs race-identity.test.cjs runner-identity.test.cjs ;;
  invite-qr) node --test journey-qr-pixels.test.cjs journey-qr.test.cjs ;;
  journey) node --test journey.test.cjs ;;
  perspective)
    node --test race-perspective.test.cjs
    node --test race.test.cjs ;;
  prism)
    export SPACE_MAN_RACE_COURSE=prism
    node --test --test-name-pattern='art evidence|frame pacing|perspective gameplay' race-perspective.test.cjs
    node --test race-online.test.cjs ;;
  racing-browser)
    node --test race.test.cjs
    node --test race-handling-audio.test.cjs ;;
  simulated-relay)
    node --test race-online.test.cjs
    node --test race-live.test.cjs ;;
  track-features) node --test starlight-features.test.cjs ;;
  theme-browser)
    # Before/after screenshots compare against the base checkout when present.
    rc=0
    node --test theme.test.cjs || rc=$?
    arena_all || rc=$?
    exit $rc ;;
  *) echo "unknown suite: $suite" >&2; exit 2 ;;
esac
