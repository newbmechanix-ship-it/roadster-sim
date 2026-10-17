// Shared parking-lot layout: used by World (visuals) and Vehicle (physics).
// Units: meters. Ground is flat asphalt (y=0); curbed islands and the tops of
// parked vehicles act as raised ground. No jump ramps: as at the reveal, the Rocket
// clears obstacles with its thrusters.

// Drivable area, enclosed by a fence (south/east/west) and the building (north)
export const LOT = { xMin: -235, xMax: 235, zMin: -185, zMax: 152 };

// Parking rows: double-loaded rows running along X, centered on z
export const STALL = { w: 2.7, d: 5.5 };
export const ROWS = [128, 107, 86, 65, 44].map(z => ({ z, xFrom: -160, xTo: 160, gap: 7 }));

// Open area (south): the Semi line from the demo, a slalom and a launch lane
export const LAUNCH = { z: -165, xStart: -215, length: 402.336 };

let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export const BOXES = [];   // { kind, x, z, y, w, h, d, yaw, ... }
export const POLES = [];   // [x, z, radius] collidable thin cylinders
export const LIGHTS = [];  // [x, z, height] parking-lot light poles (visual)
export const TREES = [];   // [x, z, scale]

// Demo set piece: Tesla Semi with cars parked beside it, perpendicular to the approach
BOXES.push(
  { kind: 'semi', x: 60, z: -60, y: 0, w: 2.6, h: 4.1, d: 7.4, yaw: Math.PI / 2 },
  { kind: 'democar', x: 60, z: -66, y: 0, w: 1.95, h: 1.45, d: 4.7, yaw: Math.PI / 2, color: 0x1c2a4a },
  { kind: 'democar', x: 60, z: -54, y: 0, w: 1.95, h: 1.45, d: 4.7, yaw: Math.PI / 2, color: 0x8a1010 },
  { kind: 'democar', x: 60, z: -48.5, y: 0, w: 1.95, h: 1.55, d: 4.8, yaw: Math.PI / 2, color: 0x2a2a2c },
);

// Building along the north edge
BOXES.push({ kind: 'building', x: 0, z: 192, y: 0, w: 250, h: 13, d: 76, yaw: 0 });

// Parking rows: stalls, parked cars, end islands with trees, light poles on the row spine
export const STALLS = []; // [x, z, facing(+1 north / -1 south)]
for (const row of ROWS) {
  for (const side of [-1, 1]) {
    const zc = row.z + side * STALL.d / 2;
    for (let x = row.xFrom; x + STALL.w <= row.xTo + 0.01; x += STALL.w) {
      const cx = x + STALL.w / 2;
      if (Math.abs(cx) < row.gap) continue; // center drive-through
      STALLS.push([cx, zc, side]);
      // occupancy thins out toward the far ends of the lot
      const occ = 0.62 - Math.abs(cx) / 420;
      if (rnd() < occ) {
        const variant = rnd() < 0.5 ? 0 : (rnd() < 0.6 ? 1 : 2); // sedan / SUV / pickup
        const dims = [[1.85, 1.45, 4.7], [1.95, 1.75, 4.85], [2.05, 1.9, 5.6]][variant];
        BOXES.push({
          kind: 'parked', variant, x: cx + (rnd() - 0.5) * 0.25, z: zc - side * (STALL.d - dims[2]) * 0.35,
          y: 0, w: dims[0], h: dims[1], d: dims[2], yaw: (side > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 0.05,
          color: rnd(),
        });
      }
    }
  }
  // curbed islands at both ends of each double row
  for (const ex of [row.xFrom - 4, row.xTo + 4]) {
    BOXES.push({ kind: 'island', x: ex, z: row.z, y: 0, w: 8, h: 0.15, d: STALL.d * 2, yaw: 0 });
    TREES.push([ex, row.z, 0.9 + rnd() * 0.4]);
    POLES.push([ex, row.z, 0.3]);
  }
  for (let x = row.xFrom + 20; x < row.xTo; x += 40) {
    if (Math.abs(x) < row.gap + 2) continue;
    LIGHTS.push([x, row.z, 10]);
    POLES.push([x, row.z, 0.35]);
  }
}
// Light poles around the open south area
for (let x = -210; x <= 210; x += 52.5) for (const z of [-180, 15]) { LIGHTS.push([x, z, 12]); POLES.push([x, z, 0.35]); }
for (const z of [-120, -60]) for (const x of [-232, 232]) { LIGHTS.push([x, z, 12]); POLES.push([x, z, 0.35]); }

// Slalom cones
export const CONES = Array.from({ length: 12 }, (_, i) => [-120 + i * 18, -110 + (i % 2 ? 2.5 : -2.5)]);

export const SPAWN = { x: 0, z: -110, yaw: 0 };

// ------------------------------------------------------------------ spatial grid
for (const b of BOXES) { b.c = Math.cos(b.yaw); b.s = Math.sin(b.yaw); b.r = Math.hypot(b.w, b.d) / 2; }
const CELL = 10, GX0 = -300, GZ0 = -260, GW = 60, GH = 60;
const grid = Array.from({ length: GW * GH }, () => []);
for (const b of BOXES) {
  const m = b.r + 2.5;
  const x0 = Math.floor((b.x - m - GX0) / CELL), x1 = Math.floor((b.x + m - GX0) / CELL);
  const z0 = Math.floor((b.z - m - GZ0) / CELL), z1 = Math.floor((b.z + m - GZ0) / CELL);
  for (let gx = Math.max(0, x0); gx <= Math.min(GW - 1, x1); gx++)
    for (let gz = Math.max(0, z0); gz <= Math.min(GH - 1, z1); gz++) grid[gz * GW + gx].push(b);
}
const EMPTY = [];
/** Boxes whose footprint may lie within ~2.5 m of (x, z). */
export function boxesNear(x, z) {
  const gx = Math.floor((x - GX0) / CELL), gz = Math.floor((z - GZ0) / CELL);
  if (gx < 0 || gz < 0 || gx >= GW || gz >= GH) return EMPTY;
  return grid[gz * GW + gx];
}

const _c = { h: 0, nx: 0, ny: 1, nz: 0 };
/** Ground height and normal at (x,z). Returns a shared object. */
export function groundAt(x, z, maxY = Infinity) {
  let h = 0;
  const list = boxesNear(x, z);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const top = b.y + b.h;
    if (top <= h || top > maxY + 0.3) continue;
    if (insideBox(b, x, z, 0)) h = top;
  }
  _c.h = h; _c.nx = 0; _c.ny = 1; _c.nz = 0;
  return _c;
}

