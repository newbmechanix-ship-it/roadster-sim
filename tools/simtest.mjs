// Headless physics calibration: node tools/simtest.mjs
import { Vehicle } from '../src/game/Vehicle.js';
import { TRIMS } from '../src/game/trims.js';
const dt = 1 / 240;
const base = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false };
for (const id of Object.keys(TRIMS)) {
  const v = new Vehicle(TRIMS[id]);
  v.noCollide = true;
  v.reset(-150, -230, 0);
  for (let i = 0; i < 480; i++) v.step(dt, base); // settle
  const settleY = v.pos.y;
  let t = 0, t60 = null, t100 = null, tq = null, z0 = v.pos.z, vmax = 0;
  while (t < 40) {
    v.step(dt, { ...base, throttle: 1, thrust: true });
    t += dt;
    const mph = v.speed * 2.23694;
    if (t60 === null && mph >= 60) t60 = t;
    if (t100 === null && mph >= 100) t100 = t;
    if (tq === null && v.pos.z - z0 >= 402.336) tq = { t, mph };
    if (v.pos.z > 300) { v.reset(-150, -230, 0); v.vel.set(0,0,vmax); }
    vmax = Math.max(vmax, v.speed);
  }
  // skidpad: steady circle at ~25 m/s
  v.reset(0, 0, 0); v.vel.set(0, 0, 25);
  let maxLat = 0;
  for (let i = 0; i < 240 * 6; i++) {
    const vf = v.forwardSpeed;
    v.step(dt, { ...base, throttle: vf < 25 ? 0.4 : 0, steer: 0.55 });
    if (i > 240 * 3) { const r = v.angVel.y * v.speed; maxLat = Math.max(maxLat, Math.abs(r) / 9.81); }
  }
  console.log(id.padEnd(12), 'settleY', settleY.toFixed(3), '0-60', t60?.toFixed(2), '0-100', t100?.toFixed(2), '1/4', tq && `${tq.t.toFixed(2)}s @ ${tq.mph.toFixed(0)}mph`, 'vmax', (vmax * 2.237).toFixed(0), 'mph', 'lat g', maxLat.toFixed(2), 'upright', (v.quat.y**2+v.quat.w**2).toFixed(2));
}

// Rocket stunts
{
  const v = new Vehicle(TRIMS.rocket);
  v.reset(0, -140, 0);
  for (let i = 0; i < 240; i++) v.step(dt, base);
  v.step(dt, { ...base, kickflip: true });
  let maxY = 0, landed = null;
  for (let i = 0; i < 240 * 4; i++) { v.step(dt, base); maxY = Math.max(maxY, v.pos.y); for (const e of v.events) if (e.type === 'land') landed = e; v.events.length = 0; }
  const upY = 1 - 2 * (v.quat.x ** 2 + v.quat.z ** 2);
  v.reset(0, -140, 0);
  for (let i = 0; i < 240 * 3; i++) v.step(dt, { ...base, lift: true });
  const hoverY = v.pos.y;
  for (let i = 0; i < 240 * 2; i++) v.step(dt, base);
  const upY2 = 1 - 2 * (v.quat.x ** 2 + v.quat.z ** 2);
  console.log('kickflip maxY', maxY.toFixed(2), 'upright after', upY.toFixed(3), 'airtime', landed?.airtime.toFixed(2), '| lift 3s y', hoverY.toFixed(1), 'upright after fall', upY2.toFixed(3));
}
