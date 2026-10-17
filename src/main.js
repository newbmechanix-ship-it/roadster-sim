import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { TRIMS } from './game/trims.js';
import { Vehicle } from './game/Vehicle.js';
import { World, buildEnvironmentMap } from './game/World.js';
import { Effects, setEffectsDay } from './game/Effects.js';
import { CameraRig } from './game/CameraRig.js';
import { GameAudio } from './game/Audio.js';
import { Input } from './game/Input.js';
import { HUD } from './game/HUD.js';
import { EffectsEditor } from './game/EffectsEditor.js';
import { FX } from './game/fxParams.js';
import { SPAWN, LAUNCH, BOXES, RAMP } from './game/layout.js';
import { createRoadster as createPlaceholder } from './car/PlaceholderRoadster.js';

// The dedicated model lives in ./car/RoadsterModel.js; fall back to the placeholder if absent.
const modelModules = import.meta.glob('./car/RoadsterModel.js');

const canvas = document.getElementById('c');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
await renderer.init();
const backendName = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 fallback';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
const envNight = buildEnvironmentMap(renderer, false);
const envDay = buildEnvironmentMap(renderer, true);
scene.environment = envNight;
scene.environmentIntensity = 0.9;

// Lighting: moonlit night + floodlight that follows the car for shadows
const hemi = new THREE.HemisphereLight(0x6070a0, 0x08080a, 0.22);
scene.add(hemi);
const flood = new THREE.DirectionalLight(0xfff2e0, 0.9);
flood.castShadow = true;
flood.shadow.mapSize.set(2048, 2048);
Object.assign(flood.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 200 });
flood.shadow.bias = -0.0004;
flood.shadow.normalBias = 0.02;
scene.add(flood, flood.target);

const world = new World(scene);
const effects = new Effects(scene);
const rig = new CameraRig(camera);
const audio = new GameAudio();
const input = new Input();
const hud = new HUD(backendName);

// Post-processing: bloom for LEDs, thrusters and light bars
const pipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
const bloomPass = bloom(sceneColor, 0.45, 0.35, 0.9);
pipeline.outputNode = sceneColor.add(bloomPass);

// Day / night
let isDay = localStorage.getItem('rdstr.day') === '1';
function applyTimeOfDay() {
  world.setDay(isDay);
  setEffectsDay(isDay);
  scene.environment = isDay ? envDay : envNight;
  scene.environmentIntensity = isDay ? 1.0 : 0.9;
  hemi.color.set(isDay ? 0xbcd2ee : 0x6070a0);
  hemi.groundColor.set(isDay ? 0x4a4436 : 0x08080a);
  hemi.intensity = isDay ? 1.1 : 0.15;
  flood.color.set(isDay ? 0xfff1dc : 0xeef2ff);
  flood.intensity = isDay ? 3.2 : 0.45;
  renderer.toneMappingExposure = isDay ? 0.9 : 1.0;
  bloomPass.strength.value = isDay ? 0.12 : 0.45;
  hud.setDay(isDay);
  if (headLight) headLight.intensity = isDay ? 40 : 260;
}

// ---------------------------------------------------------------- car
let trimId = localStorage.getItem('rdstr.trim') || 'thrust';
if (!TRIMS[trimId]) trimId = 'thrust';
const car = new Vehicle(TRIMS[trimId]);
car.reset(SPAWN.x, SPAWN.z, SPAWN.yaw);
let model = null, parts = null, wheelRestY = {};
let headLight = null;
let cabinLight = null;
let createRoadster = createPlaceholder;
let usingPlaceholder = true;

async function loadModelFactory() {
  const loader = modelModules['./car/RoadsterModel.js'];
  if (!loader) return;
  try {
    const mod = await loader();
    if (typeof mod.createRoadster === 'function') { createRoadster = mod.createRoadster; usingPlaceholder = false; }
  } catch (e) {
    console.warn('RoadsterModel failed to load, using placeholder', e);
  }
}

