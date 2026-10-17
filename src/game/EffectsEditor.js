// Thruster effect editor: loops a Rocket kickflip (takeoff burst, differential-thrust roll,
// stabilisation pulses, cushioned landing, cloud dissipation) and exposes every effect
// parameter as a live slider. Changes apply instantly and persist (also in normal play).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FX, FX_SCHEMA, FX_DEFAULTS, setFX, resetFX, exportFX, importFX } from './fxParams.js';

const START = { x: 30, z: -120 };

export class EffectsEditor {
  constructor({ car, effects, camera, canvas, setTrim, getTrimId, onOpen, onClose }) {
    Object.assign(this, { car, effects, camera, setTrim, getTrimId, onOpen, onClose });
    this.active = false;
    this.playing = true;
    this.speed = 1;
    this.loop = true;
    this.rollDir = 1;
    this.camMode = 'side';
    this.t = 0;
    this.kicked = false;
    this.stats = { pulses: 0, apex: 0, flip: null, start: 0 };
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.buildUI();
  }

  // ---------------------------------------------------------------- lifecycle
  toggle() { this.active ? this.close() : this.open(); }

  open() {
    this.active = true;
    this.prevTrim = this.getTrimId();
    if (this.prevTrim !== 'rocket') this.setTrim('rocket'); // kickflip needs the perimeter jets
    this.panel.classList.remove('hidden');
    this.controls.enabled = true;
    this.restart();
    this.setCam(this.camMode);
    this.onOpen?.();
  }

  close() {
    this.active = false;
    this.panel.classList.add('hidden');
    this.controls.enabled = false;
    this.camera.up.set(0, 1, 0);
    if (this.prevTrim && this.prevTrim !== 'rocket') this.setTrim(this.prevTrim);
    this.car.reset(START.x, START.z, 0);
    this.onClose?.();
  }

  restart() {
    this.car.reset(START.x, START.z, 0);
    this.effects.cloud.clear();
    this.t = 0;
    this.kicked = false;
    this.stats = { pulses: 0, apex: 0, flip: null, start: 0 };
  }

  /** Scripted input for the playback: hold still, kickflip, then let the flight computer work. */
  input(simDt) {
    const inp = { throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: false, lift: false, pitch: 0, roll: 0, yawAir: 0, kickflip: false };
    if (!this.active || simDt <= 0) return inp;
    this.t += simDt;
    if (!this.kicked && this.t >= 0.8) {
      this.kicked = true;
      inp.kickflip = true;
      inp.steer = this.rollDir > 0 ? 0.5 : -0.5;
      this.stats.start = this.t;
      this.stats.y0 = this.car.pos.y;
    }
    if (this.kicked) {
      this.stats.apex = Math.max(this.stats.apex, this.car.pos.y - this.stats.y0);
      if (this.stats.flip === null && this.car.flipState === null && this.t - this.stats.start > 1.2) this.stats.flip = this.t - this.stats.start;
    }
    // loop once the cloud has had time to dissipate after landing
    if (this.loop && this.kicked && this.t > 11 && this.car.groundedWheels > 2) this.restart();
    return inp;
  }

  get simScale() { return this.active && this.playing ? this.speed : 0; }

  onPulses(n) { this.stats.pulses += n; }

  // ---------------------------------------------------------------- camera
  setCam(mode) {
    this.camMode = mode;
    const c = this.camera, p = this.car.pos;
    c.up.set(0, 1, 0);
    // frame the whole jump arc (ground cloud to the ~14 m apex)
    const tgt = new THREE.Vector3(START.x, 6.5, START.z + 2);
    const pos = {
      side: [START.x - 40, 7, START.z + 3],
      front: [START.x + 4, 6, START.z + 40],
      top: [START.x + 0.1, 46, START.z + 2],
      follow: [p.x - 14, p.y + 4, p.z - 10],
      orbit: [c.position.x, c.position.y, c.position.z],
    }[mode];
    if (mode !== 'orbit') c.position.set(...pos);
    this.controls.target.copy(mode === 'follow' ? p : tgt);
    c.fov = 45; c.updateProjectionMatrix();
    this.controls.update();
    for (const b of this.panel.querySelectorAll('[data-cam]')) b.classList.toggle('sel', b.dataset.cam === mode);
  }

  updateCamera(dt) {
    if (this.camMode === 'follow') {
      const p = this.car.pos;
      this.controls.target.lerp(new THREE.Vector3(p.x, p.y + 0.5, p.z), 1 - Math.exp(-dt * 6));
    }
    this.controls.update();
  }

