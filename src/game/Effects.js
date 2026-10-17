// Cold-gas thruster and tire-smoke effects, measured frame by frame from the reveal Semi-jump footage (fixed camera
// on the whole Semi jump, 6 unique frames/s of slow motion = 15 real frames/s) and the reveal:
//  • every nozzle emits a stream of gas points; the visible jet is a camera-facing ribbon through
//    them. Because the gas keeps its own momentum, columns bend and trail when the car rotates,
//    detach when a valve closes and drift apart in ~0.3 s instead of vanishing on the spot
//  • lift / pop / landing jets: long bluish-white columns that reach the ground from ~10 m
//    (≈0.15 m wide at the nozzle, ~1 m near the ground)
//  • attitude / roll jets: thin cyan cones ~2–2.5 m long, ~0.5 m wide at the tip
//  • only gas that actually reaches the ground makes cloud: a brief touch at takeoff leaves a
//    small low splash; sustained low firing at landing builds the big cloud that rolls outward
//  • perimeter jets fire selectively, according to the force and torque the car needs
import * as THREE from 'three/webgpu';
import {
  attribute, vec3, vec4, float, uniform, abs, pow, mix, smoothstep, mx_noise_float,
  positionGeometry, cameraPosition, cross, normalize, length, select,
  viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar, positionView, saturate, positionWorld,
} from 'three/tsl';
import { groundAt, LIGHTS } from './layout.js';
import { CloudSim, simTime as time } from './CloudSim.js';
import { FX } from './fxParams.js';

// Soft-particle factor: fade where the effect approaches opaque geometry behind it.
function softness(distance) {
  const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(), cameraNear, cameraFar);
  return saturate(positionView.z.sub(sceneZ).div(distance));
}

// ambient air for the jet gas = the cloud wind (FX windX/windZ; footage: ~calm)
const WIND = new THREE.Vector3(0, 0, 0);
// deterministic per-index pseudo-random (jet variation must not depend on page-load randomness)
const hash01 = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

// ------------------------------------------------------------------ jet ribbons
const NPTS = 72;            // gas points per nozzle (ring buffer)
const EMIT_HZ = 120;        // gas points emitted per second while a valve is open
const SEG_V = 6;            // vertices per ribbon segment (2 rings × left/centre/right)
// visual exhaust speed and lifetime: columns reach ~9–10 m, cones ~2.3 m (measured)
// (radii are the ribbon half-width; the soft profile shows roughly the inner 60%)
const COL = { speed: 44, life: 0.42, r0: 0.13, spread: 0.08 };   // round 25: 0.15 → 0.08 (VERTJUMP u55/u61: narrow ~0.3–0.6 m columns, mild flare; the 1.5–2 m fans were too wide)   // round 18: 0.12 → 0.15 (3.0 s: grey-blue diffuse columns, not narrow bright rods)   // round 16: wider toward the ground (VERTJUMP 3.0–3.4 s: ~1.5–2 m wide diffuse feet)
const RCS = { speed: 46, life: 0.06, r0: 0.07, spread: 0.18 };   // round 25: 0.26 → 0.18 (footage 2.5 s: one long thin bright plume)   // fast gas: cones stay straight while the car spins; they widen quickly

function makeJetMaterial() {
  const seed = uniform(0).onObjectUpdate(({ object }) => object.userData.jetSeed || 0);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const tang = attribute('tang', 'vec3');
  const jd = attribute('jdat', 'vec4');   // side (-1..1), radius, alpha, normalized age
  const jx = attribute('jx', 'vec2');     // rcs (0/1), gas coordinate (travels with the flow)
  const c = positionGeometry;             // ribbon centre line, world space (mesh has identity transform)
  const toCam = normalize(cameraPosition.sub(c));
  const sideV = cross(tang, toCam);
  const sl = length(sideV);
  const side = select(sl.greaterThan(1e-4), sideV.div(sl.max(1e-4)), vec3(1, 0, 0));
  m.positionNode = c.add(side.mul(jd.y.mul(jd.x)));
  const across = abs(jd.x);
  const age = jd.w;
  // turbulent break-up that advects with the gas and grows downstream
  const n1 = mx_noise_float(vec3(jd.x.mul(1.6), jx.y.mul(1.1), seed));
  const n2 = mx_noise_float(vec3(jd.x.mul(3.7), jx.y.mul(1.4).sub(time.mul(2.0)), seed.add(4.3)));
  const turb = n1.mul(0.6).add(n2.mul(0.4)).mul(0.5).add(0.5);
  // clumpy, turbulent gas inside the plume, ragged tips
  const breakup = mix(float(1), smoothstep(0.32, 0.78, turb), smoothstep(0.04, 0.6, age).mul(mix(float(0.9), float(1), jx.x)));
  // soft plume: a bright core plus a hazy halo (no hard edge), feathered by turbulence
  // columns are diffuse (VERTJUMP 3.0–3.4 s: soft, wide, grey-blue), attitude cones keep a tight bright core
  const core2 = pow(saturate(float(1).sub(across.mul(across))), mix(float(1.0), float(3.0), jx.x));   // round 19: 1.7 → 1.0 (columns more diffuse)
  const halo = saturate(float(1).sub(across)).mul(mix(float(0.45), float(0.35), jx.x));   // round 25: 0.7 → 0.45, the haze is a faint sleeve only   // round 19: 0.5 → 0.7 (foggy grey-blue columns, 3.0 s)
  const profile = core2.add(halo);
  const edgeFray = mix(float(1), smoothstep(0.1, 0.6, turb), across);
  // where the gas runs along the view ray the ribbon has no defined width: fade it instead of
  // falling back to a fixed side vector (that drew bright horizontal bars at the column feet)
  const viewOk = smoothstep(0.08, 0.35, sl);
  m.opacityNode = jd.z.mul(profile).mul(breakup).mul(edgeFray).mul(viewOk).mul(softness(0.3)).min(1);
  // colours sampled from the footage: columns bluish white, attitude cones cyan with a white core
  const core = float(1).sub(across).mul(float(1).sub(age));
  const colCol = mix(vec3(0.36, 0.66, 0.8), vec3(0.8, 0.93, 1.0), core.mul(core));   // round 25: cyan body (footage ~(130,190,210)) with a whiter core, not grey-white fans
  const rcsCol = mix(vec3(0.38, 0.72, 0.9), vec3(0.75, 0.93, 1.0), core.mul(core).mul(core));
  // the footage cones are the brightest thing in frame after the headlights: HDR core so they bloom
  const hdr = mix(float(0.8), float(2.4), jx.x).mul(float(1).sub(age.mul(mix(float(0.75), float(0.6), jx.x))));
  m.colorNode = vec4(mix(colCol, rcsCol, jx.x).mul(turb.mul(0.25).add(0.9)).mul(hdr), float(1));
  return m;
}

