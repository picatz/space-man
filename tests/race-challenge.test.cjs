// Star Circuit challenge links: a friend's time on a circuit and pace, shared
// as #circuit=…&pace=…&beat=<centiseconds>[&by=<adj>.<noun>].
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load() {
  const window = { console };
  window.window = window;
  vm.createContext(window);
  for (const file of ["math.js", "race.js", "race-ui.js"])
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), window, { filename: file });
  return window;
}

test("a challenge link round-trips circuit, pace, time and sender", () => {
  const w = load(), UI = w.SpaceManRaceUI, track = w.SpaceManRace.tracks[3].id;
  const link = UI.challengeLink("https://example.test/play/#old", { trackId: track, difficulty: "hard", time: 102.314, by: [4, 17] });
  assert.equal(link, `https://example.test/play/#circuit=${track}&pace=hard&beat=10231&by=4.17`);
  assert.deepEqual(JSON.parse(JSON.stringify(UI.parseChallenge(link.slice(link.indexOf("#"))))), { trackId: track, difficulty: "hard", time: 102.31, by: [4, 17] });
  const anonymous = UI.parseChallenge(`#circuit=${track}&pace=easy&beat=9000`);
  assert.equal(anonymous.by, null);
});

test("malformed challenge links are ignored", () => {
  const w = load(), UI = w.SpaceManRaceUI, track = w.SpaceManRace.tracks[0].id;
  for (const hash of [
    "", "#circuit=", `#circuit=nowhere&pace=easy&beat=9000`, `#circuit=${track}&pace=turbo&beat=9000`,
    `#circuit=${track}&pace=easy`, `#circuit=${track}&pace=easy&beat=12`, `#circuit=${track}&pace=easy&beat=999999`,
    `#circuit=${track}&pace=easy&beat=9e3`, `#circuit=${track}&pace=easy&beat=-9000`,
  ]) assert.equal(UI.parseChallenge(hash), null, hash);
  assert.equal(UI.parseChallenge(`#circuit=${track}&pace=easy&beat=9000&by=<b>`).by, null, "a sender is callsign indexes, never text");
});
