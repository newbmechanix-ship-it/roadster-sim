// Procedural Tesla Roadster (2nd gen, revealed 2026-10-15) for three/webgpu.
//
// Conventions: meters, +Y up, car faces +Z, origin on the ground midway between the axles.
// The body is a lofted, flat-shaded faceted shell: 11 profile points per cross-section,
// each driven by piecewise-linear keyframes along Z (crisp Cybertruck-style creases), with
// the wheel arches carved by clamping the lower profile points above the arch circle.
//
// API: createRoadster({ trim: 'performance'|'thrust'|'rocket', wheelStyle: 'spoke'|'aero' })
//   -> THREE.Group 'Roadster' with userData.parts / userData.dims (see bottom of file).

import * as THREE from 'three/webgpu';

// ---------------------------------------------------------------------------------------------
// Key dimensions (measured from the side-profile reference photos, scaled to a 4.39 m length)
// ---------------------------------------------------------------------------------------------
const Z_NOSE = 2.255;
const Z_TAIL = -2.135;
const Z_FA = 1.438; // front axle
const Z_RA = -1.438; // rear axle
const WHEEL_R = 0.345;
const TRACK_F = 1.66;
const TRACK_R = 1.75; // rear tyres sit flush with the flared haunches (straight-rear render)
const TIRE_W_F = 0.27;
const TIRE_W_R = 0.33;
// arches are ellipses (r = half-length along Z, ry = height above the wheel centre); fitted to the side photo trace
const ARCHES = [
  { z: Z_FA + 0.012, y: WHEEL_R, r: 0.376, ry: 0.366 },
  { z: Z_RA, y: WHEEL_R, r: 0.41, ry: 0.41 },
];

const Z_COWL = 1.5; // windshield base
const Z_ROOF = -0.15; // windshield top / start of black canopy
const Z_SAIL = -0.8; // where the white sails start beside the rear glass
const Z_SAILGLASS = -1.55; // dark glass wraps down the sail ridge this far back (wingless studio render)
const Z_RGLASS = -1.75; // black rear glass ends at the stowed-wing deck panel (side photo, clean renders)
const Z_BPILLAR = -0.47; // end of black B-pillar strip
const Z_QWIN = -1.03; // rear tip of the triangular quarter window

// Door split per band: [rearZ, frontZ]. Band 3 = lower side, 4 = upper side, 5 = side glass.
const DOOR_BANDS = { 3: [-0.25, 0.83], 4: [-0.34, 0.93], 5: [-0.4, 1.1] }; // nominal (station hints)
// Door shut lines (measured): slanted front and rear cuts for the body bands, constant for the glass.
const DOOR_CUT = {
  front: (band, y) => (band === 5 ? 1.1 : 0.803 + 0.269 * (y - 0.274)),
  rear: (band, y) => -0.186 - 0.286 * (y - 0.309),
};
const DOOR_GAP = 0.004;
const B_PILLAR_W = 0.014; // thin dark seam between door glass and quarter glass (side render)
const HINGE = [0.865, 0.835, 1.0];

// ---------------------------------------------------------------------------------------------
// Cross-section keyframes: [z, x, y] (half profile, +x side), z descending.
// Profile point order (bottom centre -> top centre):
//  0 floor centre, 1 floor edge, 2 rocker, 3 black/white crease, 4 shoulder,
//  5 belt / fender peak, 6 glass top / A-pillar / roof edge / sail ridge, 7 (derived) inner edge
//  of the white A-pillar/roof rail, 8 hood edge / glass edge, 9 (derived) crown, 10 centre top.
// ---------------------------------------------------------------------------------------------
// P5 belt (door/quarter glass lower edge) measured on the metric-gridded Tesla side render
const K = {
  P1: [[2.255, 0.55, 0.15], [2.05, 0.6, 0.135], [1.8, 0.62, 0.11], [1.2, 0.62, 0.095], [-1.55, 0.62, 0.085], [-1.85, 0.69, 0.13], [-2.135, 0.69, 0.19]],
  P2: [[2.255, 0.62, 0.17], [2.05, 0.83, 0.15], [1.6, 0.9, 0.11], [0.9, 0.9, 0.085], [-1.0, 0.94, 0.085], [-1.6, 0.98, 0.1], [-1.85, 1.025, 0.4], [-2.135, 0.92, 0.42]], // rear corners end high: tyres visible below (straight-rear render)
  P3: [[2.255, 0.64, 0.3], [2.0, 0.88, 0.295], [1.6, 0.94, 0.28], [1.0, 0.925, 0.274], [-0.186, 0.915, 0.305], [-1.0, 0.97, 0.42], [-1.4, 0.995, 0.5], [-1.76, 1.0, 0.6], [-1.87, 1.062, 0.68], [-1.985, 1.02, 0.75], [-2.135, 0.96, 0.785]],
  P4: [[2.255, 0.66, 0.44], [2.0, 0.89, 0.54], [1.6, 0.965, 0.68], [1.438, 0.97, 0.71], [1.0, 0.95, 0.75], [0.0, 0.935, 0.8], [-0.58, 0.95, 0.857], [-1.165, 1.0, 0.905], [-1.82, 1.0, 0.909], [-2.135, 0.95, 0.88]],
  P5: [[2.255, 0.64, 0.505], [2.12, 0.77, 0.57], [1.88, 0.85, 0.7], [1.646, 0.86, 0.785], [1.5, 0.86, 0.795], [1.0, 0.87, 0.81], [-0.37, 0.87, 0.885], [-0.47, 0.85, 0.895], [-0.65, 0.8, 0.92], [-0.93, 0.7, 0.97], [-1.025, 0.625, 1.08], [-1.587, 0.7, 0.99], [-2.135, 0.9, 0.895]],
  P6: [[1.5, 0.86, 0.82], [1.224, 0.8, 0.871], [0.756, 0.69, 1.047], [0.15, 0.6, 1.14], [-0.45, 0.56, 1.172], [-1.025, 0.62, 1.1], [-1.587, 0.66, 1.018], [-1.938, 0.76, 0.942], [-2.135, 0.9, 0.9]],
  P8: [[2.255, 0.6, 0.5], [1.5, 0.5, 0.72], [0.85, 0.5, 1.03], [0.15, 0.46, 1.16], [-0.45, 0.46, 1.175], [-1.03, 0.42, 1.085], [-1.7, 0.315, 0.97], [-1.75, 0.33, 0.965], [-2.135, 0.55, 0.905]],
  P10: [[2.255, 0, 0.5], [2.2, 0, 0.52], [1.5, 0, 0.725], [0.85, 0, 1.035], [0.15, 0, 1.16], [-0.45, 0, 1.18], [-0.8, 0, 1.155], [-1.2, 0, 1.075], [-1.7, 0, 0.985], [-2.08, 0, 0.905], [-2.135, 0, 0.91]],
};

function lerpKeys(keys, z) {
  if (z >= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) {
    if (z >= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      const t = (z - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  const l = keys[keys.length - 1];
  return [l[1], l[2]];
}

// Monotone cubic (Fritsch-Carlson) interpolation of keyframes along Z: continuous curvature
// for the sculpted lines (rocker, crease, shoulder, roof centre) without overshoot.
function smoothKeys(keys, z) {
  const n = keys.length;
  if (z >= keys[0][0]) return [keys[0][1], keys[0][2]];
  if (z <= keys[n - 1][0]) return [keys[n - 1][1], keys[n - 1][2]];
  let i = 1;
  while (z < keys[i][0]) i++;
  const out = [];
  for (const c of [1, 2]) {
    const sec = [];
    for (let k = 0; k < n - 1; k++) sec.push((keys[k + 1][c] - keys[k][c]) / (keys[k + 1][0] - keys[k][0]));
    const tan = (k) => {
      if (k === 0) return sec[0];
      if (k === n - 1) return sec[n - 2];
      const a = sec[k - 1], b = sec[k];
      return a * b <= 0 ? 0 : (2 * a * b) / (a + b); // harmonic mean keeps it monotone
    };
    const z0 = keys[i - 1][0], z1 = keys[i][0], h = z1 - z0, t = (z - z0) / h;
    const y0 = keys[i - 1][c], y1 = keys[i][c];
    const t2 = t * t, t3 = t2 * t;
    out.push((2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * tan(i - 1) + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * tan(i));
  }
  return out;
}

function archTop(z) {
  let ya = -1;
  for (const a of ARCHES) {
    const dz = z - a.z;
    if (Math.abs(dz) < a.r) ya = Math.max(ya, a.y + a.ry * Math.sqrt(1 - (dz * dz) / (a.r * a.r)));
  }
  return ya;
}

function profileAt(z) {
  const p1 = lerpKeys(K.P1, z);
  const p2 = smoothKeys(K.P2, z);
  const p3 = smoothKeys(K.P3, z);
  const p4 = smoothKeys(K.P4, z);
  const p5 = lerpKeys(K.P5, z);
  const p6 = z >= Z_COWL ? p5.slice() : lerpKeys(K.P6, z);
  const p8 = lerpKeys(K.P8, z);
  const y10 = smoothKeys(K.P10, z)[1];
  const dx = p8[0] - p6[0], dy = p8[1] - p6[1];
  const L = Math.hypot(dx, dy);
  const s = L > 1e-6 ? Math.min(0.018, 0.45 * L) / L : 0;
  const p7 = [p6[0] + dx * s, p6[1] + dy * s];
  // crown: convex over the glass, nearly flat hood panel between the raised fender edges (front renders)
  const p9 = [p8[0] * 0.5, y10 + (p8[1] - y10) * (z > Z_COWL ? 0.45 : 0.25)];
  const pts = [[0, p1[1]], p1, p2, p3, p4, p5, p6, p7, p8, p9, [0, y10]];
  pts.z = z;
  const ya = archTop(z);
  if (ya > 0) {
    for (let i = 1; i <= 4; i++) {
      if (pts[i][1] < ya) pts[i] = [pts[i][0], Math.min(ya, pts[5][1] - 0.004)];
    }
  }
  return pts;
}

// Cross-section surfacing: profile joints in SOFT are smooth (shoulder over the haunch, hood/roof
// crown, centreline); every other joint stays a crisp design crease. Bands touching a soft joint are
// subdivided along a Hermite curve, so the panel reads as one continuous sculpted surface.
const SOFT = new Set([4, 9, 10]);
const BAND_SUB = 8; // M12: smoother shoulder / crown / centreline curvature
function bandCurve(P, b) {
  const isSoft = (i) => SOFT.has(i) || (i === 5 && P.z > 1.95); // only the nose corner of the fender peak is rounded; taut fender over the wheel
  const soft0 = isSoft(b), soft1 = isSoft(b + 1);
  const p0 = P[b], p1 = P[b + 1];
  if (!soft0 && !soft1) return [p0, p1];
  const chord = [p1[0] - p0[0], p1[1] - p0[1]];
  const cl = Math.hypot(chord[0], chord[1]);
  if (cl < 1e-4) return [p0, p1];
  const tangent = (i) => {
    if (!isSoft(i)) return chord;
    if (i === 10) return [P[10][0] - P[9][0], 0]; // centreline: horizontal (mirror symmetry)
    let t = [(P[i + 1][0] - P[i - 1][0]) / 2, (P[i + 1][1] - P[i - 1][1]) / 2];
    const lim = Math.min(Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]), Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]));
    const tl = Math.hypot(t[0], t[1]);
    if (tl > lim && tl > 1e-9) t = [t[0] * lim / tl, t[1] * lim / tl];
    return t;
  };
  const m0 = tangent(b), m1 = tangent(b + 1);
  // band 3 (crease -> shoulder) carries the concave sweep under the shoulder along the doors into the haunch
  const z = P.z ?? 0;
  const ramp = (a0, a1, v) => Math.max(0, Math.min(1, (v - a0) / (a1 - a0)));
  const dip = b === 3 ? 0.011 * ramp(1.35, 0.7, z) * ramp(-1.95, -1.3, z) : 0; // shallow, long fade = soft highlight falloff
  const nrm = [chord[1] / cl, -chord[0] / cl]; // outward for the +x side (chord runs upward)
  const out = [];
  for (let k = 0; k <= BAND_SUB; k++) {
    const t = k / BAND_SUB, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const d = dip * Math.pow(Math.sin(Math.PI * t), 1.5);
    out.push([h00 * p0[0] + h10 * m0[0] + h01 * p1[0] + h11 * m1[0] - nrm[0] * d, h00 * p0[1] + h10 * m0[1] + h01 * p1[1] + h11 * m1[1] - nrm[1] * d]);
  }
  return out;
}
// dense outline of a cross-section (for the nose/tail caps)
function denseProfile(P) {
  const out = [P[0]];
  for (let b = 0; b < 10; b++) out.push(...bandCurve(P, b).slice(1));
  return out;
}
// point on band b at parameter t (or at height y when useY)
function bandPoint(P, b, t, useY) {
  const C = bandCurve(P, b);
  if (useY) {
    for (let k = 0; k < C.length - 1; k++) {
      const a = C[k], c = C[k + 1];
      if ((t - a[1]) * (t - c[1]) <= 0 && Math.abs(c[1] - a[1]) > 1e-9) {
        const u = (t - a[1]) / (c[1] - a[1]);
        return [a[0] + (c[0] - a[0]) * u, t];
      }
    }
    return t < C[0][1] === C[0][1] < C[C.length - 1][1] ? C[0] : C[C.length - 1];
  }
  const f = Math.max(0, Math.min(1, t)) * (C.length - 1), k = Math.min(C.length - 2, Math.floor(f)), u = f - k;
  return [C[k][0] + (C[k + 1][0] - C[k][0]) * u, C[k][1] + (C[k + 1][1] - C[k][1]) * u];
}