function buildCar() {
  if (model) { scene.remove(model); model.traverse(o => o.geometry?.dispose?.()); }
  let m;
  try { m = createRoadster({ trim: trimId, wheelStyle: 'spoke' }); }
  catch (e) { console.error('createRoadster threw, using placeholder', e); m = createPlaceholder({ trim: trimId }); }
  model = m;
  parts = model.userData.parts;
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(model);
  // Align physics wheel positions with the model's wheel pivots
  wheelRestY = {};
  for (const w of car.wheels) {
    const p = parts.wheels[w.id];
    if (!p) continue;
    wheelRestY[w.id] = p.position.y;
    w.local.x = p.position.x;
    w.local.z = p.position.z;
  }
  const dims = model.userData.dims;
  if (dims?.wheelRadius) car.wheelRadius = dims.wheelRadius;
  // Headlight
  headLight = new THREE.SpotLight(0xf4f6ff, 260, 120, 0.5, 0.6, 1.8);
  headLight.position.set(0, 0.6, 2.4); // just ahead of the nose, so it lights the road, not the bodywork
  headLight.target.position.set(0, -0.6, 20);
  headLight.castShadow = false;
  model.add(headLight, headLight.target);
  // Soft cabin/ambient light for the cockpit view (always present so toggling it never
  // changes the light count and forces a shader recompile; only its intensity changes)
  cabinLight = new THREE.PointLight(0xfff1e2, 0, 3.2, 2);
  const eye = model.userData.cockpitEye;
  cabinLight.position.set(0, (eye?.[1] ?? 0.93) + 0.2, (eye?.[2] ?? -0.1) + 0.05); // roof lamp
  model.add(cabinLight);
  effects.attachJets(parts.thrusters || {});
  doorT = 0; doorTarget = 0;
}

// Pre-compile every GPU pipeline the game can need (jet cores, vapor sprites, light pools,
// day and night lighting/environment) behind the loading screen, so nothing hitches the
// first time thrusters fire or day/night is toggled. Frames go through the real render
// pipeline so the same render targets and shadow passes are used as during play.
async function warmUp() {
  const loading = document.getElementById('loading');
  loading.textContent = 'Compiling shaders…';
  const saved = isDay;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  for (const d of [!saved, saved]) {
    isDay = d;
    applyTimeOfDay();
    for (const o of world.nightOnly) o.visible = true;
    effects.warmFrames = 3;
    for (let i = 0; i < 3; i++) {
      tmpWarm.set(0, -car.cgHeight, 0).applyQuaternion(car.quat);
      model.position.copy(car.pos).add(tmpWarm);
      model.quaternion.copy(car.quat);
      model.updateMatrixWorld(true);
      effects.updateJets(car, 0);
      effects.emitJets(car, 1 / 60);
      effects.update(1 / 60, car);
      rig.update(1 / 60, car, model);
      pipeline.render();
      await frame();
    }
  }
  isDay = saved;
  applyTimeOfDay();
  effects.warmFrames = 0;
}
const tmpWarm = new THREE.Vector3();

function setTrim(id) {
  trimId = id;
  localStorage.setItem('rdstr.trim', id);
  car.setTrim(TRIMS[id]);
  buildCar();
  effects.warmFrames = 3; // compile the new trim's pipelines while the menu is still up
  hud.setTrim(TRIMS[id], bestFor(id));
}

// ---------------------------------------------------------------- timing / stunts
const best = JSON.parse(localStorage.getItem('rdstr.best') || '{}');
const bestFor = id => best[id] || {};
const timer = { state: 'idle', still: 0, t: 0, dist: 0, last: car.pos.clone(), t60: null, t100: null, tq: null };
function updateTiming(dt) {
  const mph = car.speed * 2.23694;
  if (timer.state !== 'running') {
    if (car.speed < 0.15 && car.groundedWheels > 2) timer.still += dt; else timer.still = 0;
    if (timer.still > 0.4 && timer.state !== 'armed') { timer.state = 'armed'; hud.armTimer(); }
    if (timer.state === 'armed' && car.speed > 0.3) {
      Object.assign(timer, { state: 'running', t: 0, dist: 0, t60: null, t100: null, tq: null });
      timer.last.copy(car.pos);
    }
    return;
  }
  timer.t += dt;
  timer.dist += timer.last.distanceTo(car.pos);
  timer.last.copy(car.pos);
  const b = best[trimId] || (best[trimId] = {});
  if (timer.t60 === null && mph >= 60) {
    timer.t60 = timer.t;
    if (!b.t60 || timer.t < b.t60) { b.t60 = timer.t; save(); hud.toast(`${timer.t.toFixed(2)} s`, '0–60 MPH · NEW BEST'); audio.chime(); }
    else hud.toast(`${timer.t.toFixed(2)} s`, '0–60 MPH');
  }
  if (timer.t100 === null && mph >= 100) { timer.t100 = timer.t; if (!b.t100 || timer.t < b.t100) { b.t100 = timer.t; save(); } }
  if (timer.tq === null && timer.dist >= 402.336) {
    timer.tq = { t: timer.t, mph };
    if (!b.tq || timer.t < b.tq) { b.tq = timer.t; save(); }
    hud.toast(`${timer.t.toFixed(2)} s @ ${mph.toFixed(0)}`, 'QUARTER MILE');
    audio.chime();
  }
  hud.setTimes(timer, b);
  const done = timer.tq !== null;
  if (done || input.state.brake > 0.3 || timer.t > 30 || car.groundedWheels === 0 && timer.t60 === null) {
    timer.state = 'idle';
    timer.still = 0;
  }
}
function save() { localStorage.setItem('rdstr.best', JSON.stringify(best)); }

