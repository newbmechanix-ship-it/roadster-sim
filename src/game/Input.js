// Keyboard + gamepad input with smoothed analog axes.
const ACTIONS = {
  Escape: 'menu', KeyC: 'camera', KeyR: 'reset', KeyF: 'fan', KeyG: 'wing', KeyV: 'doors', KeyM: 'mute', KeyH: 'help', KeyN: 'daynight', KeyJ: 'assist', KeyP: 'teleport', KeyK: 'editor',
};

// Space: pressing it fires the takeoff pop at once (the Q jump without the roll); kept held longer
// than this it also opens the 4 vertical lift thrusters (hover mode, same as E).
const SPACE_HOLD_MS = 180;

export class Input {
  constructor() {
    this.keys = new Set();
    this.handlers = {};
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false, jump: false, ultra: false };
    this.padPrev = [];
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (!['KeyQ'].includes(e.code)) return; }
      this.keys.add(e.code);
      if (e.code === 'KeyQ' && !e.repeat) this.state.kickflip = true;
      if (e.code === 'KeyT' && !e.repeat) { this.state.ultra = !this.state.ultra; this.emit('ultra'); }   // T toggles the automatic super recharger
      if (e.code === 'Space') { this.spaceT = performance.now(); this.state.jump = true; }   // press = jump at once (like Q); keep holding = lift
      const a = ACTIONS[e.code];
      if (a && !e.repeat) this.emit(a);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(action, fn) { this.handlers[action] = fn; }
  emit(action) { this.handlers[action]?.(); }

  poll() {
    const k = this.keys, s = this.state;
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    let throttle = up ? 1 : 0, brake = down ? 1 : 0;
    let steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
    let handbrake = k.has('KeyB');   // Space is jump/hover now; not Ctrl (Ctrl+W would close the tab)
    let thrust = k.has('ShiftLeft') || k.has('ShiftRight');
    let lift = k.has('KeyE') || (k.has('Space') && performance.now() - this.spaceT >= SPACE_HOLD_MS);
    // +pitch = torque about the car's +X (left) axis = nose down. W: nose down, S: nose up.
    let pitch = (up ? 1 : 0) - (down ? 1 : 0);
    let roll = (right ? 1 : 0) - (left ? 1 : 0);
    let yawAir = (k.has('KeyZ') ? 1 : 0) - (k.has('KeyX') ? 1 : 0);
    let analogSteer = null;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      // Only standard-layout gamepads (Xbox/PlayStation style). Flight sticks, HOTAS
      // throttles, wheels and other HID devices report a non-standard mapping and are ignored.
      if (!p || !p.connected || p.mapping !== 'standard') continue;
      const b = (i) => p.buttons[i]?.value || 0;
      const pressed = (i) => p.buttons[i]?.pressed;
      const dz = (v) => Math.abs(v) < 0.12 ? 0 : v;
      const lx = dz(p.axes[0] || 0), ly = dz(p.axes[1] || 0);
      if (b(7) > 0.05) throttle = Math.max(throttle, b(7));
      if (b(6) > 0.05) brake = Math.max(brake, b(6));
      if (lx) { analogSteer = lx; roll = lx; }
      if (ly) pitch = -ly; // stick forward (negative Y) = nose down
      handbrake ||= pressed(0);
      thrust ||= pressed(5);
      lift ||= pressed(3);
      const prev = this.padPrev[p.index] || [];
      const edge = (i) => pressed(i) && !prev[i];
      if (edge(1)) s.kickflip = true;
      if (edge(9)) this.emit('menu');
      if (edge(8)) this.emit('camera');
      if (edge(2)) this.emit('reset');
      if (edge(4)) this.emit('fan');
      this.padPrev[p.index] = p.buttons.map(x => x.pressed);
    }

    // Keyboard steering ramps smoothly; analog passes through
    if (analogSteer !== null) s.steer = analogSteer;
    else {
      const rate = steerTarget === 0 ? 6 : 4;
      s.steer += Math.max(-rate / 60, Math.min(rate / 60, steerTarget - s.steer));
    }
    s.throttle = throttle; s.brake = brake; s.handbrake = handbrake; s.thrust = thrust; s.lift = lift;
    s.pitch = pitch; s.roll = roll; s.yawAir = yawAir;
  }
}
