// A normal, real-world parking lot at night (or day): worn asphalt, painted
// stalls, parked cars, LED light poles, curbed islands with trees, a warehouse,
// chain-link fence, a road with wooden utility poles, and the Tesla Semi line
// from the reveal demo.
import * as THREE from 'three/webgpu';
import { texture, uv, vec2, vec3, float, mix } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOT, ROWS, STALL, STALLS, BOXES, LIGHTS, TREES, CONES, LAUNCH, RAMP, rampPoint } from './layout.js';

let seed = 99;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

function noiseFill(g, w, h, amp) {
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() * 2 - 1) * amp;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function glowTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

function withColor(geo, r, g, b) {
  const gg = geo.index ? geo.toNonIndexed() : geo;
  const n = gg.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b; }
  gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return gg;
}

/** Extrude a side profile (points as [z, y]) across the width; result is centered on x. */
function profileExtrude(points, width, bevel = 0.05) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  const depth = Math.max(0.01, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 2 });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

// ------------------------------------------------------------------ parked car geometry
const CAR_TYPES = [
  { // sedan
    L: 4.7, W: 1.85, H: 1.45, wr: 0.33,
    lower: [[2.35, 0.3], [2.38, 0.56], [2.28, 0.72], [1.2, 0.86], [0.95, 0.9], [-1.7, 0.95], [-2.3, 0.98], [-2.37, 0.72], [-2.33, 0.3]],
    cabin: [[1.0, 0.88], [0.15, 1.40], [-0.95, 1.42], [-1.75, 0.97], [-1.75, 0.9]],
    roof: [[0.12, 1.39], [0.08, 1.45], [-0.95, 1.46], [-1.05, 1.40]],
  },
  { // SUV
    L: 4.85, W: 1.95, H: 1.75, wr: 0.37,
    lower: [[2.42, 0.36], [2.45, 0.7], [2.35, 0.92], [1.35, 1.04], [1.05, 1.06], [-2.35, 1.08], [-2.43, 0.9], [-2.4, 0.36]],
    cabin: [[1.1, 1.04], [0.35, 1.68], [-2.2, 1.7], [-2.36, 1.1]],
    roof: [[0.32, 1.67], [0.28, 1.75], [-2.18, 1.76], [-2.26, 1.68]],
  },
  { // pickup
    L: 5.6, W: 2.05, H: 1.9, wr: 0.4,
    lower: [[2.8, 0.4], [2.83, 0.8], [2.7, 1.08], [1.3, 1.16], [1.0, 1.18], [-2.75, 1.18], [-2.8, 0.95], [-2.78, 0.4]],
    cabin: [[1.05, 1.16], [0.45, 1.82], [-0.75, 1.84], [-0.85, 1.16]],
    roof: [[0.42, 1.81], [0.38, 1.9], [-0.75, 1.91], [-0.82, 1.82]],
  },
];

/** Lower-body profile with the bottom edge running forward around both wheel arches. */
function lowerWithArches(t) {
  const pts = t.lower.slice();
  const bottom = pts[pts.length - 1][1];
  const r = t.wr + 0.07;
  for (const zc of [-(t.L / 2 - 0.9), t.L / 2 - 0.95]) {
    for (let k = 0; k <= 8; k++) {
      const a = Math.PI - (k / 8) * Math.PI;
      pts.push([zc + Math.cos(a) * r, Math.max(bottom, t.wr + Math.sin(a) * r)]);
    }
  }
  return pts;
}

function buildCarGeometries(t) {
  const paint = [], trim = [];
  paint.push(withColor(profileExtrude(lowerWithArches(t), t.W, 0.06), 1, 1, 1));
  paint.push(withColor(profileExtrude(t.roof, t.W - 0.28, 0.03), 1, 1, 1));
  trim.push(withColor(profileExtrude(t.cabin, t.W - 0.22, 0.04), 0.025, 0.028, 0.032)); // glass
  // bumpers / lower cladding
  const bumper = new THREE.BoxGeometry(t.W - 0.04, 0.16, 0.18);
  for (const zs of [1, -1]) {
    const b = bumper.clone(); b.translate(0, 0.4, zs * (t.L / 2 - 0.02));
    trim.push(withColor(b, 0.05, 0.05, 0.055));
  }
  // lights
  for (const xs of [-1, 1]) {
    const hl = new THREE.BoxGeometry(0.42, 0.1, 0.05); hl.translate(xs * (t.W / 2 - 0.3), t.lower[2][1] - 0.06, t.L / 2 - 0.02);
    trim.push(withColor(hl, 0.75, 0.77, 0.8));
    const tl = new THREE.BoxGeometry(0.38, 0.12, 0.05); tl.translate(xs * (t.W / 2 - 0.28), t.lower[t.lower.length - 3][1] - 0.1, -t.L / 2 + 0.01);
    trim.push(withColor(tl, 0.45, 0.02, 0.02));
  }
  // wheels
  const tire = new THREE.CylinderGeometry(t.wr, t.wr, 0.24, 14); tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(t.wr * 0.62, t.wr * 0.62, 0.245, 10); rim.rotateZ(Math.PI / 2);
  for (const zs of [1, -1]) for (const xs of [1, -1]) {
    const x = xs * (t.W / 2 - 0.16), z = zs * (t.L / 2 - (zs > 0 ? 0.95 : 0.9));
    const a = tire.clone(); a.translate(x, t.wr, z); trim.push(withColor(a, 0.022, 0.022, 0.024));
    const r = rim.clone(); r.translate(x + xs * 0.005, t.wr, z); trim.push(withColor(r, 0.42, 0.43, 0.45));
  }
  return { paint: mergeGeometries(paint), trim: mergeGeometries(trim) };
}

