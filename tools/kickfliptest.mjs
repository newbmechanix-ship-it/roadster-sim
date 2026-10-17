// Kickflip timeline vs the reveal footage (hover shot): apex ~13.7 m at ~1.9 s, flip ~1 s near apex,
// cushioned landing ~2 m/s.
import { Vehicle } from '../src/game/Vehicle.js';
import { TRIMS } from '../src/game/trims.js';
const dt = 1 / 240, base = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false };
const v = new Vehicle(TRIMS.rocket); v.noCollide = true; v.reset(0, -110, 0);
for (let i = 0; i < 240; i++) v.step(dt, base);
const y0 = v.pos.y; let maxRate = 0; let t = 0, apex = 0, tApex = 0, flipStart = null, flipEnd = null, land = null, roll = 0;
const tank0 = v.tank;
v.step(dt, { ...base, kickflip: true });
const rows = [];
for (let i = 0; i < 240 * 7; i++) {
  v.step(dt, base); t += dt;
  const h = v.pos.y - y0;
  if (h > apex) { apex = h; tApex = t; }
  for (const cp of [0.2, 0.4]) if (!rows['cp' + cp] && t >= cp) rows['cp' + cp] = h;
  if (v.flipState === 'spinup' && flipStart === null) flipStart = t;
  if (flipStart !== null && flipEnd === null && v.flipState === null) flipEnd = t;
  if (v.rollBurn && !rows.burnLog) rows.burnLog = []; if (v.rollBurn) (rows.burnLog ||= []).push(+t.toFixed(2));
  maxRate = Math.max(maxRate, Math.abs(v.angVel.z) * 57.3, Math.abs(v.angVel.x) * 57.3);
  for (const e of v.events) if (e.type === 'land' && !land) land = { t, air: e.airtime, impact: e.impact };
  v.events.length = 0;
  if (i % 60 === 0) rows.push(`t=${t.toFixed(2)} h=${h.toFixed(2)} vy=${v.vel.y.toFixed(1)} upY=${(1 - 2 * (v.quat.x ** 2 + v.quat.z ** 2)).toFixed(2)}`);
}
const upY = 1 - 2 * (v.quat.x ** 2 + v.quat.z ** 2);
console.log(rows.join('\n'));
const bl = rows.burnLog || []; const spans = []; for (const x of bl) { if (!spans.length || x - spans[spans.length-1][1] > 0.02) spans.push([x, x]); else spans[spans.length-1][1] = x; }
console.log(`early climb: +0.2 s ${rows['cp0.2'].toFixed(2)} m (footage 1.07), +0.4 s ${rows['cp0.4'].toFixed(2)} m (footage 3.0)`);
console.log('roll burns (one-side jets):', spans.map(s => s[0].toFixed(2) + '–' + s[1].toFixed(2) + 's').join(', '), '| peak roll rate ~' + maxRate.toFixed(0) + '°/s (CFD plot ~330°/s)');
console.log(`apex ${apex.toFixed(1)} m at ${tApex.toFixed(2)} s (footage ~13.7 m at ~1.9 s); flip ${flipStart?.toFixed(2)}–${flipEnd?.toFixed(2)} s; landing ${land ? land.t.toFixed(2) + ' s, airtime ' + land.air.toFixed(2) + ' s' : 'none'}; upright after ${upY.toFixed(2)}; air used ${((tank0 - v.tank) / 1000).toFixed(0)} of ${(tank0 / 1000).toFixed(0)} kN·s`);
