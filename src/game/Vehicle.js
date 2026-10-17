// Rigid-body vehicle with raycast suspension, a Pacejka-lite tire model,
// aero downforce, suction fan, and cold-gas thrusters.
// Body frame: +Z forward, +Y up, +X = left side.
import * as THREE from 'three/webgpu';
import { groundAt, boxesNear, POLES, LOT, insideBox, loopAt, loopShell, RAMP } from './layout.js';
import { FX } from './fxParams.js';

const G = 9.81;
const RHO = 1.2;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _r = new THREE.Vector3();
const _f = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();

export class Vehicle {
  constructor(trim) {
    this.setTrim(trim);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.force = new THREE.Vector3();
    this.torque = new THREE.Vector3();

    // Geometry (relative to center of mass)
    this.cgHeight = 0.5;      // CG height above ground at rest (model origin = CG - cgHeight)
    this.wheelRadius = 0.36;
    this.restLength = 0.35;
    this.springK = 76000;
    this.damperC = 6500;
    const a = 1.3, b = 1.35, ht = 0.85, my = 0.15;
    this.wheels = [
      { id: 'fl', local: new THREE.Vector3(ht, my, a), front: true },
      { id: 'fr', local: new THREE.Vector3(-ht, my, a), front: true },
      { id: 'rl', local: new THREE.Vector3(ht, my, -b), front: false },
      { id: 'rr', local: new THREE.Vector3(-ht, my, -b), front: false },
    ].map(w => ({ ...w, compression: 0, prevCompression: 0, contact: false, spin: 0, spinRate: 0, load: 0, slip: 0, world: new THREE.Vector3(), contactPoint: new THREE.Vector3() }));

    // Body hull points for ground collision when flipped / bottoming out
    this.hull = [];
    // bumper bottoms ~0.23 m above the ground at rest (CG 0.5 m)
    for (const x of [-0.95, 0.95]) for (const z of [-2.15, 2.15]) for (const y of [-0.27, 0.65]) this.hull.push(new THREE.Vector3(x, y, z));
    this.hull.push(new THREE.Vector3(0, 0.7, 0.4), new THREE.Vector3(0, 0.7, -0.6));

    this.steer = 0;
    this.fanOn = true;
    this.wingMode = 0;   // 0 auto, 1 track (always deployed), 2 low drag
    this.wingAngle = 0;  // angle of attack demand 0..1 (1 = airbrake)
    this.wingDeploy = 0; // retractable wing: 0 stowed flush in the deck .. 1 fully deployed
    this.thrustLevel = 0;
    this.liftLevel = 0;
    this.airborneTime = 0;
    this.groundedWheels = 0;
    this.lastImpact = 0;
    this.flipRoll = 0;
    this.kickflipTimer = 0;
    // Thruster-allocation intent for visual effects (world space)
    this.controlTorque = new THREE.Vector3(); // direction × strength 0..1
    this.burstTimer = 0;                      // kickflip pop: lift + roll jets fire hard
    this.burstTorque = new THREE.Vector3();
    this.popTimer = 0;
    this.flipCtl = new THREE.Vector3();
    this.flipSide = new THREE.Vector3(1, 0, 0);
    this.rollBurn = 0;
    this.rollDone = 0;
    this.flipState = null;
    this.flipT = 0;
    this.flipDir = 1;
    this.assistForce = new THREE.Vector3();   // jet braking / cornering force (world)
    this.assistLevel = 0;
    this.assistEnabled = true;                // J / HUD toggle
    this.autoLift = 0;                        // landing-cushion demand 0..1
    this.fanLevel = 0.55;                     // suction, in units of the car's weight
    this.events = [];
    this.reset(0, 0, 0);
  }

  setTrim(trim) {
    this.trim = trim;
    this.mass = trim.mass;
    // Box inertia approximation (L 4.4, W 2.0, H 1.15) lowered a bit for a mid-mounted pack
    const m = this.mass;
    this.inertia = new THREE.Vector3(
      m / 12 * (1.15 ** 2 + 4.4 ** 2) * 0.8,   // pitch (x)
      m / 12 * (2.0 ** 2 + 4.4 ** 2) * 0.8,    // yaw (y)
      m / 12 * (2.0 ** 2 + 1.15 ** 2) * 0.8,   // roll (z)
    );
    this.tank = trim.tank;
  }