  // ---------------------------------------------------------------- UI
  buildUI() {
    const css = document.createElement('style');
    css.textContent = `
      #fxEditor { position: fixed; top: 0; left: 0; bottom: 0; width: 360px; z-index: 30; overflow-y: auto;
        background: rgba(8,9,11,0.88); border-right: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(8px);
        color: #e8e8e8; font: 12px "Segoe UI", Arial, sans-serif; padding: 14px 14px 40px; }
      #fxEditor h2 { margin: 0 0 2px; font-weight: 400; letter-spacing: 0.25em; font-size: 14px; }
      #fxEditor .sub { color: #8b8e94; font-size: 10px; letter-spacing: 0.12em; margin-bottom: 10px; }
      #fxEditor .row { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; align-items: center; }
      #fxEditor button { background: #1b1d21; color: #e8e8e8; border: 1px solid rgba(255,255,255,0.18); padding: 5px 9px;
        font: inherit; font-size: 11px; cursor: pointer; letter-spacing: 0.06em; }
      #fxEditor button:hover { border-color: rgba(255,255,255,0.5); }
      #fxEditor button.sel, #fxEditor button.primary { background: #ff2a1a; border-color: #ff2a1a; color: #fff; }
      #fxEditor .stats { font: 11px Consolas, monospace; color: #b8bcc2; background: rgba(255,255,255,0.04); padding: 8px; line-height: 1.6; margin: 8px 0; white-space: pre; }
      #fxEditor details { border-top: 1px solid rgba(255,255,255,0.1); padding: 6px 0; }
      #fxEditor summary { cursor: pointer; letter-spacing: 0.14em; font-size: 11px; text-transform: uppercase; color: #fff; padding: 4px 0; }
      #fxEditor summary .rst { float: right; color: #8b8e94; font-size: 10px; text-transform: none; letter-spacing: 0; }
      #fxEditor .s { display: grid; grid-template-columns: 1fr 54px; gap: 2px 8px; align-items: center; margin: 6px 0 2px; }
      #fxEditor .s label { color: #c8cbd0; font-size: 11px; }
      #fxEditor .s input[type=range] { grid-column: 1 / 3; width: 100%; accent-color: #ff2a1a; }
      #fxEditor .s .v { text-align: right; font: 11px Consolas, monospace; color: #fff; }
      #fxEditor .s.changed label { color: #ff8a7a; }
      #fxEditor textarea { width: 100%; height: 90px; background: #111; color: #ddd; border: 1px solid #333; font: 10px Consolas, monospace; }
      #fxEditor .phase { display: inline-block; padding: 2px 8px; border: 1px solid #ff2a1a; color: #ff8a7a; font-size: 10px; letter-spacing: 0.15em; }
    `;
    document.head.appendChild(css);
    const el = this.panel = document.createElement('div');
    el.id = 'fxEditor';
    el.className = 'hidden';
    el.innerHTML = `
      <h2>THRUSTER FX EDITOR</h2>
      <div class="sub">Kickflip playback · live sliders · K / Esc to close</div>
      <div class="row">
        <button data-act="play" class="primary">❚❚ PAUSE</button>
        <button data-act="restart">↺ RESTART</button>
        <button data-act="step">STEP ▸</button>
        <button data-act="dir">ROLL ⟳ RIGHT</button>
        <label style="margin-left:auto"><input type="checkbox" data-act="loop" checked> loop</label>
      </div>
      <div class="s"><label>Playback speed</label><span class="v" data-v="speed">1.00×</span>
        <input type="range" min="0.1" max="1" step="0.05" value="1" data-speed></div>
      <div class="row">
        <button data-cam="side">SIDE</button><button data-cam="front">FRONT</button><button data-cam="top">TOP</button>
        <button data-cam="follow">FOLLOW</button><button data-cam="orbit">FREE ORBIT</button>
      </div>
      <div class="row"><span class="phase" data-phase>READY</span></div>
      <div class="stats" data-stats></div>
      <div data-groups></div>
      <details><summary>Presets</summary>
        <div class="row"><button data-act="export">COPY JSON</button><button data-act="import">APPLY JSON BELOW</button><button data-act="resetall">RESET ALL</button></div>
        <textarea data-json placeholder="Paste a preset JSON here, then Apply"></textarea>
      </details>
      <div class="row" style="margin-top:12px"><button data-act="close">CLOSE EDITOR</button></div>`;
    document.body.appendChild(el);

    const groups = el.querySelector('[data-groups]');
    this.sliders = {};
    FX_SCHEMA.forEach((g, gi) => {
      const d = document.createElement('details');
      if (gi < 3) d.open = true;
      const sum = document.createElement('summary');
      sum.innerHTML = `${g.group}<span class="rst" data-reset="${gi}">reset</span>`;
      d.appendChild(sum);
      for (const it of g.items) {
        const row = document.createElement('div');
        row.className = 's';
        row.innerHTML = `<label title="${it.key}">${it.label}</label><span class="v"></span>
          <input type="range" min="${it.min}" max="${it.max}" step="${it.step}">`;
        const input = row.querySelector('input'), val = row.querySelector('.v');
        const show = () => {
          const v = FX[it.key];
          val.textContent = it.int ? String(Math.round(v)) : (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(it.step < 0.01 ? 3 : 2));
          row.classList.toggle('changed', Math.abs(v - FX_DEFAULTS[it.key]) > it.step * 0.5);
        };
        input.value = FX[it.key];
        input.addEventListener('input', () => { setFX(it.key, it.int ? Math.round(+input.value) : +input.value); show(); });
        input.addEventListener('dblclick', () => { setFX(it.key, FX_DEFAULTS[it.key]); input.value = FX[it.key]; show(); });
        show();
        this.sliders[it.key] = { input, show };
        d.appendChild(row);
      }
      groups.appendChild(d);
    });

    const refreshAll = () => { for (const [k, s] of Object.entries(this.sliders)) { s.input.value = FX[k]; s.show(); } };
    el.addEventListener('click', (e) => {
      const r = e.target.closest('[data-reset]');
      if (r) { e.preventDefault(); resetFX(FX_SCHEMA[+r.dataset.reset].items.map(i => i.key)); refreshAll(); return; }
      const cam = e.target.closest('[data-cam]');
      if (cam) { this.setCam(cam.dataset.cam); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'play') { this.playing = !this.playing; b.textContent = this.playing ? '❚❚ PAUSE' : '▶ PLAY'; }
      else if (act === 'restart') this.restart();
      else if (act === 'step') { this.playing = false; el.querySelector('[data-act=play]').textContent = '▶ PLAY'; this.stepOnce = true; }
      else if (act === 'dir') { this.rollDir *= -1; b.textContent = this.rollDir > 0 ? 'ROLL ⟳ RIGHT' : 'ROLL ⟲ LEFT'; this.restart(); }
      else if (act === 'export') { const j = exportFX(); el.querySelector('[data-json]').value = j; navigator.clipboard?.writeText(j).catch(() => {}); }
      else if (act === 'import') { try { importFX(el.querySelector('[data-json]').value); refreshAll(); } catch (err) { el.querySelector('[data-json]').value = 'Invalid JSON: ' + err.message; } }
      else if (act === 'resetall') { resetFX(); refreshAll(); }
      else if (act === 'close') this.close();
    });
    el.querySelector('[data-act=loop]').addEventListener('change', (e) => { this.loop = e.target.checked; });
    const sp = el.querySelector('[data-speed]');
    sp.addEventListener('input', () => { this.speed = +sp.value; el.querySelector('[data-v=speed]').textContent = this.speed.toFixed(2) + '×'; });
    // keep keyboard shortcuts for the game from firing while dragging sliders
    el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  /** Per-frame UI refresh (phase label + stats). */
  updateUI(timing) {
    if (!this.active) return;
    const c = this.car;
    let phase = 'READY';
    if (this.kicked) {
      if (c.popTimer > 0) phase = 'TAKEOFF BURST';
      else if (c.flipState === 'spinup') phase = 'ROLL SPIN-UP (one side)';
      else if (c.flipState === 'coast') phase = 'COAST — JETS OFF';
      else if (c.flipState === 'spindown') phase = 'ROLL BRAKE (other side)';
      else if (c.autoLift > 0.05) phase = 'LANDING BURN';
      else if (c.groundedWheels === 0) phase = 'STABILISING (pulses)';
      else phase = 'LANDED — CLOUD DISSIPATING';
    }
    this.panel.querySelector('[data-phase]').textContent = phase;
    const cl = this.effects.cloud;
    const air = this.car.tank / 1000;
    this.panel.querySelector('[data-stats]').textContent =
      `time        ${(this.t - (this.stats.start || 0.8)).toFixed(2)} s\n` +
      `height      ${(c.pos.y - c.cgHeight).toFixed(2)} m   apex ${this.stats.apex.toFixed(1)} m\n` +
      `flip done   ${this.stats.flip ? this.stats.flip.toFixed(2) + ' s' : '—'}\n` +
      `pulses      ${this.stats.pulses}\n` +
      `cloud tris  ${Math.round(cl.vcount / 3)}   area ${cl.sideArea?.toFixed(1) ?? '—'} m²\n` +
      `worker      ${((cl.timing?.physics || 0) + (cl.timing?.mesh || 0)).toFixed(1)} ms\n` +
      `air tank    ${air.toFixed(0)} kN·s`;
  }
}