function buildStations() {
  const important = [Z_NOSE, Z_TAIL, Z_COWL, Z_ROOF, Z_SAIL, Z_RGLASS, Z_BPILLAR, Z_QWIN];
  for (const k of Object.values(K)) for (const e of k) important.push(e[0]);
  for (const b of Object.values(DOOR_BANDS)) important.push(b[0], b[1]);
  const list = [];
  const has = (z, eps) => list.some((v) => Math.abs(v - z) < eps);
  for (const z of important) if (z <= Z_NOSE && z >= Z_TAIL && !has(z, 1e-4)) list.push(z);
  for (const a of ARCHES) {
    for (let i = -36; i <= 36; i++) {
      const z = a.z + a.r * Math.sin((i / 36) * Math.PI * 0.5);
      if (!has(z, 0.003)) list.push(z);
    }
    for (const e of [a.z + a.r, a.z - a.r]) if (!has(e, 1e-4)) list.push(e);
  }
  for (let z = Z_NOSE; z > Z_TAIL; z -= 0.025) if (!has(z, 0.009)) list.push(z); // M12: denser stations (smoother silhouettes)
  return list.sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------------------------
// Geometry buckets: collect flat-shaded triangles per material, then merge into one mesh each.
// ---------------------------------------------------------------------------------------------
const mx = (v) => [-v[0], v[1], v[2]];

// The fascia leans back: shear the nose so the face bottom sits ~4-7 cm behind the leading edge.
function warpNose(p) {
  if (p[2] <= 2.0 || p[1] >= 0.5) return false;
  const s = Math.min(1, (p[2] - 2.0) / (Z_NOSE - 2.0));
  p[2] -= (0.5 - p[1]) * 0.19 * s;
  return true;
}

// Glass is lofted from twisted quads; average normals so reflections stay continuous.
const SMOOTH_KEYS = new Set(['glass']);
// crease angles (deg) for smooth vertex normals per material; sharper angles stay hard character lines
// (M12: wheels, interior and small parts were flat-shaded and read faceted)
const AUTOSMOOTH = { AnoWhite: 34, GlossBlack: 30, BlackCanopy: 30, Carbon: 30, MatteBlack: 30, GoldGlass: 40,
  Spoke: 30, SpokeFace: 30, Tire: 50, RimBarrel: 45, WheelDisc: 30, DarkMetal: 30, Interior: 32, Seat: 35, Suede: 35,
  Bronze: 40, NozzleInner: 40, Plate: 20, RedAccent: 40 };
function smoothNormals(B) {
  const acc = new Map();
  const key = (i) => `${Math.round(B.p[i] * 2000)},${Math.round(B.p[i + 1] * 2000)},${Math.round(B.p[i + 2] * 2000)}`;
  for (let i = 0; i < B.p.length; i += 3) {
    const k = key(i);
    let a = acc.get(k);
    if (!a) { a = [0, 0, 0]; acc.set(k, a); }
    a[0] += B.n[i]; a[1] += B.n[i + 1]; a[2] += B.n[i + 2];
  }
  for (let i = 0; i < B.p.length; i += 3) {
    const a = acc.get(key(i));
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    B.n[i] = a[0] / l; B.n[i + 1] = a[1] / l; B.n[i + 2] = a[2] / l;
  }
}

// Weld coincident vertices and average the normals of faces within `deg` of each other:
// curved lofted panels become smooth while the design creases stay sharp.
function autoSmooth(B, deg) {
  const cos = Math.cos((deg * Math.PI) / 180);
  const P = B.p, N = B.n, nv = P.length / 3;
  const fn = new Float32Array(nv * 3);
  for (let t = 0; t < nv; t += 3) {
    const i = t * 3;
    const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2];
    const vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // area weighted
    for (let k = 0; k < 3; k++) { fn[i + k * 3] = nx; fn[i + k * 3 + 1] = ny; fn[i + k * 3 + 2] = nz; }
  }
  const groups = new Map();
  for (let v = 0; v < nv; v++) {
    const k = `${Math.round(P[v * 3] * 4000)},${Math.round(P[v * 3 + 1] * 4000)},${Math.round(P[v * 3 + 2] * 4000)}`;
    let g = groups.get(k); if (!g) { g = []; groups.set(k, g); } g.push(v);
  }
  const out = new Float32Array(nv * 3);
  for (const g of groups.values()) {
    for (const v of g) {
      const ax = fn[v * 3], ay = fn[v * 3 + 1], az = fn[v * 3 + 2];
      const al = Math.hypot(ax, ay, az) || 1;
      let sx = 0, sy = 0, sz = 0;
      for (const w of g) {
        const bx = fn[w * 3], by = fn[w * 3 + 1], bz = fn[w * 3 + 2];
        const bl = Math.hypot(bx, by, bz) || 1;
        if ((ax * bx + ay * by + az * bz) / (al * bl) >= cos) { sx += bx; sy += by; sz += bz; }
      }
      const l = Math.hypot(sx, sy, sz);
      if (l > 1e-12) { out[v * 3] = sx / l; out[v * 3 + 1] = sy / l; out[v * 3 + 2] = sz / l; }
      else { out[v * 3] = N[v * 3]; out[v * 3 + 1] = N[v * 3 + 1]; out[v * 3 + 2] = N[v * 3 + 2]; }
    }
  }
  for (let i = 0; i < out.length; i++) N[i] = out[i];
}

class Buckets {
  constructor() { this.map = new Map(); }
  get(key) {
    let b = this.map.get(key);
    if (!b) { b = { p: [], n: [], uv: null }; this.map.set(key, b); }
    return b;
  }
  tri(key, a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-10) return;
    nx /= l; ny /= l; nz /= l;
    const B = this.get(key);
    B.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    B.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }
  quad(key, a, b, c, d) { this.tri(key, a, b, c); this.tri(key, a, c, d); }
  // quad whose winding is flipped if needed so the face points away from `center`
  quadAway(key, a, b, c, d, center) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const fx = (a[0] + b[0] + c[0] + d[0]) / 4 - center[0];
    const fy = (a[1] + b[1] + c[1] + d[1]) / 4 - center[1];
    const fz = (a[2] + b[2] + c[2] + d[2]) / 4 - center[2];
    if (nx * fx + ny * fy + nz * fz >= 0) this.quad(key, a, b, c, d);
    else this.quad(key, d, c, b, a);
  }
  // mirrored pair (+x as given, -x mirrored with reversed winding)
  quadM(key, a, b, c, d) { this.quad(key, a, b, c, d); this.quad(key, mx(d), mx(c), mx(b), mx(a)); }
  triM(key, a, b, c) { this.tri(key, a, b, c); this.tri(key, mx(c), mx(b), mx(a)); }
  geom(key, g, matrix) {
    let gg = g.index ? g.toNonIndexed() : g.clone();
    if (matrix) gg.applyMatrix4(matrix);
    if (!gg.attributes.normal) gg.computeVertexNormals();
    const B = this.get(key);
    const P = gg.attributes.position.array, N = gg.attributes.normal.array;
    for (let i = 0; i < P.length; i++) { B.p.push(P[i]); B.n.push(N[i]); }
    gg.dispose();
  }
  warp(fn) {
    for (const B of this.map.values()) {
      const P = B.p, N = B.n;
      const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
      for (let i = 0; i < P.length; i += 9) {
        a[0] = P[i]; a[1] = P[i + 1]; a[2] = P[i + 2];
        b[0] = P[i + 3]; b[1] = P[i + 4]; b[2] = P[i + 5];
        c[0] = P[i + 6]; c[1] = P[i + 7]; c[2] = P[i + 8];
        const m = fn(a) | fn(b) | fn(c);
        if (!m) continue;
        P[i] = a[0]; P[i + 1] = a[1]; P[i + 2] = a[2];
        P[i + 3] = b[0]; P[i + 4] = b[1]; P[i + 5] = b[2];
        P[i + 6] = c[0]; P[i + 7] = c[1]; P[i + 8] = c[2];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        for (let k = 0; k < 3; k++) { N[i + k * 3] = nx; N[i + k * 3 + 1] = ny; N[i + k * 3 + 2] = nz; }
      }
    }
  }
  build(materials, parent, opts = {}) {
    const meshes = {};
    for (const [key, B] of this.map) {
      if (!B.p.length) continue;
      const crease = AUTOSMOOTH[materials[key] && materials[key].name];
      if (crease) autoSmooth(B, crease);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
      if (opts.translate) g.translate(opts.translate[0], opts.translate[1], opts.translate[2]);
      g.computeBoundingSphere();
      const mat = materials[key];
      if (!mat) throw new Error('RoadsterModel: missing material ' + key);
      const m = new THREE.Mesh(g, mat);
      m.name = (opts.prefix || '') + key;
      m.castShadow = opts.castShadow !== false && !mat.transparent;
      m.receiveShadow = !mat.transparent;
      parent.add(m);
      meshes[key] = m;
      if (key === 'glass' && materials.glassInner) {
        // seen from inside the cabin the glass is only lightly tinted (exterior faces use FrontSide)
        const inner = new THREE.Mesh(g, materials.glassInner);
        inner.name = m.name + '_inner'; inner.renderOrder = 1;
        parent.add(inner);
      }
    }
    return meshes;
  }
}

// Extrude a closed outline drawn in the side (z, y) plane into a plate of `thickness` along X.
function extrudeYZ(pts, thickness, curveSegments = 6) {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments });
  g.rotateY(Math.PI / 2);
  g.translate(-thickness / 2, 0, 0);
  return g;
}

// Thick ribbon along a (z, y) polyline (for swan-neck struts)
function ribbonOutline(center, thick) {
  const L = [], R = [];
  for (let i = 0; i < center.length; i++) {
    const p = center[i];
    const a = center[Math.max(0, i - 1)], b = center[Math.min(center.length - 1, i + 1)];
    let tz = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tz, ty) || 1; tz /= l; ty /= l;
    const nz = -ty, ny = tz;
    L.push([p[0] + nz * thick * 0.5, p[1] + ny * thick * 0.5]);
    R.push([p[0] - nz * thick * 0.5, p[1] - ny * thick * 0.5]);
  }
  return L.concat(R.reverse());
}

// ---------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------
// lit centre-screen UI glow: dark gradient, car wireframe-ish shape and status bars (no text)
function makeScreenTexture() {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas'); c.width = 512; c.height = 320;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 320); gr.addColorStop(0, '#0d1118'); gr.addColorStop(1, '#05070a');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 320);
    g.strokeStyle = 'rgba(200,210,225,0.55)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(130, 190); g.lineTo(190, 150); g.lineTo(300, 135); g.lineTo(390, 160); g.lineTo(400, 195); g.lineTo(130, 200); g.closePath(); g.stroke();
    for (const x of [185, 345]) { g.beginPath(); g.arc(x, 200, 22, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = 'rgba(220,40,40,0.8)'; g.fillRect(40, 270, 120, 6); g.fillRect(360, 270, 110, 6);
    g.fillStyle = 'rgba(200,210,225,0.35)'; for (let i = 0; i < 6; i++) g.fillRect(40 + i * 75, 28, 50, 5);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  } catch (e) { return null; }
}

function makePlateTexture() {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#ecece8'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = '#8d8d8a'; g.lineWidth = 10; g.strokeRect(10, 10, 492, 236);
    g.fillStyle = '#26272a';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 142px "Eurostile", "Bahnschrift", "Arial Narrow", Arial, sans-serif';
    g.fillText('RDSTR', 256, 138);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  } catch (e) { return null; }
}