  reset(x, z, yaw) {
    const g = groundAt(x, z);
    this.pos.set(x, g.h + this.cgHeight + 0.05, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.tank = this.trim.tank;
    this.airborneTime = 0;
    for (const w of this.wheels) { w.compression = w.prevCompression = 0.06; w.spinRate = 0; w.spin = 0; w.contact = false; w.load = 0; w.slip = 0; w.onLoop = false; }
    // jump / jet state too: a reset mid-flip must not carry the old flight into the new one
    this.flipState = null; this.flipT = 0; this.flipRoll = 0; this.rollBurn = 0; this.rollDone = 0; this.rollW = 0;
    this.kickflipTimer = 0; this.burstTimer = 0; this.popTimer = 0; this.autoLift = 0; this.lateralTrim = 0; this.rollSettle = false;
    this.liftLevel = 0; this.thrustLevel = 0; this.assistLevel = 0; this.lastImpact = 0; this.steer = 0;
    this.flipCtl.set(0, 0, 0); this.burstTorque.set(0, 0, 0); this.controlTorque.set(0, 0, 0); this.assistForce.set(0, 0, 0);
    this.force.set(0, 0, 0); this.torque.set(0, 0, 0); this.events.length = 0;
    this.wingAngle = 0; this.wingDeploy = 0; this.onLoop = false; this.groundedWheels = 0;
    this.rampFlight = null; this.rampS = -1; this.rampTheta = -1;
  }

  get speed() { return this.vel.length(); }
  get forwardSpeed() { return this.vel.dot(_fwd.set(0, 0, 1).applyQuaternion(this.quat)); }

  toWorld(local, out) { return out.copy(local).applyQuaternion(this.quat).add(this.pos); }

  addForceAt(F, point) {
    this.force.add(F);
    _r.subVectors(point, this.pos);
    this.torque.add(_t.crossVectors(_r, F));
  }

  /** input: throttle, brake, steer (-1 left..1 right), handbrake, thrust, lift, pitch, roll, yawAir, kickflip, jump */
  step(dt, input) {
    const trim = this.trim;
    const m = this.mass;
    this.force.set(0, -m * G, 0);
    this.torque.set(0, 0, 0);

    _up.set(0, 1, 0).applyQuaternion(this.quat);
    _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    _right.set(-1, 0, 0).applyQuaternion(this.quat);

    const vF = this.vel.dot(_fwd);
    const speed = this.vel.length();

    // Steering: speed-sensitive steer-by-wire
    const aLim = trim.mu * 0.9 * (1 + this.fanLevel) * G + Math.min(0.5*RHO*speed*speed*trim.clA, m*G*1.5)*trim.mu*0.9/m;
    const maxSteer = Math.min(0.6, Math.atan(2.65 * aLim / Math.max(speed * speed, 1)) + 0.08);
    const target = -input.steer * maxSteer; // positive yaw = left
    const rate = 3.2 / (1 + speed * 0.05);
    this.steer += THREE.MathUtils.clamp(target - this.steer, -rate * dt, rate * dt);

    // Aero
    // Retractable active wing: stowed flush in the rear deck at low speed (as in Tesla's clean
    // renders), deploys on its struts above ~50 mph (as in the show-floor photos), and tilts steep
    // as an airbrake under hard braking. Motorised travel takes about a second.
    let deployTarget = 0;
    if (trim.wing) {
      if (this.wingMode === 1) deployTarget = 1;
      else if (this.wingMode === 2) deployTarget = speed > 25 && speed < 70 ? 1 : 0;
      else deployTarget = (speed > 22 || (this.wingDeploy > 0.5 && speed > 15) || (input.brake > 0.5 && speed > 18)) ? 1 : 0;
    }
    this.wingDeploy += THREE.MathUtils.clamp(deployTarget - this.wingDeploy, -dt, dt);
    const autoWing = input.brake > 0.2 && speed > 15 ? 1 : (this.wingMode === 2 || speed > 75 ? 0.3 : 0.75);
    this.wingAngle += (autoWing - this.wingAngle) * Math.min(1, dt * 4);
    const wingFactor = trim.wing ? 0.55 + this.wingDeploy * (0.05 + 0.6 * this.wingAngle) : 1;
    const q = 0.5 * RHO * speed * speed;
    // Tesla displayed 4,700 kg of downforce; treat that as the total including the fan
    const downforce = Math.max(0, Math.min(q * trim.clA * wingFactor, 4700 * G - this.fanLevel * m * G));
    const drag = q * trim.cdA * (trim.wing ? 0.85 + this.wingDeploy * (0.05 + 0.35 * this.wingAngle) : 1);
    if (speed > 0.01) this.force.addScaledVector(this.vel, -drag / speed);

    // Grounded check from last step
    const grounded = this.groundedWheels > 0;
    const canThrust = this.tank > 0;
    const liftOn = input.lift && trim.liftThrust > 0 && canThrust;

    // Multi-mode suction fan: 0.55 g of extra downforce cruising and launching, ramping to a
    // full 1 g under braking and cornering for grip. Off while the lift jets push the car up.
    const lateralDemand = Math.abs(input.steer) * Math.min(1, speed / 15);
    const brakeDemand = vF > 2 ? input.brake : 0;
    // On the vertical ramp the fan runs flat out (1.2 g: Tesla says it holds the car upside down
    // even when stationary), so the car can crawl over the top as slowly as in the footage.
    const fanTarget = !this.fanOn || liftOn ? 0
      : this.onLoop ? 1.2
      : 0.55 + 0.45 * Math.max(lateralDemand, brakeDemand, input.handbrake && speed > 3 ? 0.6 : 0);
    this.fanLevel += (fanTarget - this.fanLevel) * Math.min(1, dt * 6);
    if (grounded) {
      const seal = Math.min(1, this.groundedWheels / 3);
      _v.copy(_up).multiplyScalar(-downforce); this.addForceAt(_v, this.toWorld(_n.set(0, -0.3, -0.25), _s));
      _v.copy(_up).multiplyScalar(-this.fanLevel * m * G * seal); this.addForceAt(_v, this.toWorld(_n.set(0, -0.3, -0.1), _s));
    }

    // Thrusters
    const thrustOn = input.thrust && trim.rearThrust > 0 && canThrust;
    this.thrustLevel += ((thrustOn ? 1 : 0) - this.thrustLevel) * Math.min(1, dt * 18);

    // Automatic landing cushion (Rocket): descending toward the ground, the perimeter jets
    // fire to bring touchdown down to ~1.5 m/s, as in the reveal's hover landing. Valves can
    // surge to ~1.8× hover thrust for the flare.
    this.autoLift = 0;
    if (trim.perimeter && canThrust && !grounded && this.vel.y < -1.5 && _up.y > 0.5) {
      const hAbove = this.pos.y - this.cgHeight - groundAt(this.pos.x, this.pos.z, this.pos.y).h;
      if (hAbove > 0.02) {
        const vt = 1.5;
        const need = (this.vel.y * this.vel.y - vt * vt) / (2 * hAbove);   // decel to arrive at vt
        const flareAccel = trim.liftThrust * 1.8 / m;                        // max cushion accel
        if (need > (flareAccel - G) * 0.32) this.autoLift = THREE.MathUtils.clamp((need + G) / flareAccel, 0, 1);
      }
    }
    const liftTarget = Math.max(liftOn ? 1 : 0, this.autoLift * 1.8);
    this.liftLevel += (liftTarget - this.liftLevel) * Math.min(1, dt * 20);
    if (this.thrustLevel > 0.01) this.force.addScaledVector(_fwd, trim.rearThrust * this.thrustLevel * THREE.MathUtils.clamp((trim.vmax * 1.04 - vF) / 6, 0, 1));
    if (this.liftLevel > 0.01) {
      // keep lift mostly vertical (thrust vectoring) so hover is controllable
      _v.copy(_up).lerp(_n.set(0, 1, 0), 0.5).normalize();
      this.force.addScaledVector(_v, trim.liftThrust * this.liftLevel);
    }
    // Jet-assisted braking and cornering (Rocket perimeter thrusters): retro-thrust under
    // braking, and a push toward the inside of the turn while cornering.
    this.assistForce.set(0, 0, 0);
    // Only at extreme speed (fades in from ~120 mph, full by ~150 mph) and only for hard
    // braking or hard cornering, where tires + suction run out; normal driving spends no air.
    const assistGate = THREE.MathUtils.clamp((speed - 54) / 13, 0, 1);
    if (trim.assistThrust && this.assistEnabled && canThrust && grounded && assistGate > 0) {
      const hardBrake = Math.max(0, (brakeDemand - 0.5) / 0.5);
      const hardTurn = Math.max(0, (Math.abs(input.steer) - 0.5) / 0.5);
      if (hardBrake > 0) this.assistForce.addScaledVector(_fwd, -hardBrake * assistGate * trim.assistThrust);
      if (hardTurn > 0 && Math.abs(vF) > 5) {
        this.assistForce.addScaledVector(_right, Math.sign(input.steer) * hardTurn * assistGate * trim.assistThrust * 0.3 * Math.sign(vF));
      }
      this.force.add(this.assistForce);
    }
    // Landing approach (Rocket): the flight computer kills horizontal drift so the car comes
    // down nearly vertically. VERTJUMP: from level-out (3.0 s) to touchdown the car moves only
    // ~2 m sideways while a horizontal cone fires along the direction of travel (retro jet).
    this.lateralTrim = 0;
    if (trim.perimeter && canThrust && !grounded && this.autoLift > 0 && (!this.flipState || this.rollSettle)) {   // round 23: also during the final roll settle (VERTJUMP u55/u57: the retro cone fires while the car still banks)
      const vx = this.vel.x, vz = this.vel.z, vh = Math.hypot(vx, vz);
      if (vh > 0.2) {
        const F = Math.min(m * G * 0.6, vh * m * 1.8);
        _v.set(-vx / vh * F, 0, -vz / vh * F);
        this.assistForce.add(_v); this.force.add(_v);
        this.lateralTrim = F / (m * G * 0.6);
      }
    }
    // round 24: flank-port drift trim. VERTJUMP u48–u61: while the roll settles and through the descent
    // the rear flank ports fire alternately (2.7–2.9 s exhaust to the car's left, 3.0–3.13 s to the
    // right, 3.4 s left again): a bang-bang controller on the sideways drift, each pulse held ≥0.3 s
    if (trim.perimeter && canThrust && !grounded && _up.y > 0.5 && ((this.flipState === 'spindown' && this.flipT > 2.0) || (!this.flipState && this.autoLift > 0))) {
      _v.copy(_right).setY(0).normalize(); const vl = this.vel.x * _v.x + this.vel.z * _v.z;   // horizontal drift (the banked right axis has a vertical part)
      this.flankHold = (this.flankHold || 0) - dt;
      if (this.flankHold <= 0) {
        const want = Math.abs(vl) > 0.1 ? -Math.sign(vl) : 0;
        if (want !== (this.flankDir || 0)) { this.flankDir = want; this.flankHold = want ? 0.3 : 0.1; }
      }
      if (this.flankDir) {
        _v.copy(_right).setY(0).normalize().multiplyScalar(this.flankDir * m * G * 0.2);
        this.assistForce.add(_v); this.force.add(_v);
        this.lateralTrim = Math.max(this.lateralTrim, 0.7);
      }
    } else { this.flankDir = 0; this.flankHold = 0; }
    this.assistLevel = trim.assistThrust ? this.assistForce.length() / trim.assistThrust : 0;

    // Air tank is stored as impulse (N·s) and drained by the thrust actually delivered.
    const impulse = (this.thrustLevel * trim.rearThrust + this.liftLevel * trim.liftThrust + this.assistForce.length()) * dt;
    if (impulse > 1) this.tank = Math.max(0, this.tank - impulse);
    else if (trim.tank > 0) this.tank = Math.min(trim.tank, this.tank + trim.refill * dt); // onboard compressor
    // ULTRA recharge (hold T): the compressor spools up over ~1.2 s, then refills an empty tank in
    // ~2.5 s; it spools down in ~0.6 s when released or once the tank is full.
    const ultraOn = input.ultra && trim.tank > 0 && this.tank < trim.tank;
    this.ultraSpool = Math.min(1, Math.max(0, (this.ultraSpool || 0) + (ultraOn ? dt / 1.2 : -dt / 0.6)));
    if (this.ultraSpool > 0 && trim.tank > 0) this.tank = Math.min(trim.tank, this.tank + this.ultraSpool * this.ultraSpool * trim.tank / 2.5 * dt);

    // Kickflip, measured from the reveal (hover shot 0:39.7–0:44.5): a ~0.5 s burst of the
    // perimeter jets at ~3.2× weight (≈21.5 m/s² net up) throws the car to a ~13.7 m apex;
    // near the apex it rolls a full turn in ~1 s; then attitude pulses re-level it and the
    // landing jets cushion the touchdown.
    // footage fit (hover shot): instant ~3.2 m/s kick at liftoff, then 21.5 m/s² net for 0.49 s
    // → +0.2 s ≈ 1.07 m, +0.4 s ≈ 3.0 m, apex ≈ 13.7 m. Violent and immediate, as in the reveal.
    const POP_G = FX.popG, POP_T = FX.popTime, POP_KICK = FX.popKick; // defaults 3.2 g, 0.49 s, 3.2 m/s (live-tunable)
    // Space tap: the same takeoff pop without the roll (jumpOnly)
    if ((input.kickflip || input.jump) && trim.perimeter && this.kickflipTimer <= 0 && this.tank > m * G * POP_G * POP_T && grounded) {
      this.popTimer = POP_T;
      this.vel.y += POP_KICK;              // valves slam open: instant kick off the ground
      this.flipDir = input.steer > 0.1 ? 1 : -1;
      this.flipState = 'pop';
      this.kickflipTimer = 4.5;            // auto-leveling off until the flip completes
      this.burstTimer = POP_T;             // perimeter jets fire as solid columns
      this.burstTorque.set(0, 0, 0);
      this.jumpOnly = !input.kickflip;
      this.events.push(this.jumpOnly ? 'jump' : 'kickflip');
    }
    if (this.popTimer > 0) {
      this.popTimer -= dt;
      this.force.y += m * G * POP_G;       // thrust-vectored to vertical
      this.tank = Math.max(0, this.tank - m * G * POP_G * dt);
    }
    // Roll profile measured frame by frame from the reveal Semi-jump footage (fixed camera, Semi jump; the hover
    // shot agrees): the roll starts right as the pop ends (~0.6 s after liftoff), passes 90° at
    // ~0.85 s and is inverted by ~1.35 s (peak ≈ 340°/s); it then hangs nearly inverted for
    // ~0.6 s (180°→205°) while thin cones fire continuously; then rolls 205°→360° and is level
    // at ~3.0 s. The CFD's "all jets off while inverted" is contradicted by the footage: cones are
    // visible in every frame from 1.1 s to 3.0 s. The perimeter jets track this profile.
    const ROLL_ALPHA = FX.rollAccel * Math.PI / 180;     // max roll accel from the jets (default 1260°/s² = 22 rad/s²)
    const RA = 1.5 * 180 / FX.rollRate;                  // 0→180° phase: peak rate = 1.5·π/RA (default 340°/s → 0.79 s)
    // round 23: the last ~25° settle slowly — VERTJUMP u51/u53/u55/u57 still bank ~35°/25°/20°/10° at
    // 2.73/2.87/3.0/3.13 s while the landing columns already fire (so they slant), level ~3.3 s
    const RB = RA + 0.65, RC1 = RB + 0.95, RC = RC1 + 0.35;   // inverted hang, then 205°→335°, then 335°→360°
    const PA = Math.PI, PB = Math.PI * 205 / 180, PB2 = Math.PI * 335 / 180, PC = Math.PI * 2;
    this.rollBurn = 0;
    if (this.flipState === 'pop' && this.popTimer <= 0 && this.jumpOnly) { this.flipState = null; this.kickflipTimer = 0; }   // plain jump: no roll, flight computer levels it
    if (this.flipState === 'pop' && this.popTimer <= 0) {
      this.flipState = 'spinup'; this.flipT = 0; this.rollDone = 0; this.rollW = 0;
      this.flipSide.copy(_right).setY(0).normalize();
    }
    if (!this.rampFlight && (this.flipState === 'spinup' || this.flipState === 'coast' || this.flipState === 'spindown')) {
      this.flipT += dt;
      const w = this.angVel.dot(_fwd) * this.flipDir;   // roll rate in the flip direction
      this.rollDone += w * dt;
      const T = this.flipT;
      // reference angle / rate / accel (smoothstep segments)
      const seg = (t0, t1, a0, a1) => {
        const u = THREE.MathUtils.clamp((T - t0) / (t1 - t0), 0, 1), d = a1 - a0, D = t1 - t0;
        return [a0 + d * u * u * (3 - 2 * u), d * 6 * u * (1 - u) / D, d * (6 - 12 * u) / (D * D) * (u > 0 && u < 1 ? 1 : 0)];
      };
      const [pr, wr, ar] = T < RA ? seg(0, RA, 0, PA) : T < RB ? seg(RA, RB, PA, PB) : T < RC1 ? seg(RB, RC1, PB, PB2) : seg(RC1, RC, PB2, PC);
      this.flipState = T < RA ? 'spinup' : T < RB ? 'coast' : 'spindown';
      this.rollSettle = T >= RC1;
      const alpha = THREE.MathUtils.clamp(ar + 70 * (pr - this.rollDone) + 16 * (wr - w), -ROLL_ALPHA, ROLL_ALPHA);
      this.torque.addScaledVector(_fwd, alpha * this.flipDir * this.inertia.z);
      // the roll-jet side also pushes the body sideways while it spins up (one side firing,
      // canted outward): a small lateral drift that the flight computer trims out before
      // touchdown, as in VERTJUMP (side cones during the descent, ~2 m of sideways travel)
      const dem = Math.abs(alpha) / ROLL_ALPHA;
      if (this.flipState === 'spinup' && alpha > 0) this.force.addScaledVector(this.flipSide, m * G * 0.12 * Math.min(1, dem * 1.6) * this.flipDir);
      this.flipCtl.copy(_fwd).multiplyScalar((alpha >= 0 ? 1 : -1) * this.flipDir * Math.max(0.05, Math.min(1, dem * 1.6)));
      this.rollBurn = dem > 0.06 ? Math.min(1, dem * 1.6) : 0;   // which side fires, and how hard
      this.tank = Math.max(0, this.tank - 9000 * dem * dt);
      if ((T >= RC && Math.abs(w) < 0.3) || grounded || T > RC + 0.6) {
        this.flipState = null; this.kickflipTimer = 0; this.rollSettle = false;   // hand back to the flight computer
      }
    }
    if (this.flipState === 'pop' && grounded && this.popTimer <= 0 && this.vel.y <= 0) { this.flipState = null; this.kickflipTimer = 0; }
    if (this.rampFlight) this.rampFlightStep(dt, grounded);
    this.kickflipTimer -= dt;

    // Drive force
    const throttle = input.throttle;
    let driveTotal = 0;
    let reversing = false;
    if (throttle > 0) {
      const vAbs = Math.max(Math.abs(vF), 2.0);
      const powerLimited = trim.power / vAbs;
      const limiter = THREE.MathUtils.clamp((trim.vmax - vF) / 4, 0, 1);
      driveTotal = throttle * Math.min(powerLimited, m * G * trim.maxDriveG) * limiter;
    } else if (input.brake > 0 && vF < 0.8) {
      reversing = true;
      driveTotal = -input.brake * m * G * 0.5 * THREE.MathUtils.clamp((12 + vF) / 3, 0, 1);
    }
    // Ramp lip: a car without the Rocket's perimeter thrusters can't right itself after leaving the
    // lip upside down, so its stability system stops it at the lip (the fan holds it there) and it
    // rolls back down. The Rocket drives off the lip (rampFlightStep takes over).
    let lipStop = false;
    if (this.onLoop && vF > 0 && this.rampS > RAMP.length - 1.0 - vF * vF / (2 * 1.6 * G) && !(trim.perimeter && this.tank > 0)) { lipStop = true; driveTotal = Math.min(driveTotal, 0); }
    const brakeForce = (!reversing ? input.brake : 0) * m * G * 2.6 + (lipStop ? m * G * 3 : 0); // carbon brakes: grip-limited, so suction shortens stops

    // ESC
    let escL = 0, escR = 0;
    if (grounded && vF > 4 && !input.handbrake) {
      const aLim2 = trim.mu * 0.85 * (1 + this.fanLevel) * G + Math.min(downforce, m*G*1.5) * trim.mu * 0.85 / m;
      let rRef = vF * Math.tan(this.steer) / (2.65 * (1 + 0.0012 * vF * vF));
      rRef = THREE.MathUtils.clamp(rRef, -aLim2 / vF, aLim2 / vF);
      const r = this.angVel.dot(_up);
      const beta = Math.atan2(-this.vel.dot(_right), vF);
      let err = r - rRef;  // + = too much left yaw
      const db = 0.04;
      if ((Math.abs(err) > db && Math.sign(err) === Math.sign(r)) || Math.abs(beta) > 0.1 + 1.35 * Math.abs(r) / vF) {
        const e = Math.sign(err) * Math.max(0, Math.abs(err) - db) + 2.0 * Math.sign(beta) * Math.max(0, Math.abs(beta) - 0.1) * 0;
        const Mz = -THREE.MathUtils.clamp(e * this.inertia.y * 10, -m * G * 0.6, m * G * 0.6);
        // braking the left wheel yaws left (+): F = Mz / 0.85
        if (Mz > 0) escL = Mz / 0.85; else escR = -Mz / 0.85;
        driveTotal *= THREE.MathUtils.clamp(1 - (Math.abs(err) - db) * 4, 0.2, 1);
      }
    }
    // Wheels
    this.groundedWheels = 0;
    for (const w of this.wheels) { w.onLoop = -1; w.rampS = -1; }
    for (const w of this.wheels) {
      this.toWorld(w.local, w.world);
      const g = groundAt(w.world.x, w.world.z, w.world.y);
      _n.set(g.nx, g.ny, g.nz);
      // distance from mount to the surface along the body's down axis: ground, or the loop deck
      let upDotN = _up.dot(_n);
      let dist = upDotN >= 0.3 ? (w.world.y - g.h) * _n.y / upDotN : Infinity;
      const lp = loopAt(w.world.x, w.world.y, w.world.z);
      if (lp) {
        const ud = _up.x * lp.nx + _up.y * lp.ny + _up.z * lp.nz;
        if (ud > 0.3 && lp.h / ud < dist) { dist = lp.h / ud; upDotN = ud; _n.set(lp.nx, lp.ny, lp.nz); w.onLoop = lp.theta; w.rampS = lp.s; }
      }
      w.prevCompression = w.compression;
      if (dist === Infinity) { w.contact = false; w.compression = 0; w.load = 0; continue; }
      const maxLen = this.restLength + this.wheelRadius;
      if (dist > maxLen) {
        w.contact = false; w.compression = 0; w.load = 0; w.onLoop = -1; w.rampS = -1;
        w.spinRate *= 0.995;
        continue;
      }
      w.contact = true;
      this.groundedWheels++;
      w.compression = maxLen - dist;
      w.compression = Math.min(w.compression, 0.4);
      const compRate = THREE.MathUtils.clamp((w.compression - w.prevCompression) / dt, -6, 6);
      let Fs = this.springK * w.compression + this.damperC * compRate;
      if (w.compression > 0.25) Fs += (w.compression - 0.25) * 900000; // bump stop
      Fs = Math.max(0, Fs);
      w.contactPoint.copy(w.world).addScaledVector(_up, -dist);
      _v.copy(_up).multiplyScalar(Fs);
      this.addForceAt(_v, w.contactPoint);

      // Normal load includes downforce share (applied through suspension)
      const Fn = Fs;
      w.load = Fn;

      // Tire frame
      const steer = w.front ? this.steer : 0;
      _f.copy(_fwd).applyAxisAngle(_up, steer);
      _f.addScaledVector(_n, -_f.dot(_n)).normalize();
      _s.crossVectors(_n, _f).normalize(); // points to +X side (left)
      // contact point velocity
      _r.subVectors(w.contactPoint, this.pos);
      _w.crossVectors(this.angVel, _r).add(this.vel);
      const vLong = _w.dot(_f);
      const vLat = _w.dot(_s);

      let mu = trim.mu * Math.min(1.15, Math.pow(Math.max(Fn, 200) / (m * G / 4), -0.2));
      let latMu = mu * (w.front ? 0.97 : 1.06);
      if (!w.front && input.handbrake) latMu *= 0.45;

      // Longitudinal
      let Fx = 0;
      const frontBias = 0.4;
      Fx += driveTotal * (w.front ? frontBias : 1 - frontBias) / 2;
      if (brakeForce > 0) Fx -= Math.sign(vLong) * Math.min(brakeForce * (w.front ? 0.62 : 0.38) / 2, Math.abs(vLong) * m * 4) ;
      if (w.id === 'fl' || w.id === 'rl') Fx -= Math.sign(vLong) * (w.front ? 0.7 : 0.3) * escL;
      if (w.id === 'fr' || w.id === 'rr') Fx -= Math.sign(vLong) * (w.front ? 0.7 : 0.3) * escR;
      if (!w.front && input.handbrake) Fx = -Math.sign(vLong) * Math.min(mu * Fn * 0.7, Math.abs(vLong) * m * 2);
      if (throttle === 0 && input.brake === 0 && !input.handbrake) Fx -= Math.sign(vLong) * Math.min(Math.abs(vLong) * m * 0.5, Math.min(0.2 * m * G, 250e3 / Math.max(Math.abs(vLong), 1))) * (w.front ? 0.6 : 0.4) / 2 + vLong * 0; // rolling / regen drag
      const maxF = mu * Fn;
      const txSlip = Math.abs(Fx) / (maxF + 1);

      // Lateral (Pacejka-lite)
      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 2.5));
      let Fy = -latMu * Fn * Math.sin(1.45 * Math.atan(9 * (w.front ? 1 : 1.3) * alpha));
      // low speed: prevent creep
      if (speed < 1.0) Fy = THREE.MathUtils.clamp(-vLat * m * 3, -latMu * Fn, latMu * Fn);
      // TC / ABS: longitudinal may use what lateral leaves, never below 35% of the circle
      if (!(input.handbrake && !w.front)) {
        const fxCap = Math.max(0.35 * maxF, Math.sqrt(Math.max(0, maxF * maxF - Fy * Fy)) * 0.95);
        Fx = THREE.MathUtils.clamp(Fx, -fxCap, fxCap);
      }
      const capC = Math.max(latMu, input.handbrake && !w.front ? 0.7 * mu : 0) * Fn, magC = Math.hypot(Fx, Fy);
      if (magC > capC) { Fx *= capC / magC; Fy *= capC / magC; }

      // Smoke only from a real slide (well past the ~8° peak) or a handbrake drift. Traction
      // control holds launches at peak grip, so a Tesla launch doesn't smoke its tires.
      w.slip = Math.max(Math.abs(alpha) > 0.24 ? Math.min(1, (Math.abs(alpha) - 0.24) * 3) * Math.min(1, speed / 8) : 0, (input.handbrake && !w.front && speed > 3) ? 0.8 : 0);

      _v.copy(_f).multiplyScalar(Fx).addScaledVector(_s, Fy);
      this.addForceAt(_v, w.contactPoint);
      w.spinRate = vLong / this.wheelRadius;
    }
    for (const w of this.wheels) w.spin += w.spinRate * dt;

