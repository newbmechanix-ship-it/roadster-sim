// Measures what suction and jet assist contribute: 60-0 braking, steady cornering, landings.
import { Vehicle } from '../src/game/Vehicle.js';
import { TRIMS } from '../src/game/trims.js';
const dt = 1 / 240;
const base = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false };
const make = (id, mod = {}) => { const v = new Vehicle({ ...TRIMS[id], ...mod }); v.noCollide = true; return v; };

function brake60(v) {
  v.reset(0, -100, 0);
  for (let i = 0; i < 240; i++) v.step(dt, base);
  v.vel.set(0, 0, 26.82);
  const z0 = v.pos.z; let t = 0;
  while (v.forwardSpeed > 0.3 && t < 10) { v.step(dt, { ...base, brake: 1 }); t += dt; }
  return { dist: v.pos.z - z0, t };
}
function corner(v, speed = 30) {
  v.reset(0, 0, 0);
  for (let i = 0; i < 240; i++) v.step(dt, base);
  v.vel.set(0, 0, speed);
  let sum = 0, n = 0, spun = false;
  const prev = v.vel.clone();
  for (let i = 0; i < 240 * 5; i++) {
    v.step(dt, { ...base, throttle: v.forwardSpeed < speed ? 0.6 : 0, steer: 1 });
    const ax = (v.vel.x - prev.x) / dt, az = (v.vel.z - prev.z) / dt; prev.copy(v.vel);
    const q = v.quat, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const beta = Math.abs(Math.atan2(v.vel.x * fz - v.vel.z * fx, v.vel.x * fx + v.vel.z * fz));
    if (beta > 0.35) spun = true;
    if (i > 240 * 2) { sum += Math.hypot(ax * fz - az * fx, 0) / 9.81; n++; }
  }
  return spun ? 'spins' : (sum / n).toFixed(2) + ' g';
}
function landing(v, setup) {
  v.reset(0, -100, 0);
  for (let i = 0; i < 240; i++) v.step(dt, base);
  setup(v);
  let impact = 0, minVy = 0;
  for (let i = 0; i < 240 * 6; i++) {
    const vy = v.vel.y;
    v.step(dt, base);
    if (v.groundedWheels > 0 && i > 10 && impact === 0) impact = -vy;
    minVy = Math.min(minVy, v.vel.y);
    if (impact) break;
  }
  return impact;
}

console.log('60-0 mph braking (all trims; fan 1 g under braking vs fan off):');
for (const id of ['performance', 'thrust', 'rocket']) {
  const on = brake60(make(id)), off = (() => { const v = make(id); v.fanOn = false; return brake60(v); })();
  const noJet = id === 'rocket' ? brake60(make(id, { assistThrust: 0 })) : null;
  console.log(`  ${id.padEnd(12)} ${on.dist.toFixed(1)} m (${(26.82 / on.t / 9.81).toFixed(2)} g)  | fan off ${off.dist.toFixed(1)} m` + (noJet ? `  | no jet assist ${noJet.dist.toFixed(1)} m` : ''));
}
console.log('Max steady cornering at 67 mph:');
for (const id of ['performance', 'thrust', 'rocket']) {
  const on = corner(make(id)); const v = make(id); v.fanOn = false; const off = corner(v);
  const noJet = id === 'rocket' ? corner(make(id, { assistThrust: 0 })) : null;
  console.log(`  ${id.padEnd(12)} ${on}  | fan off ${off}` + (noJet !== null ? `  | no jet assist ${noJet}` : ''));
}
console.log('Rocket touchdown vertical speed (auto landing cushion vs none):');
const kick = v => v.step(dt, { ...base, kickflip: true });
const drop = h => v => { v.pos.y += h; v.vel.set(0, 0, 0); };
for (const [name, setup] of [['kickflip (8 m apex)', kick], ['15 m drop', drop(15)], ['30 m drop', drop(30)]]) {
  const a = landing(make('rocket'), setup);
  const v2 = make('rocket'); v2.trim = { ...v2.trim, perimeter: false, perimeterLanding: false };
  // disable only the cushion: perimeter=false also blocks kickflip, so emulate by zero lift thrust during fall
  const b = landing(make('rocket', { liftThrust: 0 }), setup);
  console.log(`  ${name.padEnd(20)} with cushion ${a.toFixed(1)} m/s  | without ${b.toFixed(1)} m/s`);
}