function makeMaterials() {
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const plateTex = makePlateTexture();
  return {
    // Ano White satin pearl
    white: P({ name: 'AnoWhite', color: 0xe6e7e3, roughness: 0.38, metalness: 0.0, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.25, sheenColor: 0xffffff, sheenRoughness: 0.6 }),
    // gloss black lower body
    black: P({ name: 'GlossBlack', color: 0x0b0b0c, roughness: 0.2, metalness: 0.15, clearcoat: 1.0, clearcoatRoughness: 0.06 }),
    trim: S({ name: 'MatteBlack', color: 0x060606, roughness: 0.62, metalness: 0.1 }),
    // gold-tinted dark glass
    // roughness 0.2: at 0.05 the overhead directional light reflected as a blown-out bloom star on the door glass
    glass: P({ name: 'GoldGlass', color: 0x1c1309, roughness: 0.2, metalness: 0.0, specularColor: 0xe0a85c, specularIntensity: 0.6, ior: 1.6, transparent: true, opacity: 0.955, side: THREE.FrontSide, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    // black glass roof canopy / rear glass
    glassInner: P({ name: 'GoldGlassInner', color: 0x2a1c0c, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.28, side: THREE.BackSide, depthWrite: false }),
    // roof canopy reads as one continuous dark gold glass surface with the windshield (studio renders)
    canopy: P({ name: 'BlackCanopy', color: 0x1a1209, roughness: 0.05, metalness: 0.0, specularColor: 0xe0a85c, specularIntensity: 1.0, ior: 1.6, clearcoat: 1.0, clearcoatRoughness: 0.03 }),
    interior: S({ name: 'Interior', color: 0x1c1c1f, roughness: 0.9, metalness: 0.0 }),
    seat: S({ name: 'Seat', color: 0xd9d9d5, roughness: 0.75 }),
    suede: S({ name: 'Suede', color: 0x58585c, roughness: 0.95 }),
    carbon: P({ name: 'Carbon', color: 0x101012, roughness: 0.4, metalness: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.2 }),
    metal: S({ name: 'DarkMetal', color: 0x2b2c30, metalness: 0.85, roughness: 0.33 }),
    bronze: S({ name: 'Bronze', color: 0xb5793f, metalness: 1.0, roughness: 0.26 }),
    nozzleIn: S({ name: 'NozzleInner', color: 0x0d0b0a, metalness: 0.7, roughness: 0.45, side: THREE.DoubleSide }),
    amber: S({ name: 'Amber', color: 0xff8c1a, emissive: 0xff7400, emissiveIntensity: 1.6 }),
    plate: S({ name: 'Plate', color: plateTex ? 0xffffff : 0xe6e6e2, map: plateTex, roughness: 0.45, metalness: 0.1 }),
    tank: P({ name: 'Tank', color: 0xd8d8d8, roughness: 0.3, metalness: 0.6, clearcoat: 0.5 }),
    // wheels
    tire: S({ name: 'Tire', color: 0x121212, roughness: 0.88, metalness: 0.0 }),
    spoke: P({ name: 'Spoke', color: 0x26272b, roughness: 0.28, metalness: 0.85, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
    spokeFace: P({ name: 'SpokeFace', color: 0xa9adb3, roughness: 0.25, metalness: 0.9, clearcoat: 0.5 }),
    rim: S({ name: 'RimBarrel', color: 0x1a1a1d, roughness: 0.4, metalness: 0.7 }),
    disc: P({ name: 'WheelDisc', color: 0x45474b, roughness: 0.38, metalness: 0.55, clearcoat: 0.4 }),
    ambient: S({ name: 'AmbientRed', color: 0x300000, emissive: 0xff1410, emissiveIntensity: 3.2, roughness: 0.6 }),
    screen: S({ name: 'Screen', color: 0x050608, emissive: 0xffffff, emissiveMap: makeScreenTexture(), emissiveIntensity: 1.2, roughness: 0.12, metalness: 0.2 }),
    accent: S({ name: 'RedAccent', color: 0xc8141c, roughness: 0.35, metalness: 0.3, emissive: 0x200000 }),
    // lights (each its own material so the game can drive emissiveIntensity independently)
    head: S({ name: 'HeadLight', color: 0xffffff, emissive: 0xf2f6ff, emissiveIntensity: 3.0, roughness: 0.2 }),
    tail: S({ name: 'TailLight', color: 0x400000, emissive: 0xff1018, emissiveIntensity: 2.2, roughness: 0.3 }),
    brake: S({ name: 'BrakeLight', color: 0x400000, emissive: 0xff1018, emissiveIntensity: 0.9, roughness: 0.3 }),
  };
}

// ---------------------------------------------------------------------------------------------
// Body loft
// ---------------------------------------------------------------------------------------------
const OPAQUE = new Set(['white', 'black', 'canopy']);

function bodyMaterial(band, z) {
  switch (band) {
    case 0: case 1: case 2: return 'black';
    // the haunch-to-tail corner (z < -1.86) is a dark smoked panel from the shoulder down (studio render)
    case 3: return 'white';
    case 4: return z < -1.94 ? 'black' : 'white'; // smoked upper tail-corner panel (side + studio renders)
    case 5:
      if (z >= DOOR_BANDS[5][1] && z < Z_COWL) return 'glass'; // fixed glass ahead of the door
      if (z <= DOOR_BANDS[5][0] && z > Z_BPILLAR) return 'black'; // B-pillar
      if (z <= Z_BPILLAR && z > Z_QWIN) return 'glass'; // triangular quarter window
      return 'white';
    case 6: // A-pillar / roof rail: dark glass-black, so the canopy reads as one continuous glass shape (Tesla renders)
      return 'white'; // thin bright A-pillar / roof-rail strip (side + front renders)
    case 7:
      if (z > Z_COWL) return 'white';
      if (z > Z_ROOF) return 'glass';
      if (z > Z_SAIL) return 'canopy';
      return 'white';
    default:
      if (z > Z_COWL) return 'white';
      if (z > Z_ROOF) return 'glass';
      if (z > Z_RGLASS) return 'canopy';
      return 'white';
  }
}

function emitBand(B, key, a0, b0, b1, a1, sign, interior) {
  if (sign > 0) B.quad(key, a0, b0, b1, a1);
  else B.quad(key, mx(a0), mx(a1), mx(b1), mx(b0));
  if (interior) {
    if (sign > 0) B.quad(interior, a0, a1, b1, b0);
    else B.quad(interior, mx(a0), mx(b0), mx(b1), mx(a1));
  }
}

// Sutherland-Hodgman: keep the part of a convex polygon where f(v) >= 0
function clipPoly(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

// emit a polygon given in loft order (a0, b0, b1, a1) on one side
function emitPoly(B, key, poly, sign, interior) {
  if (poly.length < 3) return;
  const P = sign > 0 ? poly : poly.map(mx).reverse();
  for (let i = 1; i < P.length - 1; i++) B.tri(key, P[0], P[i], P[i + 1]);
  if (interior) for (let i = 1; i < P.length - 1; i++) B.tri(interior, P[i + 1], P[i], P[0]);
}

// ---------------------------------------------------------------------------------------------
// Deck-panel wing planform (M10, rear-wing reference photo): the wing IS the rear deck panel.
// Stowed it is cut out of the body loft (same surface, same paint) with a thin shut gap; deployed it
// lifts away and leaves a dark cavity of exactly this outline. Trapezoid in plan (x half-width w(z)):
// front edge just behind the rear glass, rear edge at the tail lip, sides diverging rearward along the
// deck/sail crease direction of Tesla's wingless hero-rear render.
// ---------------------------------------------------------------------------------------------
// Convex hexagon: centre front edge (|x| < wL) at zL, diagonal out over the haunch tops to (wT, zK),
// fore-aft edges at |x| = wT, rear edge at zT.
const DECK = { zL: -1.765, wL: 0.58, zK: -1.8, wT: 0.92, zT: -2.133, gap: 0.004, depth: 0.15,
  // Down-turned tips = the panel's end-plates, rigid with it (user correction): stowed they are the body's
  // rear corners, i.e. the haunch-top strip outside |x| = wT and the upper side wall down to the lower
  // crease P3, behind a front cut that starts at zF on the shoulder crease P4 and slants back to zC low on
  // the side wall (rear-wing reference photo: dark notch under the crease, slanted front edge). B = rear-low.
  zF: -1.879, zC: -1.922, yC: 0.7, yB: 0.756, tipDepth: 0.05 };
// +x-half edge lines as normalised a*x + c*z + d >= 0 (inside)
let DECK_EDGES = null, CUT_PIECES = null;
function deckEdges() {
  const dx = DECK.wT - DECK.wL, dz = DECK.zK - DECK.zL, l = Math.hypot(dx, dz);
  let a = dz / l, c = -dx / l; if (a * 0 + c * DECK.zT - (a * DECK.wL + c * DECK.zL) < 0) { a = -a; c = -c; }
  DECK_EDGES = [[0, -1, DECK.zL], [a, c, -(a * DECK.wL + c * DECK.zL)], [-1, 0, DECK.wT], [0, 1, -DECK.zT]];
  const xz = ([p, q, r]) => (v, g) => p * v[0] + q * v[2] + r - g; // plan-view line
  const zy = ([p, q, r]) => (v, g) => p * v[2] + q * v[1] + r - g; // side-view line (z, y)
  const line = (p, q, inPt) => { // through p, q in (z, y); inside contains inPt
    let A = q[1] - p[1], Bq = p[0] - q[0]; const ll = Math.hypot(A, Bq); A /= ll; Bq /= ll;
    let C = -(A * p[0] + Bq * p[1]); if (A * inPt[0] + Bq * inPt[1] + C < 0) { A = -A; Bq = -Bq; C = -C; }
    return [A, Bq, C];
  };
  DECK.yD = profileAt(DECK.zF)[4][1];
  const Dp = [DECK.zF, DECK.yD], Cp = [DECK.zC, DECK.yC], Bp = [DECK.zT, DECK.yB];
  const [E0, E1, E2, E3] = DECK_EDGES.map(xz), xIn = xz([1, 0, -DECK.wT]), zF = xz([0, 1, -DECK.zF]), zFb = xz([0, -1, DECK.zF]);
  // convex pieces; each function carries whether it is a real shut line (gap + wall) or an internal seam
  CUT_PIECES = {
    top: [
      { kind: 'deck', fns: [[E0, 1], [E1, 1], [E2, 1], [zF, 0]] }, // ahead of zF: hexagon
      { kind: 'deck', fns: [[E2, 0], [zFb, 0], [E3, 1]] }, // behind zF, inside |x| = wT
      { kind: 'tip', fns: [[xIn, 0], [zFb, 1], [E3, 1]] }, // behind zF, outside |x| = wT: haunch-top strip
    ],
    side: [{ kind: 'tip', fns: [[zy(line(Dp, Cp, [DECK.zT, DECK.yD])), 1], [zy(line(Cp, Bp, [DECK.zT + 0.05, 0.95])), 1], [E3, 1]] }],
  };
  return DECK_EDGES;
}
// (deckEdges() runs at the start of buildBodyShell; profileAt must be ready first)
// planform half-width at z (shrunk by g)
const deckW = (z, g = 0) => {
  let w = Infinity;
  for (const [a, c, d] of DECK_EDGES) if (a < -1e-9) w = Math.min(w, (c * z + d - g) / -a);
  return w;
};
// corners of the (shrunk) outline on the +x side: front-centre, diagonal/tip, tip/rear
const deckCorners = (g) => {
  const E = DECK_EDGES.map(([a, c, d]) => [a, c, d - g]);
  const X = (p, q) => { const det = p[0] * q[1] - q[0] * p[1]; return [(-p[2] * q[1] + q[2] * p[1]) / det, (-p[0] * q[2] + q[0] * p[2]) / det]; };
  return [X(E[0], E[1]), X(E[1], E[2]), X(E[2], E[3])]; // [x, z] each
};
// +x-side polygons of the carved panel: deck hole (height lookup), tip holes [poly, real shut-line fns],
// panel skin ['white', poly, real fns shrunk by the gap]
const DECK_CUT = { hole: [], tip: [], skin: [] };
function carveDeck(poly, band) {
  if (band < 3) return { out: [poly] };
  let zmin = Infinity, zmax = -Infinity;
  for (const v of poly) { zmin = Math.min(zmin, v[2]); zmax = Math.max(zmax, v[2]); }
  if (zmax < DECK.zT - 1e-6 || zmin > DECK.zL + 1e-6) return { out: [poly] };
  let cur = [poly], hit = false;
  for (const pc of band >= 4 ? CUT_PIECES.top : CUT_PIECES.side) {
    const next = [];
    for (const p of cur) {
      let rem = p;
      for (const [fn] of pc.fns) {
        const o = clipPoly(rem, (v) => -fn(v, 0));
        if (o.length >= 3) next.push(o);
        rem = clipPoly(rem, (v) => fn(v, 0));
        if (rem.length < 3) break;
      }
      if (rem.length < 3) continue;
      hit = true;
      const real0 = pc.fns.filter((e) => e[1]).map(([fn]) => (v) => fn(v, 0));
      const realG = pc.fns.filter((e) => e[1]).map(([fn]) => (v) => fn(v, DECK.gap));
      let skin = rem;
      for (const fn of realG) { skin = clipPoly(skin, fn); if (skin.length < 3) break; }
      if (skin.length >= 3) DECK_CUT.skin.push(['white', skin, realG, pc.kind]);
      if (pc.kind === 'deck') DECK_CUT.hole.push(rem); else DECK_CUT.tip.push([rem, real0]);
    }
    cur = next;
  }
  return { out: cur, hit };
}

function buildBodyShell(B, stations, profiles) {
  DECK_CUT.hole.length = 0; DECK_CUT.tip.length = 0; DECK_CUT.skin.length = 0; deckEdges();
  for (let s = 0; s < stations.length - 1; s++) {
    const za = stations[s], zb = stations[s + 1], zm = (za + zb) / 2;
    const A = profiles[s], P = profiles[s + 1];
    for (let b = 0; b < 10; b++) {
      const key = bodyMaterial(b, zm);
      if (!key) continue;
      const CA = bandCurve(A, b), CP = bandCurve(P, b);
      for (let k = 0; k < CA.length - 1; k++) {
      const a0 = [CA[k][0], CA[k][1], za], a1 = [CA[k + 1][0], CA[k + 1][1], za];
      const b0 = [CP[k][0], CP[k][1], zb], b1 = [CP[k + 1][0], CP[k + 1][1], zb];
      const inner = OPAQUE.has(key) ? (key === 'canopy' ? 'suede' : 'interior') : null; // grey microsuede headliner under the black canopy (cockpit render)
      if (b >= 3 && b <= 5) {
        // cut the door opening out along the slanted shut lines
        const quad = [a0, b0, b1, a1];
        const front = clipPoly(quad, (v) => v[2] - DOOR_CUT.front(b, v[1]));
        const rear = clipPoly(quad, (v) => DOOR_CUT.rear(b, v[1]) - v[2]);
        if (b === 5) {
          // fixed glass ahead of the door; slanted black B-pillar strip; quarter glass behind
          const fk = zm < Z_COWL ? 'glass' : 'white';
          emitPoly(B, fk, front, 1, null); emitPoly(B, fk, front, -1, null);
          const pillar = clipPoly(rear, (v) => v[2] - (DOOR_CUT.rear(5, v[1]) - B_PILLAR_W));
          const qwin = clipPoly(rear, (v) => DOOR_CUT.rear(5, v[1]) - B_PILLAR_W - v[2]);
          for (const sg of [1, -1]) emitPoly(B, 'black', pillar, sg, 'interior');
          if (zm > Z_QWIN) { for (const sg of [1, -1]) emitPoly(B, 'glass', qwin, sg, null); continue; }
          const c = qwin.length >= 3 ? carveDeck(qwin, b) : { out: [] }; // the deck panel also takes this strip near the tail
          for (const o of c.out) for (const sg of [1, -1]) emitPoly(B, 'white', o, sg, 'interior');
          continue;
        }
        for (const piece of [front, rear]) {
          if (piece.length < 3) continue;
          const c = carveDeck(piece, b);
          for (const o of c.out) { emitPoly(B, key, o, 1, inner); emitPoly(B, key, o, -1, inner); }
        }
        continue;
      }
      const c = carveDeck([a0, b0, b1, a1], b);
      if (c.hit) {
        // deck panel region: the body keeps only what lies outside the planform
        for (const o of c.out) { emitPoly(B, key, o, 1, inner); emitPoly(B, key, o, -1, inner); }
        continue;
      }
      emitBand(B, key, a0, b0, b1, a1, 1, inner);
      emitBand(B, key, a0, b0, b1, a1, -1, inner);
      }
    }
  }
  // Nose cap: triangle fan, black fascia (white corners come from the loft chamfer)
  const N = denseProfile(profiles[0]);
  const C = [0, 0.33, Z_NOSE]; // fan centre on the centreline (an off-centre centre made overlapping mirrored faces)
  const pt = (p) => [p[0], p[1], Z_NOSE];
  for (let i = 0; i < N.length - 1; i++) {
    B.triM('black', C, pt(N[i]), pt(N[i + 1]));
    B.triM('interior', pt(N[i + 1]), pt(N[i]), C);
  }
  B.triM('black', C, pt(N[N.length - 1]), pt(N[0]));
  // Tail cap: horizontal strips per band (white upper panel, black lower)
  const T = denseProfile(profiles[profiles.length - 1]);
  for (let i = 0; i < T.length - 1; i++) {
    const p = T[i], q = T[i + 1];
    if (Math.abs(q[1] - p[1]) < 1e-5) continue;
    // the tail face is white down to the diffuser/bumper line, black below
    const Y_SPLIT = 0.745; // white tail band full width from the light bar down to y 0.745 (M12: 040149 back-projected 0.756-0.81, hero render 0.74-0.81)
    const parts = [];
    if (q[1] <= Y_SPLIT || p[1] >= Y_SPLIT) parts.push([p, q, q[1] <= Y_SPLIT ? 'black' : 'white']);
    else {
      const t = (Y_SPLIT - p[1]) / (q[1] - p[1]);
      const mid = [p[0] + (q[0] - p[0]) * t, Y_SPLIT];
      parts.push([p, mid, 'black'], [mid, q, 'white']);
    }
    for (const [u, w, key] of parts) {
      const a = [0, u[1], Z_TAIL], b = [0, w[1], Z_TAIL], c = [w[0], w[1], Z_TAIL], d = [u[0], u[1], Z_TAIL];
      B.quadM(key, a, b, c, d);
      B.quadM('interior', d, c, b, a);
    }
  }
}

function buildDoorShell(B, stations, sign) {
  const z0 = 1.12, z1 = -0.42;
  const zs = [z0, ...stations.filter((z) => z < z0 - 1e-4 && z > z1 + 1e-4), z1];
  const prof = zs.map(profileAt);
  for (const band of [3, 4, 5]) {
    for (let s = 0; s < zs.length - 1; s++) {
      const za = zs[s], zb = zs[s + 1];
      const A = prof[s], P = prof[s + 1];
      const b = band;
      const key = band === 5 ? 'glass' : 'white';
      const CA = bandCurve(A, b), CP = bandCurve(P, b);
      for (let k = 0; k < CA.length - 1; k++) {
      const a0 = [CA[k][0], CA[k][1], za], a1 = [CA[k + 1][0], CA[k + 1][1], za];
      const b0 = [CP[k][0], CP[k][1], zb], b1 = [CP[k + 1][0], CP[k + 1][1], zb];
      // shave the bottom edge of the door slightly so a shut-line shows against the sill
      if (band === 3 && k === 0) { a0[1] += DOOR_GAP; b0[1] += DOOR_GAP; }
      if (band === 5) { a1[1] -= DOOR_GAP * 0.5; b1[1] -= DOOR_GAP * 0.5; }
      let poly = clipPoly([a0, b0, b1, a1], (v) => DOOR_CUT.front(b, v[1]) - DOOR_GAP - v[2]);
      poly = clipPoly(poly, (v) => v[2] - DOOR_CUT.rear(b, v[1]) - DOOR_GAP);
      emitPoly(B, key, poly, sign, key === 'white' ? 'interior' : null);
      }
    }
  }
  // inner window frame: black sill along the belt and a black frame along the glass rear edge
  for (let s = 0; s < 6; s++) {
    const za = 0.9 - s * 0.2, zb = za - 0.2;
    const A = profileAt(za), P = profileAt(zb);
    const pa = [A[5][0] - 0.035, A[5][1], za], pb = [P[5][0] - 0.035, P[5][1], zb];
    const qa = [pa[0], pa[1] - 0.05, za], qb = [pb[0], pb[1] - 0.05, zb];
    if (sign > 0) B.quad('trim', qa, pa, pb, qb); else B.quad('trim', mx(qa), mx(qb), mx(pb), mx(pa));
  }
  {
    const P = profileAt(-0.33);
    const y0 = P[5][1], y1 = P[6][1] - 0.01, z0 = DOOR_CUT.rear(5, y0) + 0.01, z1 = DOOR_CUT.rear(5, y1) + 0.01;
    const x0 = P[5][0] - 0.03, x1 = P[6][0] - 0.02;
    const a = [x0, y0, z0], b = [x1, y1, z1], c = [x1, y1, z1 + 0.04], d = [x0, y0, z0 + 0.04];
    if (sign > 0) B.quad('trim', a, b, c, d); else B.quad('trim', mx(d), mx(c), mx(b), mx(a));
  }
  // door inner trim (visible with the doors open, cockpit render): grey microsuede panel, black
  // armrest pocket with a red ambient light channel, carbon upper trim along the window line, pull handle
  const zp = [0.82, 0.55, 0.25, -0.05, -0.22];
  const inner = (z, d) => {
    const P = profileAt(z);
    const yb = P[3][1] + 0.06, yt = P[5][1] - 0.04;
    return (t) => [P[3][0] + (P[5][0] - P[3][0]) * t - d, yb + (yt - yb) * t, z];
  };
  const q = (key, a0, a1, b1, b0) => {
    if (sign > 0) B.quad(key, a0, a1, b1, b0); else B.quad(key, mx(a0), mx(b0), mx(b1), mx(a1));
  };
  for (let k = 0; k < zp.length - 1; k++) {
    const A = inner(zp[k], 0.06), P = inner(zp[k + 1], 0.06);
    q('suede', A(0), A(0.45), P(0.45), P(0));
    q('suede', A(0.7), A(0.78), P(0.78), P(0.7));
    q('carbon', A(0.78), A(1), P(1), P(0.78));
    const A2 = inner(zp[k], 0.075), P2 = inner(zp[k + 1], 0.075);
    q('interior', A2(0.45), A2(0.7), P2(0.7), P2(0.45)); // recessed pocket
    const u = k / (zp.length - 1), v = (k + 1) / (zp.length - 1);
    const A3 = inner(zp[k], 0.078), P3 = inner(zp[k + 1], 0.078);
    q('ambient', A3(0.3 + 0.3 * u), A3(0.42 + 0.3 * u), P3(0.42 + 0.3 * v), P3(0.3 + 0.3 * v)); // wide rising red light band (cockpit render)
    if (k < zp.length - 2) q('ambient', A3(0.4), A3(0.44), P3(0.44), P3(0.4)); // lower edge of the pocket: the band wraps around it
    const A4 = inner(zp[k], 0.035), P4 = inner(zp[k + 1], 0.035);
    q('suede', A4(0.72), A4(0.8), P4(0.8), P4(0.72)); // raised armrest bolster above the pocket (panel relief)
  }
  {
    const P = inner(0.15, 0.09);
    const a = P(0.55), b = P(0.62);
    const g = boxGeo(-0.012, 0.012, -0.012, 0.012, -0.09, 0.09);
    g.translate(sign * a[0], (a[1] + b[1]) / 2, 0.15);
    B.geom('metal', g); // door pull
  }
}

// Patch on the surface of a body band (between profile points band and band+1), offset outward.
function surfacePatch(B, key, z0, z1, band, t0, t1, offset, mirror = true, steps = 3, useY = false) {
  const point = (P, z, t) => { const q = bandPoint(P, band, t, useY); return [q[0], q[1], z]; };
  for (let i = 0; i < steps; i++) {
    const za = z0 + ((z1 - z0) * i) / steps, zb = z0 + ((z1 - z0) * (i + 1)) / steps;
    const A = profileAt(za), P = profileAt(zb);
    const q = [point(A, za, t0), point(P, zb, t0), point(P, zb, t1), point(A, za, t1)];
    // the quad (a0,b0,b1,a1) follows the loft winding when z0 > z1
    const ord = z0 > z1 ? q : [q[1], q[0], q[3], q[2]];
    const u = [ord[1][0] - ord[0][0], ord[1][1] - ord[0][1], ord[1][2] - ord[0][2]];
    const v = [ord[2][0] - ord[0][0], ord[2][1] - ord[0][1], ord[2][2] - ord[0][2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((c) => (c / l) * offset);
    const o = ord.map((p) => [p[0] + n[0], p[1] + n[1], p[2] + n[2]]);
    if (mirror) B.quadM(key, o[0], o[1], o[2], o[3]);
    else B.quad(key, o[0], o[1], o[2], o[3]);
  }
}

// Width of the tail face at height y
function tailHalfWidth(y) {
  const T = profileAt(Z_TAIL);
  for (let i = 0; i < T.length - 1; i++) {
    const p = T[i], q = T[i + 1];
    if ((y >= p[1] && y <= q[1]) || (y <= p[1] && y >= q[1])) {
      const t = Math.abs(q[1] - p[1]) < 1e-6 ? 0 : (y - p[1]) / (q[1] - p[1]);
      return p[0] + (q[0] - p[0]) * t;
    }
  }
  return 0.9;
}

// box with rounded vertical corners and bevelled faces (exterior trim: no razor-sharp CG edges)
function bevBox(x0, x1, y0, y1, z0, z1, r = 0.01, bev = 0.004) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const g = roundBox(w, h, d, Math.max(0.0005, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3)), Math.max(0, Math.min(bev, d / 2 - 1e-4, h / 2 - 1e-4, w / 2 - 1e-4)));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
function boxGeo(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function buildDetails(B, L, trim) {
  // ---- front ----
  // splitter / lip
  B.geom('trim', bevBox(-0.6, 0.6, 0.2, 0.265, 1.95, 2.36, 0.03, 0.008)); // protruding splitter lip (side render: y 0.2-0.27, to z 2.31 after warpNose)
  // horizontal slat across the black fascia
  B.geom('black', bevBox(-0.58, 0.58, 0.33, 0.345, 2.25, 2.268, 0.006, 0.004));
  // hidden-headlight LED slit across the nose + lamps in the fender notches
  L.head.geom('head', boxGeo(-0.62, 0.62, 0.466, 0.482, 2.25, 2.262));
  surfacePatch(L.head, 'head', 2.165, 2.12, 7, 0.3, 0.75, 0.003, true, 1); // small LED clusters at the hood/fender corners
  // amber side marker behind the front arch
  surfacePatch(B, 'trim', 1.18, 0.88, 3, 0.615, 0.65, 0.003, true, 3, true); // continuous black side blade (side render)
  surfacePatch(B, 'amber', 1.13, 1.08, 3, 0.62, 0.645, 0.006, true, 1, true); // amber marker at its front end

  // thin dark seam where the windshield meets the roof canopy (studio renders)
  for (const band of [7, 8, 9]) surfacePatch(B, 'trim', Z_ROOF + 0.006, Z_ROOF - 0.006, band, 0, 1, 0.002, true, 1);
  // ---- rear ----
  const hwBar = tailHalfWidth(0.865);
  B.geom('trim', bevBox(-hwBar, hwBar, 0.825, 0.9, Z_TAIL - 0.009, Z_TAIL - 0.001, 0.02, 0.003)); // black light-bar housing (shallow: the deck-panel cavity is right behind it)
  L.tail.geom('tail', boxGeo(-(hwBar - 0.002), hwBar - 0.002, 0.859, 0.875, Z_TAIL - 0.013, Z_TAIL - 0.005));
  L.brake.geom('brake', boxGeo(-(hwBar - 0.03), hwBar - 0.03, 0.836, 0.842, Z_TAIL - 0.013, Z_TAIL - 0.005));
  // red side markers behind the rear wheels
  surfacePatch(L.tail, 'tail', -1.865, -1.895, 2, 0.64, 0.665, 0.004, true, 1, true); // red marker along the rear crease (side render)
  // trapezoid air outlets on the rear quarters (040046) and vertical slots on the tail corners (rear render)
  // recessed trapezoid quarter vents on the rear corner chamfer, below the light-bar ends (040046)
  // large smoked corner panel: covers the haunch-to-tail corner from the shoulder down to the crease (studio render)
  // ---- M12 tail face (040149 back-projected onto the tail plane, hero rear render, rear-wing reference photo) ----
  // protruding white blade under the light bar (its lit top reads as a bright ledge in rear-wing reference photo)
  { const hw = tailHalfWidth(0.81) - 0.04;
    const sh = new THREE.Shape([[-hw, 0], [hw, 0], [hw - 0.03, -0.028], [-(hw - 0.03), -0.028]].map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
    g.rotateX(Math.PI / 2); g.translate(0, 0.826, Z_TAIL - 0.001); B.geom('white', g); }
  // white centre panel bulging down around the plate: measured lower edge (x, y)
  { const E = [[0.9, 0.745], [0.71, 0.742], [0.665, 0.715], [0.635, 0.672], [0.6, 0.636], [0.55, 0.606], [0.45, 0.594], [0.2, 0.587], [0, 0.585]]; // 040149: ends (0.62, 0.643), bottom (0.52, 0.595)
    const pts = [...E.map(([x, y]) => new THREE.Vector2(x, y)), ...E.slice(0, -1).reverse().map(([x, y]) => new THREE.Vector2(-x, y))];
    pts.push(new THREE.Vector2(-0.9, 0.752), new THREE.Vector2(0.9, 0.752));
    const tg = new THREE.ShapeGeometry(new THREE.Shape(pts), 8); tg.rotateY(Math.PI); tg.translate(0, 0, Z_TAIL - 0.003); B.geom('white', tg); }
  for (const sx of [-1, 1]) B.geom('trim', bevBox(sx * 0.8 - 0.01, sx * 0.8 + 0.01, 0.6, 0.7, Z_TAIL - 0.004, Z_TAIL + 0.01, 0.008, 0.002)); // small corner slots
  // plate recess
  B.geom('trim', bevBox(-0.18, 0.18, 0.565, 0.745, Z_TAIL - 0.005, Z_TAIL + 0.01, 0.015, 0.003));
  // rounded nozzle / diffuser bezel: raised gloss-black rim around a recessed band (x +-0.70, y 0.215-0.545)
  const rrect = (w, y0, y1, r) => {
    // rounded bottom corners, chamfered top corners (040149: octagonal bezel top)
    const c = Math.min(1.6 * r, (y1 - y0) / 2);
    const sh = new THREE.Shape(); sh.moveTo(-w + r, y0); sh.lineTo(w - r, y0); sh.quadraticCurveTo(w, y0, w, y0 + r); sh.lineTo(w, y1 - c); sh.lineTo(w - c, y1);
    sh.lineTo(-w + c, y1); sh.lineTo(-w, y1 - c); sh.lineTo(-w, y0 + r); sh.quadraticCurveTo(-w, y0, -w + r, y0); return sh;
  };
  {
    const zf = Z_TAIL - 0.025, w = 0.68, yb = 0.19, yt = 0.575;
    B.geom('trim', boxGeo(-w, w, yb, yt, Z_TAIL - 0.004, Z_TAIL + 0.3)); // back wall / plenum (inside)
    const outer = rrect(0.725, 0.19, 0.565, 0.075), hole = rrect(0.7, 0.215, 0.545, 0.06);
    outer.holes.push(hole);
    const rim = new THREE.ExtrudeGeometry(outer, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2, curveSegments: 8 });
    rim.rotateY(Math.PI); rim.translate(0, 0, Z_TAIL - 0.002); B.geom('black', rim);
    const band = new THREE.ShapeGeometry(rrect(0.7, 0.215, 0.545, 0.06), 8); band.rotateY(Math.PI); band.translate(0, 0, Z_TAIL - 0.0025); B.geom('nozzleIn', band); // dark recessed field
    // slim nozzle shelf under the row (shelf y 0.448 in 040149)
    { const sh = rrect(0.6, 0.436, 0.448, 0.006); const g = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 }); g.rotateY(Math.PI); g.translate(0, 0, Z_TAIL - 0.003); B.geom('black', g); }
    if (trim === 'rocket') for (const x of [-0.326, 0, 0.326]) B.geom('trim', boxGeo(x - 0.008, x + 0.008, yb, 0.43, zf + 0.005, Z_TAIL));
    if (trim !== 'rocket') {
      // thin raked diffuser strakes flanking the nozzles (hero rear render: pointed blades under the row)
      const fin = [[Z_TAIL + 0.3, 0.2], [Z_TAIL + 0.02, 0.43], [Z_TAIL - 0.022, 0.43], [Z_TAIL - 0.03, 0.33], [Z_TAIL - 0.012, 0.222], [Z_TAIL + 0.1, 0.2]]; // inside the bezel (040149)
      for (const x of [-0.53, -0.265, 0, 0.265, 0.53]) {
        const g = extrudeYZ(fin, 0.007); g.rotateZ(-x * 0.16); g.translate(x, 0, 0); B.geom('trim', g); // outer ones cant outward
      }
    }
    for (const x of trim === 'rocket' ? [-0.487, -0.163, 0.163, 0.487] : []) {
      const zc = Z_TAIL - 0.012;
      const disc = new THREE.CircleGeometry(0.118, 32); disc.rotateY(Math.PI); disc.translate(x, 0.27, zc + 0.008);
      B.geom('nozzleIn', disc);
      for (let k = 0; k < 9; k++) {
        const bl = boxGeo(-0.009, 0.009, 0.03, 0.112, -0.004, 0.004);
        bl.rotateY(0.5); bl.rotateZ((k / 9) * Math.PI * 2); bl.translate(x, 0.27, zc);
        B.geom('trim', bl);
      }
      const cone = new THREE.ConeGeometry(0.036, 0.075, 18); cone.rotateX(-Math.PI / 2); cone.translate(x, 0.27, zc - 0.03);
      B.geom('metal', cone);
    }
  }
  // flat underbody: floor tray, fan intake louvres, adjustable sealing skirts
  B.quad('trim', [-0.6, 0.082, 1.85], [0.6, 0.082, 1.85], [0.6, 0.082, -1.6], [-0.6, 0.082, -1.6].map((v) => v));
  for (let z = -0.35; z > -1.05; z -= 0.07) B.geom('metal', boxGeo(-0.5, 0.5, 0.074, 0.08, z - 0.012, z));
  for (const sx of [-1, 1]) B.geom('trim', bevBox(sx * 0.9 - 0.015, sx * 0.9 + 0.015, 0.055, 0.086, -0.98, 0.78, 0.01, 0.01));

  // dark door jambs right behind the front / rear shut lines, so the 4 mm gaps read as continuous dark
  // lines instead of showing the light door-trim through them (M12 rough-edge pass)
  for (const cut of ['front', 'rear']) for (const band of [3, 4]) {
    const N = 12, pts = [];
    for (let i = 0; i <= N; i++) {
      const P0 = profileAt(cut === 'rear' ? -0.25 : 1.0);
      const y = P0[band][1] + (P0[band + 1][1] - P0[band][1]) * (i / N);
      const z = DOOR_CUT[cut](band, y), P = profileAt(z), q = bandPoint(P, band, y, true);
      pts.push([q[0] - 0.009, q[1], z]);
    }
    for (let i = 0; i < N; i++) {
      const p = pts[i], q = pts[i + 1], w = 0.014;
      const quad = [[p[0], p[1], p[2] + w], [q[0], q[1], q[2] + w], [q[0], q[1], q[2] - w], [p[0], p[1], p[2] - w]];
      for (const sg of [1, -1]) emitPoly(B, 'trim', quad, sg, 'trim');
    }
  }

  // ---- interior ----
  buildInterior(B, trim);
}

// ---------------------------------------------------------------------------------------------
// Interior (Tesla.com cockpit render, HUtt side photo with the seated driver, 040022 doors open)
// ---------------------------------------------------------------------------------------------
const INTERIOR = {
  seatX: 0.33, // seat centrelines at +-0.33 (driver on the left, +x)
  hip: [0.05, 0.22], // [z, y] backrest hinge point (driver head in HUtt photo at z -0.1..-0.2)
  backTilt: 0.4, // backrest recline from vertical (rad)
  yoke: [0.4, 0.81, 0.46], yokeTilt: 0.33, yokeW: 0.345, yokeH: 0.23,
  screen: [-0.02, 0.8, 0.66], screenW: 0.37, screenH: 0.235, screenTilt: 0.22,
  dashTop: 0.7, dashFront: 0.6,
  eye: [0.35, 0.93, -0.1], // driver eye point (helmet centre measured in the HUtt photo: z -0.18, y 0.92)
};
const INTERIOR_KP = {};
const SCREEN_FACE = { geom: null };

function roundBox(w, h, d, r, bevel = 0.008) {
  const sh = new THREE.Shape();
  const x0 = -w / 2 + r, x1 = w / 2 - r, y0 = -h / 2 + r, y1 = h / 2 - r;
  sh.moveTo(x0, -h / 2); sh.lineTo(x1, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, y0);
  sh.lineTo(w / 2, y1); sh.quadraticCurveTo(w / 2, h / 2, x1, h / 2); sh.lineTo(x0, h / 2);
  sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, y1); sh.lineTo(-w / 2, y0); sh.quadraticCurveTo(-w / 2, -h / 2, x0, -h / 2);
  const depth = Math.max(0.001, d - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 5 });
  g.translate(0, 0, -depth / 2);
  return g; // centred; width along X, height along Y, depth along Z
}
function place(g, rx, ry, rz, x, y, z) {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function buildSeat(B, x) {
  const [hz, hy] = INTERIOR.hip, t = INTERIOR.backTilt;
  // cushion: white centre, raised grey microsuede side bolsters
  B.geom('seat', place(roundBox(0.3, 0.5, 0.075, 0.04), -Math.PI / 2, 0, 0, x, hy - 0.02, hz + 0.27));
  for (const sx of [-1, 1]) B.geom('suede', place(roundBox(0.1, 0.5, 0.13, 0.04), -Math.PI / 2, 0, sx * 0.12, x + sx * 0.205, hy + 0.01, hz + 0.27));
  B.geom('interior', boxGeo(x - 0.24, x + 0.24, 0.1, hy - 0.06, hz - 0.02, hz + 0.5)); // seat pan
  // backrest: perforated white centre, grey microsuede wings, white shoulder wings, wide flat top
  const L = 0.41; // low, wide-topped backrest (cockpit render; helmet sits above it in the HUtt photo)
  const add = (key, g) => { g.rotateX(-t); g.translate(x, hy, hz); B.geom(key, g); };
  add('seat', place(roundBox(0.31, L, 0.07, 0.05), 0, 0, 0, 0, L / 2 + 0.02, -0.02));
  for (const sx of [-1, 1]) {
    add('suede', place(roundBox(0.1, L * 0.62, 0.15, 0.045), 0, sx * -0.28, 0, sx * 0.2, L * 0.33, 0.0));
    add('seat', place(roundBox(0.075, L * 0.36, 0.1, 0.035), 0, sx * -0.15, 0, sx * 0.19, L * 0.8, -0.015));
  }
  add('seat', place(roundBox(0.44, 0.18, 0.05, 0.06), 0, 0, 0, 0, L - 0.07, -0.055));
  add('seat', place(roundBox(0.44, L, 0.03, 0.05), 0, 0, 0, 0, L / 2 + 0.03, -0.085)); // white back shell (seen from behind in the cockpit render)
  add('suede', place(roundBox(0.3, L * 0.45, 0.012, 0.03), 0, 0, 0, 0, L * 0.25, -0.102)); // grey lower back panel
  const top = new THREE.Vector3(0, L + 0.02, -0.05).applyAxisAngle(new THREE.Vector3(1, 0, 0), -t);
  const s = x > 0 ? 'L' : 'R';
  INTERIOR_KP['seattop_' + s] = [x, hy + top.y, hz + top.z];
  INTERIOR_KP['seattopOut_' + s] = [x + Math.sign(x) * 0.195, hy + top.y - 0.03, hz + top.z];
  INTERIOR_KP['seattopIn_' + s] = [x - Math.sign(x) * 0.195, hy + top.y - 0.03, hz + top.z];
}

function roundedRectPath(w, h, r) {
  const p = new THREE.CurvePath();
  const v = (a, b) => new THREE.Vector3(a, b, 0);
  const x = w / 2, y = h / 2;
  const seg = (a, b) => p.add(new THREE.LineCurve3(a, b));
  const arc = (c, a0) => {
    const pts = [];
    for (let k = 0; k <= 4; k++) { const a = a0 + (k / 4) * (Math.PI / 2); pts.push(v(c[0] + r * Math.cos(a), c[1] + r * Math.sin(a))); }
    p.add(new THREE.CatmullRomCurve3(pts));
  };
  seg(v(-x + r, -y), v(x - r, -y)); arc([x - r, -y + r], -Math.PI / 2);
  seg(v(x, -y + r), v(x, y - r)); arc([x - r, y - r], 0);
  seg(v(x - r, y), v(-x + r, y)); arc([-x + r, y - r], Math.PI / 2);
  seg(v(-x, y - r), v(-x, -y + r)); arc([-x + r, -y + r], Math.PI);
  return p;
}

function buildYoke(B) {
  const { yoke: [x, y, z], yokeTilt: t, yokeW: w, yokeH: h } = INTERIOR;
  const xf = (g) => { g.rotateY(Math.PI); g.rotateX(t); g.translate(x, y, z); return g; }; // faces the driver, tilted back
  B.geom('seat', xf(new THREE.TubeGeometry(roundedRectPath(w, h, 0.075), 96, 0.017, 10, true))); // white rim
  const inner = new THREE.TubeGeometry(roundedRectPath(w - 0.026, h - 0.026, 0.065), 96, 0.011, 8, true);
  inner.translate(0, 0, 0.006);
  B.geom('interior', xf(inner)); // black inner face of the rim
  B.geom('interior', xf(roundBox(0.11, 0.085, 0.045, 0.03))); // hub
  const badge = new THREE.CircleGeometry(0.02, 20); badge.translate(0, 0.005, 0.024);
  B.geom('metal', xf(badge));
  for (const sx of [-1, 1]) {
    const a = sx * 0.05, b = sx * (w / 2 - 0.012);
    B.geom('interior', xf(boxGeo(Math.min(a, b), Math.max(a, b), -0.022, 0.006, -0.012, 0.012))); // spokes
    B.geom('seat', xf(boxGeo(sx * 0.07 - 0.012, sx * 0.07 + 0.012, -0.05, -0.028, 0.012, 0.016))); // thumb buttons
    B.geom('canopy', xf(boxGeo(sx * 0.075 - 0.03, sx * 0.075 + 0.03, 0.012, 0.05, -0.036, -0.03))); // two small forward displays
  }
  const col = new THREE.CylinderGeometry(0.03, 0.04, 0.2, 14);
  col.rotateX(Math.PI / 2 - t); col.translate(x, y + 0.03, z + 0.1);
  B.geom('interior', col);
  const corner = (sx, sy) => {
    const v = new THREE.Vector3(sx * w / 2, sy * h / 2, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI).applyAxisAngle(new THREE.Vector3(1, 0, 0), t);
    return [x + v.x, y + v.y, z + v.z];
  };
  INTERIOR_KP.yoke_c = [x, y, z];
  // rotateY(PI) mirrors x: local +x maps to world -x
  INTERIOR_KP.yoke_TL = corner(-1, 1); INTERIOR_KP.yoke_TR = corner(1, 1);
  INTERIOR_KP.yoke_BL = corner(-1, -1); INTERIOR_KP.yoke_BR = corner(1, -1);
}

function buildInterior(B, trim) {
  const I = INTERIOR;
  buildSeat(B, I.seatX);
  if (trim === 'rocket') {
    // single seat: the passenger side carries the propellant tanks under a white composite cover
    B.geom('tank', place(roundBox(0.5, 0.62, 0.62, 0.12, 0.02), 0, 0, 0, -I.seatX, 0.43, -0.26));
    B.geom('suede', place(roundBox(0.46, 0.04, 0.58, 0.02, 0.005), 0, 0, 0, -I.seatX, 0.75, -0.26));
    for (const dz of [-0.4, -0.12]) B.geom('metal', boxGeo(-I.seatX - 0.26, -I.seatX + 0.26, 0.56, 0.58, dz - 0.012, dz + 0.012)); // straps
  } else buildSeat(B, -I.seatX);
  // floor carpet and bulkhead
  B.geom('interior', boxGeo(-0.8, 0.8, 0.09, 0.12, -0.72, 1.2));
  B.geom('interior', boxGeo(-0.8, 0.8, 0.1, 0.98, -0.74, -0.7));
  // dash: grey microsuede top, black face with a full-width metal line and vent slot
  const df = I.dashFront, dt = I.dashTop;
  B.geom('interior', place(roundBox(1.6, 0.6, 0.04, 0.03, 0.006), -Math.PI / 2, 0, 0, 0, dt, df + 0.3)); // dark dash top (cockpit render)
  B.geom('interior', boxGeo(-0.8, 0.8, 0.38, dt - 0.015, df, df + 0.55));
  B.geom('metal', boxGeo(-0.62, 0.62, dt - 0.07, dt - 0.064, df - 0.004, df));
  B.geom('nozzleIn', boxGeo(-0.6, 0.6, dt - 0.1, dt - 0.088, df - 0.003, df + 0.01));
  INTERIOR_KP.dash_L = [0.8, dt, df]; INTERIOR_KP.dash_R = [-0.8, dt, df];
  // centre touchscreen (landscape, floating, tilted toward the driver) on a slim stalk
  const [sx, sy, sz] = I.screen, sw = I.screenW, shh = I.screenH, st = I.screenTilt;
  B.geom('interior', place(roundBox(sw + 0.012, shh + 0.012, 0.018, 0.01, 0.003), st, 0, 0, sx, sy, sz + 0.012));
  const face = new THREE.PlaneGeometry(sw, shh); face.rotateY(Math.PI); face.rotateX(st); face.translate(sx, sy, sz);
  SCREEN_FACE.geom = face; // separate textured mesh (keeps UVs for the lit UI)
  B.geom('interior', boxGeo(sx - 0.05, sx + 0.05, df - 0.03, sy - shh / 2, sz + 0.01, sz + 0.06));
  const sc = (ax, ay) => { const v = new THREE.Vector3(ax * sw / 2, ay * shh / 2, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), st); return [sx + v.x, sy + v.y, sz + v.z]; };
  INTERIOR_KP.screen_TL = sc(1, 1); INTERIOR_KP.screen_TR = sc(-1, 1); INTERIOR_KP.screen_BL = sc(1, -1); INTERIOR_KP.screen_BR = sc(-1, -1);
  buildYoke(B);
  // centre tunnel below the screen (black with a grey microsuede insert); white padded armrest between the seats
  B.geom('interior', boxGeo(-0.09, 0.09, 0.12, df - 0.03, 0.05, df + 0.05));
  B.geom('suede', boxGeo(-0.045, 0.045, 0.25, df - 0.08, 0.045, 0.05));
  B.geom('seat', place(roundBox(0.2, 0.6, 0.12, 0.05), -Math.PI / 2, 0, 0, 0, 0.42, -0.05));
  B.geom('interior', boxGeo(-0.09, 0.09, 0.12, 0.36, -0.4, 0.25));
  INTERIOR_KP.armrest_f = [0, 0.48, 0.25];
  // halo trim: grey microsuede tubes along the windshield edges + header, and the diagonal braces
  const pts = [];
  for (let z = 1.4; z >= -0.12; z -= 0.12) { const p = profileAt(z)[6]; pts.push(new THREE.Vector3(p[0] - 0.05, p[1] - 0.045, z)); }
  const header = profileAt(-0.15)[6];
  const halo = [...pts, new THREE.Vector3(header[0] - 0.12, header[1] - 0.05, -0.2), new THREE.Vector3(0, header[1] - 0.035, -0.22)];
  const haloR = halo.slice().reverse().map((v) => new THREE.Vector3(-v.x, v.y, v.z));
  // wide sculpted microsuede frame around the windshield and header (cockpit render): flattened tube
  { const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([...halo, ...haloR.slice(1)]), 120, 0.06, 10, false);
    const pa = tg.attributes.position; const ctr = new THREE.CatmullRomCurve3([...halo, ...haloR.slice(1)]);
    void ctr; B.geom('suede', tg); }
  for (const sxx of [-1, 1]) {
    const a = new THREE.Vector3(sxx * 0.72, dt + 0.02, 0.9), b = new THREE.Vector3(sxx * 0.56, header[1] - 0.07, -0.08);
    B.geom('suede', new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 2, 0.022, 8, false)); // diagonal braces (clearly visible in Tesla's cockpit render)
  }
  INTERIOR_KP.halo_L = [header[0] - 0.12, header[1] - 0.05, -0.2];
  INTERIOR_KP.halo_R = [-(header[0] - 0.12), header[1] - 0.05, -0.2];
  // rear-view mirror on a mount from the header
  // rear-view mirror hangs from the header on a triangular mount (cockpit render)
  // mirror sits high, tucked right under the header at the windshield top (cockpit render: image height needs y ~1.16)
  B.geom('interior', place(roundBox(0.2, 0.05, 0.02, 0.012, 0.003), 0.15, 0, 0, 0, 1.115, -0.1));
  const mount = new THREE.ConeGeometry(0.035, 0.04, 3); mount.translate(0, 1.15, -0.11); B.geom('interior', mount);
  INTERIOR_KP.mirror = [0, 1.115, -0.11];
  // pedals: NOT visible in any reference -- simple placeholder pads in the footwell
  for (const [dx, w] of [[0.26, 0.05], [0.4, 0.07]]) B.geom('metal', place(boxGeo(-w / 2, w / 2, -0.06, 0.06, -0.006, 0.006), -0.6, 0, 0, dx, 0.22, 1.05));
}


// ---------------------------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------------------------
function lathe(points, segs) {
  const g = new THREE.LatheGeometry(points.map(([r, a]) => new THREE.Vector2(r, a)), segs);
  g.rotateZ(-Math.PI / 2); // lathe axis Y -> X, profile +a side faces +X
  return g;
}

function buildWheelGeometry(style, width) {
  const hw = width / 2, R = WHEEL_R, Rr = 0.285;
  const B = new Buckets();
  // low-profile tire
  B.geom('tire', lathe([
    [Rr, -hw + 0.012], [0.3, -hw], [0.33, -hw + 0.004], [0.35, -hw + 0.018], [R - 0.004, -hw + 0.036], [R, -hw + 0.055],
    [R, hw - 0.055], [R - 0.004, hw - 0.036], [0.35, hw - 0.018], [0.33, hw - 0.004], [0.3, hw], [Rr, hw - 0.012],
  ], 72));
  // rim barrel (inward facing) and outer lip
  B.geom('rim', lathe([[Rr - 0.004, hw - 0.02], [Rr - 0.004, -hw + 0.02]], 48));
  B.geom('spoke', lathe([[Rr + 0.004, hw - 0.003], [Rr - 0.01, hw - 0.006], [Rr - 0.014, hw - 0.03]], 72));

  if (style === 'aero') {
    // flat aero cover
    B.geom('disc', lathe([[Rr - 0.012, hw - 0.012], [0.22, hw - 0.007], [0.12, hw - 0.004], [0.09, hw - 0.004]], 64));
    B.geom('spoke', lathe([[0.09, hw - 0.004], [0.075, hw - 0.002], [0.04, hw], [0.0, hw]], 32));
    // ring of small vent slots near the rim
    const n = 30;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = a0 + 0.07;
      const r0 = 0.248, r1 = 0.266, x = hw - 0.0085;
      const P = (r, a) => [x, r * Math.cos(a), r * Math.sin(a)];
      B.quadAway('rim', P(r0, a0), P(r1, a0), P(r1, a1), P(r0, a1), [x - 1, 0, 0]);
    }
  } else {
    // light inner disc seen through the spokes + red accent ring
    // flat light-grey disc filling the wheel behind the spokes (Tesla side render), thin red pinstripe at its edge
    B.geom('disc', lathe([[Rr - 0.006, hw - 0.05], [0.2, hw - 0.046], [0.09, hw - 0.04]], 64));
    B.geom('accent', lathe([[Rr - 0.007, hw - 0.0505], [Rr - 0.013, hw - 0.0503]], 64));
    // hub
    B.geom('spoke', lathe([[0.082, hw - 0.065], [0.082, hw - 0.022], [0.068, hw - 0.01], [0.0, hw - 0.008]], 32));
    B.geom('disc', lathe([[0.032, hw - 0.0075], [0.0, hw - 0.0065]], 20));
    // 6 wide, straight, tapering gloss-black spokes with a raised centre ridge (Tesla side render):
    // each spoke = two faceted halves meeting at the ridge.
    const r0 = 0.07, r1 = Rr - 0.006, NS = 6, twist = 0.03; // slim straight spokes (studio renders)
    for (let k = 0; k < 6; k++) {
      const phi = (k / 6) * Math.PI * 2 + Math.PI / 6;
      for (const j of [-1, 1]) {
        const rings = [];
        for (let i = 0; i <= NS; i++) {
          const u = i / NS, r = r0 + (r1 - r0) * u;
          const th = phi + twist * u;
          const gap = 0.003 + 0.003 * u, wid = 0.064 - 0.024 * u; // thick split spokes dominate the wheel face
          const xf = hw - 0.004 - 0.014 * u, depth = 0.06 - 0.02 * u; // deep 3D blades
          const P = (x, t) => [x, r * Math.cos(th + (j * t) / r), r * Math.sin(th + (j * t) / r)];
          rings.push({
            c: P(xf - depth / 2, gap + wid / 2),
            // dark face twisted along the spoke (face slope changes hub -> rim) + bright outer chamfer
            fl: P(xf - 0.006 * u, gap), fm: P(xf - 0.022 + 0.012 * u, gap + wid * 0.72), fr: P(xf - 0.034, gap + wid),
            bl: P(xf - depth, gap), br: P(xf - depth, gap + wid),
          });
        }
        for (let i = 0; i < NS; i++) {
          const a = rings[i], b = rings[i + 1];
          const c = [(a.c[0] + b.c[0]) / 2, (a.c[1] + b.c[1]) / 2, (a.c[2] + b.c[2]) / 2];
          B.quadAway('spoke', a.fl, a.fm, b.fm, b.fl, c);
          B.quadAway(j > 0 ? 'spokeFace' : 'spoke', a.fm, a.fr, b.fr, b.fm, c); // narrow machined-silver chamfer
          B.quadAway('spoke', a.bl, a.br, b.br, b.bl, c);
          B.quadAway('spoke', a.fl, a.bl, b.bl, b.fl, c);
          B.quadAway('spoke', a.fr, a.br, b.br, b.fr, c);
        }
        const e = rings[NS];
        B.quadAway('spoke', e.fl, e.fr, e.br, e.bl, [0, 0, 0]);
      }
    }
  }
  return B;
}

