export type Sfx = 'click' | 'place' | 'zone' | 'bulldoze' | 'error' | 'cash' | 'notify' | 'gavel';

export interface Ambience {
  /** Camera distance from the ground focus, metres. */
  dist: number;
  population: number;
  /** 0 by day, 1 at night. */
  night: number;
  paused: boolean;
  /** 0..1: how hard it is raining. */
  rain?: number;
}

const MUTE_KEY = 'metropolis.muted';

/**
 * All sound is synthesised with the Web Audio API: no audio files. Ambience is layered
 * filtered noise (wind, city hum), crickets at night and bird calls by day, mixed from
 * how close the camera is and how big the city has grown. Browsers only allow audio after
 * a user gesture, so the graph is built on the first click or key press.
 */
export class GameAudio {
  muted: boolean;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private city: GainNode | null = null;
  private crickets: GainNode | null = null;
  private rain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private birdTimer = 2;

  constructor() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(MUTE_KEY);
    } catch {
      // Storage can be unavailable (private windows); sound simply starts on.
    }
    this.muted = stored === '1';
    const unlock = (): void => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      this.start();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private start(): void {
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.7;
    master.connect(ctx.destination);
    this.master = master;

    // Two seconds of white noise, looped, feeds every noise-based layer.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;

    const layer = (type: BiquadFilterType, freq: number, q: number): GainNode => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(master);
      src.start();
      return gain;
    };
    this.wind = layer('bandpass', 420, 0.4);
    this.city = layer('lowpass', 210, 0.7);
    // Rain: the hiss of the top of the noise spectrum.
    this.rain = layer('highpass', 2400, 0.3);

    // Crickets: a high tone chopped by a fast tremolo.
    const tone = ctx.createOscillator();
    tone.frequency.value = 4300;
    const chop = ctx.createGain();
    chop.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 13;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(chop.gain);
    const out = ctx.createGain();
    out.gain.value = 0;
    tone.connect(chop).connect(out).connect(master);
    tone.start();
    lfo.start();
    this.crickets = out;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Not remembered, but still applied for this session.
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  /** Call every frame with what the camera sees. */
  update(dt: number, a: Ambience): void {
    const ctx = this.ctx;
    if (!ctx || !this.wind || !this.city || !this.crickets) return;
    const t = ctx.currentTime;
    // 1 when hugging the streets, 0 from high above.
    const close = Math.min(1, Math.max(0, 1 - (a.dist - 60) / 900));
    const size = Math.min(1, Math.log10(1 + a.population) / 4.3);
    const live = a.paused ? 0.35 : 1;
    this.wind.gain.setTargetAtTime(0.05 + (1 - close) * 0.2, t, 0.4);
    this.city.gain.setTargetAtTime(size * (0.12 + close * 0.5) * live * (1 - a.night * 0.5), t, 0.4);
    const rain = a.rain ?? 0;
    this.crickets.gain.setTargetAtTime(a.night * close * 0.012 * (1 - size * 0.6) * (1 - rain), t, 0.6);
    this.rain?.gain.setTargetAtTime(rain * (0.05 + close * 0.16), t, 0.8);

    // Birds: an occasional two- or three-note call by day, when close to the ground.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 2.5 + Math.random() * 7;
      if (a.night < 0.3 && close > 0.25 && rain < 0.15 && !this.muted) this.bird(close * (1 - size * 0.5));
    }
  }

  private bird(level: number): void {
    const ctx = this.ctx!;
    const notes = 2 + Math.floor(Math.random() * 3);
    const base = 2200 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const t = ctx.currentTime + i * (0.11 + Math.random() * 0.05);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(base * (1 + Math.random() * 0.25), t);
      osc.frequency.exponentialRampToValueAtTime(base * (0.8 + Math.random() * 0.5), t + 0.08);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03 * level, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  private tone(freq: number, to: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private burst(freq: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.2), ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(ctx.currentTime, Math.random());
    src.stop(ctx.currentTime + dur + 0.02);
  }

  play(kind: Sfx): void {
    if (!this.ctx || !this.master || this.muted) return;
    switch (kind) {
      case 'click':
        this.tone(900, 700, 0.04, 0.06);
        break;
      case 'place':
        this.tone(150, 55, 0.2, 0.3);
        this.burst(1800, 0.09, 0.12);
        break;
      case 'zone':
        this.tone(520, 760, 0.09, 0.08, 'triangle');
        break;
      case 'bulldoze':
        this.burst(900, 0.38, 0.3);
        this.tone(90, 40, 0.3, 0.2);
        break;
      case 'error':
        this.tone(220, 200, 0.09, 0.07, 'square');
        this.tone(165, 150, 0.14, 0.07, 'square', 0.1);
        break;
      case 'notify':
        this.tone(660, 660, 0.12, 0.06, 'sine');
        this.tone(990, 990, 0.22, 0.06, 'sine', 0.12);
        break;
      case 'gavel':
        this.burst(2400, 0.06, 0.25);
        this.tone(220, 120, 0.12, 0.25, 'triangle');
        break;
      case 'cash':
        this.tone(880, 880, 0.07, 0.07, 'triangle');
        this.tone(1320, 1320, 0.14, 0.07, 'triangle', 0.07);
        break;
    }
  }
}