// Impingement glow: where a column hits the tarmac the footage shows a bright, soft pool of
// light-scattering gas. A flat disc on the ground with a radial falloff, additive.
function makeGlowMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const lvl = uniform(0).onObjectUpdate(({ object }) => object.userData.glow || 0);
  const d = length(positionGeometry.xy);          // disc of radius 1 in its own plane
  // diffuse, irregular mist (no clean oval): radial falloff broken up by drifting noise
  const mist = mx_noise_float(vec3(positionGeometry.xy.mul(2.2), time.mul(1.5))).mul(0.5).add(0.5);
  const fall = pow(saturate(float(1).sub(d)), float(2.2)).mul(mist.mul(1.3).add(0.1));
  // seen at a grazing angle the disc collapses into a thin bright bar at the column's foot
  // (round 13/14 jets_zoom at 3.0 s): fade it out toward edge-on views
  const edgeOn = smoothstep(0.2, 0.7, abs(normalize(cameraPosition.sub(positionWorld)).y));
  m.colorNode = vec4(vec3(0.62, 0.82, 0.95).mul(fall).mul(lvl).mul(edgeOn).mul(0.42), float(1));
  m.opacityNode = fall.mul(lvl).mul(edgeOn).min(1);
  return m;
}

function makeJetGeometry() {
  const nSeg = (NPTS - 1) * 2;   // core ribbon + mist sleeve
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(nSeg * SEG_V * 3), 3);
  const tang = new THREE.BufferAttribute(new Float32Array(nSeg * SEG_V * 3), 3);
  const jdat = new THREE.BufferAttribute(new Float32Array(nSeg * SEG_V * 4), 4);
  const jx = new THREE.BufferAttribute(new Float32Array(nSeg * SEG_V * 2), 2);
  for (const a of [pos, tang, jdat, jx]) a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pos); g.setAttribute('tang', tang); g.setAttribute('jdat', jdat); g.setAttribute('jx', jx);
  const idx = [];
  for (let s = 0; s < nSeg; s++) {
    const b = s * SEG_V; // ring0: b, b+1, b+2 (L,C,R) ring1: b+3, b+4, b+5
    idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5);
  }
  g.setIndex(idx);
  g.setDrawRange(0, 0);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

class GasTrail {
  constructor() {
    const N = NPTS;
    this.p = new Float32Array(N * 3); this.v = new Float32Array(N * 3);
    this.age = new Float32Array(N); this.life = new Float32Array(N); this.lev = new Float32Array(N);
    this.dist = new Float32Array(N); this.rcs = new Uint8Array(N); this.chain = new Int32Array(N);
    this.coord = new Float32Array(N); this.hit = new Float32Array(N); this.gh = new Float32Array(N).fill(-1e9);
    this.n = 0; this.chainId = 0; this.acc = 0; this.coordT = 0;
    this.last = new THREE.Vector3(); this.lastD = new THREE.Vector3(); this.hasLast = false; this.open = false;
  }
  // newest first: shift everything down by one
  push(px, py, pz, vx, vy, vz, lev, rcs, life) {
    const N = NPTS, n = Math.min(this.n, N - 1);
    this.p.copyWithin(3, 0, n * 3); this.v.copyWithin(3, 0, n * 3);
    for (const a of [this.age, this.life, this.lev, this.dist, this.rcs, this.chain, this.coord, this.hit, this.gh]) a.copyWithin(1, 0, n);
    this.p[0] = px; this.p[1] = py; this.p[2] = pz; this.v[0] = vx; this.v[1] = vy; this.v[2] = vz;
    this.age[0] = 0; this.life[0] = life; this.lev[0] = lev; this.dist[0] = 0; this.rcs[0] = rcs; this.chain[0] = this.chainId;
    this.coord[0] = this.coordT; this.hit[0] = 0; this.gh[0] = -1e9;
    this.n = n + 1;
  }
}

// ------------------------------------------------------------------ lighting tint
// Vapor is lit by the parking-lot LEDs (cool white) and by the car's own red tail bar.
// Clouds far from any pole read dimmer.
let dayMode = false;
export function setEffectsDay(d) { dayMode = d; }
function lightTint(p, out, extraRed = 0) {
  let lit = dayMode ? 1 : 0.8;
  if (!dayMode) for (let i = 0; i < LIGHTS.length; i++) {
    const dx = p.x - LIGHTS[i][0], dz = p.z - LIGHTS[i][1];
    const d2 = dx * dx + dz * dz;
    if (d2 < 900) lit = Math.max(lit, 0.8 + 0.2 * (1 - Math.sqrt(d2) / 30));
  }
  const red = Math.min(0.6, extraRed);
  const v = lit * (0.94 + Math.random() * 0.06);
  out[0] = v;
  out[1] = v * (1 - red * 0.75);
  out[2] = v * (1 - red * 0.7) * 1.02;
  return out;
}

