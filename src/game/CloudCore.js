// Cloud simulation core (no rendering, no three.js): gas-parcel physics + marching-cubes
// meshing. Runs inside a Web Worker (cloudWorker.js) so it never stalls the game loop;
// CloudSim falls back to running it inline when Workers aren't available (tests).
import { edgeTable, triTable } from './mcTables.js';
import { groundAt } from './layout.js';

const MAX_CELLS = 450000;
// float32 → IEEE half bits, table method (truncating; plenty for density), shared buffer views
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
const H_BASE = new Uint16Array(512), H_SHIFT = new Uint8Array(512);
for (let i = 0; i < 256; i++) {
  const e = i - 127;
  if (e < -24) { H_BASE[i] = 0; H_SHIFT[i] = 24; }
  else if (e < -14) { H_BASE[i] = 0x0400 >> (-e - 14); H_SHIFT[i] = -e - 1; }
  else if (e <= 15) { H_BASE[i] = (e + 15) << 10; H_SHIFT[i] = 13; }
  else { H_BASE[i] = 0x7c00; H_SHIFT[i] = 24; }
  H_BASE[i | 256] = H_BASE[i] | 0x8000; H_SHIFT[i | 256] = H_SHIFT[i];
}
function toHalf(v) { _f32[0] = v; const x = _u32[0], k = x >>> 23; return H_BASE[k] + ((x & 0x7fffff) >>> H_SHIFT[k]); }
// the volume and the hull use a wider, softer kernel than the physics radius: the density then
// falls off gently at the edge of the gas, so the shader's billow noise carves lobes over a thick
// band (cauliflower outline) instead of tracing each parcel's sphere
const SOFT = 1.25;
// coarse optical-density volume for volumetric shading of the mesh (front surface → ray march)
// A parcel that swells mixes with more air: its condensation is spread over a bigger volume, so
// the optical depth through it falls ~ 1/r² (column through a sphere of fixed mass). Without this
// every expanded puff stayed as opaque as a fresh one (white cotton balls instead of smoky outskirts).
export const SPREAD = { ref: 1.5, pow: 2 };   // round 17: 1.5 → 2 (f38/f43 carried ~1.7× the footage gas)
const spreadK = (r) => Math.min(2, Math.pow(SPREAD.ref / Math.max(0.3, r), SPREAD.pow));
// round 16: gas carried out by the ring flattens as it ages (footage f38–f47: the outskirts are
// low, sheared streaks along the tarmac, ≤ 1.5 m tall, while the young core billows up to ~3.5 m)
export const FLAT = { k: 0.9, core: 0.5, t0: 0.15, t1: 0.65 };
export const CLEAR = { a: 2.7, b: 2.8, k: 1.6, push: 3.4 };   // round 24: a 3.4 → 2.7 (f43: the footage heaps butt against the bumpers)   // clearing around the car: semi-axes (m) and push rate (1/s)
export const RING = { grow: 5 };   // ring core growth (m). Round 25: 3.5 → 5 (f38 16.7 m wide vs footage 23 m once erT trimmed the thin outskirts)
export const RING_LAT = 0.2;   // lateral share of the ring's outward travel
// round 27: billow-scale eddies (~4–8 m, evolving over a few seconds) that advect the parcels directly: neighbouring
// puffs roll around each other and the bank churns like a fluid. The big curl field above is ~30–50 m across, so it
// only moved the whole cloud coherently. a: m/s, s: spatial scale, w: time rate, tau: decay with age (s), fl: floor
export const EDDY = { a: 1.2, s: 2, w: 3, tau: 2.5, fl: 0.35 };
// round 26: 22 → 24 vertical voxels and the box floor clamped to the tarmac (it reached ~3 m below the
// ground; voxels ≥ 0.25 m tall); stored as half floats (density/dmax)
export const VOL = { x: 56, y: 24, z: 56, dmax: 6 };
// live-tunable parameters (FX editor); defaults = the footage calibration
export const CLOUD_DEFAULTS = {
  cloudMaxParcels: 1600, cloudDissipation: 1, cloudTurbulence: 1, cloudSpread: 1, cloudSink: 1, cloudRise: 1,
  cloudDrag: 1, windX: 0, windZ: 0, meshComplexity: 2.6, meshMinCell: 0.22, meshIso: 0.06,
};