function makeWheel(name, pos, width, side, style, M, cache) {
  const key = style + ':' + width;
  if (!cache[key]) {
    const tmp = new THREE.Group();
    buildWheelGeometry(style, width).build(M, tmp, { prefix: 'wheel_' });
    cache[key] = tmp;
  }
  const pivot = new THREE.Object3D();
  pivot.name = name;
  pivot.position.set(pos[0], pos[1], pos[2]);
  const spin = new THREE.Object3D();
  spin.name = name + '_spin';
  pivot.add(spin);
  const g = new THREE.Group();
  for (const m of cache[key].children) {
    const c = new THREE.Mesh(m.geometry, m.material);
    c.name = m.name; c.castShadow = true; c.receiveShadow = true;
    g.add(c);
  }
  if (side < 0) g.rotation.y = Math.PI; // outer face towards -X on the right side
  spin.add(g);
  pivot.userData.spin = spin;
  return pivot;
}

// ---------------------------------------------------------------------------------------------
// Rear wing: the retractable deck panel (all trims)
// ---------------------------------------------------------------------------------------------
// Deck-panel rear wing (M10; rear-wing reference photo, 040046, 040149). The wing IS the body-coloured
// rear deck panel: stowed (deploy 0) it is the deck itself, cut from the body loft with a 4 mm shut gap;
// deployed (deploy 1) it lifts and tilts up on two actuators and a pair of front swing links as ONE rigid
// piece together with its down-turned tips (the haunch-top / upper-side-wall corners at the rear, which are
// its end-plates), leaving a dark open cavity and corner pockets of exactly its outline.
// API kept: userData.setDeploy / setAngle / setRaised / getState / plane.
const WING = {
  T: 0.025, // panel thickness
  // deployed pose at cruise (angle -0.35, raised 0.85), camera-matched to rear-wing reference photo
  teY: 1.111, teZ: -2.285, pitch: 0.716, // trailing-edge top (centre) height / z, chord pitch (rad, TE up)
  lift: 0.12, liftEnd: 0.4, tiltStart: 0.25, // straight-up lift at the start of the deploy (tips slide up out of their corner pockets)
  strutX: 0.44, strutZ: -2.0, linkX: 0.3, // strut |x| measured 0.40-0.47 (040149, spoiler photo)
};
function buildWing(M, initialDeploy = 1) {
  const pivot = new THREE.Object3D();
  pivot.name = 'Wing';
  const { zL, zT, gap, depth } = DECK;
  const T = WING.T;

  // exact body-surface height on the carved deck region
  const triY = (a, b, c, x, z) => {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-12) return null;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) return null;
    return l1 * a[1] + l2 * b[1] + l3 * c[1];
  };
  const surfY = (x, z) => {
    const zz = Math.min(zL - 1e-5, Math.max(zT + 1e-5, z));
    const ax = Math.min(Math.abs(x), deckW(zz) - 1e-5);
    for (const P of DECK_CUT.hole) for (let i = 1; i < P.length - 1; i++) { const y = triY(P[0], P[i], P[i + 1], ax, zz); if (y !== null) return y; }
    return profileAt(zz)[10][1];
  };
  const floorY = (z) => surfY(0, z) - depth;
  // planform outline (+ shrink g), sampled, counter-clockwise seen from above
  const outline = (g) => {
    const [c1, c2, c3] = deckCorners(g), m = (p) => [-p[0], p[1]], pts = [];
    const seg = (p, q, n) => { for (let i = 0; i < n; i++) pts.push([p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n]); };
    seg(c1, m(c1), 24); seg(m(c1), m(c2), 8); seg(m(c2), m(c3), 12); seg(m(c3), c3, 30); seg(c3, c2, 12); seg(c2, c1, 8);
    return pts;
  };
  const faceQuad = (B, key, a, b, c, d, dirFn) => {
    // emit so the face normal agrees with dirFn(centroid)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const cen = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2], w = dirFn(cen);
    if (n[0] * w[0] + n[1] * w[1] + n[2] * w[2] >= 0) B.quad(key, a, b, c, d); else B.quad(key, d, c, b, a);
  };
  const zMid = (zL + zT) / 2;
  const newell = (P) => {
    const n = [0, 0, 0];
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); }
    const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; // outward (loft order)
  };
  // smooth (vertex-averaged) inward offsets, so offset copies of neighbouring polygons stay watertight
  const vkey = (v) => v.map((c) => c.toFixed(4)).join();
  const vnorms = (polys) => {
    const N = new Map();
    for (const P of polys) { const n = newell(P); for (const v of P) { const k = vkey(v), a = N.get(k) || [0, 0, 0]; N.set(k, [a[0] + n[0], a[1] + n[1], a[2] + n[2]]); } }
    for (const [k, a] of N) { const l = Math.hypot(...a) || 1; N.set(k, [a[0] / l, a[1] / l, a[2] / l]); }
    return N;
  };
  const offs = (P, N, d) => P.map((v) => { const n = N.get(vkey(v)); return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d]; });
  const onCut = (fns, p, q) => fns.some((fn) => Math.abs(fn(p)) < 1e-5 && Math.abs(fn(q)) < 1e-5);

  // ---- cavity (static): walls + floor in matte black, mechanism mounts ----
  const recess = new THREE.Object3D(); recess.name = 'WingRecess'; pivot.add(recess);
  {
    const RB = new Buckets(), O = outline(0);
    const inward = (c) => [-c[0], 0, zMid - c[2]];
    for (let i = 0; i < O.length; i++) {
      const p = O[i], q = O[(i + 1) % O.length];
      const pt = [p[0], surfY(p[0], p[1]), p[1]], qt = [q[0], surfY(q[0], q[1]), q[1]];
      const pb = [p[0], floorY(p[1]), p[1]], qb = [q[0], floorY(q[1]), q[1]];
      faceQuad(RB, 'trim', pt, qt, qb, pb, inward);
    }
    const zk = deckCorners(0)[1][1], zs = [zL];
    for (let i = 0; i <= 12; i++) zs.push(zk - ((zk - zT) * i) / 12);
    for (let i = 0; i < zs.length - 1; i++) {
      const za = zs[i], zb = zs[i + 1];
      faceQuad(RB, 'trim', [-deckW(za), floorY(za), za], [deckW(za), floorY(za), za], [deckW(zb), floorY(zb), zb], [-deckW(zb), floorY(zb), zb], () => [0, 1, 0]);
    }
    // actuator mounts and link brackets on the floor
    for (const sx of [-1, 1]) {
      const x = sx * WING.strutX, z = WING.strutZ, y = floorY(z);
      RB.geom('metal', boxGeo(x - 0.035, x + 0.035, y, y + 0.03, z - 0.05, z + 0.05));
      RB.geom('metal', boxGeo(sx * 0.12 - 0.01, sx * 0.12 + 0.01, y, y + 0.02, zT + 0.02, zL - 0.02)); // floor rails
    }
    // corner pockets left by the down-turned tips: dark floor tipDepth inside the skin + walls on the cut
    const NT = vnorms(DECK_CUT.tip.map((e) => e[0]));
    for (const [P, F0] of DECK_CUT.tip) {
      const Q = offs(P, NT, DECK.tipDepth);
      for (const sg of [1, -1]) emitPoly(RB, 'trim', Q, sg, 'trim');
      for (let i = 0; i < P.length; i++) {
        const j = (i + 1) % P.length;
        if (onCut(F0, P[i], P[j])) for (const sg of [1, -1]) emitPoly(RB, 'trim', [P[i], P[j], Q[j], Q[i]], sg, 'trim');
      }
    }
    RB.build(M, recess, { prefix: 'wing_recess_', castShadow: false });
  }

  // ---- panel: exact deck skin on top, dark underside, white edges ----
  const H0 = new THREE.Vector3(0, surfY(0, zL - gap), zL - gap); // front-edge centre, top surface
  const plane = new THREE.Object3D(); plane.name = 'WingPlane'; pivot.add(plane);
  {
    const PB = new Buckets();
    const NS = vnorms(DECK_CUT.skin.map((e) => e[1]));
    const UP = { get: () => [0, 1, 0] }; // deck piece: vertical thickness (as the original deck panel)
    for (const [, poly, FG, kind] of DECK_CUT.skin) {
      // one paint over deck and tips (the cut corner band was read as a smoked panel before)
      emitPoly(PB, 'white', poly, 1, null); emitPoly(PB, 'white', poly, -1, null);
      const lo = offs(poly, kind === 'deck' ? UP : NS, T);
      emitPoly(PB, 'carbon', lo.slice().reverse(), 1, null); emitPoly(PB, 'carbon', lo.slice().reverse(), -1, null); // dark underside (all three photos)
      for (let i = 0; i < poly.length; i++) { // white edge wall along the shut line
        const j = (i + 1) % poly.length;
        if (onCut(FG, poly[i], poly[j])) for (const sg of [1, -1]) emitPoly(PB, 'white', [poly[i], poly[j], lo[j], lo[i]], sg, 'white');
      }
    }
    PB.build(M, plane, { prefix: 'wing_', translate: [-H0.x, -H0.y, -H0.z] });
  }

  // ---- keypoints of the -x (photo right) tip, plane-local: A rear-top, D front-top (shoulder crease P4),
  // C lowest point of the side cut, B rear-low (for camera fitting / tests)
  {
    const sideX = (z, y) => bandPoint(profileAt(z), 3, Math.max(profileAt(z)[3][1], Math.min(profileAt(z)[4][1], y)), true);
    const p4 = (z) => profileAt(z)[4];
    const kp = { A: [p4(zT + gap)[0], p4(zT + gap)[1], zT + gap], D: [p4(DECK.zF - gap)[0], p4(DECK.zF - gap)[1], DECK.zF - gap] };
    const c = sideX(DECK.zC, DECK.yC + gap), b = sideX(zT + gap, DECK.yB + gap);
    kp.C = [c[0], c[1], DECK.zC]; kp.B = [b[0], b[1], zT + gap];
    pivot.userData.tipKeys = Object.fromEntries(Object.entries(kp).map(([k, v]) => [k, [-v[0] - H0.x, v[1] - H0.y, v[2] - H0.z]]));
  }

  // ---- mechanism: two telescopic actuators + two front swing links (rebuilt per pose) ----
  const struts = new THREE.Object3D(); struts.name = 'WingStruts'; pivot.add(struts);
  const cyl = (r, key) => { const g = new THREE.CylinderGeometry(r, r, 1, 14); g.translate(0, 0.5, 0); const m = new THREE.Mesh(g, M[key]); m.castShadow = true; struts.add(m); return m; };
  const box = (w, d, key) => { const g = new THREE.BoxGeometry(w, 1, d); g.translate(0, 0.5, 0); const m = new THREE.Mesh(g, M[key]); m.castShadow = true; struts.add(m); return m; };
  const toLocal = (p) => new THREE.Vector3(p[0], p[1], p[2]).sub(H0);
  const acts = [-1, 1].map((sx) => {
    const x = sx * WING.strutX, zA = WING.strutZ - 0.03;
    return { base: new THREE.Vector3(x, floorY(WING.strutZ) + 0.03, WING.strutZ), attach: toLocal([x, surfY(x, zA) - T, zA]), housing: cyl(0.026, 'metal'), rod: cyl(0.016, 'metal'), housingLen: 0.06 };
  });
  const links = [-1, 1].map((sx) => {
    const x = sx * WING.linkX, zA = zL - gap - 0.03;
    return { x, attach: toLocal([x, surfY(x, zA) - T, zA]), arm: box(0.035, 0.016, 'metal'), base: null };
  });
  const _Y = new THREE.Vector3(0, 1, 0), _v = new THREE.Vector3(), _w = new THREE.Vector3();
  const aim = (mesh, a, b) => { _v.subVectors(b, a); const l = Math.max(1e-4, _v.length()); mesh.position.copy(a); mesh.quaternion.setFromUnitVectors(_Y, _v.divideScalar(l)); mesh.scale.set(1, l, 1); return l; };

  // panel pose for a given rotation th (about +X, TE up) and trailing-edge target
  const yT0 = surfY(0, zT + gap), r0 = new THREE.Vector3(0, yT0 - H0.y, zT + gap - H0.z);
  const phi0 = Math.atan2(yT0 - H0.y, H0.z - (zT + gap)); // stowed chord slope (negative: deck falls rearward)
  const rotX = (v, th) => new THREE.Vector3(v.x, v.y * Math.cos(th) - v.z * Math.sin(th), v.y * Math.sin(th) + v.z * Math.cos(th));
  const deployedPose = (angle, raised) => {
    const th = WING.pitch - phi0 + THREE.MathUtils.clamp(-angle - 0.35, -0.05, 0.08);
    const te = new THREE.Vector3(0, WING.teY + Math.max(0, raised - 0.85) * 0.45, WING.teZ); // raised 1: +7 cm, the higher show-floor pose (040046)
    return { th, H: te.sub(rotX(r0, th)) };
  };
  // fixed floor pivots for the swing links: equidistant from the stowed and cruise-deployed attach points
  {
    const P1 = deployedPose(-0.35, 0.85);
    for (const k of links) {
      const S = k.attach.clone().add(H0), Tt = rotX(k.attach, P1.th).add(P1.H);
      let yf = floorY(zL - 0.05), zf = zL - 0.05;
      for (let it = 0; it < 3; it++) {
        zf = ((Tt.z * Tt.z + (Tt.y - yf) ** 2) - (S.z * S.z + (S.y - yf) ** 2)) / (2 * (Tt.z - S.z));
        zf = Math.min(zL - 0.02, Math.max(zT + 0.05, zf)); yf = floorY(zf) + 0.015;
      }
      k.base = new THREE.Vector3(k.x, yf, zf);
    }
  }

  let raised = 0.85, angle = -0.35, deploy = initialDeploy;
  const ease = (t) => t * t * (3 - 2 * t);
  const apply = () => {
    // one rigid piece: lifts straight up first (the down-turned tips slide up out of their corner
    // pockets), then tilts trailing edge up and moves to the deployed pose
    const d = Math.max(0, Math.min(1, deploy));
    const up = ease(Math.min(1, d / WING.liftEnd));
    const m = ease(Math.max(0, Math.min(1, (d - WING.tiltStart) / (1 - WING.tiltStart))));
    const P = deployedPose(angle, raised);
    plane.position.set(0, H0.y + (P.H.y - H0.y) * m + WING.lift * up * (1 - m), H0.z + (P.H.z - H0.z) * m);
    plane.rotation.set(P.th * m, 0, 0);
    plane.updateMatrix();
    for (const a of acts) {
      _w.copy(a.attach).applyMatrix4(plane.matrix);
      aim(a.rod, a.base, _w);
      const l = _w.distanceTo(a.base);
      aim(a.housing, a.base, _v.subVectors(_w, a.base).setLength(Math.min(a.housingLen, l - 0.005)).add(a.base));
    }
    for (const k of links) { _w.copy(k.attach).applyMatrix4(plane.matrix); aim(k.arm, k.base, _w); }
    struts.visible = d > 0.001;
  };
  pivot.userData.plane = plane;
  pivot.userData.setAngle = (rad) => { angle = rad; apply(); };
  pivot.userData.setRaised = (t) => { raised = Math.max(0, Math.min(1, t)); apply(); };
  pivot.userData.setDeploy = (t) => { deploy = Math.max(0, Math.min(1, t)); apply(); };
  pivot.userData.getState = () => ({ angle, raised, deploy });
  apply();
  return pivot;
}


