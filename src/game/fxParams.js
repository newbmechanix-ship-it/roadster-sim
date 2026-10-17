// Live-tunable thruster / cloud effect parameters, shared by the effects code, the cloud
// worker and the FX editor. Values are multipliers (1 = the footage-calibrated default)
// unless noted. Persisted per browser.
const KEY = 'rdstr.fx.v3'; // v3: only user-changed values are stored (v2 stored every value)

export const FX_SCHEMA = [
  { group: 'Cloud — amount & lifetime', items: [
    { key: 'cloudEmission', label: 'Amount (gas emitted)', min: 0, max: 3, step: 0.05, def: 1 },
    { key: 'cloudMaxParcels', label: 'Max gas parcels (mesh pieces)', min: 200, max: 3000, step: 50, def: 1600, int: true },
    { key: 'cloudSize', label: 'Parcel size', min: 0.3, max: 2.5, step: 0.05, def: 1 },
    { key: 'cloudLife', label: 'Lifetime', min: 0.2, max: 3, step: 0.05, def: 1 },
    { key: 'cloudDissipation', label: 'Dissipation speed (thinning)', min: 0.2, max: 3, step: 0.05, def: 1 },
    { key: 'groundCloud', label: 'Ground cloud (landing) amount', min: 0, max: 3, step: 0.05, def: 1 },
    { key: 'takeoffCloud', label: 'Takeoff cloud amount', min: 0, max: 3, step: 0.05, def: 1 },
  ] },
  { group: 'Cloud — physics', items: [
    { key: 'cloudTurbulence', label: 'Turbulence (eddies)', min: 0, max: 4, step: 0.05, def: 1 },
    { key: 'cloudSpread', label: 'Spread (parcel pressure)', min: 0, max: 4, step: 0.05, def: 1 },
    { key: 'cloudSink', label: 'Cold-gas sinking', min: 0, max: 3, step: 0.05, def: 1 },
    { key: 'cloudRise', label: 'Buoyancy when warm', min: 0, max: 3, step: 0.05, def: 1 },
    { key: 'cloudDrag', label: 'Air drag', min: 0.2, max: 3, step: 0.05, def: 1 },
    { key: 'cloudJetSpeed', label: 'Jet exit speed (puff momentum)', min: 0.2, max: 3, step: 0.05, def: 1 },
    { key: 'windX', label: 'Wind X (m/s)', min: -6, max: 6, step: 0.1, def: 0 },
    { key: 'windZ', label: 'Wind Z (m/s)', min: -6, max: 6, step: 0.1, def: 0 },
  ] },
  { group: 'Cloud — mesh', items: [
    { key: 'meshComplexity', label: 'Complexity (cells per parcel radius)', min: 2, max: 9, step: 0.1, def: 2.6 },
    { key: 'meshMinCell', label: 'Finest cell size (m)', min: 0.12, max: 0.8, step: 0.01, def: 0.22 },
    { key: 'meshIso', label: 'Surface threshold (iso)', min: 0.02, max: 0.6, step: 0.005, def: 0.06 },
  ] },
  { group: 'Cloud — look', items: [
    { key: 'cloudOpacity', label: 'Opacity', min: 0, max: 2, step: 0.02, def: 1 },
    { key: 'cloudBrightness', label: 'Brightness', min: 0.3, max: 1.8, step: 0.02, def: 1 },
    { key: 'cloudGlow', label: 'Internal glow (scattering)', min: 0, max: 1.2, step: 0.02, def: 0.3 },
    { key: 'cloudBillow', label: 'Billow displacement (m)', min: 0, max: 1.5, step: 0.01, def: 0.3 },
    { key: 'cloudBump', label: 'Surface detail (bump)', min: 0, max: 0.4, step: 0.01, def: 0 },
    { key: 'cloudEdge', label: 'Edge softness', min: 0, max: 1, step: 0.02, def: 1 },
    { key: 'cloudFray', label: 'Fraying into wisps', min: 0, max: 2, step: 0.05, def: 1 },
  ] },
  { group: 'Jets — vapor cones', items: [
    { key: 'jetLength', label: 'Cone length', min: 0, max: 3, step: 0.05, def: 1 },
    { key: 'jetWidth', label: 'Cone width', min: 0.2, max: 3, step: 0.05, def: 1 },
    { key: 'jetOpacity', label: 'Cone opacity', min: 0, max: 2, step: 0.05, def: 1 },
    { key: 'jetTint', label: 'Maneuvering-jet blue tint', min: 0, max: 1, step: 0.05, def: 0.75 },
    { key: 'jetPuffs', label: 'Column twist / turbulence', min: 0, max: 3, step: 0.05, def: 1 },
    { key: 'jetFlutter', label: 'Pressure flutter', min: 0, max: 0.5, step: 0.01, def: 0.1 },
  ] },
  { group: 'Jets — maneuvering pulses', items: [
    { key: 'pulseThreshold', label: 'Min impulse to fire', min: 0.005, max: 0.1, step: 0.005, def: 0.025 },
    { key: 'pulseMin', label: 'Shortest pulse (s)', min: 0.03, max: 0.3, step: 0.01, def: 0.08 },
    { key: 'pulseMax', label: 'Longest pulse (s)', min: 0.05, max: 0.5, step: 0.01, def: 0.22 },
    { key: 'pulseCooldown', label: 'Valve recovery (s)', min: 0, max: 0.4, step: 0.01, def: 0.07 },
    { key: 'pulseVolume', label: '"Psst" volume', min: 0, max: 2, step: 0.05, def: 1 },
  ] },
  { group: 'Jump (kickflip)', items: [
    { key: 'popG', label: 'Takeoff thrust (× weight)', min: 1.5, max: 5, step: 0.05, def: 3.2 },
    { key: 'popTime', label: 'Takeoff burst duration (s)', min: 0.15, max: 1.2, step: 0.01, def: 0.49 },
    { key: 'popKick', label: 'Instant kick (m/s)', min: 0, max: 8, step: 0.1, def: 3.2 },
    { key: 'rollRate', label: 'Peak roll rate (°/s)', min: 120, max: 600, step: 5, def: 340 },
    { key: 'rollAccel', label: 'Max roll accel (°/s²)', min: 200, max: 2500, step: 10, def: 1260 },
  ] },
];

