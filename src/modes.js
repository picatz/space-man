/* Space Man · mode registry
   One catalog of every game in the Lantern Reach: its name, the region it is
   set in (SpaceManArt.REGIONS), how it plays and which buttons open it. The
   launcher, Play Together hub and tests read this list, so a new mode is one
   entry here plus its own files; tests/modes.test.cjs reports what a new entry
   still needs (home card, hub pick, room wire mode, docs). */
(function (root) {
  'use strict';
  // loop: 'realtime' (fixed-step simulation), 'turns' (SpaceManTabletop) or 'rhythm' (timed echoes, SpaceManStarling).
  // host: the Play Together pick, or null for a solo-only mode.
  // wire: the transport mode a Play Together room opens with (src/net.js).
  // seats: [min, max] pilots in one match; watchers are extra.
  const LIST = Object.freeze([
    { id: 'run', name: 'Endless Run', caption: 'Outrun the flare', region: 'orbital', loop: 'realtime', seats: [1, 32], solo: true, local: false, online: true, wire: 'runner', home: 'btnPlay', host: 'btnCreateRoom' },
    { id: 'arena', name: 'Orbital Arena', caption: 'Bump, dodge, KO.', region: 'orbital', loop: 'realtime', seats: [2, 4], solo: true, local: true, online: true, wire: 'arena', home: 'btnArena', host: 'btnHostArena' },
    { id: 'race', name: 'Star Circuit', caption: 'Catch a boost', region: 'orbital', loop: 'realtime', seats: [1, 4], solo: true, local: false, online: true, wire: 'race', home: 'btnRace', host: 'btnHostRace' },
    { id: 'lanterns', name: 'Constellations', caption: 'Connect three stars', region: 'prism', loop: 'turns', seats: [2, 2], solo: true, local: true, online: true, wire: 'table', game: 'lanterns', home: 'btnLanterns', host: 'btnHostLanterns' },
    { id: 'starlings', name: 'Starlings', caption: 'Echo the light', region: 'bloom', loop: 'rhythm', seats: [1, 1], solo: true, local: false, online: false, wire: null, home: 'btnStarlings', host: null },
  ].map(Object.freeze));
  const byId = new Map(LIST.map(m => [m.id, m]));
  const api = Object.freeze({
    /** Every registered mode, in launcher order. */
    list: () => LIST,
    /** The mode with this id, or null. */
    get: id => byId.get(id) || null,
    /** The mode a Play Together room of this wire mode (and tabletop game id) belongs to. */
    forWire: (wire, game) => LIST.find(m => !!wire && m.wire === wire && (!m.game || !game || m.game === game)) || null,
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpaceManModes = api;
})(typeof window !== 'undefined' ? window : globalThis);
