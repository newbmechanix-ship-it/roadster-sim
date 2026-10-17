// Space key: tap = takeoff pop without the roll (lands upright); hold = vertical lift thrusters (hover).
import { Vehicle } from '../src/game/Vehicle.js';
import { TRIMS } from '../src/game/trims.js';
const dt = 1 / 240, base = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false, jump: false };
const upY = (v) => 1 - 2 * (v.quat.x ** 2 + v.quat.z ** 2);
{ // tap
  const v = new Vehicle(TRIMS.rocket); v.noCollide = true; v.reset(0, -110, 0);
  for (let i = 0; i < 240; i++) v.step(dt, base);
  const y0 = v.pos.y; let apex = 0, tApex = 0, minUp = 1, land = null, ev = [];
  v.step(dt, { ...base, jump: true }); ev.push(...v.events); v.events.length = 0;
  for (let i = 0; i < 240 * 6; i++) {
    v.step(dt, base); const t = (i + 1) * dt, h = v.pos.y - y0;
    if (h > apex) { apex = h; tApex = t; } minUp = Math.min(minUp, upY(v));
    for (const e of v.events) if (e.type === 'land' && !land) land = { t, impact: e.impact };
    v.events.length = 0;
  }
  console.log(`TAP: event ${JSON.stringify(ev)}; apex ${apex.toFixed(1)} m @ ${tApex.toFixed(2)} s; min upY ${minUp.toFixed(2)} (1 = never rolled); landing ${land ? land.t.toFixed(2) + ' s impact ' + (+land.impact).toFixed(1) : 'none'}; upright ${upY(v).toFixed(2)}`);
}
{ // hold: lift only
  const v = new Vehicle(TRIMS.rocket); v.noCollide = true; v.reset(0, -110, 0);
  for (let i = 0; i < 240; i++) v.step(dt, base);
  const y0 = v.pos.y; let ev = [];
  for (let i = 0; i < 240 * 2; i++) { v.step(dt, { ...base, lift: true }); ev.push(...v.events.filter(e => typeof e === 'string')); v.events.length = 0; }
  console.log(`HOLD 2 s: height ${(v.pos.y - y0).toFixed(1)} m, liftLevel ${v.liftLevel.toFixed(2)}, flipState ${v.flipState}, string events ${JSON.stringify(ev)}`);
}