    // Ramp lane guidance: the side rails keep the car centred on the 3.2 m deck and pointing along
    // the loop plane (it can't yaw into the rails)
    let loopTheta = -1, rampS = -1;
    for (const w of this.wheels) if (w.onLoop >= 0) { loopTheta = Math.max(loopTheta, w.onLoop); rampS = Math.max(rampS, w.rampS); }
    const wasOnLoop = this.onLoop;
    this.onLoop = loopTheta >= 0;
    if (this.onLoop) {
      this.rampS = rampS; this.rampTheta = loopTheta;
      this.force.x += m * (12 * (RAMP.x0 - this.pos.x) - 7 * this.vel.x);
      _v.set(0, _fwd.y, _fwd.z).normalize();
      const e = _w.crossVectors(_fwd, _v).dot(_up), wy = this.angVel.dot(_up);
      this.torque.addScaledVector(_up, this.inertia.y * (40 * e - 10 * wy));
    } else if (wasOnLoop) {
      // just left the deck: past ~125 deg that is the lip, and the Rocket's flight computer takes over
      if (this.rampTheta > 2.2 && trim.perimeter && this.tank > 0 && !this.rampFlight) this.startRampFlight();
      this.rampS = -1;
    }

    // Hull vs ground (roof landings, bottoming out)
    for (const h of this.hull) {
      this.toWorld(h, _v);
      const g = groundAt(_v.x, _v.z, _v.y);
      let pen = Math.min(g.h - _v.y, 0.12);
      _n.set(g.nx, g.ny, g.nz);
      const lp = loopAt(_v.x, _v.y, _v.z);
      let hullMu = 0.6;
      if (lp && -lp.h > pen) { pen = Math.min(-lp.h, 0.12); _n.set(lp.nx, lp.ny, lp.nz); hullMu = 0.12; }   // bumper skid plates scraping the smooth deck
      if (pen > 0) {
        _r.subVectors(_v, this.pos);
        _w.crossVectors(this.angVel, _r).add(this.vel);
        const vn = _w.dot(_n);
        const Fn = Math.max(0, pen * 400000 - vn * 30000);
        _t.copy(_w).addScaledVector(_n, -vn);
        const vt = _t.length();
        _f.copy(_n).multiplyScalar(Fn);
        if (vt > 0.01) _f.addScaledVector(_t, -Math.min(Fn * hullMu, vt * m * 4) / vt);
        this.addForceAt(_f, _v);
        if (-vn > 6) this.lastImpact = Math.max(this.lastImpact, -vn);
      }
    }

