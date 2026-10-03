/* Star Expedition: deterministic continuous encounters, independent of transport.
 * A token binds each result to one encounter; route history stays bounded. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpaceManExpedition = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const bounded = (v, max) => Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;
  function mix(seed, n) {
    let x = ((seed >>> 0) ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad); x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return (x ^ (x >>> 15)) >>> 0;
  }
  // Five-encounter sectors have a climax, but their approaches are remixed.
  // Neighbouring encounters never repeat a control scheme, including sectors.
  const routes = Object.freeze([
    ['runner', 'arena', 'race', 'runner'], ['runner', 'race', 'arena', 'runner'],
    ['race', 'arena', 'runner', 'race'], ['race', 'runner', 'arena', 'race'],
    ['runner', 'arena', 'runner', 'race'], ['race', 'arena', 'race', 'runner'],
  ].map(Object.freeze));
  const arenas = ['orbital-dock', 'bloom-reactor', 'ember-foundry'];
  const arenaNames = ['Orbital Dock', 'Bloom Reactor', 'Ember Foundry'];
  const tracks = ['starlight', 'bloom', 'ember'];
  const trackNames = ['Starlight Speedway', 'Bloom Circuit', 'Ember Ring'];
  function encounterAt(seed, index = 0) {
    index = bounded(index, 1000000);
    const sector = Math.floor(index / 5), slot = index % 5, roll = mix(seed, index + 7919);
    const id = slot === 4 ? 'arena' : routes[mix(seed, sector) % routes.length][slot];
    const common = { id, index, sector: sector + 1, seed: mix(seed, index), countdownTicks: 60 };
    if (id === 'runner') {
      const goal = [260, 340, 420][roll % 3];
      return { ...common, kind: 'escape', name: ['Flare escape', 'Comet crossing', 'Rift run'][roll % 3], destination: ['THE OUTER RIM', 'COMET BELT', 'STARFALL REACH'][roll % 3], goal, maxTicks: 2400,
        cue: 'Reach ' + goal + 'm · Your shuttle catches every fall', controls: 'Move + jump · A/D + Space · F fires' };
    }
    if (id === 'race') {
      const track = (sector + (roll % 3)) % 3;
      return { ...common, kind: 'sprint', name: ['Starlight sprint', 'Bloom rush', 'Ember chase'][track], destination: trackNames[track].toUpperCase(), trackId: tracks[track], laps: 1, maxTicks: 5400, difficulty: 'easy',
        cue: 'One lap · Steer, boost and keep your momentum', controls: 'Auto-drive · A/D steer · Space boosts · S brakes' };
    }
    const stage = (sector + (roll % 3)) % 3, boss = slot === 4;
    return { ...common, kind: boss ? 'boss' : 'skirmish', encounter: boss ? 'boss' : 'skirmish', name: boss ? ['Sentinel breach', 'Reactor guardian', 'Furnace titan'][stage] : ['Dock skirmish', 'Reactor rumble', 'Foundry clash'][stage], destination: arenaNames[stage].toUpperCase(), arenaId: arenas[stage], format: boss || (roll & 1) ? 'teams' : 'duel', difficulty: 'easy', stocks: 2, bossTier: 1 + Math.min(2, Math.floor(sector / 2)), wingmate: true, durationTicks: boss ? 3300 : 2100,
      cue: boss ? 'Boss ahead · Dodge the warning, strike the opening' : 'Clear a path · Pulse rivals away from the route', controls: 'Move + double jump · F pulse · Shift dash' };
  }
  function result(id, data = {}) {
    if (id === 'runner') return { id, reached: data.reached === true, distance: bounded(data.distance, 60000), score: bounded(data.score, 9999999) };
    if (id === 'arena') return { id, won: data.won === true, tie: data.tie === true, kos: bounded(data.kos, 99), stocks: bounded(data.stocks, 3) };
    return { id, position: Math.max(1, bounded(data.position, 6)), finished: data.finished === true, time: Number.isFinite(data.time) && data.time >= 0 ? Math.min(data.time, 3600) : null };
  }
  function create(seed = 1) {
    seed >>>= 0;
    let index = 0, phase = 'ready', token = 0, records = [], completed = 0;
    const current = () => ({ ...encounterAt(seed, index), token });
    const snapshot = () => ({ version: 2, seed, index, phase, token, completed, current: current(), records: records.map(r => ({ ...r })) });
    return Object.freeze({
      snapshot,
      begin() { if (phase !== 'ready') return null; phase = 'playing'; token++; return current(); },
      finish(id, legToken, data) {
        if (phase !== 'playing' || current().id !== id || legToken !== token) return false;
        records.push({ ...result(id, data), kind: current().kind, index, name: current().name });
        if (records.length > 20) records.shift();
        completed++; phase = 'transition'; return true;
      },
      advance() { if (phase !== 'transition') return false; index++; phase = 'ready'; return true; },
      cancel() { if (phase === 'cancelled') return false; phase = 'cancelled'; token++; return true; },
    });
  }
  return Object.freeze({ create, encounterAt, routes });
});