// ------------------------------------------------------------------ main
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _r = new THREE.Vector3();
const _f = new THREE.Vector3();
const _tau = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _v2 = new THREE.Vector3(), _r2 = new THREE.Vector3();
const _a = new THREE.Vector3();
const _col = [1, 1, 1];
const _t3 = [0, 1, 0];
const _up3 = new THREE.Vector3();
const _out = new THREE.Vector3();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.cloud = new CloudSim(scene); // physically simulated gas parcels, meshed every frame
    this.fx = FX;                     // live FX params (debug/editor handle)
    this.domeTune = { peak: 1.8, w: 1, up: 0.8 };   // round 25: centre-peaked dome (w 1.3 pushed the dome back over the Chase camera)   // hover dome under the car: along-car spread shape, width, centre-peaked upwash (round 25 calibration handle)
    this.colCant = -0.03;   // lift-column outward cant (negative cancels the ports' built-in cant)
    this.wingTune = { sp: 1, life: 1 };   // low thin wings fore/aft (round 25 calibration handle)
    this.heapTune = { rise: -0.15, life: 1.3, mass: 1.6 };   /* round 23: f43 heaps stood ~1.2 m vs the footage's ~2.5 m by the car */   // fountain heaps once the car is down (round 23 calibration handle)
    this.jetMat = makeJetMaterial();  // one shared material for every nozzle (single pipeline)
    this.glowMat = makeGlowMaterial();
    this.glowGeo = new THREE.CircleGeometry(1, 24);
    this.warmFrames = 0;              // while > 0, every jet renders (at zero opacity) so its pipeline gets compiled
    this.pulseEvents = [];            // attitude-jet pulse onsets this frame (for sound)
    this.jets = [];
    this.time = 0;
  }

  /** Emit a cloud parcel. Visible size → radius, opacity → mass, life/hold → evaporation. */
  vapor(p, v, life, size0, size1, alpha, color, drag = 1.5, rise = 0, hold = 0.1, ring = null) {
    const S = FX.cloudSize, D = FX.cloudDissipation;
    // gas carried out by the ring lingers as low streaks (side shot f43–f47: the outskirts are still
    // 18–20 m wide at +2–3 s, after the core over the car has gone)
    const mk = this.massK || 1, sk = Math.cbrt(mk);
    this.cloud.emit(p, v, { mass: alpha * 1.7 * (ring ? 0.7 : 1) * mk, r0: size0 * 0.75 * S * sk, r1: size1 * 0.8 * S * sk, life: life * FX.cloudLife * (ring ? 1.5 : 1), hold: hold / D, color, drag, rise, ring });
  }

  /** markers: { rear: Object3D[], perimeter: Object3D[] } */
  attachJets(thrusters) {
    for (const j of this.jets) { this.scene.remove(j.mesh); j.mesh.geometry.dispose(); if (j.glow) this.scene.remove(j.glow); }
    this.jets = [];
    let pc = 0;
    const add = (marker, kind) => {
      const ji = this.jets.length;
      const mesh = new THREE.Mesh(makeJetGeometry(), this.jetMat);
      mesh.userData.jetSeed = hash01(ji, 1) * 10;
      mesh.renderOrder = 11;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      const glow = new THREE.Mesh(this.glowGeo, this.glowMat);
      glow.rotation.x = -Math.PI / 2; glow.renderOrder = 12; glow.frustumCulled = false; glow.visible = false; glow.userData.glow = 0;
      this.scene.add(glow);
      this.jets.push({ marker, mesh, glow, kind, pidx: kind === 'perimeter' ? pc++ : -1, lenVar: 0.7 + 0.6 * hash01(ji, 2), trail: new GasTrail(), value: 0, groundAcc: 0, dwell: 0, flicker: hash01(ji, 3) * 10, acc: 0, pulse: 0, cool: 0, rcs: false, splash: 0 });
    };
    for (const m of thrusters.rear || []) add(m, 'rear');
    for (const m of thrusters.perimeter || []) add(m, 'perimeter');
  }

  /** Forget all jet / valve / cloud state (tests and sheets start from an identical state). */
  resetJets() {
    this.time = 0; this.landT = 0; this.pulseEvents.length = 0;
    this.jets.forEach((j, ji) => {
      Object.assign(j, { value: 0, groundAcc: 0, fountAcc: 0, dwell: 0, acc: 0, pulse: 0, cool: 0, rcs: false, vOpen: false, vt: 0, vLev: 0, aAlign: 0, flicker: hash01(ji, 3) * 10 });
      j.trail = new GasTrail(); if (j.glow) { j.glow.userData.glow = 0; j.glow.visible = false; }
    });
    this.cloud.clear();
  }

  /** Decide each jet's firing level from the vehicle's thrust/lift/torque demand. */
  updateJets(car, dt) {
    const cgPos = car.pos;
    const T = car.controlTorque;
    const tMag = Math.min(1, T.length());
    const burst = car.burstTimer > -0.12;   // footage: the pop columns are still attached at 0.6 s; valves taper off just after the burst
    this.landT = car.autoLift > 0 && car.liftLevel > 0.2 ? (this.landT || 0) + dt : 0;
    // round 21: each landing gets its own lopsided cloud (footage f30: the tallest heap at one end, the
    // other side lower and wispier): fore/aft share and heap vigour drawn once per landing
    if (this.landT > 0 && this.landT <= dt + 1e-6) { const b = Math.random() - 0.5; this.fBias = b; this.fUp = [1 + 0.3 * b, 1 - 0.3 * b]; }
    let openCount = 0; for (const j of this.jets) if (j.vOpen) openCount++;
    for (const j of this.jets) {
      let target = 0;
      if (j.kind === 'rear') {
        target = car.thrustLevel; j.rcs = false;
      } else {
        j.marker.getWorldPosition(_p);
        j.marker.getWorldQuaternion(_q);
        _d.set(0, 0, 1).applyQuaternion(_q);        // exhaust direction
        _f.copy(_d).negate();                       // force on the car
        const upForce = Math.max(0, _f.y);
        // sustained lift (hover, landing flare, kickflip pop) → steady columns
        let sustained = Math.min(1, car.liftLevel) * Math.min(1, upForce * 1.3);
        // landing burn ramps up as in VERTJUMP: the rear pair first, the rest ~0.3 s later
        if (this.landT > 0 && j.pidx !== 6 && j.pidx !== 7) sustained *= smooth(0.15, 0.4, this.landT);
        // round 18: VERTJUMP 3.4 s shows 4 near-vertical landing columns (front and rear pairs under the
        // body); the canted front-corner ports (p4/p5) stay shut during the landing burn
        if (this.landT > 0 && (j.pidx === 4 || j.pidx === 5)) sustained = 0;
        if (burst) sustained = Math.max(sustained, Math.min(1, upForce * 1.5));
        // attitude / assist demand
        let att = 0;
        if (car.assistLevel > 0.02) {
          const fh = Math.hypot(_f.x, _f.z);
          const A = car.assistForce, al = Math.hypot(A.x, A.z);
          // sideways part of the demand (drift correction) → the flank ports
          _a.set(-1, 0, 0).applyQuaternion(car.quat); const latF = A.x * _a.x + A.z * _a.z;
          j.aAlign = Math.abs(latF) > 250 && fh > 0.05 ? Math.max(0, (_f.x * _a.x + _f.z * _a.z) * Math.sign(latF) / fh) * Math.min(1, fh * 1.5) : 0;
          if (fh > 0.05 && al > 1) att = Math.max(att, Math.max(0, (_f.x * A.x + _f.z * A.z) / (fh * al)) * Math.min(1, car.assistLevel * 1.4));
        }
        if (tMag > 0.02) {
          _r.subVectors(_p, cgPos);
          _tau.crossVectors(_r, _f);
          const tl = _tau.length();
          if (tl > 1e-3) att = Math.max(att, Math.max(0, _tau.dot(T) / (tl * Math.max(tMag, 1e-3))) * tMag);
        }
        if (!(car.flipState === 'spinup' || car.flipState === 'coast' || car.flipState === 'spindown')) { j.vOpen = false; j.vt = 1; }
        if (car.assistLevel <= 0.02) j.aAlign = 0;
        if (sustained <= 0.35 && car.lateralTrim > 0.12 && (j.aAlign || 0) > 0.6) {
          // landing approach: the flight computer's drift correction holds a side jet open
          target = Math.min(1, 0.55 + car.lateralTrim); j.rcs = true; j.pulse = 0; j.acc = 0;
        } else if (sustained > 0.35) {
          target = sustained; j.rcs = false; j.acc = 0; j.pulse = 0;
        } else if (car.flipState === 'spinup' || car.flipState === 'coast' || car.flipState === 'spindown') {
          // the roll (VERTJUMP: 2–4 thin cones visible in every frame from 1.1 s to 3.0 s, also
          // while hanging inverted): jets whose torque lines up with the roll demand stay open;
          // when the demand is small the opposite side trims too (holding the hang)
          _r.subVectors(_p, cgPos); _tau.crossVectors(_r, _f);
          const tl = _tau.length(), fl = car.flipCtl.length();
          const align = tl > 1e-3 && fl > 1e-3 ? _tau.dot(car.flipCtl) / (tl * fl) : 0;
          const dem = car.rollBurn || 0;
          let want = 0;
          if (align > 0.3) want = 0.75 + 0.25 * dem;
          else if (align < -0.3 && dem < 0.12) want = 0.7;
          // valve timing (footage: cones live ~0.2–0.5 s, the pattern switches ~5×/s): once open a
          // valve stays open ≥0.3 s, once shut it stays shut ≥0.15 s
          j.vt = (j.vt ?? 0) + dt;
          if (j.vOpen && !want && j.vt > 0.3) { j.vOpen = false; j.vt = 0; openCount--; }
          else if (!j.vOpen && want && j.vt > 0.15 && openCount < 3) { j.vOpen = true; j.vt = 0; j.vLev = want; openCount++; }   // footage: 2–3 cones at a time
          if (j.vOpen && want) j.vLev = want;
          const lev = j.vOpen ? (j.vLev || 0.7) : 0;
          // the first quarter turn still flows as heavy white plumes (VERTJUMP 0.67–0.9 s);
          // from there on the jets read as thin cyan cones
          target = lev; j.rcs = true; j.pulse = 0; j.acc = 0;
          if (lev > 0 && j.value < 0.05 && dt > 0) this.pulseEvents.push({ strength: 0.75, pan: Math.sign(j.marker.position.x || 1) });
        } else {
          // Bang-bang pulse-width modulation, measured from the reveal footage: individual
          // bursts last ~0.05–0.2 s and the firing pattern switches every ~0.13–0.27 s. Demand is
          // integrated; once it reaches a minimum impulse bit the valve opens fully for a pulse.
          j.acc = j.acc * Math.exp(-0.6 * dt) + att * dt;
          j.cool -= dt;
          if (j.pulse > 0) j.pulse -= dt;
          else if (j.cool <= 0 && j.acc >= FX.pulseThreshold) {
            j.pulse = Math.min(FX.pulseMax, Math.max(FX.pulseMin, j.acc * 2.5));
            j.acc = Math.max(0, j.acc - j.pulse);
            j.cool = j.pulse + FX.pulseCooldown; // valve recovery before the same nozzle can fire again
            this.pulseEvents.push({ strength: Math.min(1, 0.5 + j.pulse * 3), pan: Math.sign(j.marker.position.x || 1) });
          }
          j.rcs = true;
          target = j.pulse > 0 ? 1 : 0;
        }
      }
      // valves open fast and close fast
      const rate = target > j.value ? 70 : 45;
      j.value += (target - j.value) * Math.min(1, dt * rate);
      if (j.value < 0.01) j.value = 0;
    }
  }

  /** Per-frame visuals for all jets: gas streams, ribbons, ground clouds. */
  emitJets(car, dt) {
    this.time += dt;
    WIND.set(FX.windX, 0, FX.windZ);
    const liftFiring = car.liftLevel > 0.3;
    const w = car.angVel;
    for (const j of this.jets) {
      const L = j.value, tr = j.trail;
      j.marker.getWorldPosition(_p);
      j.marker.getWorldQuaternion(_q);
      _d.set(0, 0, 1).applyQuaternion(_q);
      // Footage: the perimeter plumes splay outward from the body (attitude cones diverge at
      // ~30–50°, lift columns only slightly), so the visible gas leaves with an outward cant
      if (j.kind === 'perimeter') {
        _up3.set(0, 1, 0).applyQuaternion(car.quat);
        _out.subVectors(_p, car.pos); _out.addScaledVector(_up3, -_out.dot(_up3));
        const ol = _out.length();
        if (ol > 1e-3) { _d.addScaledVector(_out, (j.rcs ? 0.6 : this.colCant) / ol   /* round 25: lift columns cancel most of the ports' outward cant (u61: 4 near-parallel columns) */   /* round 18: landing columns near-parallel (VERTJUMP 3.4 s) */).normalize(); }
      }
      const P = j.rcs ? RCS : COL;
      tr.coordT += dt * P.speed * 0.25;
      const lenK = FX.jetLength;
      // 1) advance gas points: drag toward the air, ground impact turns into radial spreading
      const kd = 1 - Math.exp(-2.4 * dt), kdC = 1 - Math.exp(-2.4 * dt);   // round 21: 4.5 tried (slanted columns) — the slowed gas turned the ribbons into flat horizontal sheets at the feet
      let alive = 0, hits = 0, hx = 0, hz = 0, hy = 0;
      for (let i = 0; i < tr.n; i++) {
        const i3 = i * 3;
        tr.age[i] += dt * (tr.hit[i] > 0 ? 6 : 1);
        if (tr.age[i] >= tr.life[i]) continue;
        alive = i + 1;
        let vx = tr.v[i3], vy = tr.v[i3 + 1], vz = tr.v[i3 + 2];
        const kk = tr.rcs[i] ? kd : kdC;   // round 21: lift columns entrain more air: they trail behind a moving car (VERTJUMP 3.0 s: slanted columns)
        vx += (WIND.x - vx) * kk; vy += (WIND.y - vy) * kk; vz += (WIND.z - vz) * kk;
        // twisting turbulence that grows downstream (CFD + footage: columns wobble and twist)
        const a = tr.age[i] / tr.life[i], ph = tr.coord[i] * 0.7 + this.time * 3;
        const tw = (tr.rcs[i] ? 18 : 22) * FX.jetPuffs * a * dt;
        vx += Math.sin(ph + i * 0.21) * tw; vz += Math.cos(ph * 1.13 + i * 0.17) * tw;
        let x = tr.p[i3] + vx * dt, y = tr.p[i3 + 1] + vy * dt, z = tr.p[i3 + 2] + vz * dt;
        const gh = groundAt(x, z, y).h + 0.06;
        tr.gh[i] = gh;
        if (y < gh) {
          y = gh;
          if (vy < 0) {
            const h = Math.hypot(vx, vz) || 1e-3, s = -vy * 0.75;
            // splash outward away from the impact column
            vx += (vx / h) * s * 0.5 + (Math.random() - 0.5) * s * 0.6; vz += (vz / h) * s * 0.5 + (Math.random() - 0.5) * s * 0.6; vy = 0;
          }
          if (!tr.hit[i]) { tr.hit[i] = tr.age[i]; }
          hits++; hx += x; hz += z; hy = gh;
        }
        tr.p[i3] = x; tr.p[i3 + 1] = y; tr.p[i3 + 2] = z;
        tr.v[i3] = vx; tr.v[i3 + 1] = vy; tr.v[i3 + 2] = vz;
        tr.dist[i] += Math.hypot(vx, vy, vz) * dt;
      }
      tr.n = alive;
      // 2) emit gas points along the nozzle path since last frame (no gaps during fast rotation)
      const open = L > 0.04;
      if (open && !tr.open) { tr.chainId++; tr.acc = 1; }
      tr.open = open;
      if (open && dt > 0) {
        if (!tr.hasLast) { tr.last.copy(_p); tr.lastD.copy(_d); }
        tr.acc += dt * EMIT_HZ;
        const n = Math.min(6, Math.floor(tr.acc));
        tr.acc -= n;
        j.flicker += dt * 37;
        const flutter = 1 - FX.jetFlutter + FX.jetFlutter * Math.sin(j.flicker) * Math.sin(j.flicker * 0.37 + 1.3);
        // nozzle velocity = car velocity + rotation (ω × r)
        _r.subVectors(_p, car.pos);
        _a.crossVectors(w, _r).add(car.vel);
        const sp = P.speed * (0.88 + 0.12 * L) * (j.rcs && car.flipState === 'spindown' ? 1.6 : 1);   // round 25: the long roll-braking plume (2.5 s) is fast gas, not long-lived gas — a long life swept it into a fan as the body rolled   // near-constant exit speed: slow gas from the opening valve was overtaken by the faster gas behind it and piled up into a bright bar at the column front (3.0 s)
        for (let k = n; k >= 1; k--) {
          const u = 1 - (k - 1) / n; // oldest first … newest at the nozzle
          const x = tr.last.x + (_p.x - tr.last.x) * u, y = tr.last.y + (_p.y - tr.last.y) * u, z = tr.last.z + (_p.z - tr.last.z) * u;
          const dx = tr.lastD.x + (_d.x - tr.lastD.x) * u, dy = tr.lastD.y + (_d.y - tr.lastD.y) * u, dz = tr.lastD.z + (_d.z - tr.lastD.z) * u;
          const back = (k - 1) / EMIT_HZ; // this point left the nozzle a little earlier: advance it
          const vx = dx * sp + _a.x, vy = dy * sp + _a.y, vz = dz * sp + _a.z;
          tr.push(x + vx * back, y + vy * back, z + vz * back, vx, vy, vz, Math.min(1, L * 1.1) * flutter, j.rcs ? 1 : 0, P.life * lenK * (j.rcs ? j.lenVar : 1) * (j.rcs ? (car.flipState === 'spindown' ? 1.1 : car.flipState ? 1.25 : 1) : 1));   // footage 2.5 s: one long ~3 m braking plume
          tr.age[0] = back; tr.dist[0] = sp * back;
        }
      }
      tr.last.copy(_p); tr.lastD.copy(_d); tr.hasLast = true;
      this.buildRibbon(j);
      // impingement glow pool under a column that reaches the ground
      {
        const g = j.glow;
        const on = hits > 0 && !j.rcs && L > 0.05;
        const target = on ? Math.min(1, L) * Math.max(0.1, 1 - (_p.y - hy) / 8) : 0;
        g.userData.glow += (target - g.userData.glow) * Math.min(1, dt * (on ? 25 : 8));
        g.visible = g.userData.glow > 0.02 || this.warmFrames > 0;
        if (on) { g.position.set(hx / hits, hy + 0.04, hz / hits); const sc = 1.6 + 1.4 * Math.min(1, (_p.y - hy) / 3); const vh = Math.hypot(car.vel.x, car.vel.z); const st = Math.min(0.35, vh * 0.05); /* only slightly stretched: a long ellipse read as a bright bar at the column feet (3.0 s) */ g.scale.set(sc * (1 + st), sc * (1 - 0.3 * st), 1); g.rotation.z = vh > 0.5 ? Math.atan2(car.vel.z, car.vel.x) : 0; }   // soft mist, stretched a little along the motion
        if (this.warmFrames > 0) g.position.copy(_p);
      }
      // 3) ground cloud: only gas that reaches the ground condenses into cloud. A brief touch
      //    (takeoff burst) leaves a small low splash that is gone in ~1.5 s; sustained firing close
      //    to the ground (landing flare / hover) builds the long-lived cloud that rolls outward.
      //    Measured (hover landing, side view): dense area +0.3 s 13 m², +0.9 s 19 m² (peak),
      //    +1.5 s 9, +2.1–2.7 s ~13, +3.3 s 5, +3.9 s 2. VERTJUMP: the cloud starts as the landing
      //    columns reach the ground (~0.6 s before touchdown), grows to ~12 m across in 0.8 s and
      //    up to the car's height, a ring-shaped roll forms at its edge and it keeps spreading.
      if (hits > 0 && dt > 0) {
        _hit.set(hx / hits, hy, hz / hits);
        const hAbove = _p.y - hy;
        const k = Math.max(0, 1 - hAbove / 10);
        if (liftFiring) j.dwell = Math.min(2, j.dwell + dt * L * (0.6 + 0.4 * k) * 4.4);   // side shot f27/f28: a 10 m bank already lies under the car while it is still ~3 m up
        const dens = Math.min(1, j.dwell / 0.4);   // ~0.25 s of a landing column on the ground builds the full cloud
        const longLived = dens * dens;
        // brief touches: a few thin, flat puffs; sustained: many heavy ones (merge into one body)
        const popping = car.popTimer > 0 || car.burstTimer > 0;
        const amt = FX.cloudEmission * FX.groundCloud * (popping ? FX.takeoffCloud : 1);
        // round 18: 4 landing columns instead of 6 carry the same gas: heavier, slightly larger parcels (not more of them: CPU)
        this.massK = (this.landT > 0 ? (1 + 0.5 * smooth(1.2, 2.6, hAbove)) * (j.pidx === 0 || j.pidx === 1 ? 1.3 : j.pidx === 6 || j.pidx === 7 ? 0.75 : 1) : 1);   /* the front pair sits 1 m ahead of centre, the rear pair 2 m behind: balance the fore/aft heaps (f43/f47 front side was ~0.55× the rear) */   // round 18: 4 landing columns instead of 6 carry the same gas while descending; once down the bank is fed less (f38 was 1.4× the footage)
        // round 24: takeoff splash (VERTJUMP 0.2–0.4 s): where each pop column hits the ground a quick
        // bluish mist bursts out low (small parcels, gone in ~0.6 s) — the takeoff cloud stays small
        if (popping && dt > 0) {
          j.splashAcc = (j.splashAcc || 0) + 28 * L * k * dt * FX.cloudEmission * FX.takeoffCloud;
          while (j.splashAcc >= 1) {
            j.splashAcc -= 1;
            const a = Math.random() * Math.PI * 2, sp = (2.5 + Math.random() * 3.5) * FX.cloudJetSpeed;
            _v.set(Math.cos(a) * sp, 0.4 + Math.random() * 1.6, Math.sin(a) * sp);
            _r.set(_hit.x + Math.cos(a) * 0.3, _hit.y + 0.15, _hit.z + Math.sin(a) * 0.3);
            lightTint(_hit, _col, 0.1 * Math.random());
            this.vapor(_r, _v, 0.6 + Math.random() * 0.4, 0.45, 1.4 + Math.random() * 0.8, 0.6 * L, _col.slice(), 2.6, 0.2, 0.05, null);
          }
        }
        j.groundAcc += (6 + 28 * longLived) * L * (0.7 + 0.3 * k) * dt * amt;   // ×4 parcels per clump when sustained
        while (j.groundAcc >= 1) {
          j.groundAcc -= 1;
          const a = Math.random() * Math.PI * 2;
          // wall jet: the side shot shows the bank 9 m wide 0.4 s before touchdown, 17 m at
          // touchdown and 30+ m at +1.6 s, so the outflow leaves fast (3–10 m/s)
          const sp = (1.2 + Math.random() * (2.6 + 0.8 * longLived)) * (0.5 + 0.5 * k) * FX.cloudJetSpeed;   // round 20: fast outrunning gas lives shorter instead (f38 wide → f43 narrower, like the footage)   // the ring roll-up carries the bank outward after touchdown (CloudCore)
          const slow = 1 - (sp / Math.max(0.1, ((4.4 + 1.4 * longLived) * FX.cloudJetSpeed))); // the core (slow gas near the car) piles up into taller puffs
          _v.set(Math.cos(a) * sp, 0.2 + Math.random() * (0.6 + 3.0 * longLived * Math.max(0, slow)), Math.sin(a) * sp);   // side shot f30: the mound already reaches the car's roof (~2.8 m)
          // the outflow runs mainly fore and aft along the car (the column pairs' wall jets meet
          // under the centre line and are turned along it): the side shot sees the car between
          // the heaps from f30 to f43, so little gas reaches out sideways toward the camera
          { _f.set(0, 0, 1).applyQuaternion(car.quat); _f.y = 0; _f.normalize(); let va = _v.x * _f.x + _v.z * _f.z; const vl = _v.x * _f.z - _v.z * _f.x;
            // round 18: each column's wall jet runs away from the fountain plane under the car: front columns feed the front heap, rear columns the rear (f47: streaks on both sides)
            const hs = (_hit.x - car.pos.x) * _f.x + (_hit.z - car.pos.z) * _f.z; if (va * hs < 0 && Math.random() < 0.65) va = -va;
            const A = 1.05, B = 0.15; _v.x = _f.x * va * A + _f.z * vl * B; _v.z = _f.z * va * A - _f.x * vl * B; }
          lightTint(_hit, _col, 0.12 * Math.random());
          { const w = 0.55 + 0.6 * Math.max(0, slow); _col[0] *= w; _col[1] *= w; _col[2] *= w; }   // dense core condenses whitest; outrunning gas is thinner and greyer
          _r.set(_hit.x + Math.cos(a) * 0.6, _hit.y + 0.2, _hit.z + Math.sin(a) * 0.6);
          // brief touch: big, thin, flat haze puffs; sustained: many denser ones that merge
          // log-normal puff sizes (footage: a few big lobes, many small ones, not equal balls)
          const lgn = Math.exp(0.45 * (Math.random() + Math.random() + Math.random() - 1.5) * 1.4);
          const size = ((1.25 + Math.random() * 0.6 + 1.15 * longLived) * (1 - 0.3 * longLived) + 1.0 * (1 - longLived)) * (longLived > 0.3 ? lgn : 1);
          this.vapor(_r, _v, 0.9 + (2.3 + 0.3 * (1 - Math.max(0, slow))) * longLived * (slow < 0.5 ? 1 : 0.85) + Math.random() * 0.4, 1.0, size * (1 + 0.5 * longLived) * (1 + 0.3 * longLived * (1 - Math.max(0, slow))),
            (0.14 + 0.08 * longLived) * L * Math.min(1.5, Math.sqrt(FX.groundCloud)) * (0.7 + 0.6 * Math.max(0, slow)), _col.slice(), 1.3 - 0.5 * longLived, 0.1 - 0.7 * longLived, 0.12 + 0.28 * longLived,
            longLived > 0.3 && slow < 0.5 ? { x: car.pos.x, z: car.pos.z } : null);   // the slow core stays around the car (tallest puffs), the fast gas rolls out in the ring
          // thin haze that runs out ahead of the body (footage: wisps stream 5–10 m beyond the
          // billows along the ground and thin out first)
          if (longLived > 0.3 && Math.random() < 0.12) {   // thin translucent veils between the lobes
            this.vapor(_r, _v, 1.6 + Math.random(), 1.2, 2.6 + Math.random(), 0.05 * L, _col.slice(), 1.0, -0.2, 0.15, { x: car.pos.x, z: car.pos.z });
          }
          // round 20: low thin wings streaming fore and aft along the tarmac beyond the heaps (footage
          // f28: wisps ~2 m past the dome at ground level; f38: the bank 23 m long; f47: wisps still
          // lying on both sides of the car)
          if (longLived > 0.3 && Math.random() < 0.3) {
            const e = Math.random() < 0.5 ? -1 : 1, ws = (2.6 + Math.random() * 2.0) * this.wingTune.sp * FX.cloudJetSpeed;   // round 23: f43/f47 wings still ~5 m too long   // round 22: shorter reach (f43/f47 25 m vs 18–20 m)
            _v2.set(_f.x * e * ws + (Math.random() - 0.5) * 1.2, 0.1, _f.z * e * ws + (Math.random() - 0.5) * 1.2);
            _r2.set(_hit.x + _f.x * e * 1.5, _hit.y + 0.25, _hit.z + _f.z * e * 1.5);
            this.vapor(_r2, _v2, (2.4 + Math.random() * 1.2) * this.wingTune.life, 1.2, 3.0 + Math.random() * 1.2, 0.24 * L, _col.slice(), 0.6, -0.35, 0.25, null);
          }
          // lobes: the footage bank is made of distinct puffs with gaps between them, so gas
          // leaves in clumps (2 extra parcels riding with this one)
          if (longLived > 0.3) for (let q = 0; q < 3; q++) {
            _r.x += (Math.random() - 0.5) * 0.8; _r.z += (Math.random() - 0.5) * 0.8; _r.y += Math.random() * 0.4;
            _v.x *= 0.92 + Math.random() * 0.16; _v.z *= 0.92 + Math.random() * 0.16;
            this.vapor(_r, _v, 0.9 + (2.3 + 0.3 * (1 - Math.max(0, slow))) * longLived * (slow < 0.5 ? 1 : 0.85) + Math.random() * 0.4, 1.0, size * (1 + 0.5 * longLived) * (1 + 0.3 * longLived * (1 - Math.max(0, slow))) * (0.8 + Math.random() * 0.3),
              (0.14 + 0.08 * longLived) * L * (0.7 + 0.6 * Math.max(0, slow)), _col.slice(), 1.3 - 0.5 * longLived, 0.1 - 0.7 * longLived, 0.12 + 0.28 * longLived, slow < 0.5 ? { x: car.pos.x, z: car.pos.z } : null);
          }
        }
        // fountain: where the wall jets of neighbouring columns collide (under the car) the gas
        // is thrown back up (VTOL fountain effect). Side shot: a 5–6 m dome engulfs the car at
        // touchdown, the tallest part of the bank stays over the car.
        if (dens > 0.3 && hAbove < 8) {   // as soon as the columns sit on the ground: one mound between them (f28)   // side shot: at −0.4 s (nozzles ~1.5 m up) the dome is still below the car
          j.downT = smooth(3.6, 1.6, hAbove) > 0.9 ? (j.downT || 0) + dt : 0;   // time since the car settled among the gas
          const hovK = 1 - smooth(3.6, 1.6, hAbove);   // round 18: still hovering → one cohesive dome under the car (f28)
          j.fountAcc = (j.fountAcc || 0) + 30 * (1 + 0.8 * hovK) * L * dens * dt * amt * Math.min(1, (8 - hAbove) / 2.5);   // round 16: the mound between the columns already stands ~2.5 m tall at f28 (nozzles ~3 m up)
          while (j.fountAcc >= 1) {
            j.fountAcc -= 1;
            // round 16 critique: the footage heaps rise at the car's front and rear ends (where the
            // wall jets of the fore and aft column pairs meet), not over the roof: the car stays
            // visible between them from f30 to f43
            _f.set(0, 0, 1).applyQuaternion(car.quat); _f.y = 0; _f.normalize();
            const endK = smooth(3.6, 1.6, hAbove);   // still hovering: one mound under the car (f28); down among the gas: heaps at the ends
            const fb = this.fBias || 0, mid = endK > 0.5 && j.downT < 0.7 && Math.random() < 0.22;   // ~1/5 of the upwash fills the middle low (no clean notch)
            const end = Math.random() < 0.5 + 0.7 * fb ? 1 : -1, along = end * (mid ? Math.random() * 1.6 : (2.0 + Math.random() * 1.3) * endK + Math.pow(Math.random(), this.domeTune.peak) * 3.4 * this.domeTune.w * (1 - endK)), lat = mid ? (Math.random() < 0.5 ? -1 : 1) * (1.3 + Math.random() * 1.2) : (Math.random() - 0.5) * (1.2 + 2.0 * (1 - endK));   // the middle fill rises beside the body, not onto it
            _r.set(car.pos.x + _f.x * along - _f.z * lat, hy + 0.4 + Math.random() * 0.5 * (1 - endK), car.pos.z + _f.z * along + _f.x * lat);
            const up = (endK > 0.5 ? 1.0 + 4.0 * Math.pow(Math.random(), 0.8) : 3.5 + Math.random() * 3.0) * (endK *   /* round 21: a spread of upwash speeds keeps each heap a column standing on the tarmac (a single fast band left a floating mushroom, f38/f43) */ (0.7 + 0.45 * Math.exp(-j.downT / 0.5)) * (mid ? 0.45 : (this.fUp ? this.fUp[end > 0 ? 0 : 1] : 1)) + 0.55 * (1 - endK) * (1 + this.domeTune.up * (0.5 - Math.abs(along) / (3.4 * this.domeTune.w)))) * FX.cloudJetSpeed,   /* round 19: vigorous upwash at touchdown (f33: a ~4 m heap), calmer later; the hover dome stays ~1 m below the car (f28 gap with the columns visible) */   /* round 18: heaps top out ~3.5 m (f38), the hover dome stays under the columns (f28) */ out = (0.4 + Math.random() * 1.4) * (1 + 0.8 * endK);   // round 22: heaps grow wide, not into chimneys   // side shot: the mound tops out at 3.6–4.1 m
            _v.set(_f.x * end * out + (Math.random() - 0.5) * 0.8, up, _f.z * end * out + (Math.random() - 0.5) * 0.8);
            lightTint(_r, _col, 0.08 * Math.random());
            const lgn = Math.exp(0.4 * (Math.random() + Math.random() - 1));
            const HT = this.heapTune;   // round 23: debug handle (calibration)
            this.vapor(_r, _v, (1.8 + 2.0 * endK + Math.random() * 0.6) * (1 + (HT.life - 1) * endK), 1.4 + 0.9 * (1 - endK),   /* round 18: the end heaps stay by the car to f43 */ (2.6 + Math.random() * 1.0) * lgn * (1 + 0.5 * (1 - endK)),
              0.3 * L * Math.min(1.5, Math.sqrt(FX.groundCloud)) * (1 + (HT.mass - 1) * endK), _col.slice(), 1.4, -0.1 + HT.rise * endK, 0.3, null);   // round 19: aged heaps settle back onto the tarmac (f43: no floating puffs)
          }
        }
        this.massK = 1;
      } else j.dwell = Math.max(0, j.dwell - dt * 0.6);
    }
  }

  /** Rebuild one jet's ribbon geometry from its gas points (newest first). */
  buildRibbon(j) {
    const tr = j.trail, g = j.mesh.geometry;
    const P = g.attributes.position.array, Tn = g.attributes.tang.array, J = g.attributes.jdat.array, X = g.attributes.jx.array;
    let s = 0;
    let sleeve = false;
    const put = (vi, i, tx, ty, tz) => {
      const i3 = i * 3, ageN = Math.min(1, tr.age[i] / tr.life[i]);
      const rc = tr.rcs[i] ? RCS : COL;
      let r = (rc.r0 + rc.spread * tr.dist[i]) * FX.jetWidth * (sleeve ? 2.3 : 1);

      // dense near the nozzle, thinning and fading with age (fade starts ~35% of the life)
      const alpha = tr.lev[i] * (1 - smooth(tr.rcs[i] ? 0.35 : 0.15, tr.rcs[i] ? 1 : 0.7, ageN)) * (tr.rcs[i] ? 1.4 : 0.6) * (tr.hit[i] ? 0 : 1) * FX.jetOpacity;   // gas on the tarmac hands over to the glow pool + cloud
      const tint = tr.rcs[i] * Math.min(1, FX.jetTint / 0.75);
      const nearSurf = smooth(0.0, 0.6, tr.p[i3 + 1] - tr.gh[i]);   // short soft fade into the mist where it meets the ground (round 16: the 2 m fade made the takeoff columns look short — footage 0.3 s: bright to the tarmac)
      // the leading edge of a fresh jet (oldest points of its chain) is ragged, not a square cut
      let lead = 1;
      for (let k = 1; k <= 4; k++) if (i + k >= tr.n || tr.chain[i + k] !== tr.chain[i] || tr.age[i + k] >= tr.life[i + k]) { lead = (k - 1) / 4; break; }
      for (let c = 0; c < 3; c++) {
        const v = vi + c;
        P[v * 3] = tr.p[i3]; P[v * 3 + 1] = tr.p[i3 + 1]; P[v * 3 + 2] = tr.p[i3 + 2];
        Tn[v * 3] = tx; Tn[v * 3 + 1] = ty; Tn[v * 3 + 2] = tz;
        J[v * 4] = c - 1; J[v * 4 + 1] = r; J[v * 4 + 2] = alpha * nearSurf * lead * (sleeve ? 0.16 : 1); J[v * 4 + 3] = ageN;
        X[v * 2] = tint; X[v * 2 + 1] = tr.coord[i];
      }
    };
    // tangent at a point: central difference within its chain, so neighbouring segments share edges
    const tan = (i) => {
      // wide span: near the slow tip the points bunch up and a 1-step difference flips around,
      // which twisted the ribbon into star/bow-tie flares
      let lo = i, hi = i;
      for (let k = 0; k < 4 && lo > 0 && tr.chain[lo - 1] === tr.chain[i]; k++) lo--;
      for (let k = 0; k < 4 && hi + 1 < tr.n && tr.chain[hi + 1] === tr.chain[i]; k++) hi++;
      const a = lo * 3, b = hi * 3;
      let tx = tr.p[a] - tr.p[b], ty = tr.p[a + 1] - tr.p[b + 1], tz = tr.p[a + 2] - tr.p[b + 2];
      const tl = Math.hypot(tx, ty, tz);
      if (tl < 1e-5) { _t3[0] = 0; _t3[1] = 1; _t3[2] = 0; } else { _t3[0] = tx / tl; _t3[1] = ty / tl; _t3[2] = tz / tl; }
      return _t3;
    };
    for (let pass = 0; pass < 2; pass++) {
      // pass 1: a wide, faint haze sleeve around lift/landing columns (footage: bluish mist around them)
      sleeve = pass === 1;
      for (let i = 0; i + 1 < tr.n; i++) {
        if (tr.chain[i] !== tr.chain[i + 1]) continue;
        if (tr.age[i] >= tr.life[i] || tr.age[i + 1] >= tr.life[i + 1]) continue;
        if (sleeve && (tr.rcs[i] || tr.rcs[i + 1])) continue;
        let t = tan(i); put(s * SEG_V, i, t[0], t[1], t[2]);
        t = tan(i + 1); put(s * SEG_V + 3, i + 1, t[0], t[1], t[2]);
        s++;
      }
    }
    if (this.warmFrames > 0 && s === 0) { // compile the pipeline: one invisible segment
      for (let v = 0; v < SEG_V; v++) { J[v * 4 + 2] = 0; J[v * 4 + 1] = 0.1; }
      s = 1;
    }
    g.setDrawRange(0, s * 12);
    j.mesh.visible = s > 0;
    for (const [att, sz] of [[g.attributes.position, 3], [g.attributes.tang, 3], [g.attributes.jdat, 4], [g.attributes.jx, 2]]) {
      att.clearUpdateRanges(); att.addUpdateRange(0, Math.max(1, s * SEG_V) * sz); att.needsUpdate = true;
    }
  }

  tireSmoke(point, carVel, amount, dt) {
    if (amount < 0.05) return;
    const n = Math.random() < amount * 14 * dt * FX.cloudEmission ? 1 : 0;
    for (let i = 0; i < n; i++) {
      _v.copy(carVel).multiplyScalar(0.25);
      _v.x += (Math.random() - 0.5) * 2.5; _v.y += Math.random() * 1.5; _v.z += (Math.random() - 0.5) * 2.5;
      _p.copy(point); _p.y += 0.25;
      lightTint(_p, _col);
      _col[0] *= 0.85; _col[1] *= 0.85; _col[2] *= 0.87;
      const s = 0.6 + Math.random() * 0.5;
      this.vapor(_p, _v, 1.0 + Math.random() * 1.0, s, s * 3, 0.35 * amount, _col.slice(), 1.6, 0.4);
    }
  }

  /** Kickflip pop. VERTJUMP: the jets slam onto the tarmac and throw up a low splash ~4 m wide,
   *  ~1 m tall, that drifts off as thin haze within ~1.5 s (the big cloud comes only at landing). */
  burst(point, count) {
    const amt = FX.cloudEmission * FX.takeoffCloud;
    if (amt <= 0) return;
    const n = Math.max(1, Math.round(Math.max(8, Math.ceil(count / 2)) * amt));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const sp = 4 + Math.random() * 4;
      _v.set(Math.cos(a) * sp, 0.3 + Math.random() * 0.6, Math.sin(a) * sp);
      _p.set(point.x + Math.cos(a) * 1.2, groundAt(point.x, point.z, point.y).h + 0.4, point.z + Math.sin(a) * 1.8);
      lightTint(_p, _col);
      this.vapor(_p, _v, 1.0 + Math.random() * 0.5, 1.3, 2.4 + Math.random() * 0.6, 0.32, _col.slice(), 2.2, 0.0, 0.05);   /* round 19: 0.2 → 0.32 (0.3 s splash was faint) */   // VERTJUMP 0.3 s: a visible low splash ring ~4 m across
    }
  }

  update(dt, car) {
    // keep one tiny parcel alive during warm-up so the cloud mesh pipeline gets compiled
    if (this.warmFrames > 0 && car) this.vapor(car.pos, { x: 0, y: 0, z: 0 }, 0.05, 0.8, 0.8, 0.4, [1, 1, 1]);
    time.value += dt;
    if (car) this.cloud.groundY = groundAt(car.pos.x, car.pos.z, car.pos.y).h;
    this.cloud.update(dt, car);
    if (this.warmFrames > 0) this.warmFrames--;
  }
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
