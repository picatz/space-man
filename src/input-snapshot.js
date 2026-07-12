/* Device-neutral input contract. Gameplay consumes actions, never button IDs. */
(function () {
  'use strict';
  function axis(value, dead) {
    const v = Math.abs(value || 0) < dead ? 0 : value;
    return Math.sign(v) * Math.pow(Math.abs(v), 1.35);
  }
  function snapshot(gamepad) {
    if (!gamepad) return { move: 0, jump: false, fire: false, pause: false };
    const b = (index) => !!(gamepad.buttons[index] && gamepad.buttons[index].pressed);
    let move = axis(gamepad.axes[0], 0.18);
    if (b(14)) move = -1; if (b(15)) move = 1;
    return { move, jump: b(0), fire: b(2) || b(5) || b(7), pause: b(9) };
  }
  window.SpaceManInput = { axis, snapshot };
})();