// ---------------------------------------------------------------------------------------------
// Thrusters
// ---------------------------------------------------------------------------------------------
const _zAxis = new THREE.Vector3(0, 0, 1);

function makeMarker(name, pos, dir) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(pos[0], pos[1], pos[2]);
  o.quaternion.setFromUnitVectors(_zAxis, new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
  return o;
}

// Nozzle mesh (into static buckets) whose exit is at `marker` and which points along its +Z
function addNozzle(B, marker, r, len) {
  const m = new THREE.Matrix4().compose(marker.position, marker.quaternion, new THREE.Vector3(1, 1, 1));
  const tube = new THREE.CylinderGeometry(r, r * 0.9, len, 22, 1, true);
  tube.rotateX(Math.PI / 2); tube.translate(0, 0, -len / 2);
  B.geom('nozzleIn', tube, m);
  const back = new THREE.CircleGeometry(r, 22);
  back.translate(0, 0, -len * 0.8);
  B.geom('nozzleIn', back, m);
  const ring = new THREE.TorusGeometry(r + 0.003, 0.005, 8, 28);
  ring.translate(0, 0, -0.002);
  B.geom('bronze', ring, m);
  const bell = new THREE.CylinderGeometry(r + 0.004, r * 0.8, len * 0.6, 24, 1, true);
  bell.rotateX(Math.PI / 2); bell.translate(0, 0, -len * 0.3 - 0.002);
  B.geom('bronze', bell, m);
}

