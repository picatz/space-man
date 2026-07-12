/* Space Man v3 data contracts. Classic script on purpose: the PWA still works
   when opened directly from disk, while the game remains dependency-free. */
(function () {
  'use strict';
  const sectors = [
    { id: 'orbital-dawn', name: 'ORBITAL DAWN', from: 0, hue: 218, motif: 'dawn', traits: ['wide'] },
    { id: 'ion-drift', name: 'ION DRIFT', from: 300, hue: 232, motif: 'ion', traits: ['boosts'] },
    { id: 'violet-reach', name: 'VIOLET REACH', from: 600, hue: 250, motif: 'violet', traits: ['shards'] },
    { id: 'night-bloom', name: 'NIGHT BLOOM', from: 900, hue: 268, motif: 'bloom', traits: ['meteors'] },
    { id: 'red-shift', name: 'RED SHIFT', from: 1200, hue: 286, motif: 'red', traits: ['guardians'] },
    { id: 'event-horizon', name: 'EVENT HORIZON', from: 1600, hue: 312, motif: 'horizon', traits: ['narrow'] },
    { id: 'the-far-side', name: 'THE FAR SIDE', from: 2000, hue: 340, motif: 'far', traits: ['meteors', 'guardians'] },
    { id: 'last-light', name: 'LAST LIGHT', from: 2500, hue: 356, motif: 'last-light', traits: ['all'] },
  ];
  const encounters = [
    { id: 'meteor-run', kind: 'meteor', from: 450, cooldown: 520, label: 'METEOR RUN', reward: 80 },
    { id: 'rescue-beacon', kind: 'rescue', from: 700, cooldown: 640, label: 'RESCUE BEACON', reward: 120 },
    { id: 'guardian-gate', kind: 'guardian', from: 1050, cooldown: 900, label: 'GUARDIAN GATE', reward: 180 },
  ];
  function sectorFor(distance) {
    let result = sectors[0];
    for (const sector of sectors) if (distance >= sector.from) result = sector;
    return result;
  }
  function encounterFor(distance, band, rng) {
    for (const encounter of encounters) {
      if (distance < encounter.from || distance > encounter.from + 75) continue;
      if ((rng() + band * 0.03) < 0.84) return Object.assign({}, encounter);
    }
    return null;
  }
  window.SpaceManContracts = { sectors, encounters, sectorFor, encounterFor };
})();