const defaults = {};
for (const g of FX_SCHEMA) for (const it of g.items) defaults[it.key] = it.def;

export const FX = { ...defaults, version: 0 };

// Earlier defaults, used to tell a frozen old default from a value the user actually chose
// when migrating v1/v2 saves (which stored every value, changed or not).
const FX_SCHEMA_DEF_V1 = {};
const OLD_DEFAULTS = { rollRate: [335], rollAccel: [630], cloudBillow: [0.13, 0.55, 0.35, 0.6], jetFlutter: [0.08], meshComplexity: [5, 3.5, 4, 3], cloudBump: [0.09, 0.03], cloudEdge: [0.9], meshIso: [0.22, 0.12], cloudMaxParcels: [1200], windX: [0.7], windZ: [0.25] };

try {
  let saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (!saved) {
    // migrate from v2 / v1: keep only genuine user changes
    const old = JSON.parse(localStorage.getItem('rdstr.fx.v2') || localStorage.getItem('rdstr.fx.v1') || '{}');
    saved = {};
    for (const k of Object.keys(defaults)) {
      const v = old[k];
      if (typeof v !== 'number' || v === defaults[k]) continue;
      if ((OLD_DEFAULTS[k] || []).some(o => Math.abs(o - v) < 1e-9)) continue; // frozen old default
      if (FX_SCHEMA_DEF_V1[k] !== undefined && Math.abs(FX_SCHEMA_DEF_V1[k] - v) < 1e-9) continue;
      saved[k] = v;
    }
    localStorage.setItem(KEY, JSON.stringify(saved));
  }
  for (const k of Object.keys(defaults)) if (typeof saved[k] === 'number') FX[k] = saved[k];
} catch { /* storage unavailable: defaults */ }

// Persist only values the user actually changed, so later default re-calibrations still
// reach every slider they haven't touched.
function persist() {
  const out = {};
  for (const k of Object.keys(defaults)) if (FX[k] !== defaults[k]) out[k] = FX[k];
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* storage unavailable */ }
}

let saveTimer = null;
export function setFX(key, value) {
  FX[key] = value;
  FX.version++;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 250);
}

export function resetFX(keys = Object.keys(defaults)) {
  for (const k of keys) FX[k] = defaults[k];
  FX.version++;
  persist();
}

export function exportFX() {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = FX[k];
  return JSON.stringify(out, null, 2);
}

export function importFX(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  for (const k of Object.keys(defaults)) if (typeof obj[k] === 'number') FX[k] = obj[k];
  FX.version++;
  persist();
}

export const FX_DEFAULTS = defaults;