// ---------------------------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------------------------
export function createRoadster(options = {}) {
  const trim = ['performance', 'thrust', 'rocket'].includes(options.trim) ? options.trim : 'thrust';
  const wheelStyle = options.wheelStyle === 'aero' ? 'aero' : 'spoke';
  const M = makeMaterials();

  const root = new THREE.Group();
  root.name = 'Roadster';
  const body = new THREE.Group();
  body.name = 'Body';
  root.add(body);

  // ---- body shell + static details ----
  const stations = buildStations();
  const profiles = stations.map(profileAt);
  const B = new Buckets();
  buildBodyShell(B, stations, profiles);
  const LB = { head: new Buckets(), tail: new Buckets(), brake: new Buckets() };
  buildDetails(B, LB, trim);

  // ---- thrusters ----
  const rear = [];
  const perimeter = [];
  {
    // the 4 bronze-ringed nozzles are on every trim (Tesla's wingless studio render shows them too);
    // only thrust/rocket expose them as thruster markers (performance: thrusters.rear stays empty)
    for (const x of [-0.398, -0.133, 0.133, 0.398]) {
      const mk = makeMarker('thruster_rear_' + rear.length, [x, 0.486, Z_TAIL - 0.03], [0, 0, -1]); // exits just proud of the recessed nozzle band (M12; 040149 y 0.488)
      addNozzle(B, mk, 0.031, 0.1);
      if (trim !== 'performance') rear.push(mk);
    }
  }
  if (trim === 'rocket') {
    const defs = [
      [[0.9, 0.05, 0.98], [0.15, -1, 0]], [[-0.9, 0.05, 0.98], [-0.15, -1, 0]],
      [[0.985, 0.36, -1.93], [1, -0.15, 0]], [[-0.985, 0.36, -1.93], [-1, -0.15, 0]], // side ports for yaw (not visible in references)
      [[0.6, 0.075, 2.02], [0.45, -1, 0.35]], [[-0.6, 0.075, 2.02], [-0.45, -1, 0.35]],
      [[0.85, 0.25, -1.98], [0.1, -1, 0]], [[-0.85, 0.25, -1.98], [-0.1, -1, 0]],
    ];
    defs.forEach(([p, d], i) => {
      const mk = makeMarker('thruster_perimeter_' + i, p, d);
      perimeter.push(mk);
      addNozzle(B, mk, i === 2 || i === 3 ? 0.028 : 0.04, i < 2 || i >= 6 ? 0.2 : i < 4 ? 0.05 : 0.13);
    });
  }
  for (const mk of [...rear, ...perimeter]) root.add(mk);

  B.warp(warpNose);
  for (const k in LB) LB[k].warp(warpNose);
  B.build(M, body, { prefix: 'body_' });

  // ---- lit centre screen ----
  if (SCREEN_FACE.geom) {
    const scr = new THREE.Mesh(SCREEN_FACE.geom, M.screen); scr.name = 'body_screen';
    scr.position.z += 0.0;
    body.add(scr); SCREEN_FACE.geom = null;
  }

  // ---- RDSTR plate ----
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.15), M.plate);
  plate.geometry.rotateY(Math.PI);
  plate.position.set(0, 0.652, Z_TAIL - 0.008);
  plate.name = 'body_plate';
  body.add(plate);

  // ---- lights ----
  const lights = {};
  for (const k of ['head', 'tail', 'brake']) {
    const meshes = LB[k].build(M, body, { prefix: 'light_', castShadow: false });
    lights[k] = meshes[k];
  }

  // ---- doors ----
  const doors = {};
  for (const [name, sign] of [['left', 1], ['right', -1]]) {
    const pivot = new THREE.Object3D();
    pivot.name = 'Door_' + name;
    const hinge = [HINGE[0] * sign, HINGE[1], HINGE[2]];
    pivot.position.set(hinge[0], hinge[1], hinge[2]);
    const DB = new Buckets();
    buildDoorShell(DB, stations, sign);
    DB.build(M, pivot, { prefix: 'door_' + name + '_', translate: [-hinge[0], -hinge[1], -hinge[2]] });
    // butterfly: rotate up, forward and outward about a tilted axis through the A-pillar hinge
    // (right door axis is the mirror image of the left one: reflect across X, then negate)
    // mostly scissor-style: doors swing up about a near-lateral axis and splay only slightly outward (top-front render, HUtt photo)
    const ax = sign > 0 ? new THREE.Vector3(1, -0.22, -0.05).normalize() : new THREE.Vector3(1, 0.22, 0.05).normalize();
    const maxAngle = 1.02; // ~58 deg: door leans back as in the HUtt side photo
    let openT = 0;
    pivot.userData.open = (t) => {
      openT = Math.max(0, Math.min(1, t));
      const e = openT * openT * (3 - 2 * openT);
      pivot.quaternion.setFromAxisAngle(ax, maxAngle * e);
    };
    pivot.userData.getOpen = () => openT;
    pivot.userData.open(0);
    root.add(pivot);
    doors[name] = pivot;
  }

  // ---- wheels ----
  const cache = {};
  const wheels = {
    fl: makeWheel('Wheel_fl', [TRACK_F / 2, WHEEL_R, Z_FA], TIRE_W_F, 1, wheelStyle, M, cache),
    fr: makeWheel('Wheel_fr', [-TRACK_F / 2, WHEEL_R, Z_FA], TIRE_W_F, -1, wheelStyle, M, cache),
    rl: makeWheel('Wheel_rl', [TRACK_R / 2, WHEEL_R, Z_RA], TIRE_W_R, 1, wheelStyle, M, cache),
    rr: makeWheel('Wheel_rr', [-TRACK_R / 2, WHEEL_R, Z_RA], TIRE_W_R, -1, wheelStyle, M, cache),
  };
  for (const w of Object.values(wheels)) root.add(w);

  // ---- wing ----
  // every trim has the retractable wing; performance starts stowed, thrust/rocket deployed
  const wing = buildWing(M, trim === 'performance' ? 0 : 1);
  root.add(wing);

  root.userData.parts = { body, wheels, doors, wing, thrusters: { rear, perimeter }, lights };
  root.userData.dims = {
    length: Z_NOSE - Z_TAIL,
    width: +(2 * Math.max(...profiles.map((pr) => Math.max(pr[2][0], pr[3][0], pr[4][0], pr[5][0])))).toFixed(3),
    height: 1.18,
    wheelbase: Z_FA - Z_RA,
    track: (TRACK_F + TRACK_R) / 2,
    wheelRadius: WHEEL_R,
  };
  root.userData.cockpitEye = INTERIOR.eye.slice(); // driver eye point in model space (looking +Z)
  root.userData.trim = trim;
  root.userData.wheelStyle = wheelStyle;
  root.userData.materials = M;
  return root;
}

export default createRoadster;

// tooling only (reference-matching scripts)
export const _debug = { WING, DECK, INTERIOR, INTERIOR_KP, profileAt, K, ARCHES, DOOR_BANDS, DOOR_CUT, Z_QWIN, Z_BPILLAR, warpNose };
