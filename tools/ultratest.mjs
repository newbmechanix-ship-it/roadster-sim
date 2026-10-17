// Hold T: ULTRA compressor spools up and refills the air tank in a few seconds.
import { Vehicle } from '../src/game/Vehicle.js';
import { TRIMS } from '../src/game/trims.js';
const dt = 1 / 240, base = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false, jump: false, ultra: false };
for (const name of ['rocket', 'thrust']) {
  const v = new Vehicle(TRIMS[name]); v.noCollide = true; v.reset(0, -110, 0);
  for (let i = 0; i < 240; i++) v.step(dt, base);
  v.tank = 0; let t = 0, half = null;
  while (v.tank < v.trim.tank && t < 20) { v.step(dt, { ...base, ultra: true }); t += dt; if (half === null && v.tank >= v.trim.tank / 2) half = t; }
  let t2 = 0; while (v.ultraSpool > 0 && t2 < 5) { v.step(dt, base); t2 += dt; }
  console.log(`${name}: empty→half ${half.toFixed(2)} s, empty→full ${t.toFixed(2)} s (normal compressor: ${(v.trim.tank / v.trim.refill / 60).toFixed(0)} min), spool-down ${t2.toFixed(2)} s`);
}