// marching-cubes corner offsets and edge endpoints (Bourke convention, as three's tables)
const CORNER = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const EDGE = [[0, 1], [1, 2], [3, 2], [0, 3], [4, 5], [5, 6], [7, 6], [4, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const EA = EDGE.map(e => e[0]), EB = EDGE.map(e => e[1]);


// rotate v (array) by quaternion (x,y,z,w)
function qrot(v, qx, qy, qz, qw) {
  const tx = 2 * (qy * v[2] - qz * v[1]), ty = 2 * (qz * v[0] - qx * v[2]), tz = 2 * (qx * v[1] - qy * v[0]);
  v[0] += qw * tx + (qy * tz - qz * ty);
  v[1] += qw * ty + (qz * tx - qx * tz);
  v[2] += qw * tz + (qx * ty - qy * tx);
}

// Divergence-free turbulence: curl of a smooth vector potential (two octaves), analytic.
function curl(x, y, z, t, out) {
  let cx = 0, cy = 0, cz = 0;
  for (let o = 0; o < 2; o++) {
    const f = o ? 2.3 : 1, a = o ? 0.5 : 1;
    const a1 = 0.37 * f, a2 = 0.41 * f, a3 = 0.43 * f, b1 = 0.53 * f, b2 = 0.61 * f, b3 = 0.47 * f;
    const w1 = 0.21 * f, w2 = 0.17 * f, w3 = 0.19 * f;
    cx += a * (b3 * Math.cos(b3 * y) - a2 * Math.cos(a2 * z + w2 * t));
    cy += a * (b1 * Math.cos(b1 * z) - a3 * Math.cos(a3 * x + w3 * t));
    cz += a * (b2 * Math.cos(b2 * x) - a1 * Math.cos(a1 * y + w1 * t));
  }
  out[0] = cx; out[1] = cy; out[2] = cz;
}

export class CloudCore {
  constructor(max = 3000) {          // storage; FX.cloudMaxParcels is the active limit
    this.prm = { ...CLOUD_DEFAULTS };
    this.SPREAD = SPREAD; this.FLAT = FLAT; this.CLEAR = CLEAR; this.RING = RING; this.EDDY = EDDY;   // debug handles
    this.max = max;
    const N = max;
    this.p = new Float32Array(N * 3);
    this.v = new Float32Array(N * 3);
    this.gh = new Float32Array(N);       // ground height under the parcel
    this.col = new Float32Array(N * 3);
    this.age = new Float32Array(N);
    this.life = new Float32Array(N);
    this.hold = new Float32Array(N);
    this.m0 = new Float32Array(N);
    this.r0 = new Float32Array(N);
    this.r1 = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.rise = new Float32Array(N);
    this.curM = new Float32Array(N);
    this.curR = new Float32Array(N);
    this.curS = new Float32Array(N);
    this.flat = new Float32Array(N).fill(1.45);   // vertical squash of the kernel
    this.hx = new Float32Array(N).fill(1);        // horizontal stretch (volume kept: the gas spreads sideways as it settles)   // shape mass: sets the mesh extent (stays up while the cloud thins)
    this.ringX = new Float32Array(N); this.ringZ = new Float32Array(N); this.ringOn = new Uint8Array(N);
    this.alive = new Uint8Array(N);
    this.cursor = 0;
    this.t = 0;
    this.sideArea = 0;
    this.denseArea = 0;
    this.vcount = 0;
    this.field = new Float32Array(MAX_CELLS);
    this.cacc = new Float32Array(MAX_CELLS * 4);
    this._c = [0, 0, 0];
    this._tmp = [0, 0, 0];
  }

  /** Emit one gas parcel. Sizes are visible radii at birth/end (m); mass 0..~1.5. */
  emit(p, v, { mass, r0, r1, life, hold = 0.2, color = [1, 1, 1], drag = 2, rise = 0.1, ring = null }) {
    let i = -1;
    const lim = Math.max(50, Math.min(this.max, this.prm.cloudMaxParcels | 0));
    if (this.cursor >= lim) this.cursor = 0;
    for (let k = 0; k < lim; k++) { // find a free slot, else recycle the oldest in line
      const c = (this.cursor + k) % lim;
      if (!this.alive[c]) { i = c; break; }
    }
    if (i < 0) return;   // full: drop the new parcel rather than deleting an older one mid-cloud
    this.cursor = (i + 1) % lim;
    this.p[i * 3] = p.x; this.p[i * 3 + 1] = p.y; this.p[i * 3 + 2] = p.z;
    this.v[i * 3] = v.x; this.v[i * 3 + 1] = v.y; this.v[i * 3 + 2] = v.z;
    this.col[i * 3] = color[0]; this.col[i * 3 + 1] = color[1]; this.col[i * 3 + 2] = color[2];
    this.age[i] = 0; this.life[i] = life; this.hold[i] = hold;
    this.m0[i] = mass; this.r0[i] = r0; this.r1[i] = r1;
    this.drag[i] = drag; this.rise[i] = rise;
    this.ringOn[i] = ring ? 1 : 0; if (ring) { this.ringX[i] = ring.x; this.ringZ[i] = ring.z; }
    this.alive[i] = 1;
  }

  clear() { this.alive.fill(0); this.vcount = 0; this.t = 0; this.cursor = 0; if (this.cm) this.cm.fill(0); }

  /** Advance dt and mesh into out = { pos, nrm, col, maxV }. Returns the vertex count. */
  update(dt, car, out, prm) {
    if (prm) for (const k in CLOUD_DEFAULTS) if (typeof prm[k] === 'number') this.prm[k] = prm[k];
    // parcels above a lowered cap are dropped
    const lim = Math.min(this.max, this.prm.cloudMaxParcels | 0);
    for (let i = lim; i < this.max; i++) this.alive[i] = 0;
    this.out = out;
    this.maxV = out.maxV;
    this.t += dt;
    const t0 = performance.now();
    this.step(dt, car);
    const t1 = performance.now();
    this.mesh_();
    const t2 = performance.now();
    this.buildVolume();
    this.timing = { physics: t1 - t0, mesh: performance.now() - t1, hull: t2 - t1, vol: performance.now() - t2 };
    return this.vcount;
  }

  // ---------------------------------------------------------------- physics
  step(dt, car) {
    const N = this.max, P = this.p, V = this.v;
    // spatial hash for parcel–parcel pressure
    const hash = new Map();
    const HC = 2.5;
    for (let i = 0; i < N; i++) {
      if (!this.alive[i]) continue;
      const t = this.age[i] / this.life[i];
      if (t >= 1) { this.alive[i] = 0; continue; }
      const u = Math.min(1, Math.max(0, (t - this.hold[i]) / (1 - this.hold[i])) * this.prm.cloudDissipation);
      this.curR[i] = this.r0[i] + (this.r1[i] - this.r0[i]) * (1 - Math.pow(1 - t, 1.7));   // puffs swell steadily (side shot: a compact dome first, the bank widens later)
      const born = Math.min(1, this.age[i] / 0.1);
      this.curM[i] = this.m0[i] * born * (1 - u * u * (3 - 2 * u));      // condensation left (thickness)
      this.curS[i] = this.m0[i] * born * (1 - 0.55 * u * u * u);        // extent: barely shrinks, cloud thins instead
      { const f = Math.min(1, Math.max(0, (t - FLAT.t0) / (FLAT.t1 - FLAT.t0))); const sq = 1 + FLAT.k * (this.ringOn[i] ? 1 : FLAT.core) * f * f * (3 - 2 * f); this.hx[i] = Math.sqrt(sq); this.flat[i] = 1.45 * sq * this.hx[i]; }
      const key = (Math.floor(P[i * 3] / HC) * 73856093) ^ (Math.floor(P[i * 3 + 1] / HC) * 19349663) ^ (Math.floor(P[i * 3 + 2] / HC) * 83492791);
      let b = hash.get(key); if (!b) hash.set(key, b = []); b.push(i);
    }
    // car frame for collision (car = { px,py,pz, qx,qy,qz,qw } or null)
    const cq = car, pr = this.prm, WX = pr.windX, WZ = pr.windZ;
    const tmp = this._tmp;
    const c = this._c;
    let cmx = 0, cmy = 0, cmz = 0, cn = 0;
    if (!this.cm) this.cm = [0, 0, 0];
    // the clearing around the car forms once it is down among the gas (f28: one mound under the hovering car)
    // round 20: only once the car is down (f30, 0.5 s before touchdown, the cloud still engulfs the car: no notch)
    this.gT = car && car.py - groundAt(car.px, car.pz, car.py).h < 0.8 ? (this.gT || 0) + dt : 0;
    const clrK = Math.min(1, Math.max(0, (this.gT - 0.1) / 0.5));
    const gRef = car ? groundAt(car.px, car.pz, car.py).h : 0;
    const hovW = car ? Math.min(1, Math.max(0, (car.py - groundAt(car.px, car.pz, car.py).h - 1.6) / 0.8)) : 0;
    for (let i = 0; i < N; i++) {
      if (!this.alive[i]) continue;
      const i3 = i * 3;
      let x = P[i3], y = P[i3 + 1], z = P[i3 + 2];
      let vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
      const r = this.curR[i], age = this.age[i];
      // drag toward the ambient wind
      const k = 1 - Math.exp(-this.drag[i] * pr.cloudDrag * dt);
      vx += (WX - vx) * k; vy += (0 - vy) * k; vz += (WZ - vz) * k;
      // cold expanded gas is denser than air: sinks at first, warms toward slight lift
      vy += (this.rise[i] * pr.cloudRise - 0.9 * pr.cloudSink * Math.max(0, 1 - age / 1.2)) * dt;
      // curl-noise turbulence (eddies), stronger for fresh, energetic gas
      // the field's local mean (over the whole cloud, previous step) is removed: otherwise the
      // cloud as a whole rides a slow eddy and drifts several metres to one side (footage: the
      // bank spreads symmetrically about the car)
      curl(x * 0.35, y * 0.35, z * 0.35, this.t, c);
      cmx += c[0]; cmz += c[2]; cmy += c[1]; cn++;
      c[0] -= this.cm[0]; c[1] -= this.cm[1]; c[2] -= this.cm[2];
      const ta = 4.0 * pr.cloudTurbulence * Math.min(1, this.curM[i] + 0.3);
      // round 19: the tarmac blocks vertical eddies: near the ground the field's (static, ~34 m) vertical part
      // lifted whole puffs off the ground on one side of the car (f43: a floating puff with a raised base)
      const wall = Math.min(1, Math.max(0, (y - gRef - 0.4) / 2.2));   // ground level near the car (one lookup per step: CPU)
      vx += c[0] * ta * dt; vy += c[1] * ta * dt * 0.15 * wall; vz += c[2] * ta * dt;
      // pressure: overlapping parcels push apart, so a dense cloud spreads out
      const gx = Math.floor(x / HC), gy = Math.floor(y / HC), gz = Math.floor(z / HC);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        const b = hash.get(((gx + ox) * 73856093) ^ ((gy + oy) * 19349663) ^ ((gz + oz) * 83492791));
        if (!b) continue;
        for (const j of b) {
          if (j === i) continue;
          const dx = x - P[j * 3], dy = y - P[j * 3 + 1], dz = z - P[j * 3 + 2];
          const d2 = dx * dx + dy * dy + dz * dz, rr = (r + this.curR[j]) * 0.55;
          if (d2 > rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2), push = (rr - d) / rr * 0.42 * pr.cloudSpread * this.curM[j];   // weak crowding: puffs keep their own shape (lobes) instead of merging into a slab
          vx += dx / d * push * dt; vy += Math.min(0, dy / d * push * dt * 0.2); vz += dz / d * push * dt;   // crowding spreads the gas sideways, it doesn't stack it up
        }
      }
      x += vx * dt; y += vy * dt; z += vz * dt;
      if (EDDY.a > 0) {   // round 27: billow-scale eddies (displacement, no momentum: the bank's size is unchanged)
        curl(x * EDDY.s + 17.3, y * EDDY.s, z * EDDY.s - 9.1, this.t * EDDY.w, c);
        const ea = EDDY.a * (EDDY.fl + (1 - EDDY.fl) * Math.exp(-age / EDDY.tau)) * dt;
        x += c[0] * ea; y += c[1] * ea * wall; z += c[2] * ea;
      }
      // landing ring vortex (CFD + VERTJUMP): the impingement outflow rolls up into a ring that
      // travels outward along the ground. Parcels are advected around a core whose radius grows
      // ~2.5 → ~9 m; bottom flow runs outward, the front rises, the top curls back inward.
      if (this.ringOn[i]) {
        const rx = x - this.ringX[i], rz = z - this.ringZ[i], d = Math.hypot(rx, rz) || 1e-3;
        // side shot: the bank is ~13 m wide at touchdown, 23+ m 1 s later, ~26 m at +2 s
        // (gamma-shaped: the roll-up first has to form, so the bank stays compact until touchdown)
        const ea = Math.exp(-age / 0.7);
        const rc = 2 + RING.grow * (1 - (1 + age / 0.7) * ea), drc = RING.grow * age / 0.49 * ea;   // round 19: 7.5 → 3.5 m (f43/f47 bank 28–30 m vs footage 18–20 m)   // round 16: 9 → 7.5 m (the flattened outskirts spread wider by themselves)   // core radius and its speed
        const yc = groundAt(x, z, y).h + 1.1;
        const dr = d - rc, dy = y - yc, r2 = dr * dr + dy * dy;
        const G = 1.5 * Math.exp(-age / 2.2) / (r2 + 1.1);   // weaker roll-up: lobes stay lobes instead of smearing into curved sheets
        const near = Math.exp(-r2 / 9);
        const vr = -G * dy + drc * (0.55 + 0.45 * near), vyv = G * dr * (dy > 1.2 ? 0.3 : 1);
        let ux = rx / d * vr * dt, uz = rz / d * vr * dt;
        if (cq) {   // the roll-up runs mostly fore and aft (side shot: little gas between the camera and the car)
          const fx = 2 * (car.qx * car.qz + car.qw * car.qy), fz = 1 - 2 * (car.qx * car.qx + car.qy * car.qy), fl = Math.hypot(fx, fz) || 1;
          const nx = fx / fl, nz = fz / fl, ua = ux * nx + uz * nz, ul = ux * nz - uz * nx;
          ux = nx * ua + nz * ul * RING_LAT; uz = nz * ua - nx * ul * RING_LAT;
        }
        x += ux; z += uz; y += vyv * dt;
      }
      // ground: gas can't go below the tarmac; downward momentum turns into radial spreading
      const gh = groundAt(x, z, y).h, floor = gh + r * 0.35;
      if (y < floor) {
        y = floor;
        if (vy < 0) {
          const hv = Math.hypot(vx, vz) || 1e-3, spread = -vy * 0.55;
          vx += vx / hv * spread; vz += vz / hv * spread; vy *= -0.08;
        }
      }
      // clearing: the car's own jets and the outflow from under it keep the gas off the car
      // (footage f30–f43: the car stays visible between the fore and aft heaps)
      if (cq && clrK > 0) {
        const ex = x - car.px, ez = z - car.pz, ey = y - car.py;
        if (ex * ex + ez * ez < 30 && ey < 4.5 && ey > -1.5) {   // round 21: up to 4.5 m (aged heaps drifted in over the car and floated there once the gas below was cleared, f38/f43)
          // car frame (heading from the quaternion's forward vector, horizontal)
          const fx = 2 * (car.qx * car.qz + car.qw * car.qy), fz = 1 - 2 * (car.qx * car.qx + car.qy * car.qy), fl = Math.hypot(fx, fz) || 1;
          const ax = (ex * fx + ez * fz) / fl, lx = (ex * fz - ez * fx) / fl;
          const e = Math.hypot(ax / CLEAR.a, lx / CLEAR.b);
          if (e < 1) {
            const k = CLEAR.k * clrK * (1 - e) * dt, il = Math.hypot(ax, lx) || 1;
            // mostly sideways and along the length, out of the car's footprint
            x += ((ax / il) * fx + 0.4 * (lx / il) * fz) / fl * k * CLEAR.push; z += ((ax / il) * fz - 0.4 * (lx / il) * fx) / fl * k * CLEAR.push;   // round 25: push strength kept when the region shrank (f38 width)   // round 19: out mostly fore/aft (sideways it piled up between the camera and the car, f38)
          }
        }
      }
      // round 19: downwash under a hovering car: the lift columns drive the gas between them down and
      // out, so the dome stays ~1 m below the underside with the columns visible (side shot f28)
      if (cq && hovW > 0) {
        const ex = x - car.px, ez = z - car.pz, ey = y - car.py;
        if (ey < 0.3 && ey > -1.8 && ex * ex + ez * ez < 12) {
          const fx = 2 * (car.qx * car.qz + car.qw * car.qy), fz = 1 - 2 * (car.qx * car.qx + car.qy * car.qy), fl = Math.hypot(fx, fz) || 1;
          const ax = (ex * fx + ez * fz) / fl, lx = (ex * fz - ez * fx) / fl;
          const e = Math.hypot(ax / 2.6, lx / 1.4);
          if (e < 1) { const k = hovW * (1 - e) * Math.min(1, (ey + 1.8) / 0.8); vy -= 14 * k * dt; y -= 1.2 * k * dt; }
        }
      }
      // car body: flow around it instead of through it
      if (cq) {
        tmp[0] = x - car.px; tmp[1] = y - car.py; tmp[2] = z - car.pz;
        if (tmp[0] * tmp[0] + tmp[1] * tmp[1] + tmp[2] * tmp[2] < 36) {
          qrot(tmp, -car.qx, -car.qy, -car.qz, car.qw);
          const hx = 1.0 + r * 0.3, hz = 2.2 + r * 0.3, y0 = -0.5, y1 = 0.75 + r * 0.3;
          if (Math.abs(tmp[0]) < hx && Math.abs(tmp[2]) < hz && tmp[1] > y0 && tmp[1] < y1) {
            const px = hx - Math.abs(tmp[0]), pz = hz - Math.abs(tmp[2]), py = y1 - tmp[1];
            // pushed out with a random overshoot: parcel centres must not pile up on the box faces
            // (that drew flat planes in the volume around the car)
            const jo = ((i * 0.6180339) % 1) * r * 0.6;
            // soft push (35 % of the penetration per step, random overshoot) instead of a hard clamp:
            // a hard clamp piled parcel centres onto the box faces → flat planes in the volume
            const f = Math.min(1, 21 * dt);
            // round 18: gas from under the car leaves fore/aft (the side shot sees the car between the heaps), not
            // sideways toward the camera or up over the hood; only gas already above the sills goes over the top
            if (tmp[1] > 0.45 && py < px * 1.5 && py < pz) tmp[1] += (y1 + jo - tmp[1]) * f; else if (px * 2.5 < pz && Math.abs(tmp[0]) > 0.6) tmp[0] += (Math.sign(tmp[0]) * (hx + jo) - tmp[0]) * f; else tmp[2] += (Math.sign(tmp[2]) * (hz + jo) - tmp[2]) * f;
            qrot(tmp, car.qx, car.qy, car.qz, car.qw);
            x = car.px + tmp[0]; y = car.py + tmp[1]; z = car.pz + tmp[2];
          }
        }
      }
      P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z;
      V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
      this.gh[i] = gh;
      this.age[i] = age + dt;
    }
    if (cn) { this.cm[0] = cmx / cn; this.cm[1] = cmy / cn; this.cm[2] = cmz / cn; } else this.cm.fill(0);
  }

  // ---------------------------------------------------------------- density volume
  /** Splat the condensation (thickness, not shape) into a coarse world-aligned volume that the
   *  cloud shader ray-marches from the surface: opacity = 1 − exp(−∫density), so thin fringes
   *  and silhouettes are soft and lobe intersections disappear. */
  buildVolume() {
    const N = this.max, P = this.p;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, any = false;
    for (let i = 0; i < N; i++) {
      if (!this.alive[i] || this.curM[i] < 0.004) continue;
      const r = this.curR[i] * SOFT * this.hx[i]; any = true;
      x0 = Math.min(x0, P[i * 3] - r); x1 = Math.max(x1, P[i * 3] + r);
      // kernel is flattened vertically; nothing below the tarmac is ever visible (round 26: the box reached
      // ~3 m under the ground and wasted a third of the vertical voxels)
      y0 = Math.min(y0, Math.max(P[i * 3 + 1] - r / this.flat[i], this.gh[i] - 0.3)); y1 = Math.max(y1, P[i * 3 + 1] + r / this.flat[i]);
      z0 = Math.min(z0, P[i * 3 + 2] - r); z1 = Math.max(z1, P[i * 3 + 2] + r);
    }
    const VX = VOL.x, VY = VOL.y, VZ = VOL.z, NV = VX * VY * VZ;
    if (!this.vol) { this.vol = new Uint16Array(NV); this.volF = new Float32Array(NV); }
    const V = this.volF;   // kept zeroed: the output pass clears what it reads
    this.volInfo = { ox: 0, oy: 0, oz: 0, sx: 1, sy: 1, sz: 1 };
    if (!any) { this.vol.fill(0); return; }
    // centre on the cloud, at most 60 × 16 × 60 m, one empty voxel of padding on every side
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const wx = Math.min(60, x1 - x0), wz = Math.min(60, z1 - z0), wy = Math.min(16, y1 - y0);
    const sx = wx / (VX - 3), sy = Math.max(0.25, wy / (VY - 3)), sz = wz / (VZ - 3);
    const ox = cx - wx / 2 - sx, oy = y0 - sy, oz = cz - wz / 2 - sz;
    for (let i = 0; i < N; i++) {
      if (!this.alive[i] || this.curM[i] < 0.004) continue;
      const r = this.curR[i] * SOFT * this.hx[i], m = this.curM[i] * spreadK(this.curR[i]), ir2 = 1 / (r * r), fl = this.flat[i];
      const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
      const ix0 = Math.max(1, Math.floor((px - r - ox) / sx)), ix1 = Math.min(VX - 2, Math.ceil((px + r - ox) / sx));
      const iy0 = Math.max(1, Math.floor((py - r / fl - oy) / sy)), iy1 = Math.min(VY - 2, Math.ceil((py + r / fl - oy) / sy));
      const iz0 = Math.max(1, Math.floor((pz - r - oz) / sz)), iz1 = Math.min(VZ - 2, Math.ceil((pz + r - oz) / sz));
      const DX = this._dx || (this._dx = new Float32Array(256));
      for (let ix = ix0; ix <= ix1; ix++) { const dx = ox + ix * sx - px; DX[ix] = dx * dx * ir2; }
      for (let iz = iz0; iz <= iz1; iz++) {
        const dz = oz + iz * sz - pz, dz2 = dz * dz * ir2;
        if (dz2 >= 1) continue;
        for (let iy = iy0; iy <= iy1; iy++) {
          const dy = (oy + iy * sy - py) * fl, dyz = dy * dy * ir2 + dz2;
          if (dyz >= 1) continue;
          // only the x-span inside the kernel
          const w = Math.sqrt(1 - dyz) * r, jx0 = Math.max(ix0, Math.ceil((px - w - ox) / sx)), jx1 = Math.min(ix1, Math.floor((px + w - ox) / sx));
          let idx = jx0 + VX * (iy + VY * iz);
          for (let ix = jx0; ix <= jx1; ix++, idx++) {
            const t = 1 - DX[ix] - dyz;
            if (t > 0) V[idx] += m * t * t;
          }
        }
      }
    }
    // half float: density / dmax (clamped as the old 8-bit volume was). Round 26: 8 bits gave thin gas only a
    // few levels through the crisp transfers
    const k = 1 / VOL.dmax, out = this.vol, h = toHalf;
    out.fill(0);
    for (let i = 0; i < NV; i++) {
      const d = V[i];
      if (d <= 0) continue;
      out[i] = h(Math.min(1, d * k)); V[i] = 0;
    }
    // texel centres: voxel i sits at o + i·s; uvw = (p − o)/(n·s) + 0.5/n
    this.volInfo = { ox, oy, oz, sx, sy, sz };
  }

  // ---------------------------------------------------------------- meshing
  mesh_() {
    const N = this.max, P = this.p;
    // cluster parcels (connected 12 m cells) so far-apart clouds get separate small grids
    const C = 12, cells = new Map();
    for (let i = 0; i < N; i++) {
      if (!this.alive[i] || this.curS[i] < 0.02 || this.curM[i] < 0.005) continue;
      const key = `${Math.floor(P[i * 3] / C)},${Math.floor(P[i * 3 + 1] / C)},${Math.floor(P[i * 3 + 2] / C)}`;
      let b = cells.get(key); if (!b) cells.set(key, b = []); b.push(i);
    }
    const seen = new Set(), clusters = [];
    for (const key of cells.keys()) {
      if (seen.has(key)) continue;
      const stack = [key], members = []; seen.add(key);
      while (stack.length) {
        const k = stack.pop(); members.push(...cells.get(k));
        const [a, b, c] = k.split(',').map(Number);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
          const nk = `${a + ox},${b + oy},${c + oz}`;
          if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
      clusters.push(members);
    }
    this.vcount = 0;
    this.sideArea = 0;
    this.denseArea = 0;
    this.sideW = 0; this.sideTop = 0;
    for (const members of clusters) this.meshCluster(members);
  }

  meshCluster(members) {
    const P = this.p;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const i of members) {
      const r = this.curR[i] * SOFT * this.hx[i] + 1.2;   // + room for the hull dilation below
      x0 = Math.min(x0, P[i * 3] - r); x1 = Math.max(x1, P[i * 3] + r);
      y0 = Math.min(y0, P[i * 3 + 1] - r); y1 = Math.max(y1, P[i * 3 + 1] + r);
      z0 = Math.min(z0, P[i * 3 + 2] - r); z1 = Math.max(z1, P[i * 3 + 2] + r);
    }
    // grid resolution scales with the cluster's parcel size: ~3.5 cells per radius keeps the
    // surface smooth while the cost per parcel stays roughly constant (detail comes from the
    // shader's noise displacement); coarser still if the cluster is huge
    let meanR = 0;
    for (const i of members) meanR += this.curR[i] * SOFT;
    meanR /= members.length;
    const ISO = Math.min(this.prm.meshIso, 0.07);   // hull = bounding proxy of the visible volume: higher thresholds would clip gas
    // the hull is only the volume's bounding proxy (detail comes from the shader), so it can be coarse
    let h = Math.min(1.0, Math.max(this.prm.meshMinCell * 1.6, meanR / (this.prm.meshComplexity * 0.7))), nx, ny, nz;
    for (;;) {
      nx = Math.ceil((x1 - x0) / h) + 5; ny = Math.ceil((y1 - y0) / h) + 5; nz = Math.ceil((z1 - z0) / h) + 5;
      if (nx * ny * nz <= MAX_CELLS) break;
      h *= 1.15;
    }
    const ox = x0 - h * 2, oy = y0 - h * 2, oz = z0 - h * 2;
    const DIL = Math.min(1.2, 0.8 * h);
    const nxy = nx * ny, total = nxy * nz;
    const F = this.field, CA = this.cacc;
    // The kernels are smooth, so splat on a 2× coarser grid (8× fewer kernel samples) and
    // trilinearly upsample to the fine grid that marching cubes runs on: fine facets, low cost.
    const h2 = h * 2, mx = Math.ceil(nx / 2) + 1, my = Math.ceil(ny / 2) + 1, mz = Math.ceil(nz / 2) + 1, mxy = mx * my;
    if (!this.fieldC || this.fieldC.length < mxy * mz) { this.fieldC = new Float32Array(mxy * mz * 2); this.caccC = new Float32Array(mxy * mz * 8); }
    const FC = this.fieldC, CC = this.caccC;
    FC.fill(0, 0, mxy * mz); CC.fill(0, 0, mxy * mz * 4);
    for (const i of members) {
      // hull from the condensation itself (the volume shader decides what is visible inside it);
      // a little extra mass keeps the hull just outside the visible gas
      // dilated by ~0.8 cell: the hull is coarse (it only bounds the volume), so it must stay
      // conservative — wherever it cut into visible gas the march started inside it (flat facets)
      const r = this.curR[i] * SOFT * this.hx[i] + DIL, m = Math.min(this.curS[i], this.curM[i] * 1.3) * spreadK(this.curR[i]);
      const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
      const ix0 = Math.max(0, Math.floor((px - r - ox) / h2)), ix1 = Math.min(mx - 1, Math.ceil((px + r - ox) / h2));
      const fl = this.flat[i], ry = r / fl, iy0 = Math.max(0, Math.floor((py - ry - oy) / h2)), iy1 = Math.min(my - 1, Math.ceil((py + ry - oy) / h2));
      const iz0 = Math.max(0, Math.floor((pz - r - oz) / h2)), iz1 = Math.min(mz - 1, Math.ceil((pz + r - oz) / h2));
      const ir2 = 1 / (r * r);
      const fade = this.curM[i] / Math.max(1e-3, this.m0[i]);   // thinning schedule 0..1 → opacity / wisps
      const cr = this.col[i * 3], cg = this.col[i * 3 + 1], cb = this.col[i * 3 + 2];
      for (let iz = iz0; iz <= iz1; iz++) {
        const dz = oz + iz * h2 - pz;
        for (let iy = iy0; iy <= iy1; iy++) {
          const dy = (oy + iy * h2 - py) * fl, dyz = dy * dy + dz * dz;   // slightly flattened kernel: gas spreads more than it stacks
          if (dyz * ir2 >= 1) continue;
          let idx = ix0 + mx * (iy + my * iz);
          for (let ix = ix0; ix <= ix1; ix++, idx++) {
            const dx = ox + ix * h2 - px, q = (dx * dx + dyz) * ir2;
            if (q >= 1) continue;
            const s = 1 - q, w = m * s * s;   // same falloff as the density volume, so the hull encloses all visible gas
            FC[idx] += w;
            const c4 = idx * 4;
            CC[c4] += w * cr; CC[c4 + 1] += w * cg; CC[c4 + 2] += w * cb; CC[c4 + 3] += w * fade;
          }
        }
      }
    }
    // upsample (trilinear) into the fine grid
    for (let iz = 0; iz < nz; iz++) {
      const cz = iz >> 1, tz = (iz & 1) * 0.5, cz1 = Math.min(mz - 1, cz + 1);
      for (let iy = 0; iy < ny; iy++) {
        const cy = iy >> 1, ty = (iy & 1) * 0.5, cy1 = Math.min(my - 1, cy + 1);
        const b00 = mx * (cy + my * cz), b10 = mx * (cy1 + my * cz), b01 = mx * (cy + my * cz1), b11 = mx * (cy1 + my * cz1);
        let idx = nx * (iy + ny * iz);
        for (let ix = 0; ix < nx; ix++, idx++) {
          const cx = ix >> 1, tx = (ix & 1) * 0.5, cx1 = Math.min(mx - 1, cx + 1);
          const w000 = (1 - tx) * (1 - ty) * (1 - tz), w100 = tx * (1 - ty) * (1 - tz), w010 = (1 - tx) * ty * (1 - tz), w110 = tx * ty * (1 - tz);
          const w001 = (1 - tx) * (1 - ty) * tz, w101 = tx * (1 - ty) * tz, w011 = (1 - tx) * ty * tz, w111 = tx * ty * tz;
          const a = b00 + cx, b = b00 + cx1, c = b10 + cx, d = b10 + cx1, e = b01 + cx, f = b01 + cx1, g = b11 + cx, k = b11 + cx1;
          const v = FC[a] * w000 + FC[b] * w100 + FC[c] * w010 + FC[d] * w110 + FC[e] * w001 + FC[f] * w101 + FC[g] * w011 + FC[k] * w111;
          F[idx] = v;
          if (v === 0) { const c4 = idx * 4; CA[c4] = CA[c4 + 1] = CA[c4 + 2] = CA[c4 + 3] = 0; continue; }
          for (let q = 0; q < 4; q++) {
            CA[idx * 4 + q] = CC[a * 4 + q] * w000 + CC[b * 4 + q] * w100 + CC[c * 4 + q] * w010 + CC[d * 4 + q] * w110 + CC[e * 4 + q] * w001 + CC[f * 4 + q] * w101 + CC[g * 4 + q] * w011 + CC[k * 4 + q] * w111;
          }
        }
      }
    }
    // side-view projected area (x–y plane) for calibration tests
    // side-view projected areas for calibration: any cloud, and only still-thick cloud
    let proj = 0, dense = 0, bx0 = 1e9, bx1 = -1, by1 = -1;
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
      let any = false, thick = false;
      for (let iz = 0; iz < nz; iz++) {
        const id = ix + nx * (iy + ny * iz);
        if (F[id] > ISO) { any = true; if (CA[id * 4 + 3] / F[id] > 0.45) { thick = true; break; } }
      }
      if (any) { proj++; if (ix < bx0) bx0 = ix; if (ix > bx1) bx1 = ix; if (iy > by1) by1 = iy; }
      if (thick) dense++;
    }
    if (proj > 0) { this.sideW = Math.max(this.sideW, (bx1 - bx0 + 1) * h); this.sideTop = Math.max(this.sideTop, oy + (by1 + 1) * h); }
    this.sideArea = Math.max(this.sideArea, proj * h * h);
    this.denseArea = Math.max(this.denseArea, dense * h * h);
    // marching cubes
    const pos = this.out.pos, nrm = this.out.nrm, col = this.out.col;
    const ev = new Float32Array(12 * 10); // per-edge: pos3, nrm3, col4
    const cornerIdx = new Int32Array(8);
    const grad = (i, j, k, out, o) => {
      const id = i + nx * (j + ny * k);
      out[o] = F[id - 1] - F[id + 1];           // -grad = outward normal (field is high inside)
      out[o + 1] = F[id - nx] - F[id + nx];
      out[o + 2] = F[id - nxy] - F[id + nxy];
    };
    const ga = new Float32Array(6);
    for (let k = 1; k < nz - 2; k++) for (let j = 1; j < ny - 2; j++) {
      let base = 1 + nx * (j + ny * k);
      for (let i = 1; i < nx - 2; i++, base++) {
        let ci = 0;
        for (let c = 0; c < 8; c++) {
          const id = base + CORNER[c][0] + nx * CORNER[c][1] + nxy * CORNER[c][2];
          cornerIdx[c] = id;
          if (F[id] < ISO) ci |= 1 << c;
        }
        const bits = edgeTable[ci];
        if (!bits) continue;
        for (let e = 0; e < 12; e++) {
          if (!(bits & (1 << e))) continue;
          const a = EA[e], b = EB[e];
          const fa = F[cornerIdx[a]], fb = F[cornerIdx[b]];
          const t = Math.abs(fb - fa) > 1e-6 ? (ISO - fa) / (fb - fa) : 0.5;
          const ca = CORNER[a], cb = CORNER[b], o = e * 10;
          ev[o] = ox + (i + ca[0] + (cb[0] - ca[0]) * t) * h;
          ev[o + 1] = oy + (j + ca[1] + (cb[1] - ca[1]) * t) * h;
          ev[o + 2] = oz + (k + ca[2] + (cb[2] - ca[2]) * t) * h;
          grad(i + ca[0], j + ca[1], k + ca[2], ga, 0);
          grad(i + cb[0], j + cb[1], k + cb[2], ga, 3);
          let gx = ga[0] + (ga[3] - ga[0]) * t, gy = ga[1] + (ga[4] - ga[1]) * t, gz = ga[2] + (ga[5] - ga[2]) * t;
          const gl = Math.hypot(gx, gy, gz) || 1;
          ev[o + 3] = gx / gl; ev[o + 4] = gy / gl; ev[o + 5] = gz / gl;
          const ia = cornerIdx[a] * 4, ib = cornerIdx[b] * 4;
          const wa = Math.max(F[cornerIdx[a]], 1e-5), wb = Math.max(F[cornerIdx[b]], 1e-5);
          for (let q = 0; q < 4; q++) ev[o + 6 + q] = Math.min(1.2, CA[ia + q] / wa + (CA[ib + q] / wb - CA[ia + q] / wa) * t);
          // optical thickness: how much gas lies just inside the surface (summed over parcels,
          // so a lone thin puff is translucent while the merged body of a big cloud is opaque)
          // averaged over three depths so the opacity varies smoothly across the surface
          let fin = 0;
          for (let dq = 0.6; dq < 2; dq += 0.6) {
            const qx = ((ev[o] - ev[o + 3] * dq - ox) / h + 0.5) | 0, qy = ((ev[o + 1] - ev[o + 4] * dq - oy) / h + 0.5) | 0, qz = ((ev[o + 2] - ev[o + 5] * dq - oz) / h + 0.5) | 0;
            fin += (qx >= 0 && qy >= 0 && qz >= 0 && qx < nx && qy < ny && qz < nz) ? F[qx + nx * (qy + ny * qz)] : 0;
          }
          fin /= 3;
          ev[o + 9] = Math.min(1, ev[o + 9]) * Math.min(1, Math.max(0.08, (fin - ISO * 0.5) / (ISO * 6.5)));   // gradual: fringes stay see-through
        }
        const tb = ci * 16;
        for (let q = 0; triTable[tb + q] !== -1; q += 3) {
          if (this.vcount + 3 > this.maxV) return;
          const e0 = triTable[tb + q] * 10, e1 = triTable[tb + q + 1] * 10, e2 = triTable[tb + q + 2] * 10;
          // wind triangles so their face normal agrees with the field normal (front faces outward)
          const ux = ev[e1] - ev[e0], uy = ev[e1 + 1] - ev[e0 + 1], uz = ev[e1 + 2] - ev[e0 + 2];
          const wx = ev[e2] - ev[e0], wy = ev[e2 + 1] - ev[e0 + 1], wz = ev[e2 + 2] - ev[e0 + 2];
          const fnx = uy * wz - uz * wy, fny = uz * wx - ux * wz, fnz = ux * wy - uy * wx;
          const flip = fnx * ev[e0 + 3] + fny * ev[e0 + 4] + fnz * ev[e0 + 5] < 0;
          for (let w = 0; w < 3; w++) {
            const eo = w === 0 ? e0 : (w === 1) !== flip ? e1 : e2;
            const v = this.vcount++;
            pos[v * 3] = ev[eo]; pos[v * 3 + 1] = ev[eo + 1]; pos[v * 3 + 2] = ev[eo + 2];
            nrm[v * 3] = ev[eo + 3]; nrm[v * 3 + 1] = ev[eo + 4]; nrm[v * 3 + 2] = ev[eo + 5];
            col[v * 4] = ev[eo + 6]; col[v * 4 + 1] = ev[eo + 7]; col[v * 4 + 2] = ev[eo + 8]; col[v * 4 + 3] = ev[eo + 9];
          }
        }
      }
    }
  }
}