    // Air control (in the air: pitch/roll/yaw from thrusters / gyroscopic)
    const airborne = this.groundedWheels === 0;
    this.controlTorque.set(0, 0, 0);
    if (this.rollBurn) this.controlTorque.copy(this.flipCtl);
    this.burstTimer -= dt;
    if (this.burstTimer > 0) this.controlTorque.copy(this.burstTorque);
    if (airborne) {
      this.airborneTime += dt;
      const ac = trim.airControl * (trim.perimeter && this.tank > 0 ? 1 : 0.35);
      _v.set(input.pitch * this.inertia.x * 4.5 * ac, input.yawAir * this.inertia.y * 3.0 * ac, input.roll * this.inertia.z * 6.0 * ac).applyQuaternion(this.quat);
      this.torque.add(_v);
      if (trim.perimeter && this.tank > 0) this.controlTorque.addScaledVector(_t.set(input.pitch, input.yawAir, input.roll).applyQuaternion(this.quat), 1);
      const steering = Math.abs(input.pitch) + Math.abs(input.roll) + Math.abs(input.yawAir) > 0;
      if (steering && trim.perimeter) this.tank = Math.max(0, this.tank - 2500 * dt); // attitude jets ~2.5 kN
      // Rocket flight computer: perimeter thrusters level the car when not stunting
      if (trim.perimeter && this.tank > 0 && !steering && this.kickflipTimer <= 0) {
        _v.crossVectors(_up, _n.set(0, 1, 0)).multiplyScalar(this.inertia.x * 14);
        _w.copy(this.angVel).addScaledVector(_n, -this.angVel.y).multiplyScalar(-this.inertia.x * 5);
        _w.y -= this.angVel.y * this.inertia.y * 2.2; // yaw jets damp spin about the vertical too
        this.torque.add(_v).add(_w);
        _t.copy(_v).add(_w).divideScalar(this.inertia.x * 6);
        this.controlTorque.add(_t);
      }
    } else {
      if (this.airborneTime > 0.6) this.events.push({ type: 'land', airtime: this.airborneTime, impact: this.lastImpact });
      this.airborneTime = 0;
    }

