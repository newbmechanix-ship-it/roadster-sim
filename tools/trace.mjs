import { Vehicle } from '../src/game/Vehicle.js';
import { TRIMS } from '../src/game/trims.js';
const dt = 1 / 240, target = +(process.argv[2] || 50);
const base = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false };
const v = new Vehicle(TRIMS.thrust);
v.reset(90, -315, 0);
for (let i = 0; i < 240 * 14; i++) {
  v.step(dt, { ...base, throttle: v.forwardSpeed < target && v.pos.z < -100 ? 1 : 0 });
  if (v.pos.z > -110 && i % 12 === 0) console.log(`z ${v.pos.z.toFixed(1)} y ${v.pos.y.toFixed(2)} vz ${v.vel.z.toFixed(1)} vy ${v.vel.y.toFixed(1)} gw ${v.groundedWheels} ev ${v.events.map(e=>e.type||e).join(',')}`);
  v.events.length = 0;
  if (v.pos.z > 20 || (v.pos.z > -110 && v.speed < 2)) break;
}
