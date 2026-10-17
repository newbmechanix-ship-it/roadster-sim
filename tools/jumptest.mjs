// Rocket kickflip over the Semi line from flat ground (no ramps, as in the reveal)
import { Vehicle } from '../src/game/Vehicle.js';
import { TRIMS } from '../src/game/trims.js';
import { BOXES } from '../src/game/layout.js';
const dt = 1 / 240;
const base = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false };
const semi = BOXES.find(b => b.kind === 'semi');
for (const target of [12, 16, 20, 25]) for (const lead of [4, 8, 12]) {
  const v = new Vehicle(TRIMS.rocket);
  v.reset(semi.x, semi.z - 90, 0);
  let crash = null, land = null, maxY = 0, flipped = false;
  for (let i = 0; i < 240 * 14; i++) {
    const kick = !flipped && v.pos.z > semi.z - 7 - lead;   // demo cars start ~6 m before the Semi
    if (kick) flipped = true;
    v.step(dt, { ...base, throttle: v.forwardSpeed < target ? 1 : 0, kickflip: kick });
    maxY = Math.max(maxY, v.pos.y);
    for (const e of v.events) { if (e.type === 'crash' && !crash) crash = v.pos.z.toFixed(1); if (e.type === 'land' && !land) land = { z: v.pos.z.toFixed(1), air: e.airtime.toFixed(2) }; }
    v.events.length = 0;
    if (land && v.pos.z > semi.z + 25) break;
  }
  const upY = 1 - 2 * (v.quat.x ** 2 + v.quat.z ** 2);
  console.log(`${(target * 2.237).toFixed(0).padStart(3)} mph, kick ${lead} m early -> apex ${maxY.toFixed(1)} m, land ${land?.z} (${land?.air}s) ${crash ? 'CRASH @' + crash : 'clean'} upright ${upY.toFixed(2)}`);
}
