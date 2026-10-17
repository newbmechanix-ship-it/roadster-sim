import * as THREE from 'three/webgpu';

const MODES = ['Chase', 'Far chase', 'Cockpit', 'Wheel', 'Drone', 'Cinematic'];
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3(0, 4, -150);
    this.look = new THREE.Vector3();
    this.heading = new THREE.Vector3(0, 0, 1);
    this.shake = 0;
    this.orbit = 0;
    this.cineSpot = new THREE.Vector3();
    this.cineTimer = 0;
  }
  get modeName() { return MODES[this.mode]; }
  next() { this.mode = (this.mode + 1) % MODES.length; this.cineTimer = 0; }

  update(dt, car, model) {
    const cam = this.camera;
    _fwd.set(0, 0, 1).applyQuaternion(car.quat);
    const speed = car.speed;
    // Heading follows the velocity when moving fast (shows drift angle), the body otherwise
    const flat = _a.set(_fwd.x, 0, _fwd.z);
    if (flat.lengthSq() < 0.01) flat.copy(this.heading);
    flat.normalize();
    if (speed > 8 && car.groundedWheels > 0) {
      _b.set(car.vel.x, 0, car.vel.z).normalize();
      flat.lerp(_b, 0.35).normalize();
    }
    this.heading.lerp(flat, 1 - Math.exp(-dt * (car.groundedWheels > 0 ? 6 : 1.5))).normalize();

    let fovTarget = 60 + Math.min(speed / 100, 1) * 22 + car.thrustLevel * 8;
    const m = MODES[this.mode];
    if ((m === 'Chase' || m === 'Far chase') && car.onLoop) {
      // on the loop: chase along the car's own forward/up so it stays in view upside down
      const dist = m === 'Chase' ? 7.2 : 12, h = m === 'Chase' ? 2.0 : 3.5;
      const up = _b.set(0, 1, 0).applyQuaternion(car.quat);
      this.camUp = (this.camUp || new THREE.Vector3(0, 1, 0)).lerp(up, 1 - Math.exp(-dt * 6)).normalize();
      _a.copy(car.pos).addScaledVector(_fwd, -dist).addScaledVector(this.camUp, h);
      this.pos.lerp(_a, 1 - Math.exp(-dt * 12));
      this.look.copy(car.pos).addScaledVector(_fwd, 3).addScaledVector(this.camUp, 0.5);
      this.heading.set(_fwd.x, 0, _fwd.z).normalize();
      cam.position.copy(this.pos);
      cam.up.copy(this.camUp);
      cam.lookAt(this.look);
    } else if (m === 'Chase' || m === 'Far chase') {
      if (this.camUp) this.camUp.set(0, 1, 0);
      const dist = m === 'Chase' ? 7.2 : 13;
      const h = m === 'Chase' ? 2.2 : 4.2;
      _a.copy(car.pos).addScaledVector(this.heading, -dist - speed * 0.02);
      _a.y = Math.max(car.pos.y + h, 1.2);
      this.pos.lerp(_a, 1 - Math.exp(-dt * 10));
      _b.copy(car.pos).addScaledVector(this.heading, 3); _b.y += 0.6;
      this.look.lerp(_b, 1 - Math.exp(-dt * 14));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
    } else if (m === 'Cockpit' || m === 'Wheel') {
      // driver's eye measured from the reveal photo (model space → CG-local: CG sits cgHeight above origin)
      const eye = model?.userData.cockpitEye;
      const local = m === 'Cockpit'
        // a little above the measured eye so the view clears the yoke and you can see the road
        ? (eye ? _a.set(eye[0] ?? eye.x, (eye[1] ?? eye.y) - car.cgHeight + 0.13, (eye[2] ?? eye.z) + 0.04) : _a.set(0.35, 0.56, -0.06))
        : _a.set(1.25, -0.05, -0.2);
      cam.position.copy(local).applyQuaternion(car.quat).add(car.pos);
      cam.quaternion.copy(car.quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      if (m === 'Cockpit') cam.rotateX(-0.09); // look slightly down over the yoke toward the road
      fovTarget += 8;
      this.pos.copy(cam.position);
    } else if (m === 'Drone') {
      _a.copy(car.pos).add(_b.set(0, 38, 0)).addScaledVector(this.heading, -12);
      this.pos.lerp(_a, 1 - Math.exp(-dt * 3));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(car.pos);
      fovTarget = 55;
    } else {
      // Cinematic: trackside cameras that cut as the car passes
      this.cineTimer -= dt;
      if (this.cineTimer <= 0 || this.cineSpot.distanceTo(car.pos) > 70) {
        this.cineTimer = 4 + Math.random() * 3;
        const side = Math.random() > 0.5 ? 1 : -1;
        _b.set(_fwd.z * side, 0, -_fwd.x * side);
        this.cineSpot.copy(car.pos).addScaledVector(car.vel, 1.6 + Math.random()).addScaledVector(_b, 6 + Math.random() * 8);
        this.cineSpot.y = 0.4 + Math.random() * 3;
      }
      cam.position.copy(this.cineSpot);
      cam.up.set(0, 1, 0);
      cam.lookAt(car.pos);
      fovTarget = THREE.MathUtils.clamp(900 / Math.max(10, this.cineSpot.distanceTo(car.pos)), 20, 60);
    }
    // Shake from thrusters and impacts
    this.shake = Math.max(this.shake * Math.exp(-dt * 5), car.thrustLevel * 0.04 + car.liftLevel * 0.03);
    if (this.shake > 0.001 && this.mode !== 4) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    cam.fov += (fovTarget - cam.fov) * (1 - Math.exp(-dt * 4));
    cam.updateProjectionMatrix();
  }
}