    // Integrate linear
    this.vel.addScaledVector(this.force, dt / m);
    this.pos.addScaledVector(this.vel, dt);

    // Integrate angular (torque in local frame / inertia)
    _qi.copy(this.quat).invert();
    _v.copy(this.torque).applyQuaternion(_qi);
    _v.set(_v.x / this.inertia.x, _v.y / this.inertia.y, _v.z / this.inertia.z).applyQuaternion(this.quat);
    this.angVel.addScaledVector(_v, dt);
    if (airborne) this.angVel.multiplyScalar(Math.exp(-0.1 * dt));
    const wl = this.angVel.length();
    if (wl > 1e-6) {
      _q.setFromAxisAngle(_v.copy(this.angVel).divideScalar(wl), wl * dt);
      this.quat.premultiply(_q).normalize();
    }

    this.collide();
  }

  collide() {
    if (this.noCollide) return; // headless calibration only
    const fwd = _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    // Sample circles along the car footprint
    for (const off of [-1.5, 0, 1.5]) {
      const cx = this.pos.x + fwd.x * off, cz = this.pos.z + fwd.z * off;
      const rad = 1.05;
      // Parked vehicles, the Semi, the building
      const list = boxesNear(cx, cz);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const bottomY = this.pos.y - 0.4, top = b.y + b.h;
        if (bottomY > top - 0.3 || this.pos.y + 0.6 < b.y) continue;
        if (!insideBox(b, cx, cz, rad)) continue;
        // push out along the smallest local axis
        const dx = cx - b.x, dz = cz - b.z;
        const lx = b.c * dx - b.s * dz, lz = b.s * dx + b.c * dz;
        const px = b.w / 2 + rad - Math.abs(lx);
        const pz = b.d / 2 + rad - Math.abs(lz);
        let nlx = 0, nlz = 0, pen;
        if (px < pz) { nlx = Math.sign(lx); pen = px; } else { nlz = Math.sign(lz); pen = pz; }
        this.resolve(b.c * nlx + b.s * nlz, -b.s * nlx + b.c * nlz, pen);
      }
      // Light poles and tree trunks
      if (this.pos.y < 9) for (const [tx, tz, tr] of POLES) {
        const dx = cx - tx, dz = cz - tz, R = rad + tr;
        if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
        const d = Math.hypot(dx, dz);
        if (d < R && d > 1e-4) this.resolve(dx / d, dz / d, R - d);
      }
      // Ramp structure (deck back + truss, solid base under the leg) is solid from outside:
      // push the car out of it and remove the velocity into it
      const sh = !this.onLoop ? loopShell(cx, this.pos.y, cz, 1.0) : null;
      if (sh) {
        this.pos.x += sh.nx * sh.pen; this.pos.y += sh.ny * sh.pen; this.pos.z += sh.nz * sh.pen;
        const vn = this.vel.x * sh.nx + this.vel.y * sh.ny + this.vel.z * sh.nz;
        if (vn < 0) { this.vel.x -= sh.nx * vn * 1.3; this.vel.y -= sh.ny * vn * 1.3; this.vel.z -= sh.nz * vn * 1.3; this.vel.multiplyScalar(0.92); if (-vn > 4) this.events.push({ type: 'crash', speed: -vn }); }
      }
      // Perimeter fence
      if (cx < LOT.xMin + rad) this.resolve(1, 0, LOT.xMin + rad - cx);
      if (cx > LOT.xMax - rad) this.resolve(-1, 0, cx - (LOT.xMax - rad));
      if (cz < LOT.zMin + rad) this.resolve(0, 1, LOT.zMin + rad - cz);
      if (cz > LOT.zMax - rad) this.resolve(0, -1, cz - (LOT.zMax - rad));
    }
  }

  resolve(nx, nz, pen) {
    this.pos.x += nx * pen;
    this.pos.z += nz * pen;
    const vn = this.vel.x * nx + this.vel.z * nz;
    if (vn < 0) {
      this.vel.x -= nx * vn * 1.35;
      this.vel.z -= nz * vn * 1.35;
      this.vel.multiplyScalar(0.92);
      this.angVel.y *= 0.6;
      if (-vn > 4) this.events.push({ type: 'crash', speed: -vn });
    }
  }

  // ---------------------------------------------------------------- vertical-ramp exit (Rocket)
  // Measured from reveal video 1 (t = 0 at the lip = 15.95 s): the car leaves
  // the lip ~20 deg short of inverted and keeps pitching over until it hangs level and belly-up
  // (+0.55 s); it holds there briefly, then the perimeter jets roll it upright in ~0.5 s
  // (90 deg at +0.85 s, level by +1.2 s); the four landing columns fire from ~+1.15 s and it touches
  // down ~2.0 s after leaving the lip in a cloud. Same jets / flight computer as the kickflip.
  startRampFlight() {
    _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    const fH = new THREE.Vector3(_fwd.x, 0, _fwd.z);
    if (fH.lengthSq() < 1e-4) fH.set(0, 0, -1);
    fH.normalize();
    // level, belly-up attitude facing fH: body +Z = fH, body +Y = -world Y, body +X = Y x Z
    const up = new THREE.Vector3(0, -1, 0), xAxis = new THREE.Vector3().crossVectors(up, fH).normalize();
    _m4.makeBasis(xAxis, up, fH);
    const qInv = new THREE.Quaternion().setFromRotationMatrix(_m4);
    this.rampFlight = { T: 0, fH, q0: this.quat.clone(), qInv, rollDir: this.flipDir || 1 };
    this.kickflipTimer = 3; this.flipState = 'coast'; this.flipT = 0;
    this.events.push('rampExit');
  }

  rampFlightStep(dt, grounded) {
    const F = this.rampFlight;
    F.T += dt;
    const T = F.T, T_PITCH = 0.55, T_R0 = 0.60, T_R1 = 1.15, ALPHA = 70;
    const ss = (u) => { u = THREE.MathUtils.clamp(u, 0, 1); return u * u * (3 - 2 * u); };
    // reference attitude: exit attitude -> level belly-up, then roll 180 deg about the heading
    _q2.copy(F.q0).slerp(F.qInv, ss(T / T_PITCH));
    // footage: fast first quarter-turn (180 -> 90 deg in ~0.17 s), slower settle (level ~1.1 s):
    // smoothstep on a warped clock w = 1 - (1 - u)^1.6
    const u = THREE.MathUtils.clamp((T - T_R0) / (T_R1 - T_R0), 0, 1), D = T_R1 - T_R0;
    const wq = 1 - Math.pow(1 - u, 1.6), dw = u < 1 ? 1.6 * Math.pow(1 - u, 0.6) / D : 0;
    const psi = Math.PI * wq * wq * (3 - 2 * wq), psiDot = Math.PI * 6 * wq * (1 - wq) * dw;
    if (psi > 0) { _q3.setFromAxisAngle(F.fH, psi * F.rollDir); _q2.premultiply(_q3); }
    // attitude error (world axis-angle) and PD within the jets' authority
    _q3.copy(_q2).multiply(_qi.copy(this.quat).invert());
    if (_q3.w < 0) { _q3.x = -_q3.x; _q3.y = -_q3.y; _q3.z = -_q3.z; _q3.w = -_q3.w; }
    const sinH = Math.hypot(_q3.x, _q3.y, _q3.z), ang = 2 * Math.atan2(sinH, _q3.w);
    _v.set(_q3.x, _q3.y, _q3.z); if (sinH > 1e-6) _v.multiplyScalar(ang / sinH);
    _w.copy(F.fH).multiplyScalar(psiDot * F.rollDir).sub(this.angVel);           // rate error
    _v.multiplyScalar(70).addScaledVector(_w, 16);                               // desired angular accel (world)
    const al = _v.length(); if (al > ALPHA) _v.multiplyScalar(ALPHA / al);
    const dem = Math.min(1, _v.length() / ALPHA);
    _qi.copy(this.quat).invert();
    _r.copy(_v).applyQuaternion(_qi); _r.set(_r.x * this.inertia.x, _r.y * this.inertia.y, _r.z * this.inertia.z).applyQuaternion(this.quat);
    this.torque.add(_r);
    // jets for the effects: which side fires and how hard (same channels as the kickflip roll)
    if (_v.lengthSq() > 1e-8) this.flipCtl.copy(_v).normalize().multiplyScalar(Math.max(0.05, Math.min(1, dem * 1.6)));
    this.rollBurn = dem > 0.06 ? Math.min(1, dem * 1.6) : 0;
    this.flipState = T < T_R0 ? 'coast' : (u < 0.5 ? 'spinup' : 'spindown');
    this.flipT = T; this.rollSettle = T > T_R1 - 0.2;
    this.tank = Math.max(0, this.tank - 9000 * dem * dt);
    // translate clear of the ramp: the lip is above the entry curve, so the flank jets push the car
    // back along its heading for the first second (footage +0.2-0.5 s: long horizontal plumes)
    if (T < 1.0) {
      const Fp = this.mass * G * 0.4 * Math.min(1, T / 0.15);
      _v.copy(F.fH).multiplyScalar(Fp); this.force.add(_v); this.assistForce.add(_v);
      this.assistLevel = this.trim.assistThrust ? this.assistForce.length() / this.trim.assistThrust : 0;
      this.tank = Math.max(0, this.tank - Fp * dt);
    }
    this.kickflipTimer = 1;
    if (T > T_R1 + 0.35 || (grounded && T > 0.3) || this.tank <= 0) {
      this.rampFlight = null; this.flipState = null; this.kickflipTimer = 0; this.rollSettle = false; this.rollBurn = 0;
    }
  }
}