const stunt = { roll: 0, pitch: 0, yaw: 0 };
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
function updateStunts(dt) {
  if (car.groundedWheels === 0) {
    _fwd.set(0, 0, 1).applyQuaternion(car.quat);
    _right.set(1, 0, 0).applyQuaternion(car.quat);
    stunt.roll += car.angVel.dot(_fwd) * dt;
    stunt.pitch += car.angVel.dot(_right) * dt;
  }
  for (const e of car.events) {
    if (e === 'jump') { audio.blast(); rig.shake = 0.5; effects.burst(car.pos, 40); }
    else if (e === 'kickflip') { hud.flash('KICKFLIP'); audio.blast(); rig.shake = 0.5; effects.burst(car.pos, 40); }
    else if (e.type === 'land') {
      _up.set(0, 1, 0).applyQuaternion(car.quat);
      const rolls = Math.round(Math.abs(stunt.roll) / (Math.PI * 2));
      const flips = Math.round(Math.abs(stunt.pitch) / (Math.PI * 2));
      const clean = _up.y > 0.8;
      let title = '';
      if (rolls) title = rolls > 1 ? `${rolls}× BARREL ROLL` : (Math.abs(stunt.roll) > 5 ? 'KICKFLIP' : 'BARREL ROLL');
      if (flips) title = (title ? title + ' + ' : '') + (flips > 1 ? `${flips}× FLIP` : (stunt.pitch < 0 ? 'FRONTFLIP' : 'BACKFLIP'));
      if (!title && e.airtime > 1.2) title = 'BIG AIR';
      if (title || e.airtime > 1.2) hud.toast(title || 'AIR', `${e.airtime.toFixed(1)} s airtime · ${clean ? 'CLEAN LANDING' : 'SKETCHY'}`);
      audio.thud(Math.min(1, e.impact / 12 + 0.2));
      rig.shake = Math.min(0.6, e.impact * 0.04);
      stunt.roll = stunt.pitch = 0;
      car.lastImpact = 0;
    } else if (e.type === 'crash') {
      audio.thud(Math.min(1, e.speed / 20));
      rig.shake = Math.min(0.8, e.speed * 0.03);
    }
  }
  if (car.groundedWheels > 0) { stunt.roll = 0; stunt.pitch = 0; }
  car.events.length = 0;
}

// ---------------------------------------------------------------- doors
let doorT = 0, doorTarget = 0;

// ---------------------------------------------------------------- menu
let running = false;
hud.buildMenu(TRIMS, trimId, (id) => { if (id !== trimId) setTrim(id); });
document.getElementById('startBtn').addEventListener('click', () => {
  audio.start();
  hud.showMenu(false);
  running = true;
});

input.on('menu', () => { if (editor.active) { editor.close(); return; } hud.showMenu(true); running = false; });
input.on('camera', () => { rig.next(); hud.setCamera(rig.modeName); });
input.on('reset', () => resetCar());
input.on('fan', () => { car.fanOn = !car.fanOn; hud.toast(car.fanOn ? 'SUCTION ON' : 'SUCTION OFF', 'multi-mode fan system', 0.9); });
input.on('wing', () => { car.wingMode = (car.wingMode + 1) % 3; });
input.on('doors', () => { if (car.speed < 1) doorTarget = doorTarget ? 0 : 1; });
input.on('mute', () => { audio.setMuted(!audio.muted); hud.setSound(!audio.muted); });
input.on('assist', () => { car.assistEnabled = !car.assistEnabled; hud.toast(car.assistEnabled ? 'JET ASSIST ON' : 'JET ASSIST OFF', car.trim.perimeter ? 'fires above ~120 mph under hard braking / cornering' : 'Rocket trim only', 1.2); });
hud.bindClicks((a) => input.emit(a));
input.on('daynight', () => { isDay = !isDay; localStorage.setItem('rdstr.day', isDay ? '1' : '0'); applyTimeOfDay(); });
input.on('help', () => hud.toggleHint());
let tpIndex = 0;
input.on('teleport', () => {
  tpIndex = (tpIndex + 1) % 4;
  if (tpIndex === 1) { car.reset(LAUNCH.xStart, LAUNCH.z, Math.PI / 2); hud.toast('LAUNCH LANE', 'quarter mile along the south fence'); }
  else if (tpIndex === 2) { const s = BOXES.find(b => b.kind === 'semi'); car.reset(s.x, s.z - 45, 0); hud.toast('SEMI JUMP', 'Rocket: Q to kickflip over it · E to fly'); }
  else if (tpIndex === 3) { car.reset(RAMP.x0, RAMP.z0 - 60, 0); hud.toast('VERTICAL RAMP', car.trim.perimeter ? 'drive up at ~25–35 mph · suction holds you on · thrusters roll you upright off the lip' : 'suction holds you on upside down · the lip needs the Rocket’s thrusters, so you roll back down'); }
  else { car.reset(SPAWN.x, SPAWN.z, SPAWN.yaw); hud.toast('PARKING LOT', ''); }
});

