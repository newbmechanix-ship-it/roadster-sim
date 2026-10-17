// Volumetric condensation clouds as dynamic meshes.
//
// Gas parcels are simulated with simple physics (jet momentum, air drag toward the wind,
// negative buoyancy of cold expanded gas that warms toward neutral, divergence-free curl-noise
// turbulence, parcel–parcel pressure spreading, ground and car collision). Each frame their
// combined density field is meshed with marching cubes: parcels that overlap merge into one
// billowing surface, and as they evaporate the surface recedes, frays and splits apart.
import * as THREE from 'three/webgpu';
import {
  attribute, positionLocal, normalLocal, normalView, vec3, float, abs, smoothstep, mix,
  mx_fractal_noise_float, viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar,
  positionView, saturate, pow, positionWorld, normalWorld, normalize, dot, transformNormalToView, uniform, max, mx_worley_noise_float, texture3D, exp, cameraPosition, mx_noise_float, length, screenCoordinate, fract, min, vec2, step, frontFacing, select, sin, sqrt, Fn, Loop, If, Break, vec4,
} from 'three/tsl';
import { CloudCore, CLOUD_DEFAULTS, VOL } from './CloudCore.js';
import { FX } from './fxParams.js';

// effect clock: advanced by the simulation dt (not wall time), reset with the cloud, so the same
// sequence of frames always renders the same noise (comparable sheets, no frame-rate dependence)
export const simTime = uniform(0);
const time = simTime;

function softness(distance) {
  const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(), cameraNear, cameraFar);
  return saturate(positionView.z.sub(sceneZ).div(distance));
}

// Tiling 3-D billow noise (1 − Worley F1, three octaves), n³ voxels, generated once.
function makeBillowNoise(n) {
  const data = new Uint8Array(n * n * n);
  const acc = new Float32Array(n * n * n);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const octs = [[4, 0.55], [8, 0.3], [16, 0.15]];
  for (const [c, w] of octs) {
    const pts = new Float32Array(c * c * c * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = rnd();
    const cs = n / c;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = (x + 0.5) / cs, fy = (y + 0.5) / cs, fz = (z + 0.5) / cs;
      const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      let d1 = 9;
      for (let oz = -1; oz <= 1; oz++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const cx = ix + ox, cy = iy + oy, cz = iz + oz;
        const wx = ((cx % c) + c) % c, wy = ((cy % c) + c) % c, wz = ((cz % c) + c) % c, pi = (wx + c * (wy + c * wz)) * 3;
        const dx = cx + pts[pi] - fx, dy = cy + pts[pi + 1] - fy, dz = cz + pts[pi + 2] - fz;
        const d = dx * dx + dy * dy + dz * dz; if (d < d1) d1 = d;
      }
      acc[x + n * (y + n * z)] += w * (1 - Math.min(1, Math.sqrt(d1)));
    }
  }
  let lo = 1e9, hi = -1e9;
  for (const v of acc) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < acc.length; i++) data[i] = Math.round(255 * (acc[i] - lo) / (hi - lo));
  const t = new THREE.Data3DTexture(data, n, n, n);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

// round 26: tiling curl-noise vector field (RGB = curl of a smooth periodic vector potential, 0.5 = zero),
// used to churn the billow noise domain (eddies turning over) — divergence-free, so it swirls without
// squeezing the gas into dots or voids
function makeCurlNoise(n) {
  let seed = 7331;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pot = [0, 1, 2].map(() => new Float32Array(n * n * n));
  for (const P of pot) for (const [c, w] of [[3, 1], [6, 0.45]]) {
    const g = new Float32Array(c * c * c); for (let i = 0; i < g.length; i++) g[i] = rnd() * 2 - 1;
    const cs = n / c, sm = (t) => t * t * (3 - 2 * t);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = x / cs, fy = y / cs, fz = z / cs, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      const tx = sm(fx - ix), ty = sm(fy - iy), tz = sm(fz - iz), at = (a, b, d) => g[((a % c + c) % c) + c * (((b % c + c) % c) + c * ((d % c + c) % c))];
      const l = (a0, a1, t) => a0 + (a1 - a0) * t;
      P[x + n * (y + n * z)] += w * l(l(l(at(ix, iy, iz), at(ix + 1, iy, iz), tx), l(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx), ty), l(l(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx), l(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx), ty), tz);
    }
  }
  const id = (x, y, z) => ((x + n) % n) + n * (((y + n) % n) + n * ((z + n) % n));
  const v = new Float32Array(n * n * n * 3); let mx = 1e-6;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = (P, ax) => (P[id(x + (ax === 0), y + (ax === 1), z + (ax === 2))] - P[id(x - (ax === 0), y - (ax === 1), z - (ax === 2))]) * 0.5;
    const o = 3 * (x + n * (y + n * z));
    v[o] = d(pot[2], 1) - d(pot[1], 2); v[o + 1] = d(pot[0], 2) - d(pot[2], 0); v[o + 2] = d(pot[1], 0) - d(pot[0], 1);
    mx = Math.max(mx, Math.abs(v[o]), Math.abs(v[o + 1]), Math.abs(v[o + 2]));
  }
  const data = new Uint8Array(n * n * n * 4);
  for (let i = 0; i < n * n * n; i++) { for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round(127.5 + 127.5 * v[i * 3 + k] / mx); data[i * 4 + 3] = 255; }
  const t = new THREE.Data3DTexture(data, n, n, n);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

