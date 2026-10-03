/* Star Expedition: a local itinerary, independent of simulation and transport.
 * A leg token makes repeated or late completion callbacks harmless. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpaceManExpedition = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const legs = Object.freeze([
    Object.freeze({ id: 'runner', name: 'Flare escape', action: 'Begin the escape', destination: 'THE OUTER RIM', goal: 400, maxTicks: 3600,
      briefing: 'Reach the 400m rendezvous. If the flare catches you, your rescue shuttle still carries you onward.',
      controls: 'Move and jump across the gaps. Touch: left side steers, right side jumps. Keyboard: A/D, Space; F fires. Controller: stick, A, X.' }),
    Object.freeze({ id: 'arena', name: 'Orbital showdown', action: 'Enter the arena', destination: 'ORBITAL DOCK',
      briefing: 'Your route runs through Orbital Dock. Face one Cadet CPU in a three-life duel. Win or lose, your kart is waiting.',
      controls: 'Move, double jump, pulse and dash. Keyboard: A/D, Space, F, Shift. Controller: stick, A, X, B. Touch: stick and the labeled buttons.' }),
    Object.freeze({ id: 'race', name: 'The home stretch', action: 'Race for home', destination: 'STARLIGHT SPEEDWAY',
      briefing: 'One lap to bring it home. Four Chill CPU pilots join you at Starlight Speedway. Every finish has a place in your story.',
      controls: 'Auto-drive is on. Steer and catch boosts. Keyboard: A/D steer, Space boosts, S brakes, R rescues. Touch: arrow and boost buttons. C changes camera.' }),
  ]);
  const bounded = (v, max) => Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;
  function result(id, data = {}) {
    if (id === 'runner') return { id, reached: data.reached === true, distance: bounded(data.distance, 60000), score: bounded(data.score, 9999999) };
    if (id === 'arena') return { id, won: data.won === true, tie: data.tie === true, kos: bounded(data.kos, 99), stocks: bounded(data.stocks, 3) };
    return { id, position: Math.max(1, bounded(data.position, 5)), finished: data.finished === true, time: Number.isFinite(data.time) && data.time >= 0 ? Math.min(data.time, 3600) : null };
  }
  function create(seed = 1) {
    let index = 0, phase = 'briefing', token = 0, records = [];
    const snapshot = () => ({ version: 1, seed: seed >>> 0, index, phase, token, records: records.map(r => ({ ...r })) });
    return Object.freeze({
      snapshot,
      begin() {
        if (phase !== 'briefing') return null;
        phase = 'playing'; token++;
        return { ...legs[index], token, seed: seed >>> 0 };
      },
      finish(id, legToken, data) {
        if (phase !== 'playing' || legs[index].id !== id || legToken !== token) return false;
        records.push(result(id, data)); phase = index === legs.length - 1 ? 'complete' : 'debrief'; return true;
      },
      advance() {
        if (phase !== 'debrief') return false;
        index++; phase = 'briefing'; return true;
      },
      cancel() { if (phase === 'cancelled') return false; phase = 'cancelled'; token++; return true; },
    });
  }
  return Object.freeze({ create, legs });
});