function resetCar() {
  const yaw = Math.atan2(_fwd.set(0, 0, 1).applyQuaternion(car.quat).x, _fwd.z);
  car.reset(car.pos.x, car.pos.z, yaw);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- loop
await loadModelFactory();
buildCar();
applyTimeOfDay();
await warmUp();
hud.setTrim(TRIMS[trimId], bestFor(trimId));
hud.setCamera(rig.modeName);
if (usingPlaceholder) console.info('Using placeholder Roadster model');
document.getElementById('loading').classList.add('hidden');

// Thruster FX editor (K, the FX EDITOR chip, or the menu button)
const editor = new EffectsEditor({
  car, effects, camera, canvas,
  setTrim: (id) => setTrim(id), getTrimId: () => trimId,
  onOpen: () => { hud.showMenu(false); document.getElementById('hud').classList.add('hidden'); audio.start(); },
  onClose: () => { document.getElementById('hud').classList.remove('hidden'); running = true; },
});
input.on('editor', () => editor.toggle());
document.getElementById('fxMenuBtn')?.addEventListener('click', () => editor.open());
window.__game = { car, rig, input, hud, scene, renderer, effects, camera, pipeline, editor, paused: false, get model() { return model; } };
const clock = new THREE.Timer();
const STEP = 1 / 240;
let acc = 0;
const tmpV = new THREE.Vector3();
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false, jump: false };