export class CloudSim {
  constructor(scene) {
    this.maxV = 360000;
    const g = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute(new Float32Array(this.maxV * 3), 3);
    this.nrmA = new THREE.BufferAttribute(new Float32Array(this.maxV * 3), 3);
    this.colA = new THREE.BufferAttribute(new Float32Array(this.maxV * 4), 4);
    for (const a of [this.posA, this.nrmA, this.colA]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posA);
    g.setAttribute('normal', this.nrmA);
    g.setAttribute('color', this.colA);
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, this.makeMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;   // last: its depth pre-pass must not hide other transparent effects (glow pools, mist, jets)
    // Depth pre-pass: the same displaced surface writes depth first (pushed back a hair), so
    // only the outermost layer of the cloud gets shaded. Inner folds no longer show through as
    // glassy membranes / dark crevices; the outer surface carries the whole optical thickness.
    const dm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true, colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4, side: THREE.DoubleSide });
    dm.positionNode = this.displaceNode;
    this.depthMesh = new THREE.Mesh(g, dm);
    this.depthMesh.frustumCulled = false;
    this.depthMesh.renderOrder = 998;
    scene.add(this.depthMesh);
    scene.add(this.mesh);
    this.vcount = 0;
    this.sideArea = 0;
    this.timing = { physics: 0, mesh: 0 };
    this.queue = [];
    this.pendingDt = 0;
    this.busy = false;
    this.clearFlag = false;
    // Off-main-thread simulation; inline core as fallback (Node tests, no Worker support)
    this.worker = null;
    try {
      if (typeof Worker !== 'undefined') {
        this.worker = new Worker(new URL('./cloudWorker.js', import.meta.url), { type: 'module' });
        this.spare = { pos: new ArrayBuffer(this.maxV * 12), nrm: new ArrayBuffer(this.maxV * 12), col: new ArrayBuffer(this.maxV * 16), maxV: this.maxV };
        this.worker.onmessage = (e) => this.receive(e.data);
      }
    } catch (err) { this.worker = null; }
    this.core = this.worker ? null : new CloudCore();
  }

  /** Run the simulation inline on the main thread (deterministic tests). */
  setSync(on) {
    if (on && !this.core) this.core = new CloudCore();
    this.sync = on;
  }

  makeMaterial() {
    // Ray-marched volume inside a marching-cubes hull. The hull (the gas parcels' shape field,
    // meshed in the worker) only bounds the cloud and gives the march its entry point (depth
    // pre-pass: outermost layer only). What you see is decided by the density volume (the
    // parcels' condensation, splatted in the worker) eroded by tiling billow noise: the
    // silhouette is made of rounded 1-3 m lobes (cauliflower edges as in the hover shot), thin
    // gas tears into wisps, and each lobe is lit by its own self-shadowing (lit tops, light-grey
    // hollows), never by the triangle surface.
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });   // round 21: back faces carry the march when the camera is inside the cloud
    // round 26: half-float RGBA (density/dmax + flow velocity m/s); 8-bit density printed terraces in thin gas
    const vt = this.volTex = new THREE.Data3DTexture(new Uint16Array(VOL.x * VOL.y * VOL.z), VOL.x, VOL.y, VOL.z);
    vt.format = THREE.RedFormat; vt.type = THREE.HalfFloatType; vt.minFilter = vt.magFilter = THREE.LinearFilter;
    vt.wrapS = vt.wrapT = vt.wrapR = THREE.ClampToEdgeWrapping; vt.unpackAlignment = 1; vt.needsUpdate = true;
    const nt = this.noiseTex = makeBillowNoise(32);
    const ct = this.curlTex = makeCurlNoise(32);
    this.volO = uniform(new THREE.Vector3()); this.volS = uniform(new THREE.Vector3(1, 1, 1));
    this.carP = uniform(new THREE.Vector3(0, -1e4, 0)); this.clrK = uniform(0); this.carF = uniform(new THREE.Vector3(0, 0, 1));   // clearing around the car
    const U = this.look = {
      opacity: uniform(1), start: uniform(-0.6), jit: uniform(0.6), jitW: uniform(0.4),   /* round 26: per-pixel jitter capped at X.jmax (5 cm) dithers the residual step contours without grain */   /* round 18: screen-space jitter printed a dot screen over thin gas → world-space smooth jitter */ dbg: uniform(0), nolit: uniform(0), bright: uniform(1), glow: uniform(0.3), billow: uniform(0.6), bump: uniform(0.03), edge: uniform(1.0), fray: uniform(1), ground: uniform(0),
    };
    const vc = attribute('color', 'vec4');
    const p = positionLocal; // mesh is built in world space
    // the hull swells a little beyond the gas so the eroded volume, not the polygons, makes the outline
    const swell = mx_fractal_noise_float(p.mul(0.22).add(vec3(time.mul(0.04), time.mul(-0.1), time.mul(0.03))), 2, 2.0, 0.5);
    const dp = p.add(normalLocal.mul(swell.mul(0.3).add(0.5).mul(U.billow.mul(1.6).add(0.3))));
    // round 21: the hull floor is kept just above the tarmac: seen from inside the bank its back faces
    // must pass the depth test against the ground, or the gas between the camera and the ground vanished
    m.positionNode = this.displaceNode = vec3(dp.x, max(dp.y, U.ground.add(0.04)), dp.z);
    const pw = positionWorld;
    // round 26: explicit LOD 0 (the textures have no mips): sampling inside the real (non-unrolled) march
    // loop with an early exit needs non-derivative fetches
    const volAt = (q) => texture3D(vt, q.sub(this.volO).div(this.volS)).level(0).r;
    const nAt = (q) => texture3D(nt, q).level(0).r;
    // round 26: cubic B-spline along y (2 linear fetches, Sigg & Hadwiger). Trilinear filtering is only C0
    // across the voxel layers: its gradient kinks printed horizontal Mach bands (the "levels") through the
    // thickness / colour transfers, one per 0.3–0.5 m voxel layer. x/z stay linear (vertical seams don't read).
    const volAtC = (q) => {
      const uvw = q.sub(this.volO).div(this.volS), u = uvw.y.mul(VOL.y).sub(0.5), i = u.floor(), f = u.sub(i);
      const f2 = f.mul(f), f3 = f2.mul(f), w0 = float(1).sub(f).pow(3).div(6), w1 = f3.mul(3).sub(f2.mul(6)).add(4).div(6);
      const w3 = f3.div(6), w2 = float(1).sub(w0).sub(w1).sub(w3), g0 = w0.add(w1), g1 = w2.add(w3);
      const y0 = i.sub(1).add(w1.div(g0.max(1e-5))).add(0.5).div(VOL.y), y1 = i.add(1).add(w3.div(g1.max(1e-5))).add(0.5).div(VOL.y);
      return texture3D(vt, vec3(uvw.x, y0, uvw.z)).level(0).r.mul(g0).add(texture3D(vt, vec3(uvw.x, y1, uvw.z)).level(0).r.mul(g1));
    };
    const drift = vec3(time.mul(0.05), time.mul(-0.11), time.mul(0.035));
    const drift2 = vec3(time.mul(-0.08), time.mul(-0.2), time.mul(0.06));
    const vdir = normalize(pw.sub(cameraPosition));
    // stable world-space step offset (moves with the gas surface, no per-pixel dot pattern)
    const jitW = saturate(texture3D(nt, pw.mul(0.37)).r.sub(0.5).mul(2.6).add(0.5)).mul(0.5).add(saturate(texture3D(nt, pw.mul(1.13).add(vec3(0.3, 0.7, 0.1))).r.sub(0.5).mul(2.6).add(0.5)).mul(0.5));
    // per-pixel jitter of the march start hides slicing
    const sc = screenCoordinate;
    // round 26: white hash instead of interleaved-gradient noise (IGN printed a diagonal hatch)
    const jit = fract(sin(sc.x.mul(12.9898).add(sc.y.mul(78.233))).mul(43758.5453));
    // tuning knobs (live-adjustable while calibrating against the footage)
    const X = this.knob = { er: uniform(1.05),   /* round 19: soft rounded billows (f38 variants) */ mod: uniform(1.1), sig: uniform(0.5), dsc: uniform(0.45), dscA: uniform(0.12), thin: uniform(0.07), lo: uniform(0.15), hi: uniform(0.8), amb: uniform(0.15),   /* round 19 critique: lighter shadow floor */ thk0: uniform(0.15), thk1: uniform(0.55), edge: uniform(0.08),   /* round 26: 0.22 → 0.08 (with 4 cm surface steps and exact ramp integration the old width read soft) */ fine: uniform(0.4), shad: uniform(1.3), core: uniform(5), soft: uniform(0.2), ag0: uniform(0.05), ag1: uniform(0.15), str: uniform(0),   /* unused since round 26 (kept for old scripts): was 1: the 3:1 horizontally stretched streak noise drew literal horizontal layers ('stacks') in thin gas; flow-mapped noise stretches along the real flow instead */ bf: uniform(0.5), erT: uniform(0.35),   /* round 24: 0.22 → 0.35 (f43/f47 thin wings 23–25 m vs footage 18–20 m) */   /* round 20: thin low wings stay visible */ gain: uniform(0.8),   /* round 23: 2 → 0.8 with the slower dense shape transfer */   /* round 19: 6 → 2 (f28/f30 p90 198/174 vs footage 162/152) */ gpow: uniform(6), gk0: uniform(0.0), gk1: uniform(0.1), clr: uniform(1), clrA: uniform(3.2), clrB: uniform(7), clr0: uniform(0.75), clr1: uniform(1.05), clrH: uniform(1.4), dk0: uniform(4), dk1: uniform(14), dkT: uniform(0.7), dkC: uniform(0.15), dscB: uniform(0.22), dx0: uniform(0.5), dx1: uniform(2.5), dsat: uniform(0.6), dsat0: uniform(0.2), dsat1: uniform(1.2), cf0: uniform(2), cf1: uniform(10), sth0: uniform(1.2), sth1: uniform(2.4), sthK: uniform(1), sthE: uniform(1), fn0: uniform(6), fn1: uniform(16), pthr: uniform(0.002), pback: uniform(0.5), shEw: uniform(0.22), mlen: uniform(16), jmax: uniform(0.05), chf: uniform(0.3), cha: uniform(0.8), chs: uniform(2), edgeRef: uniform(0.18), softRef: uniform(0.3) };   // round 27: edge centring re-matched to the pre-round-26 side areas (f30/f33/f38 37/52/13 m² vs 36/48/13) after the curl warp and eddies   // round 26: march length cap behind the gas entry (m), jitter cap (m), round 27: curl warp frequency (1/m) / amplitude (m) / drift speed   // round 26: pre-march threshold / back-off (m)   // round 24: heap tops seen against the sky (Chase) eroded into lobes, no spray   // round 23: thinner gas near the Chase camera (1–7 → 2–10 m)   // round 16: crispness by amount, streaky outskirts, ragged base   // round 14 calibration (side shot)
    const sigma = float(2.9).mul(U.opacity).mul(X.sig);
    const erodeAmt = U.fray.mul(0.4).add(0.5).mul(X.er);
    const N = 128, G = 1.022;   // round 26/27: 36 × 1.08 → 128 × 1.022 over at most X.mlen (16 m) from where the gas starts (pre-march below): ~2 cm steps at the surface, ~0.1 m 4 m in (96 × 1.03 still left faint fine lines in thin gas, d27v). Coarser steps printed one contour per step (the "stacks"); the loop exits once the ray is opaque
    // march from the hull entry to where the ray leaves the density volume's box. Steps grow
    // geometrically (×1.08): fine (~0.1–0.25 m) at the surface, where the crisp billow detail is
    // seen, coarse deep inside, and the whole ray to the box exit is always covered. (A fixed
    // stride from the hull ran out of steps before reaching gas further back: dark gaps.)
    const inv = vec3(1).div(vdir.add(vec3(1e-5)));
    const tA = this.volO.sub(pw).mul(inv), tB = this.volO.add(this.volS).sub(pw).mul(inv);
    const tNear = max(max(min(tA.x, tB.x), min(tA.y, tB.y)), min(tA.z, tB.z));
    const tFar = min(min(max(tA.x, tB.x), max(tA.y, tB.y)), max(tA.z, tB.z));
    // round 21: with the camera inside the bank (the Chase camera sits 7 m behind the car, right in the
    // landing cloud) only back faces are in front of it: march from the camera instead of the surface
    const sEnt = max(select(frontFacing, U.start, length(pw.sub(cameraPosition)).negate().add(0.2)), tNear);
    // round 26: pre-march the raw volume (1 fetch per step) to find where the gas actually starts behind
    // the hull entry, then spend the fine steps there. Before, the gas surface lay 1–2 m behind the
    // dilated hull where steps were already 0.3–0.5 m: each step printed a contour (the "stacks").
    const PM = 24, PG = 1.1;
    // density → [0,1]: gentle saturation, so only the thick core near the car is opaque while the
    // outer gas stays translucent (footage: bright solid core, smoky see-through outskirts)
    // two transfers of the same density: the SHAPE (saturates early: thin gas is still carved into
    // crisp billows) and the AMOUNT (saturates late: only the thick core is optically dense)
    // round 23: the shape transfer saturates more slowly in dense gas (dsc → dscB): mid/thick gas keeps
    // its billow structure (the Chase camera inside the bank saw one flat wash), thin late gas unchanged
    const sat = (d) => { const x = d.mul(VOL.dmax).sub(0.06).max(0); return float(1).sub(exp(x.mul(mix(X.dsc, X.dscB, smoothstep(X.dx0, X.dx1, x))).negate())); };
    const satA = (d) => float(1).sub(exp(d.mul(VOL.dmax).sub(0.06).max(0).mul(X.dscA).negate()));
    const ext = (bA) => X.thin.add(bA.mul(X.core));   // extinction scale: see-through wisps … solid core
    const shAt = (qq) => nAt(qq.mul(0.085).add(drift.mul(0.085))).mul(0.7).add(nAt(qq.mul(0.23).add(drift2.mul(0.23))).mul(0.3));
    const erOf = (sh, gnd, cr) => float(1).sub(sh).mul(erodeAmt).mul(float(1).sub(gnd.mul(0.35))).mul(mix(X.erT, float(1), cr));
    const modOf = (bb, sh, gnd) => mix(float(1), sh.mul(1.7).sub(0.1).max(0), X.mod.mul(float(1).sub(gnd.mul(0.4))).mul(float(1).sub(bb)));
    const densOf = (bb, sh, gnd, ew = X.edge, cr = float(1)) => {
      // billow erosion (threshold) carves lobes; the edge is crisp only in the young dense core
      // (ew), soft and smoky in thin outer gas. Multiplicative noise keeps the thin body grainy.
      const er = erOf(sh, gnd, cr);
      const d0 = smoothstep(er, er.add(ew), bb);
      return d0.mul(modOf(bb, sh, gnd));
    };
    // round 26: pre-integrated crisp transfer. The billow edge (a ramp a few cm wide) was point-sampled at
    // the march steps, so every step printed a contour line where the surface crossed it (the "stacks").
    // Here the ramp's argument is taken as linear between the previous and the current sample and the
    // ramp clamp((f)/w, 0, 1) is integrated exactly over the step: the result varies continuously with the
    // surface position, whatever the step size (Engel et al. 2001 pre-integration, analytic for a ramp).
    const rampF = (x, w) => { const t = x.div(w).clamp(0, 1), t3 = t.mul(t).mul(t); return w.mul(t3.sub(t3.mul(t).mul(0.5))).add(x.sub(w).max(0)); };   // ∫ smoothstep(0, w, x) dx (same edge profile as before)
    const preRamp = (fa, fb, w) => { const df = fb.sub(fa); return select(abs(df).lessThan(1e-4), smoothstep(float(0), w, fa.add(fb).mul(0.5)), rampF(fb, w).sub(rampF(fa, w)).div(df)); };
    // round 26: real shader loops (Loop/Break) instead of JS-unrolled ones: the unrolled 36-step march with
    // flow-mapped noise took minutes to compile on D3D; the loops also stop once the ray is opaque
    const march = Fn(() => {
    const pdl = tFar.sub(sEnt).mul((PG - 1) / (Math.pow(PG, PM) - 1)).toVar(), ps = sEnt.toVar(), pprev = sEnt.toVar(), hit = float(1e9).toVar();
    Loop(PM, () => {
      If(volAt(pw.add(vdir.mul(ps))).greaterThan(X.pthr), () => { hit.assign(pprev); Break(); });
      pprev.assign(ps); ps.addAssign(pdl); pdl.mulAssign(PG);
    });
    const s0 = select(hit.greaterThan(1e8), sEnt, max(sEnt, hit.sub(X.pback)));
    const dl = min(tFar.sub(s0), X.mlen).mul((G - 1) / (Math.pow(G, N) - 1)).clamp(0.02, 0.6).toVar();
    const s = s0.toVar();   // each sample is jittered within its own step (below), so no step leaves contour bands
    const T = float(1).toVar(), Cacc = vec3(0).toVar(), fP = float(-1).toVar(), f3P = float(-1).toVar(), fbP = float(0).toVar(), first = float(1).toVar(), cP = vec3(0).toVar();
    Loop(N, () => {
      // round 26: per-pixel jitter capped at jmax metres: it only has to dither the few-cm surface steps (bigger
      // offsets in long thin-gas steps printed speckles at the silhouettes)
      const q = pw.add(vdir.mul(s.add(select(frontFacing, jitW.mul(U.jitW).mul(dl).add(jit.mul(U.jit).mul(min(dl, X.jmax))), jit.mul(0.25).add(jitW.mul(0.75)).mul(dl)))));   // round 22: from inside, per-pixel jitter of every step (banding)
      // round 27 ('more like a fluid simulation'): the billow noise is looked up through a curl-noise (divergence-
      // free) domain warp of about its own size (~3 m, ±0.8 m), so the lobes curl over into swirls and wisps
      // like a simulated smoke's vortices, and the warp drifts (chs) so they keep turning over. Round 26 tried a
      // two-phase cross-faded flow map driven by the splatted gas velocity: it softened the crisp billows.
      const chW = texture3D(ct, q.mul(X.chf).add(vec3(0.031, 0.047, -0.023).mul(time.mul(X.chs)))).level(0).xyz.sub(0.5).mul(X.cha.mul(2));
      const qw = q.add(chW);
      const sh0 = shAt(qw);
      // the density lookup is jittered by the billow noise (±0.3 m): the trilinear volume (0.45 m
      // voxels) otherwise prints its layers as horizontal contour stripes through the crisp transfer
      // round 22: close to the camera (Chase view inside the bank) the 0.45 m voxel layers printed contour
      // stripes: add a per-pixel offset there only (it fades out by 14 m, so distant views stay clean)
      const nearJ = float(1).sub(smoothstep(4.0, 14.0, length(q.sub(cameraPosition)))).mul(jitW.sub(0.5)).mul(0.0);   // round 22: disabled (per-pixel offsets made the near gas foamy)
      const qb = q.add(vec3(sh0.sub(0.5).mul(0.5).add(nearJ), sh0.sub(0.5).mul(-0.7).sub(nearJ), sh0.sub(0.5).mul(0.4).add(nearJ.mul(0.7))));
      const base = volAtC(qb);
      const hq = q.y.sub(U.ground);
      const gnd = float(1).sub(smoothstep(0.1, 1.4, hq)).mul(0.4);
      const b = sat(base);
      const bA = satA(base);
      // crispness follows the amount of gas: sharp billows only in the thick young core, older
      // thinner gas is smoother, streaky and translucent
      const crisp = smoothstep(X.ag0, X.ag1, bA);
      // round 24: the stretched streak texture is for ground-hugging outskirts; up high (heap tops seen
      // against the sky from the Chase camera) it read as wind-blown spray: billow lobes there instead
      const crispH = max(crisp, smoothstep(X.sth0, X.sth1, hq).mul(X.sthK));   // high gas: rounded lobes with crisp-ish edges
      // round 26: the stretched streak texture (stAt, str) is retired: its 3:1 horizontal stretch drew the 'stacks'
      const sh = sh0;
      const ew = mix(X.soft, X.edge, crispH);
      // round 26: narrower edges, centred where the old (round 25) edge centre was, so the visible amount and
      // outline stay the same (sheet areas) while the billow edge gets crisper
      const ewRef = mix(X.softRef, X.edgeRef, crispH);
      const er0 = erOf(sh, gnd, mix(crisp, crispH, X.sthE)), f0 = b.sub(er0).sub(ewRef.sub(ew).mul(0.5).max(0));
      const fa0 = select(first.greaterThan(0.5), f0, fP);
      const d0i = preRamp(fa0, f0, ew);
      // where in this step the gas lies (fraction 0 = previous sample … 1 = this one): the step's colour is
      // taken there, interpolated between the two samples, instead of at the sample point
      const tc = fa0.div(fa0.sub(f0)).clamp(0, 1);
      const lam = select(abs(f0.sub(fa0)).lessThan(1e-4), float(0.5), select(f0.greaterThan(fa0), tc.add(1).mul(0.5), tc.mul(0.5)));
      fP.assign(f0);
      const dens0 = d0i.mul(modOf(b, sh, gnd));
      // fine cauliflower puffs (~0.3–0.6 m and ~1 m) carved into the surface of the dense core only
      const sh3 = nAt(qw.mul(0.32).add(drift2.mul(0.32))).mul(0.7).add(nAt(qw.mul(0.55).add(drift.mul(0.55))).mul(0.3));
      const er3 = float(1).sub(sh3).mul(X.fine).mul(crisp).mul(float(1).sub(dens0.mul(0.7))).mul(smoothstep(X.fn0, X.fn1, length(q.sub(cameraPosition))));   // round 25: the fine cauliflower carving read as foam from the Chase camera 5–15 m away: fade it in with distance
      // ragged base: the gas thins out over the bottom ~0.2–0.8 m with noisy height (footage: soft,
      // torn lower edge with tendrils along the tarmac, not a razor line on the ground)
      // round 26: pre-integrated too — a height ramp a few dm wide, crossed by the downward rays of a raised
      // camera, printed one horizontal line per step (the remaining 'levels' in the FX-editor follow view)
      const bw = sh.mul(X.bf.mul(1.6)).add(0.1), fb0 = hq.add(0.05);
      const baseF = preRamp(select(first.greaterThan(0.5), fb0, fbP), fb0, bw);
      fbP.assign(fb0);
      // clearing: the car's jets and the outflow from under it keep the gas off the body (footage
      // f30–f43: the car stays visible between the fore and aft heaps); ragged by the billow noise
      const cd = q.sub(this.carP), cax = cd.x.mul(this.carF.x).add(cd.z.mul(this.carF.z)), clx = cd.x.mul(this.carF.z).sub(cd.z.mul(this.carF.x));
      const ce = length(vec3(cax.div(X.clrA), cd.y.max(0).div(X.clrH), clx.div(X.clrB))).add(sh.sub(0.5).mul(0.5));
      const clear = mix(float(1), smoothstep(X.clr0, X.clr1, ce), X.clr.mul(this.clrK));
      // round 22: gas right at the camera is thin (a camera inside a cloud sees the car and the billows around it, not a grey wash)
      const camF = smoothstep(X.cf0, X.cf1, length(q.sub(cameraPosition)));
      const f3 = dens0.sub(er3), d3i = preRamp(select(first.greaterThan(0.5), f3, f3P), f3, ew);
      f3P.assign(f3);
      const dens = d3i.mul(dens0.min(1)).mul(baseF).mul(clear).mul(camF);
      // self-shadow toward the overhead floodlights: lit billow tops, grey folds and undersides
      // shadow lookups: trilinear volume and this sample's billow noise (cost: 6 fewer noise fetches per step for
      // 128 steps; the shadow is soft, d27w2 sheet: no visible difference)
      const densAt = (qq) => { const v = volAt(qq); return densOf(sat(v), sh0, float(0), X.shEw).mul(ext(satA(v))); };
      const occ = densAt(q.add(vec3(0.04, 0.25, 0.03))).mul(0.35).add(densAt(q.add(vec3(0.06, 0.6, 0.04))).mul(0.6)).add(densAt(q.add(vec3(0.15, 1.4, 0.1))).mul(0.9)).mul(sigma).mul(X.shad).add(volAtC(q.add(vec3(0.3, 2.6, 0.2))).mul(VOL.dmax * 1.6));
      const lit = mix(exp(occ.negate()), float(1), U.nolit);
      const hgt = smoothstep(-0.3, 2.6, hq);
      // colour by thickness: the thick core reads cyan-white, thin outer gas grey and dimmer
      // round 18: graded by distance from the car (footage f33–f47: bright heaps next to the car,
      // dimmer, thinner, grey streaks further out — the stage lights are centred on the car)
      const distF = smoothstep(X.dk0, X.dk1, length(vec2(cd.x, cd.z))).mul(step(-1000, this.carP.y));
      const thick = smoothstep(X.thk0, X.thk1, bA).mul(float(1).sub(distF.mul(X.dkT)));
      // dynamic range (round 16 critique): the lit tops of the young dense billows next to the car
      // are near-clipping bright (HDR → bloom), thin gas stays dark grey and see-through
      const rad = lit.mul(1.4).add(pow(lit, X.gpow).mul(X.gain).mul(smoothstep(X.gk0, X.gk1, bA)).mul(float(1).sub(distF))).add(X.amb.add(hgt.mul(0.08))).mul(float(1).sub(distF.mul(X.dkC)));
      const col = mix(vec3(0.46, 0.55, 0.58).mul(X.lo.div(0.42)), vec3(0.56, 0.93, 0.95).mul(X.hi), thick);   /* round 20: a touch less saturated */   // round 19: the tonemapper desaturates: footage core (150,179,178) needs a strong cyan input   // footage: brightest core ~(150,176,176), cyan
      // thick gas is optically much denser (crisp, solid billows); thin gas stays see-through
      // round 23: dim (shadowed / thin) samples are greyer: the cyan input is tuned for the bright core, which
      // the tonemapper desaturates; dim gas kept the full cyan and read as a teal wash in the Chase view
      const colD = mix(col, vec3(dot(col, vec3(0.3, 0.55, 0.15))), X.dsat.mul(float(1).sub(smoothstep(X.dsat0, X.dsat1, rad))));
      const a = float(1).sub(exp(dens.mul(sigma).mul(ext(bA)).mul(dl).negate()));
      const cCur = colD.mul(rad), cEff = mix(select(first.greaterThan(0.5), cCur, cP), cCur, lam);
      cP.assign(cCur); first.assign(0);
      Cacc.addAssign(cEff.mul(a).mul(T));
      T.mulAssign(float(1).sub(a));
      s.addAssign(dl);
      dl.mulAssign(G);
      If(T.lessThan(0.004), () => { Break(); });
    });
    return vec4(Cacc, float(1).sub(T));
    });
    const res = march();
    const L = res.xyz, alpha = res.w;
    // hull vertex colours are blocky (coarse proxy mesh): only a faint influence, or they print boxes
    const tint = mix(vec3(0.9), vc.rgb, 0.25).div(0.9);
    m.colorNode = tint.mul(L.div(alpha.max(1e-3))).mul(U.glow.mul(0.55).add(0.24)).mul(U.bright);
    m.colorNode = mix(m.colorNode, vec3(alpha), U.dbg);
    m.opacityNode = mix(alpha, float(1), U.dbg).mul(select(frontFacing, smoothstep(-0.2, 0.25, pw.y.sub(U.ground)).mul(0.9).add(0.1), float(1))).min(1);
    return m;
  }

  /** Queue one gas parcel. Sizes are visible radii at birth/end (m); mass 0..~1.5. */
  emit(p, v, { mass, r0, r1, life, hold = 0.2, color = [1, 1, 1], drag = 2, rise = 0.1, ring = null }) {
    if (this.sync || !this.worker) { this.core.emit(p, v, { mass, r0, r1, life, hold, color, drag, rise, ring }); return; }
    this.queue.push(p.x, p.y, p.z, v.x, v.y, v.z, mass, r0, r1, life, hold, color[0], color[1], color[2], drag, rise, ring ? 1 : 0, ring ? ring.x : 0, ring ? ring.z : 0);
  }

  clear() {
    if (this.core) this.core.clear();
    simTime.value = 0;
    this.queue.length = 0; this.gT = 0;
    this.clearFlag = true;
    this.geometry.setDrawRange(0, 0);
  }

  syncLook() {
    const U = this.look;
    U.opacity.value = FX.cloudOpacity; U.bright.value = FX.cloudBrightness; U.glow.value = FX.cloudGlow;
    U.billow.value = FX.cloudBillow; if (this.groundY !== undefined) U.ground.value = this.groundY; U.bump.value = FX.cloudBump; U.edge.value = FX.cloudEdge; U.fray.value = FX.cloudFray;
    const p = this.prm ||= {};
    for (const k in CLOUD_DEFAULTS) p[k] = FX[k];
    return p;
  }

  update(dt, car) {
    const prm = this.syncLook();
    if (car) {
      const q = car.quat, fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y), fl = Math.hypot(fx, fz) || 1;
      this.carP.value.copy(car.pos); this.carF.value.set(fx / fl, 0, fz / fl);
      // the clearing forms once the car is down among the gas (f28: one mound under the hovering car)
      // (f33, just after touchdown, the car is still mostly hidden; by f38 it shows between the heaps)
      const hg = car.pos.y - (this.groundY ?? 0); this.gT = hg < 0.8 ? (this.gT || 0) + dt : 0;
      const u = Math.min(1, Math.max(0, (this.gT - 0.15) / 0.6)); this.clrK.value = u * u * (3 - 2 * u);
    } else this.carP.value.set(0, -1e4, 0);
    const c = car ? { px: car.pos.x, py: car.pos.y, pz: car.pos.z, qx: car.quat.x, qy: car.quat.y, qz: car.quat.z, qw: car.quat.w } : null;
    if (this.sync || !this.worker) {
      const n = this.core.update(dt, c, { pos: this.posA.array, nrm: this.nrmA.array, col: this.colA.array, maxV: this.maxV }, prm);
      this.sideArea = this.core.sideArea; this.denseArea = this.core.denseArea; this.sideW = this.core.sideW; this.sideTop = this.core.sideTop; this.timing = this.core.timing;
      this.setVolume(this.core.vol, this.core.volInfo);
      this.commit(n);
      return;
    }
    // hand the next step to the worker; if it's still busy, accumulate time and emissions
    this.pendingDt += dt;
    if (this.busy) return;
    const emits = new Float32Array(this.queue);
    this.queue.length = 0;
    const step = Math.min(this.pendingDt, 0.05);
    this.pendingDt = 0;
    this.busy = true;
    const bufs = this.spare;
    this.spare = null;
    this.worker.postMessage({ dt: step, car: c, emits, bufs, clear: this.clearFlag, prm }, [emits.buffer, bufs.pos, bufs.nrm, bufs.col]);
    this.clearFlag = false;
  }

  setVolume(vol, info) {
    if (!vol || !info) return;
    this.volTex.image.data.set(vol); this.volTex.needsUpdate = true;
    // uvw = (p − o)/(n·s) + 0.5/n  → store o' = o − 0.5·s and S = n·s
    this.volO.value.set(info.ox - 0.5 * info.sx, info.oy - 0.5 * info.sy, info.oz - 0.5 * info.sz);
    this.volS.value.set(VOL.x * info.sx, VOL.y * info.sy, VOL.z * info.sz);
  }

  receive({ vcount, sideArea, denseArea, timing, bufs, vol, volInfo, sideW, sideTop }) {
    this.setVolume(vol, volInfo); this.sideW = sideW; this.sideTop = sideTop;
    const n = vcount;
    this.posA.array.set(new Float32Array(bufs.pos, 0, n * 3));
    this.nrmA.array.set(new Float32Array(bufs.nrm, 0, n * 3));
    this.colA.array.set(new Float32Array(bufs.col, 0, n * 4));
    this.sideArea = sideArea; this.denseArea = denseArea; this.timing = timing;
    this.spare = bufs;
    this.busy = false;
    this.commit(n);
  }

  commit(n) {
    this.vcount = n;
    this.geometry.setDrawRange(0, n);
    for (const [a, sz] of [[this.posA, 3], [this.nrmA, 3], [this.colA, 4]]) {
      a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n) * sz); a.needsUpdate = true;
    }
  }
}
