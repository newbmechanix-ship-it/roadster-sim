import { LOT, ROWS, STALL, BOXES, RAMP } from './layout.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(backend) {
    $('rendererChip').textContent = backend;
    this.el = {
      speed: $('speed'), kmh: $('kmh'), gear: $('gear'), tank: $('tankBar'), thrust: $('thrustBar'),
      fan: $('fanFlag'), wing: $('wingFlag'), air: $('airFlag'), assist: $('assistFlag'), gval: $('gval'), toast: $('toast'),
      t60: $('t60'), t100: $('t100'), tq: $('tq'), b60: $('b60'), claim: $('claim'), timing: $('timing'),
    };
    this.g = $('gcanvas').getContext('2d');
    this.map = $('minimap').getContext('2d');
    this.toastTimer = 0;
    this.gSmooth = { x: 0, y: 0 };
    this.prevVel = null;
    this.frame = 0;
  }

  buildMenu(trims, selected, onSelect) {
    const root = $('trims');
    root.innerHTML = '';
    for (const t of Object.values(trims)) {
      const d = document.createElement('div');
      d.className = 'trim' + (t.id === selected ? ' sel' : '');
      d.innerHTML = `<h3>${t.name.toUpperCase()}</h3><div class="tag">${t.tagline}</div>
        <div class="big">${t.spec.zeroSixty}<small>0–60 MPH</small></div>
        <dl><dt>Top speed</dt><dd>${t.spec.topSpeed}</dd><dt>Range</dt><dd>${t.spec.range}</dd>
        <dt>Seats</dt><dd>${t.spec.seats}</dd><dt>Thrusters</dt><dd>${t.spec.thrusters}</dd>
        <dt>Availability</dt><dd>${t.spec.availability}</dd></dl>`;
      d.addEventListener('click', () => {
        root.querySelectorAll('.trim').forEach(x => x.classList.remove('sel'));
        d.classList.add('sel');
        onSelect(t.id);
      });
      root.appendChild(d);
    }
  }

  showMenu(show) {
    $('menu').classList.toggle('hidden', !show);
    $('hud').classList.toggle('hidden', show);
  }

  setTrim(trim, best) {
    $('trimChip').textContent = trim.name;
    this.el.claim.textContent = `Tesla claim: ${trim.spec.zeroSixty}`;
    this.el.b60.textContent = best.t60 ? best.t60.toFixed(2) + ' s' : '—';
    this.el.t60.textContent = this.el.t100.textContent = this.el.tq.textContent = '—';
    this.trim = trim;
  }

  setCamera(name) { $('camChip').textContent = name; }

  /** Make HUD chips/flags act like their keyboard shortcuts. */
  bindClicks(emit) {
    const map = { trimChip: 'menu', camChip: 'camera', dayChip: 'daynight', soundChip: 'mute', fxChip: 'editor', fanFlag: 'fan', wingFlag: 'wing', assistFlag: 'assist' };
    for (const [id, action] of Object.entries(map)) {
      const el = $(id);
      el.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus on the game
      el.addEventListener('click', (e) => { e.stopPropagation(); emit(action); el.blur(); });
    }
  }
  setDay(day) { $('dayChip').textContent = day ? 'DAY' : 'NIGHT'; }
  setSound(on) { $('soundChip').textContent = on ? 'SOUND ON' : 'SOUND OFF'; }
  toggleHint() { $('hint').classList.toggle('hidden'); }

  armTimer() {
    this.el.timing.classList.add('live');
    this.el.t60.textContent = 'READY';
  }

  setTimes(t, best) {
    const f = (v) => v == null ? '—' : v.toFixed(2) + ' s';
    this.el.t60.textContent = t.t60 != null ? f(t.t60) : (t.t * 1).toFixed(2);
    this.el.t100.textContent = f(t.t100);
    this.el.tq.textContent = t.tq ? `${t.tq.t.toFixed(2)} s · ${t.tq.mph.toFixed(0)}` : '—';
    this.el.b60.textContent = f(best.t60);
  }

  toast(title, sub = '', dur = 2.2) {
    this.el.toast.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
    this.el.toast.classList.add('show');
    this.toastTimer = dur;
  }
  flash(title) { this.toast(title, '', 1.2); }

  update(car, inp, dt) {
    this.frame++;
    const mph = car.speed * 2.23694;
    this.el.speed.textContent = Math.round(mph);
    this.el.kmh.textContent = `${Math.round(car.speed * 3.6)} km/h`;
    const vF = car.forwardSpeed;
    this.el.gear.textContent = vF < -0.5 ? 'R' : (car.speed < 0.2 && inp.throttle === 0 ? 'P' : 'D');
    const trim = car.trim;
    this.el.tank.style.width = trim.tank ? `${(car.tank / trim.tank) * 100}%` : '0%';
    this.el.thrust.style.width = `${Math.min(1, Math.max(car.thrustLevel, car.liftLevel, car.assistLevel)) * 100}%`;
    this.el.fan.classList.toggle('on', car.fanOn);
    this.el.fan.textContent = car.fanOn ? `SUCTION ${car.fanLevel.toFixed(2)} g` : 'SUCTION OFF';
    this.el.assist.classList.toggle('red', car.assistLevel > 0.05 || car.autoLift > 0.05);
    this.el.assist.classList.toggle('on', car.assistEnabled);
    this.el.assist.textContent = car.autoLift > 0.05 ? 'LANDING ASSIST' : (car.assistEnabled ? 'JET ASSIST ON' : 'JET ASSIST OFF');
    this.el.assist.classList.toggle('hidden', !trim.perimeter);
    const wingState = car.wingDeploy < 0.05 ? 'STOWED' : (car.wingAngle > 0.9 && car.wingDeploy > 0.9 ? 'AIRBRAKE' : (car.wingDeploy > 0.95 ? 'UP' : 'MOVING'));
    this.el.wing.textContent = trim.wing ? `WING ${['AUTO', 'TRACK', 'LOW DRAG'][car.wingMode]} · ${wingState}` : 'FLUSH AERO';
    this.el.wing.classList.toggle('on', trim.wing);
    this.el.air.classList.toggle('red', car.groundedWheels === 0);

    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.el.toast.classList.remove('show'); }

    // G-meter
    if (this.prevVel && dt > 0) {
      const ax = (car.vel.x - this.prevVel.x) / dt, az = (car.vel.z - this.prevVel.z) / dt;
      // project into the car frame
      const q = car.quat;
      const fwdX = 2 * (q.x * q.z + q.w * q.y), fwdZ = 1 - 2 * (q.x * q.x + q.y * q.y);
      const len = Math.hypot(fwdX, fwdZ) || 1;
      const lon = (ax * fwdX + az * fwdZ) / len / 9.81;
      const lat = -(ax * fwdZ - az * fwdX) / len / 9.81; // + = toward the right
      const k = 1 - Math.exp(-dt * 10);
      this.gSmooth.x += (lat - this.gSmooth.x) * k;
      this.gSmooth.y += (lon - this.gSmooth.y) * k;
    }
    this.prevVel = car.vel.clone();
    if (this.frame % 2 === 0) this.drawG();
    if (this.frame % 3 === 0) this.drawMap(car);
  }

  drawG() {
    const g = this.g, W = 110, c = W / 2, R = 48, scale = R / 3;
    g.clearRect(0, 0, W, W);
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    for (const r of [1, 2, 3]) { g.beginPath(); g.arc(c, c, r * scale, 0, 7); g.stroke(); }
    g.beginPath(); g.moveTo(c - R, c); g.lineTo(c + R, c); g.moveTo(c, c - R); g.lineTo(c, c + R); g.stroke();
    const x = Math.max(-3, Math.min(3, this.gSmooth.x)), y = Math.max(-3, Math.min(3, this.gSmooth.y));
    g.fillStyle = '#ff2a1a';
    g.shadowColor = '#ff2a1a'; g.shadowBlur = 10;
    g.beginPath(); g.arc(c + x * scale, c - y * scale, 5, 0, 7); g.fill();
    g.shadowBlur = 0;
    this.el.gval.textContent = `${Math.hypot(x, y).toFixed(1)} g`;
  }

  drawMap(car) {
    const g = this.map, W = 180, c = W / 2;
    // map centered on the car, 2 px per 3 m, north (+Z) up
    const s = 0.55;
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(c, c, c - 1, 0, 7); g.clip();
    const P = (x, z) => [c - (x - car.pos.x) * s, c - (z - car.pos.z) * s];
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5;
    const [ax, ay] = P(LOT.xMin, LOT.zMin), [bx, by] = P(LOT.xMax, LOT.zMax);
    g.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (const r of ROWS) {
      const [x0, y0] = P(r.xTo, r.z + STALL.d), [x1, y1] = P(r.xFrom, r.z - STALL.d);
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    for (const b of BOXES) {
      if (b.kind === 'parked' || b.kind === 'island') continue;
      const [x, y] = P(b.x, b.z);
      g.fillStyle = b.kind === 'building' ? 'rgba(255,255,255,0.25)' : 'rgba(255,90,60,0.9)';
      const w = (Math.abs(b.c) * b.w + Math.abs(b.s) * b.d) * s, h = (Math.abs(b.s) * b.w + Math.abs(b.c) * b.d) * s;
      g.fillRect(x - w / 2, y - h / 2, w, h);
    }
    { const [lx, ly] = P(RAMP.x0, RAMP.z0); g.strokeStyle = 'rgba(255,90,60,0.9)'; g.lineWidth = 2; g.strokeRect(lx - RAMP.width / 2 * s, ly - (RAMP.R1 + RAMP.depth) * s, RAMP.width * s, (RAMP.R1 + RAMP.depth) * s); }
    g.restore();
    const x = c, y = c;
    const q = car.quat;
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const a = Math.atan2(-fx, fz);
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 5); g.lineTo(-4, 5); g.closePath(); g.fill();
    g.restore();
  }
}