let ultraWas = false, ultraFull = false;
const perf = window.__perf = { phys: 0, fx: 0, render: 0, total: 0 };
renderer.setAnimationLoop(() => {
  const tStart = performance.now();
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  if (window.__game.paused) { pipeline.render(); return; } // debug: external script drives the sim
  input.poll();
  // FX editor playback runs on scaled sim time (slow motion / pause / frame step)
  const ed = editor.active;
  let simDt = dt;
  if (ed) { simDt = editor.stepOnce ? 1 / 60 : dt * editor.simScale; editor.stepOnce = false; }
  const inp = ed ? editor.input(simDt) : (running ? input.state : idle);

  // Fixed-step physics
  acc += simDt;
  let kick = inp.kickflip, jump = inp.jump;
  while (acc >= STEP) {
    car.step(STEP, { ...inp, kickflip: kick, jump });
    kick = jump = false;
    acc -= STEP;
  }
  if (kick === false) input.state.kickflip = false;
  if (jump === false) input.state.jump = false;
  const hold = window.__game?.hold;
  if (hold) {
    car.pos.set(hold.x, hold.y, hold.z);
    car.quat.setFromEuler(new THREE.Euler(hold.pitch || 0, hold.yaw || 0, hold.roll || 0, 'YXZ'));
    car.vel.set(0, 0, 0); car.angVel.set(0, 0, 0);
    car.liftLevel = hold.lift || 0; car.thrustLevel = hold.thrust || 0;
    car.controlTorque.set(hold.tx || 0, hold.ty || 0, hold.tz || 0);
    for (const w of car.wheels) w.compression = 0;
  }
  const tPhys = performance.now();

  // Sync model
  if (model) {
    tmpV.set(0, -car.cgHeight, 0).applyQuaternion(car.quat);
    model.position.copy(car.pos).add(tmpV);
    model.quaternion.copy(car.quat);
    for (const w of car.wheels) {
      const p = parts.wheels[w.id];
      if (!p) continue;
      p.position.y = (wheelRestY[w.id] ?? 0.36) + (w.compression - 0.06);
      if (w.front) p.rotation.y = car.steer;
      const spin = p.userData.spin || p;
      spin.rotation.x = w.spin;
    }
    // Doors / wing / lights
    if (car.speed > 2) doorTarget = 0;
    doorT += (doorTarget - doorT) * Math.min(1, dt * 3);
    parts.doors?.left?.userData.open?.(doorT);
    parts.doors?.right?.userData.open?.(doorT);
    if (parts.wing) {
      const wu = parts.wing.userData, d = car.wingDeploy;
      if (wu.setDeploy) {
        wu.setDeploy(d);                                   // model-native stow/deploy
      } else {
        // interim until the model exposes setDeploy: sink the wing into the deck and hide it stowed
        wu.baseY ??= parts.wing.position.y;
        parts.wing.position.y = wu.baseY - (1 - d) * 0.5;
        parts.wing.visible = !car.trim.wing || d > 0.04;
      }
      wu.setAngle?.(-0.05 - car.wingAngle * 0.4 * d);
      wu.setRaised?.(Math.min(1, d * (0.4 + car.wingAngle * 0.6)));
    }
    const braking = inp.brake > 0.1 && car.forwardSpeed > 0.5;
    if (parts.lights?.brake?.material) parts.lights.brake.material.emissiveIntensity = braking ? 9 : 0.4;
    if (parts.lights?.tail?.material) parts.lights.tail.material.emissiveIntensity = 4;

  }

  // Thruster effects (after the model is posed so marker transforms are current)
  if (model) {
    model.updateMatrixWorld(true);
    effects.updateJets(car, simDt);
    effects.emitJets(car, simDt);
  }

  // Tire smoke
  let slip = 0;
  for (const w of car.wheels) {
    if (!w.contact) continue;
    slip = Math.max(slip, w.slip);
    if (w.slip > 0.1) effects.tireSmoke(w.contactPoint, car.vel, w.slip, simDt);
  }
  effects.update(simDt, car);
  if (ed) editor.onPulses(effects.pulseEvents.length);
  for (const e of effects.pulseEvents) audio.rcsPulse(e.strength * FX.pulseVolume, e.pan);
  effects.pulseEvents.length = 0;

  if (running && !ed) { updateTiming(dt); updateStunts(dt); }

  if (ed) { editor.updateCamera(dt); editor.updateUI(); } else rig.update(dt, car, model);
  if (cabinLight) cabinLight.intensity = rig.modeName === 'Cockpit' ? (isDay ? 0.3 : 0.8) : 0;
  if (hold?.cam) { camera.position.set(...hold.cam); camera.lookAt(car.pos.x, car.pos.y + (hold.lookDy || 0), car.pos.z); camera.fov = hold.fov || 40; camera.updateProjectionMatrix(); }

  // Shadow light follows the car
  if (isDay) flood.position.set(car.pos.x + 45, car.pos.y + 70, car.pos.z - 35);
  else flood.position.set(car.pos.x + 6, car.pos.y + 45, car.pos.z + 4); // overhead pole light
  flood.target.position.copy(car.pos);

  audio.update({ speed: car.speed, throttle: inp.throttle, thrust: Math.min(1, Math.max(car.thrustLevel, car.liftLevel, car.assistLevel, car.popTimer > 0 ? 1 : 0, car.rollBurn ? 0.7 : 0)), fan: car.fanOn, slip, ultra: car.ultraSpool || 0 });
  // super recharger feedback (T toggles it; while on it auto-refills whenever the tanks aren't full)
  const ultraOn = !!input.state.ultra;
  if (ultraOn !== ultraWas) hud.toast(ultraOn ? 'SUPER RECHARGER ON' : 'SUPER RECHARGER OFF', ultraOn ? (car.trim.tank ? 'auto-refills the air tanks in ~3 s' : 'this trim has no air tanks') : 'normal onboard compressor', 1.6);
  if (ultraOn && car.trim.tank && car.tank >= car.trim.tank && !ultraFull && car.ultraSpool > 0.5) { hud.toast('TANKS FULL', '', 1.0); ultraFull = true; }
  if (!ultraOn || car.tank < car.trim.tank * 0.98) ultraFull = false;
  ultraWas = ultraOn;
  hud.el.tank.style.boxShadow = car.ultraSpool > 0.02 ? `0 0 ${(4 + 10 * car.ultraSpool).toFixed(1)}px rgba(120,220,255,${(0.4 + 0.6 * car.ultraSpool).toFixed(2)})` : '';
  hud.update(car, inp, dt);
  const tR = performance.now();
  pipeline.render();
  const tEnd = performance.now();
  const k = 0.05;
  perf.phys += (tPhys - tStart - perf.phys) * k;
  perf.fx += (tR - tPhys - perf.fx) * k;
  perf.render += (tEnd - tR - perf.render) * k;
});