export function insideBox(b, x, z, pad) {
  const dx = x - b.x, dz = z - b.z;
  if (dx * dx + dz * dz > (b.r + pad) * (b.r + pad)) return false;
  const lx = b.c * dx - b.s * dz;
  const lz = b.s * dx + b.c * dz;
  return Math.abs(lx) < b.w / 2 + pad && Math.abs(lz) < b.d / 2 + pad;
}

// ------------------------------------------------------------------ vertical ramp
// The steel-truss "vertical ramp" from reveal video 1 (13.25–18.2 s;
// silhouettes at 26.4–29 s and in reveal video 2 1.7–4 s; ground-level shot 36.0–37.0 s).
// NOT a full loop: a partial loop that rises from the asphalt, goes vertical and curls back over
// to ~160°, ending in an open lip ~13.1 m up. The car climbs it on its suction fan, leaves the lip
// nearly upside down, the flight computer pitches it level-inverted, rolls it upright in ~0.5 s
// and the landing jets set it down ~2 s after it left the lip.
// Profile in the loop plane (u = z - z0 forward along the approach, y up), inner running surface:
//   entry arc  R1, heading 0 → 90° (tangent to the ground at u = 0)
//   vertical straight Lv
//   top arc    R2, heading 90° → end (160°), open lip
// Enter driving +Z along x = x0.
export const RAMP = { x0: -100, z0: -60, R1: 6.5, Lv: 0.3, R2: 5.8, end: 160 * Math.PI / 180, width: 3.2, depth: 1.8, phiMin: 0.08 };
{
  const R = RAMP;
  R.s1 = R.R1 * Math.PI / 2; R.s2 = R.Lv; R.s3 = R.R2 * (R.end - Math.PI / 2); R.length = R.s1 + R.s2 + R.s3;
  R.cy = R.R1 + R.Lv; R.cu = R.R1 - R.R2;                       // top-arc centre (u, y)
  R.lipY = R.cy - R.R2 * Math.cos(R.end); R.lipU = R.cu + R.R2 * Math.sin(R.end);
}
/** Point on the running surface at arc length s: { u, y, phi (heading), nu, ny (inward normal) }. */
export function rampPoint(s, off = 0) {
  const R = RAMP; let u, y, phi;
  if (s < R.s1) { phi = s / R.R1; u = R.R1 * Math.sin(phi); y = R.R1 - R.R1 * Math.cos(phi); }
  else if (s < R.s1 + R.s2) { phi = Math.PI / 2; u = R.R1; y = R.R1 + (s - R.s1); }
  else { phi = Math.PI / 2 + (s - R.s1 - R.s2) / R.R2; u = R.cu + R.R2 * Math.sin(phi); y = R.cy - R.R2 * Math.cos(phi); }
  const nu = -Math.sin(phi), ny = Math.cos(phi);               // toward the inside of the curve
  return { u: u + nu * off, y: y + ny * off, phi, nu, ny };
}

