/**
 * Small synthesised sounds (WebAudio, no audio files). Silent unless the "Move sounds" setting is on.
 * Piece sounds are a short filtered noise burst plus a low thump, which reads as a wooden "tock".
 */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

export type SoundKind = 'move' | 'capture' | 'castle' | 'check' | 'end' | 'win' | 'lose' | 'draw' | 'solved' | 'wrong';

function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state !== 'running') void ctx.resume();
  return ctx;
}

/**
 * Browsers (iOS above all) only allow audio after a tap. Call once from the first user gesture: it creates and resumes
 * the AudioContext, plays a silent buffer, and asks Safari to treat the page as media playback so the ring/silent
 * switch does not mute the sounds.
 */
export function unlockAudio(): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession !== undefined) nav.audioSession.type = 'playback';
    const c = audio();
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch {
    // no audio available
  }
}

/** Install a one-time listener that unlocks audio on the first tap, click or key press. */
export function installAudioUnlock(): void {
  const once = () => {
    unlockAudio();
    for (const e of ['pointerdown', 'touchend', 'keydown']) window.removeEventListener(e, once, true);
  };
  for (const e of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(e, once, { capture: true, passive: true });
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise === null) {
    noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.2), c.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 12345; // fixed seed: the contact tick is identical every time
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      d[i] = (seed / 0x80000000) - 1;
    }
  }
  return noise;
}

/** All sounds go through one master gain so the volume setting applies to everything. */
let master: GainNode | null = null;
function out(c: AudioContext): AudioNode {
  if (master === null) {
    master = c.createGain();
    master.connect(c.destination);
  }
  return master;
}

/**
 * A wooden piece set down on a board: a very short bright "tick" (the contact) followed by the dull ringing of the
 * wood (a few quickly damped resonances) and a low thump from the board. Always exactly the same sound, no randomness
 * in the tick (a fixed noise buffer), so every move sounds alike. `body` shifts the pitch: lower = heavier.
 */
function tock(c: AudioContext, at: number, body: number, vol: number): void {
  const t = c.currentTime + at;
  // contact tick: ~10 ms of high-passed noise
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const hp = c.createBiquadFilter();
  hp.type = 'bandpass';
  hp.frequency.value = body * 9;
  hp.Q.value = 0.7;
  const tg = c.createGain();
  tg.gain.setValueAtTime(vol * 0.9, t);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.014);
  src.connect(hp).connect(tg).connect(out(c));
  src.start(t);
  src.stop(t + 0.02);
  // wood resonances: [frequency ratio, level, decay seconds]
  const modes: Array<[number, number, number]> = [[1, 1, 0.085], [2.05, 0.55, 0.06], [3.6, 0.3, 0.04], [5.4, 0.12, 0.025]];
  for (const [ratio, level, decay] of modes) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(body * ratio, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * level * 0.6, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(out(c));
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }
  // board thump
  const th = c.createOscillator();
  const thg = c.createGain();
  th.type = 'sine';
  th.frequency.setValueAtTime(body * 0.55, t);
  th.frequency.exponentialRampToValueAtTime(body * 0.35, t + 0.06);
  thg.gain.setValueAtTime(0.0001, t);
  thg.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.003);
  thg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  th.connect(thg).connect(out(c));
  th.start(t);
  th.stop(t + 0.09);
}

function tone(c: AudioContext, at: number, freq: number, dur: number, type: OscillatorType, vol: number): void {
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out(c));
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** `volume` is 0..1 (the "Sound volume" setting). */
export function playSound(kind: SoundKind, volume = 0.5): void {
  try {
    const c = audio();
    out(c);
    if (master !== null) master.gain.value = Math.max(0, Math.min(1, volume));
    switch (kind) {
      case 'move': tock(c, 0, 240, 0.7); break;
      case 'capture': tock(c, 0, 200, 0.9); tock(c, 0.045, 300, 0.45); break;
      case 'castle': tock(c, 0, 240, 0.7); tock(c, 0.13, 220, 0.7); break;
      case 'check': tock(c, 0, 240, 0.7); tone(c, 0.05, 660, 0.2, 'sine', 0.1); break;
      case 'end': tock(c, 0, 200, 0.9); tone(c, 0.06, 196, 0.5, 'sine', 0.14); break;
      case 'win': [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, i * 0.12, f, 0.5, 'sine', 0.14)); break;
      case 'lose': [392, 349.23, 311.13, 261.63].forEach((f, i) => tone(c, i * 0.18, f, 0.55, 'sine', 0.16)); break;
      case 'draw': tone(c, 0, 440, 0.35, 'sine', 0.12); tone(c, 0.17, 440, 0.45, 'sine', 0.12); break;
      case 'solved': tone(c, 0, 659.25, 0.2, 'sine', 0.13); tone(c, 0.1, 987.77, 0.35, 'sine', 0.13); break;
      case 'wrong': tone(c, 0, 180, 0.25, 'sine', 0.14); tone(c, 0.09, 140, 0.3, 'sine', 0.14); break;
    }
  } catch {
    // Audio unavailable (autoplay policy, no device): ignore.
  }
}
