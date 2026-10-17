// Jet assist must stay idle in normal driving and only help at extreme speed.
import { Vehicle } from '../src/game/Vehicle.js';
import { TRIMS } from '../src/game/trims.js';
const dt = 1 / 240;
const base = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false };
const mk = () => { const v = new Vehicle(TRIMS.rocket); v.noCollide = true; v.reset(0, 0, 0); for (let i = 0; i < 240; i++) v.step(dt, base); return v; };
// 1) normal driving: launches, braking and cornering up to ~100 mph
let v = mk(); const full = v.tank;
const plan = [[3, { throttle: 1 }], [1.5, { brake: 1 }], [3, { throttle: 0.6, steer: 0.9 }], [2, { throttle: 1 }], [2, { brake: 1, steer: 0.6 }], [3, { throttle: 0.5, steer: -1 }]];
let maxMph = 0, fired = 0;
for (const [d, inp] of plan) for (let i = 0; i < d * 240; i++) { v.step(dt, { ...base, ...inp }); maxMph = Math.max(maxMph, v.speed * 2.237); if (v.assistLevel > 0.01) fired++; }
console.log(`normal driving (max ${maxMph.toFixed(0)} mph): assist active ${(fired * dt).toFixed(2)} s, air used ${((full - v.tank) / 1000).toFixed(1)} kN·s`);
// 2) hard stop from 170 mph, assist on vs off
for (const on of [true, false]) {
  v = mk(); v.assistEnabled = on; v.vel.set(0, 0, 76); const z0 = v.pos.z; const t0 = v.tank; let t = 0;
  while (v.forwardSpeed > 0.3 && t < 15) { v.step(dt, { ...base, brake: 1 }); t += dt; }
  console.log(`170-0 mph, assist ${on ? 'ON ' : 'OFF'}: ${(v.pos.z - z0).toFixed(1)} m, air used ${((t0 - v.tank) / 1000).toFixed(1)} kN·s`);
}
