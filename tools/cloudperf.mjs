// CPU cost of the mesh cloud sim: physics + meshing per frame at realistic parcel counts.
import { CloudCore } from '../src/game/CloudCore.js';
const scene = { add() {} };
const sim = new CloudCore(); const out = { pos: new Float32Array(360000*3), nrm: new Float32Array(360000*3), col: new Float32Array(360000*4), maxV: 360000 };
const car = { pos: { x: 0, y: 0.47, z: 0, clone() { return this; } }, quat: null };
const V = (x, y, z) => ({ x, y, z });
let t = 0; const dt = 1 / 60; const times = []; let phys = 0, mesh = 0, maxArea = 0; let maxTris = 0, maxParcels = 0;
for (let f = 0; f < 60 * 6; f++) {
  // landing-cloud-like emission for 1.5 s: ~8 jets × 15/s ground parcels + 8 × 38/s puffs
  if (t < 1.5) for (let k = 0; k < 9; k++) {
    const a = Math.random() * 6.283, sp = 6 + Math.random() * 8;
    sim.emit(V((Math.random() - 0.5) * 4, 0.4, (Math.random() - 0.5) * 3), V(Math.cos(a) * sp, 0.6, Math.sin(a) * sp),
      { mass: 0.6, r0: 0.5, r1: 3.2, life: 4.5, hold: 0.55, color: [0.9, 0.9, 0.92], drag: 1.6, rise: 0.2 });
  }
  const t0 = performance.now();
  sim.update(dt, null, out);
  times.push(performance.now() - t0); phys += sim.timing.physics; mesh += sim.timing.mesh; globalThis.__h = (globalThis.__h||0) + (sim.timing.hull||0); globalThis.__v = (globalThis.__v||0) + (sim.timing.vol||0); maxArea = Math.max(maxArea, sim.sideArea);
  maxTris = Math.max(maxTris, sim.vcount / 3);
  let n = 0; for (let i = 0; i < sim.max; i++) n += sim.alive[i]; maxParcels = Math.max(maxParcels, n);
  t += dt;
}
times.sort((a, b) => a - b);
const pct = p => times[Math.floor(times.length * p)].toFixed(2);
console.log(`parcels peak ${maxParcels}, triangles peak ${maxTris}, frame cost ms: median ${pct(0.5)}  p95 ${pct(0.95)}  max ${times[times.length - 1].toFixed(2)}  side area peak ${maxArea.toFixed(1)} m²  | avg physics ${(phys/times.length).toFixed(2)} ms, mesh ${(mesh/times.length).toFixed(2)} ms (hull ${(globalThis.__h/times.length).toFixed(2)}, volume ${(globalThis.__v/times.length).toFixed(2)})`);
