// Minimal stand-in that implements the RoadsterModel API contract.
// Used only if src/car/RoadsterModel.js is missing or fails to load.
import * as THREE from 'three/webgpu';

export function createRoadster({ trim = 'thrust' } = {}) {
  const group = new THREE.Group();
  group.name = 'Roadster';
  const white = new THREE.MeshPhysicalMaterial({ color: 0xe9ebec, roughness: 0.35, clearcoat: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x1a1408, roughness: 0.05, metalness: 0.6 });

  // Side profile extruded across the width
  const s = new THREE.Shape();
  s.moveTo(-2.2, 0.25); s.lineTo(2.2, 0.25); s.lineTo(2.25, 0.5); s.lineTo(1.2, 0.85);
  s.lineTo(0.2, 1.15); s.lineTo(-1.3, 1.02); s.lineTo(-2.15, 0.9); s.lineTo(-2.2, 0.25);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 1.95, bevelEnabled: false });
  geo.translate(0, 0, -0.975);
  geo.rotateY(-Math.PI / 2); // profile x → world z
  const body = new THREE.Mesh(geo, white);
  body.castShadow = true;
  const bodyGroup = new THREE.Group();
  bodyGroup.add(body);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 2.2), glass);
  canopy.position.set(0, 1.1, -0.2); canopy.rotation.x = -0.08;
  bodyGroup.add(canopy);
  group.add(bodyGroup);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.02), new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff1010, emissiveIntensity: 3 }));
  tail.position.set(0, 0.85, -2.2);
  const brake = tail.clone(); brake.material = tail.material.clone(); brake.position.y = 0.78;
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 3 }));
  head.position.set(0, 0.5, 2.26);
  group.add(tail, brake, head);

  const tire = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 28); tire.rotateZ(Math.PI / 2);
  const wheels = {};
  for (const [id, x, z] of [['fl', 0.85, 1.3], ['fr', -0.85, 1.3], ['rl', 0.85, -1.35], ['rr', -0.85, -1.35]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.36, z);
    const spin = new THREE.Group();
    const t = new THREE.Mesh(tire, black); t.castShadow = true;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.5, 0.06), white);
    spin.add(t, rim); pivot.add(spin); pivot.userData.spin = spin;
    group.add(pivot); wheels[id] = pivot;
  }
  const doors = {};
  for (const side of ['left', 'right']) {
    const p = new THREE.Group(); p.position.set(side === 'left' ? 0.97 : -0.97, 0.9, 0.9);
    p.userData.open = (t) => { p.rotation.x = -t * 1.2; };
    group.add(p); doors[side] = p;
  }
  let wing = null;
  if (trim !== 'performance') {
    wing = new THREE.Group(); wing.position.set(0, 1.05, -1.9);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.03, 0.4), white); blade.position.y = 0.35;
    wing.add(blade);
    wing.userData.setAngle = (a) => { blade.rotation.x = a; };
    wing.userData.setRaised = (t) => { blade.position.y = 0.2 + 0.25 * t; };
    group.add(wing);
  }
  const rear = [], perimeter = [];
  if (trim !== 'performance') for (let i = 0; i < 4; i++) {
    const m = new THREE.Object3D(); m.position.set(-0.45 + i * 0.3, 0.38, -2.22); m.rotation.y = Math.PI; group.add(m); rear.push(m);
  }
  if (trim === 'rocket') for (let i = 0; i < 8; i++) {
    const m = new THREE.Object3D(); const a = i / 8 * Math.PI * 2;
    m.position.set(Math.cos(a) * 0.9, 0.2, Math.sin(a) * 1.8); m.rotation.x = Math.PI / 2; group.add(m); perimeter.push(m);
  }
  group.userData.parts = { body: bodyGroup, wheels, doors, wing, thrusters: { rear, perimeter }, lights: { tail, head, brake } };
  group.userData.dims = { length: 4.4, width: 1.95, height: 1.15, wheelbase: 2.65, track: 1.7, wheelRadius: 0.36 };
  return group;
}
