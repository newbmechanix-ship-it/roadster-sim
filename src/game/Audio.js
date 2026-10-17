// Synthesized audio: electric motor whine, cold-gas thruster hiss, fan hum, tire squeal.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // Motor: two detuned oscillators through a lowpass
    this.motorGain = ctx.createGain(); this.motorGain.gain.value = 0;
    this.motorFilter = ctx.createBiquadFilter(); this.motorFilter.type = 'lowpass'; this.motorFilter.frequency.value = 1200; this.motorFilter.Q.value = 4;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'sine';
    this.osc3 = ctx.createOscillator(); this.osc3.type = 'triangle';
    const g2 = ctx.createGain(); g2.gain.value = 0.6;
    const g3 = ctx.createGain(); g3.gain.value = 0.35;
    this.osc1.connect(this.motorFilter); this.osc2.connect(g2).connect(this.motorFilter); this.osc3.connect(g3).connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain).connect(this.master);
    this.osc1.start(); this.osc2.start(); this.osc3.start();

    // Noise source shared by thrusters, fan, tires and wind
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

    const chain = (type, freq, q) => {
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      noise().connect(f).connect(g).connect(this.master);
      return { f, g };
    };
    this.thruster = chain('highpass', 900, 0.7);
    this.thrusterLow = chain('lowpass', 300, 1);
    this.fan = chain('bandpass', 420, 6);
    this.tire = chain('bandpass', 1400, 9);
    this.wind = chain('lowpass', 500, 0.5);
    // ULTRA compressor: turbine whine + rushing intake air, pitch follows the spool
    this.compOsc = ctx.createOscillator(); this.compOsc.type = 'sawtooth'; this.compOsc.frequency.value = 80;
    this.compF = ctx.createBiquadFilter(); this.compF.type = 'bandpass'; this.compF.Q.value = 3; this.compF.frequency.value = 400;
    this.compG = ctx.createGain(); this.compG.gain.value = 0;
    this.compOsc.connect(this.compF).connect(this.compG).connect(this.master); this.compOsc.start();
    this.compAir = chain('bandpass', 2500, 1.5);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.05;
    const sp = Math.abs(s.speed);
    const base = 60 + sp * 38;
    this.osc1.frequency.setTargetAtTime(base, t, k);
    this.osc2.frequency.setTargetAtTime(base * 2.01, t, k);
    this.osc3.frequency.setTargetAtTime(base * 0.5 + 30, t, k);
    this.motorFilter.frequency.setTargetAtTime(600 + sp * 40 + s.throttle * 1500, t, k);
    this.motorGain.gain.setTargetAtTime(0.05 + s.throttle * 0.16 + Math.min(sp / 100, 1) * 0.06, t, k);
    this.thruster.g.gain.setTargetAtTime(s.thrust * 0.55, t, 0.03);
    this.thrusterLow.g.gain.setTargetAtTime(s.thrust * 0.7, t, 0.03);
    this.fan.g.gain.setTargetAtTime(s.fan ? 0.05 : 0, t, 0.2);
    this.fan.f.frequency.setTargetAtTime(380 + sp * 2, t, 0.2);
    this.tire.g.gain.setTargetAtTime(Math.min(1, s.slip) * 0.22, t, 0.05);
    this.wind.g.gain.setTargetAtTime(Math.min(1, sp / 90) * 0.25, t, 0.1);
    this.wind.f.frequency.setTargetAtTime(300 + sp * 8, t, 0.1);
    const u = s.ultra || 0;
    this.compOsc.frequency.setTargetAtTime(80 + u * u * 1500, t, 0.08);
    this.compF.frequency.setTargetAtTime(300 + u * 2600, t, 0.08);
    this.compG.gain.setTargetAtTime(u * 0.12, t, 0.08);
    this.compAir.g.gain.setTargetAtTime(u * 0.18, t, 0.08);
    this.compAir.f.frequency.setTargetAtTime(1500 + u * 3000, t, 0.08);
  }

  /** Short cold-gas valve burst ("psst") for an attitude-jet pulse. */
  rcsPulse(strength = 1, pan = 0) {
    if (!this.ctx || this.muted || !this.noiseBuf) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.25;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400 + Math.random() * 1000; bp.Q.value = 0.7; // real-speed Semi jump audio: flip hiss centroid ~2.6–3.3 kHz
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    const g = ctx.createGain();
    const peak = 0.32 * strength;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);            // valve snaps open
    g.gain.setValueAtTime(peak, t + 0.06 + 0.08 * strength);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2 + 0.1 * strength); // pressure bleeds off
    let out = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-0.8, Math.min(0.8, -pan * 0.6)); g.connect(p); out = p; }
    src.connect(hp).connect(bp).connect(g);
    out.connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.4);
  }

  /** Kickflip takeoff: all perimeter valves slam open — a deep whump plus a roaring gas blast. */
  blast() {
    if (!this.ctx || this.muted || !this.noiseBuf) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.thud(1.0);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.012);
    g.gain.setValueAtTime(0.9, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + 1.0);
  }

  thud(strength) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    g.gain.setValueAtTime(Math.min(0.9, strength), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.4);
  }

  chime() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.5);
      o.connect(g).connect(this.master); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.6);
    });
  }
}