const _lp = { h: 0, nx: 0, ny: 1, nz: 0, theta: 0, s: 0 };
/** Ramp running surface near (x,y,z): clearance h (m, + = on the running side) along the surface
 *  normal, the normal (toward the inside of the curve), heading theta and arc length s.
 *  Returns null away from the deck (off its sides, past the lip, or on the flat entry plate). */
export function loopAt(x, y, z) {
  const R = RAMP;
  if (Math.abs(x - R.x0) > R.width / 2) return null;
  const u = z - R.z0;
  if (u < -0.5 || u > R.R1 + 0.7 || y > R.lipY + 0.8 + R.R2) return null;
  let h, nu, ny, phi, s;
  if (y < R.R1) {                                               // entry arc
    const du = u, dy = y - R.R1, d = Math.hypot(du, dy);
    if (d < 1e-3) return null;
    phi = Math.atan2(du, -dy);
    if (phi < R.phiMin || phi > Math.PI / 2) return null;
    h = R.R1 - d; nu = -du / d; ny = -dy / d; s = R.R1 * phi;
  } else if (y <= R.cy) {                                       // vertical straight
    h = R.R1 - u; nu = -1; ny = 0; phi = Math.PI / 2; s = R.s1 + (y - R.R1);
  } else {                                                      // top arc
    const du = u - R.cu, dy = y - R.cy, d = Math.hypot(du, dy);
    if (d < 1e-3) return null;
    phi = Math.atan2(du, -dy); if (phi < 0) phi += Math.PI * 2;
    if (phi < Math.PI / 2 || phi > R.end) return null;
    h = R.R2 - d; nu = -du / d; ny = -dy / d; s = R.s1 + R.s2 + R.R2 * (phi - Math.PI / 2);
  }
  if (h > 3.5 || h < -0.6) return null;
  _lp.h = h; _lp.nx = 0; _lp.ny = ny; _lp.nz = nu; _lp.theta = phi; _lp.s = s;
  return _lp;
}

/** Solid structure behind the running surface (deck + truss, `depth` deep; below the leg the
 *  frame is filled down to the asphalt), for a car outside it. (x,y,z) = car CG, rad = car radius.
 *  Returns { pen, nx, ny, nz } (push direction away from the structure) or null. */
export function loopShell(x, y, z, rad = 0.9) {
  const R = RAMP, dx = x - R.x0, halfW = R.width / 2 + 0.35 + rad;
  if (Math.abs(dx) > halfW) return null;
  const u = z - R.z0;
  if (y < R.R1) {
    const uDeck = R.R1 * Math.sin(Math.acos(Math.min(1, (R.R1 - Math.max(0, y)) / R.R1)));
    if (u < uDeck + 0.3 || u > R.R1 + R.depth + rad) return null;
    const pb = R.R1 + R.depth + rad - u, ps = halfW - Math.abs(dx);
    return pb < ps ? { pen: pb, nx: 0, ny: 0, nz: 1 } : { pen: ps, nx: Math.sign(dx), ny: 0, nz: 0 };
  }
  let back, nu, ny;                                             // back = distance behind the running surface
  if (y <= R.cy) { back = u - R.R1; nu = 1; ny = 0; }
  else {
    const du = u - R.cu, dy = y - R.cy, d = Math.hypot(du, dy);
    let phi = Math.atan2(du, -dy); if (phi < 0) phi += Math.PI * 2;
    if (phi < Math.PI / 2 || phi > R.end + 0.08) return null;
    back = d - R.R2; nu = du / d; ny = dy / d;
  }
  if (back < 0.05 || back > R.depth + rad) return null;
  return { pen: R.depth + rad - back, nx: 0, ny, nz: nu };
}
// truss feet (collidable): the base frame behind the vertical leg
for (const sx of [-1, 1]) POLES.push([RAMP.x0 + sx * (RAMP.width / 2 + 0.25), RAMP.z0 + RAMP.R1 + RAMP.depth + 1.6, 0.3]);
POLES.push([RAMP.x0 - 13, RAMP.z0 - 5, 0.9]);   // light-tower trailer