// Real-world color distribution of parked cars (linear sRGB-ish values)
const PALETTE = [
  [0.25, 0xf2f2f0], [0.2, 0x0d0e10], [0.17, 0x55585c], [0.14, 0xa9adb2],
  [0.09, 0x1b2e55], [0.08, 0x8e1414], [0.03, 0x2d3d2a], [0.02, 0xb59f7c], [0.02, 0x4a3022],
];
function carColor(u) {
  let acc = 0;
  for (const [p, c] of PALETTE) { acc += p; if (u <= acc) return new THREE.Color(c); }
  return new THREE.Color(PALETTE[0][1]);
}

export function buildEnvironmentMap(renderer, day = false) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(day ? 0x9bb8d8 : 0x05070a);
  const panel = (w, h, col, intensity, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  if (day) {
    panel(60, 60, 0xcfe0f5, 1.6, [0, 40, 0]);
    panel(10, 10, 0xfff4e0, 30, [25, 30, -15]);
  } else {
    // overhead LED fixtures scattered across the sky dome + faint horizon glow
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      panel(2.5, 1.2, 0xf4f6ff, 7, [Math.cos(a) * 20, 12 + (i % 3) * 3, Math.sin(a) * 20]);
    }
    panel(120, 6, 0x3a3226, 0.6, [0, 2, -40]);
    panel(120, 6, 0x3a3226, 0.6, [0, 2, 40]);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: day ? 0x4a4a4a : 0x0c0c0c }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2; env.add(floor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  return pmrem.fromScene(env, 0.03).texture;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.nightOnly = [];   // objects visible only at night (light pools)
    this.lampMats = [];    // emissive materials dimmed in daytime
    this.buildSky();
    this.buildGround();
    this.buildMarkings();
    this.buildIslandsAndTrees();
    this.buildLightPoles();
    this.buildParkedCars();
    this.buildSetPiece();
    this.buildBuilding();
    this.buildFenceAndRoad();
    this.buildBackground();
    this.buildCones();
    this.buildRamp();
    this.setDay(false);
  }

  // ---------------------------------------------------------------- sky
  buildSky() {
    const geo = new THREE.SphereGeometry(1800, 32, 16);
    const col = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.skyGeo = geo;
    this.sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -1;
    this.group.add(this.sky);
    // faint stars (suburban light pollution hides most of them)
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = 0.25 + Math.random() * 1.2;
      pos.set([Math.cos(u) * Math.cos(v) * 1700, Math.sin(v) * 1700, Math.sin(u) * Math.cos(v) * 1700], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x8890a0, size: 1.4, sizeAttenuation: false, fog: false }));
    this.group.add(this.stars);
  }

  paintSky(day) {
    const p = this.skyGeo.attributes.position, c = this.skyGeo.attributes.color;
    const zen = new THREE.Color(day ? 0x3f6fb0 : 0x020306);
    const hor = new THREE.Color(day ? 0xc9d8e8 : 0x1a1814); // sodium/LED skyglow at night
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 1800;
      const t = Math.pow(Math.max(0, y), day ? 0.5 : 0.35);
      tmp.copy(hor).lerp(zen, t);
      if (y < 0) tmp.copy(hor).multiplyScalar(day ? 0.8 : 0.6);
      c.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    c.needsUpdate = true;
  }

  // ---------------------------------------------------------------- ground
  buildGround() {
    // detail: aggregate, small cracks, tar seams (tiles every 8 m)
    const detail = canvasTex(1024, 1024, (g, w, h) => {
      g.fillStyle = '#5b5c5e'; g.fillRect(0, 0, w, h);
      noiseFill(g, w, h, 34);
      for (let i = 0; i < 2500; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(20,20,22,0.5)' : 'rgba(140,140,140,0.35)';
        g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
      g.strokeStyle = 'rgba(25,25,26,0.28)'; g.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        let x = Math.random() * w, y = Math.random() * h;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 14; k++) { x += (Math.random() - 0.5) * 50; y += (Math.random() - 0.5) * 50; g.lineTo(x, y); }
        g.stroke();
      }
    }, { repeat: [1, 1] });
    // macro: large-scale wear, oil stains under stalls, patched areas (whole lot, no repeat)
    const W = LOT.xMax - LOT.xMin + 40, D = LOT.zMax - LOT.zMin + 40;
    const macro = canvasTex(1024, 768, (g, w, h) => {
      g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 160; i++) {
        const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 120;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        const v = Math.random() < 0.5 ? 'rgba(60,60,60,0.25)' : 'rgba(170,170,170,0.18)';
        gr.addColorStop(0, v); gr.addColorStop(1, 'rgba(128,128,128,0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // patched rectangles (fresher, darker asphalt)
      for (let i = 0; i < 14; i++) {
        // real patches are a few metres across and only slightly darker
        g.fillStyle = 'rgba(48,48,50,0.16)';
        g.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 7, 2 + Math.random() * 5);
      }
      // oil drips in the middle of each stall
      const sx = w / W, sz = h / D;
      for (const [x, z] of STALLS) {
        if (Math.random() < 0.6) {
          // canvas top = texture v=1 = world −z (the plane is rotated −90° about X), so rows map from the south edge
          const px = (x - LOT.xMin + 20) * sx, py = (z - (LOT.zMin - 20)) * sz, r = 3 + Math.random() * 4;
          const gr = g.createRadialGradient(px, py, 0, px, py, r);
          gr.addColorStop(0, 'rgba(25,25,25,0.6)'); gr.addColorStop(1, 'rgba(60,60,60,0)');
          g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
        }
      }
    }, { srgb: false });
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
    const tiles = vec2(W / 8, D / 8);
    const d = texture(detail, uv().mul(tiles));
    const m = texture(macro, uv());
    mat.colorNode = d.rgb.mul(m.rgb.mul(2.0)).mul(vec3(0.85, 0.85, 0.87));
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat);
    lot.rotation.x = -Math.PI / 2;
    lot.position.set((LOT.xMin + LOT.xMax) / 2, 0, (LOT.zMin + LOT.zMax) / 2);
    lot.receiveShadow = true;
    this.group.add(lot);

    // grass verge everywhere else
    const grassTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#3c4a26'; g.fillRect(0, 0, w, h);
      noiseFill(g, w, h, 30);
    }, { repeat: [300, 300] });
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.02;
    grass.receiveShadow = true;
    this.group.add(grass);
  }

  // ---------------------------------------------------------------- paint
  buildMarkings() {
    const worn = canvasTex(64, 512, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      const img = g.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = Math.random() < 0.18 ? 40 + Math.random() * 120 : 220 + Math.random() * 35;
      g.putImageData(img, 0, 0);
    });
    const white = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, map: worn, transparent: true, roughness: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const lines = [];
    const add = (x, z, len, w, yaw = 0) => lines.push({ x, z, len, w, yaw });
    for (const row of ROWS) {
      for (const side of [-1, 1]) {
        const zc = row.z + side * STALL.d / 2;
        for (let x = row.xFrom; x <= row.xTo + 0.01; x += STALL.w) {
          if (Math.abs(x) < row.gap - STALL.w * 0.5) continue;
          add(x, zc, STALL.d - 0.1, 0.1);
        }
      }
      // row spine (where back-to-back stalls meet)
      const half = (row.xTo - row.gap) / 2 + row.gap;
      for (const sx of [-1, 1]) add(sx * half, row.z, row.xTo - row.gap, 0.1, Math.PI / 2);
    }
    // launch lane start/finish (event chalk lines)
    for (const x of [LAUNCH.xStart, LAUNCH.xStart + LAUNCH.length]) add(x, LAUNCH.z, 9, 0.35);
    // crosswalk in front of the building entrance
    for (let i = 0; i < 8; i++) add(-7 + i * 2, 146, 6, 0.6);
    const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), white, lines.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    lines.forEach((l, i) => {
      e.set(-Math.PI / 2, 0, l.yaw); q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(l.x, 0.012, l.z), q, new THREE.Vector3(l.w, l.len, 1));
      inst.setMatrixAt(i, mtx);
    });
    inst.receiveShadow = true;
    this.group.add(inst);
  }

  // ---------------------------------------------------------------- islands + trees
  buildIslandsAndTrees() {
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xa8a59c, roughness: 0.85 });
    const mulchMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
    const islands = BOXES.filter(b => b.kind === 'island');
    const curb = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), curbMat, islands.length);
    const mulch = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mulchMat, islands.length);
    const m = new THREE.Matrix4();
    islands.forEach((b, i) => {
      m.compose(new THREE.Vector3(b.x, b.h / 2, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w, b.h, b.d)); curb.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(b.x, b.h + 0.005, b.z), new THREE.Quaternion(), new THREE.Vector3(b.w - 0.4, 0.01, b.d - 0.4)); mulch.setMatrixAt(i, m);
    });
    curb.receiveShadow = curb.castShadow = true;
    this.group.add(curb, mulch);
    this.addTrees(TREES.map(([x, z, s]) => [x, z, s, 0.15]));
  }

  addTrees(list) {
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 3, 7); trunkGeo.translate(0, 1.5, 0);
    const blobs = [];
    for (let k = 0; k < 4; k++) {
      const b = new THREE.IcosahedronGeometry(1.6 + rnd() * 0.6, 1);
      const p = b.attributes.position;
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.85 + rnd() * 0.3), p.getY(i) * (0.8 + rnd() * 0.3), p.getZ(i) * (0.85 + rnd() * 0.3));
      b.translate((rnd() - 0.5) * 1.6, 4.2 + rnd() * 1.4, (rnd() - 0.5) * 1.6);
      blobs.push(b);
    }
    const crownGeo = mergeGeometries(blobs); crownGeo.computeVertexNormals();
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x3b2c20, roughness: 1 }), list.length);
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    list.forEach(([x, z, s, y = 0], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
      trunk.setMatrixAt(i, m); crown.setMatrixAt(i, m);
      crown.setColorAt(i, c.setHSL(0.24 + rnd() * 0.06, 0.35 + rnd() * 0.2, 0.13 + rnd() * 0.08));
    });
    trunk.castShadow = crown.castShadow = true;
    this.group.add(trunk, crown);
  }

  // ---------------------------------------------------------------- light poles
  buildLightPoles() {
    const steel = new THREE.MeshStandardMaterial({ color: 0x6f7378, metalness: 0.6, roughness: 0.45 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.9 });
    const housing = new THREE.MeshStandardMaterial({ color: 0x2c2e31, metalness: 0.4, roughness: 0.5 });
    const lens = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xf2f5ff, emissiveIntensity: 9 });
    this.lampMats.push(lens);
    const n = LIGHTS.length;
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 1, 8); poleGeo.translate(0, 0.5, 0);
    const baseGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.8, 10); baseGeo.translate(0, 0.4, 0);
    const pole = new THREE.InstancedMesh(poleGeo, steel, n);
    const base = new THREE.InstancedMesh(baseGeo, concrete, n);
    const heads = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    LIGHTS.forEach(([x, z, h], i) => {
      m.compose(new THREE.Vector3(x, 0.8, z), q, new THREE.Vector3(1, h - 0.8, 1)); pole.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 0, z), q, one); base.setMatrixAt(i, m);
      // twin shoebox heads on short arms (north/south)
      for (const s of [-1, 1]) heads.push([x, h, z + s * 0.9]);
    });
    const headGeo = new THREE.BoxGeometry(0.55, 0.14, 0.85);
    const lensGeo = new THREE.PlaneGeometry(0.45, 0.7); lensGeo.rotateX(Math.PI / 2);
    const armGeo = new THREE.BoxGeometry(0.08, 0.08, 0.9);
    const head = new THREE.InstancedMesh(headGeo, housing, heads.length);
    const lensM = new THREE.InstancedMesh(lensGeo, lens, heads.length);
    const arm = new THREE.InstancedMesh(armGeo, steel, heads.length);
    heads.forEach(([x, y, z], i) => {
      m.compose(new THREE.Vector3(x, y, z), q, one); head.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, y - 0.075, z), q, one); lensM.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, y + 0.02, (z + LIGHTS[Math.floor(i / 2)][1]) / 2), q, one); arm.setMatrixAt(i, m);
    });
    pole.castShadow = base.castShadow = head.castShadow = true;
    this.group.add(pole, base, head, lensM, arm);

    // pools of light on the asphalt (night only)
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xc8ccd4, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), n);
    LIGHTS.forEach(([x, z, h], i) => {
      const r = h * 3.6;
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      m.compose(new THREE.Vector3(x, 0.02, z), q, new THREE.Vector3(r, r, 1)); pool.setMatrixAt(i, m);
    });
    q.identity();
    this.group.add(pool);
    this.nightOnly.push(pool);

    // Night air scatters the LED light: a soft halo around each head and a faint shaft of
    // lit haze under it (the reveal footage is full of this; jets and clouds sit in it).
    const haloMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xdfe6f2, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const shaftGeo = new THREE.CylinderGeometry(0.35, 1, 1, 20, 1, true); shaftGeo.translate(0, -0.5, 0);
    {
      const pos = shaftGeo.attributes.position, col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { const k = 1 + pos.getY(i); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0.25 + 0.75 * k; }
      shaftGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const shaftMat = new THREE.MeshBasicMaterial({ color: 0x9aa6b8, vertexColors: true, transparent: true, opacity: 0.008,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const shaft = new THREE.InstancedMesh(shaftGeo, shaftMat, heads.length);
    heads.forEach(([x, y, z], i) => {
      const halo = new THREE.Sprite(haloMat);
      halo.position.set(x, y - 0.15, z); halo.scale.setScalar(1.7);
      this.group.add(halo); this.nightOnly.push(halo);
      const r = y * 0.55;
      m.compose(new THREE.Vector3(x, y - 0.1, z), q, new THREE.Vector3(r, y - 0.1, r)); shaft.setMatrixAt(i, m);
    });
    this.group.add(shaft); this.nightOnly.push(shaft);
  }

  // ---------------------------------------------------------------- parked cars
  buildParkedCars() {
    const paintMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.32, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0.3 });
    const parked = BOXES.filter(b => b.kind === 'parked');
    CAR_TYPES.forEach((t, vi) => {
      const list = parked.filter(b => b.variant === vi);
      if (!list.length) return;
      const g = buildCarGeometries(t);
      const paint = new THREE.InstancedMesh(g.paint, paintMat, list.length);
      const trim = new THREE.InstancedMesh(g.trim, trimMat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
      list.forEach((b, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw);
        m.compose(new THREE.Vector3(b.x, 0, b.z), q, one);
        paint.setMatrixAt(i, m); trim.setMatrixAt(i, m);
        paint.setColorAt(i, carColor(b.color));
      });
      paint.castShadow = trim.castShadow = true;
      paint.receiveShadow = true;
      this.group.add(paint, trim);
    });
  }

  // ---------------------------------------------------------------- demo set piece
  buildSetPiece() {
    const paintMatCache = {};
    for (const b of BOXES) {
      if (b.kind === 'semi') {
        const s = this.makeSemi(b);
        s.position.set(b.x, b.y, b.z); s.rotation.y = b.yaw; this.group.add(s);
      } else if (b.kind === 'democar') {
        const t = CAR_TYPES[0];
        const g = buildCarGeometries({ ...t, L: b.d, W: b.w });
        const pm = paintMatCache[b.color] ||= new THREE.MeshPhysicalMaterial({ color: b.color, vertexColors: true, roughness: 0.25, metalness: 0.3, clearcoat: 1 });
        const grp = new THREE.Group();
        const p = new THREE.Mesh(g.paint, pm), tr = new THREE.Mesh(g.trim, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.3 }));
        p.castShadow = tr.castShadow = true;
        grp.add(p, tr);
        grp.position.set(b.x, 0, b.z); grp.rotation.y = b.yaw;
        this.group.add(grp);
      }
    }
  }

  makeSemi(b) {
    // Tesla Semi day cab (front at +Z local), as parked in the reveal demo
    const g = new THREE.Group();
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f2f2, roughness: 0.3, clearcoat: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.6 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.05, metalness: 0.5 });
    const L = b.d;
    const cabShape = new THREE.Shape();
    cabShape.moveTo(0, 0.55); cabShape.lineTo(L - 0.25, 0.55); cabShape.lineTo(L, 1.25); cabShape.lineTo(L - 0.6, 2.75);
    cabShape.quadraticCurveTo(L - 2.0, 4.1, L - 3.9, 4.1); cabShape.lineTo(L - 6.2, 4.0); cabShape.lineTo(L - 6.2, 0.55);
    const cabGeo = new THREE.ExtrudeGeometry(cabShape, { depth: 2.4, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 8 });
    cabGeo.translate(-L / 2, 0, -1.2); cabGeo.rotateY(-Math.PI / 2);
    const cab = new THREE.Mesh(cabGeo, white); cab.castShadow = true; g.add(cab);
    const ws = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.15, 0.04), glass);
    ws.position.set(0, 3.1, L / 2 - 1.0); ws.rotation.x = -0.72; g.add(ws);
    const side = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.9, 1.3), glass);
    side.position.set(0, 3.0, L / 2 - 2.6); g.add(side);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.04), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 2 }));
    bar.position.set(0, 1.3, L / 2 + 0.02); g.add(bar);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, L - 0.4), dark);
    chassis.position.set(0, 0.75, 0); g.add(chassis);
    const fifth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 1.4), dark);
    fifth.position.set(0, 1.0, -L / 2 + 0.9); g.add(fifth);
    const tire = new THREE.CylinderGeometry(0.52, 0.52, 0.32, 18); tire.rotateZ(Math.PI / 2);
    for (const z of [L / 2 - 1.35, -L / 2 + 1.6, -L / 2 + 0.3]) for (const sx of [-1, 1]) {
      const t = new THREE.Mesh(tire, dark); t.position.set(sx * 1.05, 0.52, z); t.castShadow = true; g.add(t);
    }
    return g;
  }

  // ---------------------------------------------------------------- building
  buildBuilding() {
    const b = BOXES.find(x => x.kind === 'building');
    const front = b.z - b.d / 2;
    const ribTex = canvasTex(256, 64, (g, w, h) => {
      g.fillStyle = '#b9b6ad'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 16) {
        const gr = g.createLinearGradient(x, 0, x + 16, 0);
        gr.addColorStop(0, '#a5a299'); gr.addColorStop(0.5, '#cbc8bf'); gr.addColorStop(1, '#a29f96');
        g.fillStyle = gr; g.fillRect(x, 0, 16, h);
      }
      noiseFill(g, w, h, 8);
    }, { repeat: [b.w / 4, 1] });
    const wallMat = new THREE.MeshStandardMaterial({ map: ribTex, roughness: 0.6, metalness: 0.35 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), wallMat);
    box.position.set(b.x, b.h / 2, b.z); box.castShadow = box.receiveShadow = true;
    this.group.add(box);
    const band = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.1, 1.2, b.d + 0.1), new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.7 }));
    band.position.set(b.x, 0.6, b.z); this.group.add(band);
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.4, 0.5, b.d + 0.4), new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.8 }));
    parapet.position.set(b.x, b.h + 0.25, b.z); this.group.add(parapet);
    // storefront: glass with lit interior, canopy
    const glassTex = canvasTex(512, 128, (g, w, h) => {
      g.fillStyle = '#1d1a14'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 64) { g.fillStyle = '#3a3a3a'; g.fillRect(x, 0, 4, h); }
      g.fillStyle = '#3a3a3a'; g.fillRect(0, h * 0.72, w, 4);
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,230,190,0.55)'); gr.addColorStop(1, 'rgba(255,230,190,0.2)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const glassMat = new THREE.MeshStandardMaterial({ map: glassTex, emissiveMap: glassTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.4 });
    this.lampMats.push(glassMat);
    const store = new THREE.Mesh(new THREE.PlaneGeometry(26, 5), glassMat);
    store.position.set(0, 2.5, front - 0.05); store.rotation.y = Math.PI; this.group.add(store);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 4), new THREE.MeshStandardMaterial({ color: 0x2f3236, roughness: 0.6 }));
    canopy.position.set(0, 5.6, front - 2); canopy.castShadow = true; this.group.add(canopy);
    // loading / roll-up doors
    const doorTex = canvasTex(64, 128, (g, w, h) => {
      g.fillStyle = '#8f9296'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) { g.fillStyle = '#6c6f73'; g.fillRect(0, y, w, 2); }
    });
    const doorMat = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.55, metalness: 0.5 });
    for (const x of [-100, -80, -60, 60, 80, 100]) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), doorMat);
      d.position.set(x, 3, front - 0.05); d.rotation.y = Math.PI; this.group.add(d);
    }
    // wall packs
    const wp = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1d8, emissiveIntensity: 6 });
    this.lampMats.push(wp);
    for (let x = -115; x <= 115; x += 23) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.3), wp);
      l.position.set(x, 8, front - 0.2); this.group.add(l);
    }
    // sidewalk with curb
    const walk = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.15, 4), new THREE.MeshStandardMaterial({ color: 0xa9a69e, roughness: 0.9 }));
    walk.position.set(0, 0.075, front - 2); walk.receiveShadow = true; this.group.add(walk);
  }

  // ---------------------------------------------------------------- fence, road, utility poles
  buildFenceAndRoad() {
    const mesh = canvasTex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(170,175,180,1)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
    }, { srgb: true });
    const H = 2.1;
    const fenceSide = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const t = mesh.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(len / 0.12, H / 0.12); t.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(len, H), mat);
      p.position.set((x0 + x1) / 2, H / 2, (z0 + z1) / 2);
      p.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
      this.group.add(p);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), new THREE.MeshStandardMaterial({ color: 0x8a8e93, metalness: 0.7, roughness: 0.4 }));
      rail.rotation.z = Math.PI / 2; rail.rotation.y = p.rotation.y;
      rail.position.set(p.position.x, H, p.position.z);
      this.group.add(rail);
      return len;
    };
    const posts = [];
    const sides = [[LOT.xMin, LOT.zMin, LOT.xMax, LOT.zMin], [LOT.xMin, LOT.zMin, LOT.xMin, LOT.zMax + 2], [LOT.xMax, LOT.zMin, LOT.xMax, LOT.zMax + 2]];
    for (const [x0, z0, x1, z1] of sides) {
      const len = fenceSide(x0, z0, x1, z1);
      for (let d = 0; d <= len; d += 3) posts.push([x0 + (x1 - x0) * d / len, z0 + (z1 - z0) * d / len]);
    }
    const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.04, H + 0.1, 6), new THREE.MeshStandardMaterial({ color: 0x8a8e93, metalness: 0.7, roughness: 0.4 }), posts.length);
    const m = new THREE.Matrix4();
    posts.forEach(([x, z], i) => { m.makeTranslation(x, (H + 0.1) / 2, z); post.setMatrixAt(i, m); });
    this.group.add(post);

    // road along the south side
    const roadZ = LOT.zMin - 14;
    const roadTex = canvasTex(512, 128, (g, w, h) => {
      g.fillStyle = '#3a3b3d'; g.fillRect(0, 0, w, h); noiseFill(g, w, h, 20);
      g.fillStyle = '#c9a227'; g.fillRect(0, h / 2 - 5, w * 0.6, 3); g.fillRect(0, h / 2 + 2, w * 0.6, 3);
      g.fillStyle = '#d8d8d2'; g.fillRect(0, 6, w, 3); g.fillRect(0, h - 9, w, 3);
    }, { repeat: [40, 1] });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(1600, 10), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85 }));
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0.005, roadZ); road.receiveShadow = true;
    this.group.add(road);

    // wooden utility poles with sagging wires (as along the road in the reveal footage)
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 1 });
    const poleZ = LOT.zMin - 7;
    const tops = [];
    const poleGeo = new THREE.CylinderGeometry(0.13, 0.17, 11, 8); poleGeo.translate(0, 5.5, 0);
    const armGeo = new THREE.BoxGeometry(2.4, 0.12, 0.12);
    const xs = []; for (let x = -420; x <= 420; x += 42) xs.push(x);
    const pole = new THREE.InstancedMesh(poleGeo, wood, xs.length);
    const arm = new THREE.InstancedMesh(armGeo, wood, xs.length);
    xs.forEach((x, i) => {
      m.makeTranslation(x, 0, poleZ); pole.setMatrixAt(i, m);
      m.makeTranslation(x, 10.4, poleZ); arm.setMatrixAt(i, m);
      tops.push(x);
    });
    pole.castShadow = true;
    this.group.add(pole, arm);
    const wires = [];
    for (let i = 0; i < tops.length - 1; i++) for (const off of [-1.05, 0, 1.05]) {
      const a = new THREE.Vector3(tops[i], 10.5, poleZ + off), b2 = new THREE.Vector3(tops[i + 1], 10.5, poleZ + off);
      const mid = a.clone().lerp(b2, 0.5); mid.y -= 0.9;
      wires.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b2), 12, 0.015, 3, false));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(wires), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 })));
  }

  // ---------------------------------------------------------------- background
  buildBackground() {
    const trees = [];
    for (let i = 0; i < 260; i++) {
      const side = i % 3;
      let x, z;
      if (side === 0) { x = -500 + rnd() * 1000; z = LOT.zMin - 30 - rnd() * 60; }
      else if (side === 1) { x = LOT.xMin - 20 - rnd() * 80; z = -200 + rnd() * 450; }
      else { x = LOT.xMax + 20 + rnd() * 80; z = -200 + rnd() * 450; }
      trees.push([x, z, 1.4 + rnd() * 1.4]);
    }
    this.addTrees(trees);
    // distant low buildings
    const bm = new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.9 });
    const winMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd9a0, emissiveIntensity: 1.2 });
    this.lampMats.push(winMat);
    for (let i = 0; i < 18; i++) {
      const a = rnd() * Math.PI * 2, r = 650 + rnd() * 350;
      const w = 30 + rnd() * 60, h = 8 + rnd() * 18;
      const bld = new THREE.Mesh(new THREE.BoxGeometry(w, h, 20 + rnd() * 30), bm);
      bld.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      bld.rotation.y = rnd() * Math.PI;
      this.group.add(bld);
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.6, 0.2), winMat);
      win.position.copy(bld.position); win.position.y = h * 0.6; win.rotation.y = bld.rotation.y;
      win.translateZ(10.1);
      this.group.add(win);
    }
  }

  buildCones() {
    const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(0.2, 0.7, 12), new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.5 }), CONES.length + 6);
    const m = new THREE.Matrix4();
    CONES.forEach(([x, z], i) => { m.makeTranslation(x, 0.35, z); cone.setMatrixAt(i, m); });
    // cones marking the launch lane start/finish
    [[LAUNCH.xStart, LAUNCH.z - 5], [LAUNCH.xStart, LAUNCH.z + 5], [LAUNCH.xStart + LAUNCH.length, LAUNCH.z - 5], [LAUNCH.xStart + LAUNCH.length, LAUNCH.z + 5],
      [LAUNCH.xStart + LAUNCH.length + 1, LAUNCH.z - 5], [LAUNCH.xStart + LAUNCH.length + 1, LAUNCH.z + 5]]
      .forEach(([x, z], i) => { m.makeTranslation(x, 0.35, z); cone.setMatrixAt(CONES.length + i, m); });
    cone.castShadow = true;
    this.group.add(cone);
  }

  // ---------------------------------------------------------------- vertical ramp
  // The reveal's steel-truss vertical ramp (layout.js RAMP): a light-grey running deck with low side
  // rails and a white LED line along each edge, carried by a deep box truss of grey steel tube
  // (chords, radial posts, diagonals, cross-bracing) that stands on a ground frame; red LED floor
  // strips with white dot fixtures run along both sides of the base, and red fixtures inside the truss
  // light the steel from within (footage: red-lit members behind the deck).
  buildRamp() {
    const R = RAMP, L = R.length, W = R.width;
    const P = (s, off, side) => { const p = rampPoint(Math.min(Math.max(s, 0), L), off); return new THREE.Vector3(R.x0 + side, p.y, R.z0 + p.u); };
    const N = Math.ceil(L / 0.12);
    // --- deck: running surface + underside + edges (one swept strip)
    {
      const pos = [], nrm = [], idx = [], T = 0.12;
      for (let i = 0; i <= N; i++) {
        const s = L * i / N, p = rampPoint(s), n = [0, p.ny, p.nu];
        const ring = [[0, -W / 2, n], [0, W / 2, n], [-T, W / 2, [0, -n[1], -n[2]]], [-T, -W / 2, [0, -n[1], -n[2]]]];
        for (const [off, sd, nn] of ring) { const q = P(s, off, sd); pos.push(q.x, q.y, q.z); nrm.push(...nn); }
      }
      for (let i = 0; i < N; i++) {
        const a = i * 4, b = (i + 1) * 4;
        idx.push(a, a + 1, b, a + 1, b + 1, b);              // top (running side)
        idx.push(a + 3, b + 3, a + 2, a + 2, b + 3, b + 2);  // underside
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setIndex(idx);
      // painted steel deck: light grey-white, two thin grey seam lines along it (footage)
      const tex = canvasTex(256, 64, (c, w, h) => {
        c.fillStyle = '#d9d9d6'; c.fillRect(0, 0, w, h);
        noiseFill(c, w, h, 7);
        c.fillStyle = 'rgba(90,90,92,0.55)'; c.fillRect(w * 0.30, 0, 2, h); c.fillRect(w * 0.70, 0, 2, h);
        c.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < h; y += 32) c.fillRect(0, y, w, 1);   // plate joints
      }, { repeat: [1, 1] });
      const uvs = [];
      for (let i = 0; i <= N; i++) { const v = L * i / N / 2.4; uvs.push(0, v, 1, v, 1, v, 0, v); }
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const deck = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.16 }));
      deck.castShadow = deck.receiveShadow = true;
      this.group.add(deck);
    }
    // --- side rails (low steel curbs) and the white LED edge lines
    const steel = new THREE.MeshStandardMaterial({ color: 0xc4c7ca, metalness: 0.35, roughness: 0.42 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0xc9cbcc, metalness: 0.55, roughness: 0.4 });
    const tube = (pts, r, seg = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, pts.length * 2), r, seg, false);
    const along = (off, side, s0 = 0, s1 = L, step = 0.25) => { const pts = []; const n = Math.max(2, Math.ceil((s1 - s0) / step)); for (let i = 0; i <= n; i++) pts.push(P(s0 + (s1 - s0) * i / n, off, side)); return pts; };
    {
      const rails = [];
      for (const sd of [-1, 1]) {
        // rail: a 0.14 x 0.22 m box section on the deck edge
        const pos = [], idx = [];
        const n = Math.ceil(L / 0.2);
        for (let i = 0; i <= n; i++) {
          const s = L * i / n;
          for (const [off, lat] of [[0, 0], [0.22, 0], [0.22, -0.14], [0, -0.14]]) { const q = P(s, off, sd * (W / 2 + lat)); pos.push(q.x, q.y, q.z); }
        }
        for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
          const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = a + 4, d = b + 4;
          if (sd > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        rails.push(g);
      }
      const rm = new THREE.Mesh(mergeGeometries(rails), railMat); rm.castShadow = true; this.group.add(rm);
      const led = new THREE.MeshStandardMaterial({ color: 0x202020, emissive: 0xf4f1ff, emissiveIntensity: 2.4 });
      this.lampMats.push(led);
      const strips = [];
      strips.push(tube(along(0.03, -(W / 2 - 0.02), 0.3, L), 0.022, 4));   // footage: one bright line, on the near (-x) edge
      this.group.add(new THREE.Mesh(mergeGeometries(strips), led));
    }
    // --- box truss behind the deck
    const D = R.depth, chordR = 0.13, webR = 0.065, half = W / 2 - 0.1;
    const visible = (s) => P(s, -D, 0).y > 0.25;            // where the outer chord is above the ground
    let sTr = 0; while (!visible(sTr) && sTr < L) sTr += 0.05;  // truss starts where it clears the ground
    const geoms = [];
    for (const sd of [-1, 1]) {
      geoms.push(tube(along(-0.16, sd * half, 0.4, L), chordR));          // inner chords (under the deck edges)
      geoms.push(tube(along(-D, sd * half, sTr, L), chordR * 1.15));       // outer chords
    }
    const chordMesh = new THREE.Mesh(mergeGeometries(geoms), steel); chordMesh.castShadow = true; this.group.add(chordMesh);
    const strutGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
    const mats = [], Y = new THREE.Vector3(0, 1, 0);
    const addStrut = (a, b, r = webR) => {
      const d = b.clone().sub(a), len = d.length(); if (len < 0.05) return;
      mats.push(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y, d.divideScalar(len)), new THREE.Vector3(r, len, r)));
    };
    const PANEL = 1.25, np = Math.round((L - sTr) / PANEL);
    const redFix = [];
    for (let i = 0; i <= np; i++) {
      const s = sTr + (L - sTr) * i / np, s2 = sTr + (L - sTr) * Math.min(np, i + 1) / np;
      for (const sd of [-1, 1]) {
        addStrut(P(s, -0.16, sd * half), P(s, -D, sd * half), 0.08);                    // radial post
        if (i < np) addStrut(P(i % 2 ? s : s2, -0.16, sd * half), P(i % 2 ? s2 : s, -D, sd * half));   // Warren diagonal
      }
      addStrut(P(s, -D, -half), P(s, -D, half), 0.055);                                  // outer cross member
      addStrut(P(s, -0.16, -half), P(s, -0.16, half), 0.05);                             // deck cross beam
      if (i < np) { addStrut(P(s, -D, i % 2 ? -half : half), P(s2, -D, i % 2 ? half : -half)); addStrut(P(s, -0.16, i % 2 ? half : -half), P(s2, -0.16, i % 2 ? -half : half), 0.05); }   // outer- and inner-face bracing
      redFix.push(P(s, -D + 0.25, 0));
    }
    // entry: deck carried on posts down to two ground sills
    const sill = [];
    for (const sd of [-1, 1]) {
      const a = P(0, 0, sd * half), b = new THREE.Vector3(R.x0 + sd * half, 0.12, R.z0 + R.R1 + D + 1.8);
      sill.push(new THREE.BoxGeometry(0.3, 0.24, b.z - a.z + 0.6).translate(a.x, 0.12, (a.z + b.z) / 2));
      for (let s = 1.2; s < sTr + 0.01; s += 1.2) { const top = P(s, -0.16, sd * half); addStrut(new THREE.Vector3(top.x, 0.24, top.z), top, 0.06); }
    }
    // ground frame under the leg: cross beams, and two raked back-stays to the leg's outer chords
    for (let u = 0.6; u < R.R1 + D + 1.8; u += 1.6) sill.push(new THREE.BoxGeometry(W - 0.2, 0.2, 0.25).translate(R.x0, 0.1, R.z0 + u));
    for (const sd of [-1, 1]) {
      const foot = new THREE.Vector3(R.x0 + sd * (W / 2 + 0.25), 0.05, R.z0 + R.R1 + D + 1.6);
      addStrut(foot, P(R.s1 * 0.78, -D, sd * half), 0.12);
      addStrut(foot, P(R.s1 * 0.45, -D, sd * half), 0.1);
      sill.push(new THREE.BoxGeometry(0.9, 0.08, 0.9).translate(foot.x, 0.04, foot.z));
    }
    // end frame at the lip
    for (const sd of [-1, 1]) addStrut(P(L, 0, sd * (W / 2)), P(L, -D, sd * half), 0.08);
    addStrut(P(L, -D, -half), P(L, -D, half), 0.08);
    const strutMesh = new THREE.InstancedMesh(strutGeo, steel, mats.length);
    mats.forEach((mm, i) => strutMesh.setMatrixAt(i, mm));
    strutMesh.castShadow = true; this.group.add(strutMesh);
    const sillMesh = new THREE.Mesh(mergeGeometries(sill), new THREE.MeshStandardMaterial({ color: 0x6d7176, metalness: 0.5, roughness: 0.55 }));
    sillMesh.castShadow = sillMesh.receiveShadow = true; this.group.add(sillMesh);
    // red fixtures inside the truss
    const redMat = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a12, emissiveIntensity: 3 });
    this.lampMats.push(redMat);
    const fix = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.1, 0.16), redMat, redFix.length);
    redFix.forEach((p, i) => fix.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    this.group.add(fix);
    // red LED floor strips with white dot fixtures along both sides of the base (footage)
    const stripMat = new THREE.MeshStandardMaterial({ color: 0x250000, emissive: 0xff2414, emissiveIntensity: 5 });
    const dotMat = new THREE.MeshStandardMaterial({ color: 0x404040, emissive: 0xfff4ec, emissiveIntensity: 6 });
    this.lampMats.push(stripMat, dotMat);
    const u0 = -14, u1 = R.R1 + D + 2.5, lenS = u1 - u0, xs = W / 2 + 1.7;
    const sg = [];
    for (const sd of [-1, 1]) sg.push(new THREE.BoxGeometry(0.09, 0.05, lenS).translate(R.x0 + sd * xs, 0.025, R.z0 + (u0 + u1) / 2));
    this.group.add(new THREE.Mesh(mergeGeometries(sg), stripMat));
    const nd = Math.floor(lenS / 0.5), dots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 6), dotMat, nd * 2);
    let k = 0;
    for (const sd of [-1, 1]) for (let i = 0; i < nd; i++) dots.setMatrixAt(k++, new THREE.Matrix4().makeTranslation(R.x0 + sd * (xs + 0.14), 0.03, R.z0 + u0 + 0.25 + i * 0.5));
    this.group.add(dots);
    // portable event light tower beside the ramp (footage 27 s: a bright tower next to it) — the one
    // real spotlight that lights the deck and truss at night, as the stage lights do in the footage
    {
      const tx = R.x0 - 13, tz = R.z0 - 5, th = 10;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, th, 8), steel); mast.position.set(tx, th / 2, tz); mast.castShadow = true;
      const trailer = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 3.2), new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.6 })); trailer.position.set(tx, 0.75, tz);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.0), steel); bar.position.set(tx, th, tz);
      const lampMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffffff, emissiveIntensity: 8 });
      this.lampMats.push(lampMat);
      const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.35, 0.12), lampMat, 4);
      const mm = new THREE.Matrix4(), qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2 - 0.35, 0));
      for (let i = 0; i < 4; i++) { mm.compose(new THREE.Vector3(tx + 0.15, th + (i < 2 ? 0.25 : -0.2), tz + (i % 2 ? 0.45 : -0.45)), qq, new THREE.Vector3(1, 1, 1)); heads.setMatrixAt(i, mm); }
      this.group.add(mast, trailer, bar, heads);
      const spot = new THREE.SpotLight(0xf2f4ff, 160, 70, 0.62, 0.6, 1.5);
      spot.position.set(tx + 0.3, th, tz); spot.target.position.set(R.x0, 6.5, R.z0 + 3.5);
      this.group.add(spot, spot.target); this.nightOnly.push(spot);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xeef2ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      halo.position.set(tx + 0.3, th, tz); halo.scale.setScalar(3); this.group.add(halo); this.nightOnly.push(halo);
    }
  }

  setDay(day) {
    this.day = day;
    this.paintSky(day);
    this.stars.visible = !day;
    for (const o of this.nightOnly) o.visible = !day;
    for (const mat of this.lampMats) {
      mat.userData.night ??= mat.emissiveIntensity;
      mat.emissiveIntensity = day ? 0.05 : mat.userData.night;
    }
    this.scene.background = null;
    this.scene.fog = day ? new THREE.Fog(0xc4d2e0, 300, 1500) : new THREE.Fog(0x161b21, 45, 520);
  }

  update() {}
}
