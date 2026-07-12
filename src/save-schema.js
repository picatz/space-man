/* Versioned persistence boundary. The gameplay file can evolve without
   scattering localStorage migrations through UI and physics code. */
(function () {
  'use strict';
  const VERSION = 3;
  function migrate(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const settings = Object.assign({ music: true, sfx: true, haptics: true, shake: true, lefty: false }, input.settings || {});
    if (input.settings && input.settings.sound !== undefined) {
      settings.music = !!input.settings.sound; settings.sfx = !!input.settings.sound;
    }
    return {
      version: VERSION,
      settings,
      discoveries: Array.isArray(input.discoveries) ? input.discoveries.slice(0, 64) : [],
      cosmetics: Object.assign({ companion: 'default', patches: [] }, input.cosmetics || {}),
      achievements: Object.assign({}, input.achievements || {}),
    };
  }
  window.SpaceManSave = { VERSION, migrate };
})();
