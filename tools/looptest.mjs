// Vertical ramp (P9) test: enter along the approach lane at a given speed, ride the partial loop,
// and check what happens at the lip.
//   Rocket: drives off the lip near-inverted, the flight computer pitches it level belly-up, rolls it
//           upright and the landing jets set it down (timeline compared with reveal video 1).
//   Performance / Thrust (no perimeter thrusters): stopped at the lip by the stability system, held
//           by the suction fan, roll back down and leave the ramp backwards, upright.
// Usage: node tools/looptest.mjs [--trace]
import { Vehicle } from '../src/game/Vehicle.js';
import { TRIMS } from '../src/game/trims.js';
import { RAMP, rampPoint } from '../src/game/layout.js';
const dt = 1 / 240, base = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false };
const TRACE = process.argv.includes('--trace');
const upY = (v) => 1 - 2 * (v.quat.x ** 2 + v.quat.z ** 2);
// footage (video 1, t = 0 at the lip): level belly-up +0.55 s, 90 deg of roll +0.85 s, upright +1.2 s, touchdown +2.0 s
const FOOT = { level: 0.55, roll90: 0.85, upright: 1.2, touchdown: 2.0 };
let fails = 0;

/** drive at `mph` to the ramp, then hold a speed along the deck (`climb` m/s, the footage's ~2-2.5 m/s crawl over the top) */
export function runRamp(id, mph, climb = null, opts = {}) {
  const v = new Vehicle(TRIMS[id]);
  v.reset(RAMP.x0, RAMP.z0 - 60, 0);
  for (let i = 0; i < 240; i++) v.step(dt, base);
  const target = mph / 2.237;
  const r = { id, mph, maxTheta: 0, minUpY: 1, exitT: null, exitV: null, exitY: null, levelT: null, roll90T: null, uprightT: null, landT: null, landV: null, landUp: null, crashes: 0, t: 0, trace: [], lipStopped: false, backOut: null };
  let t = 0, onRampT = null, lastOn = false;
  for (let i = 0; i < 240 * 16; i++) {
    let thr;
    if (v.onLoop && climb !== null) thr = v.forwardSpeed < (climb === 'footage' ? (v.rampTheta < Math.PI / 2 ? 6 : 3) : climb) ? 1 : 0;
    else thr = v.forwardSpeed < target ? 1 : 0;
    if (r.lipStopped) thr = 0;                     // driver lets it roll back
    const vy0 = v.vel.y;
    v.step(dt, { ...base, throttle: thr });
    t += dt;
    if (v.onLoop) { r.maxTheta = Math.max(r.maxTheta, v.rampTheta); if (onRampT === null) onRampT = t; }
    r.minUpY = Math.min(r.minUpY, upY(v));
    for (const e of v.events) {
      if (e === 'rampExit') { r.exitT = t; r.exitV = v.speed; r.exitY = v.pos.y; }
      if (e && e.type === 'crash') r.crashes++;
      if (e && e.type === 'land' && r.exitT !== null && r.landT === null) { r.landT = t - r.exitT; r.landV = -vy0; r.landUp = upY(v); r.landU = v.pos.z - RAMP.z0; r.landOnFlat = !v.onLoop && v.wheels.every(w => !w.contact || w.onLoop < 0); }
    }
    v.events.length = 0;
    if (r.exitT !== null) {
      const te = t - r.exitT, f = { x: 0, y: 0, z: 1 };
      const fwd = [2 * (v.quat.x * v.quat.z + v.quat.w * v.quat.y), 2 * (v.quat.y * v.quat.z - v.quat.w * v.quat.x), 1 - 2 * (v.quat.x ** 2 + v.quat.y ** 2)];
      if (r.levelT === null && Math.abs(fwd[1]) < 0.1 && upY(v) < -0.9) r.levelT = te;
      if (r.roll90T === null && r.levelT !== null && upY(v) > 0) r.roll90T = te;
      if (r.uprightT === null && upY(v) > 0.97) r.uprightT = te;
      if (TRACE || opts.trace) r.trace.push([+te.toFixed(3), +(v.pos.y - v.cgHeight).toFixed(2), +upY(v).toFixed(3), +v.pos.z.toFixed(2), v.flipState || '-']);
      if (r.landT !== null && te > r.landT + 0.5) break;
    }
    if (!v.onLoop && lastOn && r.exitT === null && v.vel.z < 0) r.backOut = { t, upY: upY(v), v: v.speed };
    if (v.onLoop && v.rampS > RAMP.length - 1.3 && Math.abs(v.forwardSpeed) < 0.3) r.lipStopped = true;
    if (r.lipT === undefined && v.onLoop && v.rampTheta > 2.6 && !v.wheels[0].contact && !v.wheels[1].contact) r.lipT = t;   // front wheels past the lip
    lastOn = v.onLoop;
    if (r.backOut && v.pos.z < RAMP.z0 - 8) break;
  }
  r.t = t; r.onRampT = onRampT; r.v = v;
  return r;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/looptest.mjs');
if (isMain) {
  const top = rampPoint(RAMP.length);
  console.log(`ramp: R1 ${RAMP.R1} m + vertical ${RAMP.Lv} m + R2 ${RAMP.R2} m to ${(RAMP.end * 57.3).toFixed(0)} deg; lip ${top.y.toFixed(2)} m up, ${RAMP.length.toFixed(1)} m of deck, ${RAMP.width} m wide`);
  for (const [id, mph, climb] of [['rocket', 30, 'footage'], ['rocket', 25, 2.5], ['rocket', 30, 2.5], ['rocket', 30, 4], ['rocket', 30, 7], ['rocket', 40, null], ['thrust', 30, 2.5], ['thrust', 40, null], ['performance', 30, 2.5], ['performance', 40, null], ['performance', 20, null]]) {
    const r = runRamp(id, mph, climb);
    const tag = `${id.padEnd(11)} ${String(mph).padStart(2)} mph${climb === 'footage' ? ' (footage pace: 6 m/s to vertical, 3 m/s over the top)' : climb ? ' (crawl ' + climb + ' m/s up)' : ' (full throttle)'}`;
    if (r.exitT !== null) {
      const ok = r.landT !== null && r.landUp > 0.9 && r.landV < 4 && !r.crashes && r.landOnFlat;
      if (!ok) fails++;
      console.log(`${tag}: max ${(r.maxTheta * 57.3).toFixed(0)} deg, left lip at ${r.exitV.toFixed(1)} m/s (CG ${r.exitY.toFixed(1)} m) (front wheels over the lip ${r.lipT !== undefined ? (r.exitT - r.lipT).toFixed(2) + ' s earlier' : '-'}) -> level belly-up +${r.levelT?.toFixed(2)} s (footage ${FOOT.level}), roll 90 deg +${r.roll90T?.toFixed(2)} (${FOOT.roll90}), upright +${r.uprightT?.toFixed(2)} (${FOOT.upright}), touchdown +${r.landT?.toFixed(2)} s (${FOOT.touchdown}) at ${r.landV?.toFixed(1)} m/s, upY ${r.landUp?.toFixed(2)}, ${r.landOnFlat ? 'on flat asphalt' : 'ON THE RAMP'} ${(-r.landU).toFixed(1)} m before the entry ${ok ? 'OK' : 'FAIL'}${r.crashes ? ' crashes ' + r.crashes : ''}`);
    } else if (r.backOut) {
      const ok = r.backOut.upY > 0.9 && !r.crashes && (id !== 'rocket');
      if (!ok) fails++;
      console.log(`${tag}: max ${(r.maxTheta * 57.3).toFixed(0)} deg, ${r.lipStopped ? 'stopped at the lip (held upside down by the fan), ' : 'did not reach the lip, '}rolled back out backwards upright ${r.backOut.upY.toFixed(2)} at ${r.backOut.v.toFixed(1)} m/s ${ok ? 'OK' : 'FAIL'}${r.crashes ? ' crashes ' + r.crashes : ''}`);
    } else { fails++; console.log(`${tag}: max ${(r.maxTheta * 57.3).toFixed(0)} deg, minUpY ${r.minUpY.toFixed(2)} -> no exit / no roll-back  FAIL`); }
    if (TRACE && r.trace.length) console.log(r.trace.filter((_, i) => i % 24 === 0).map(a => a.join(' ')).join('\n'));
  }
  console.log(fails ? `${fails} FAILED` : 'all OK');
  process.exit(fails ? 1 : 0);
}
