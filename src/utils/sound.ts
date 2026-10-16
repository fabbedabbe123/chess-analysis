/**
 * Small synthesised sounds (WebAudio, no audio files). Silent unless the "Move sounds" setting is on.
 * Piece sounds are a short filtered noise burst plus a low thump, which reads as a wooden "tock".
 */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

export type SoundKind = 'move' | 'capture' | 'castle' | 'check' | 'end' | 'win' | 'lose' | 'draw' | 'solved' | 'wrong';

function audio(): AudioContext {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise === null) {
    noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.2), c.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** One piece "tock" at `at` seconds from now. */
function tock(c: AudioContext, at: number, pitch: number, vol: number): void {
  const t = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = pitch;
  band.Q.value = 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(band).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + 0.08);
  tone(c, at, pitch / 9, 0.09, 'sine', vol * 0.9);
}

function tone(c: AudioContext, at: number, freq: number, dur: number, type: OscillatorType, vol: number): void {
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function playSound(kind: SoundKind): void {
  try {
    const c = audio();
    switch (kind) {
      case 'move': tock(c, 0, 1900, 0.5); break;
      case 'capture': tock(c, 0, 1400, 0.8); tock(c, 0.045, 2300, 0.45); break;
      case 'castle': tock(c, 0, 1800, 0.5); tock(c, 0.11, 1500, 0.55); break;
      case 'check': tock(c, 0, 1700, 0.6); tone(c, 0.03, 880, 0.18, 'triangle', 0.12); break;
      case 'end': tock(c, 0, 1300, 0.7); tone(c, 0.05, 196, 0.5, 'sine', 0.2); break;
      case 'win': [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, i * 0.11, f, 0.45, 'triangle', 0.16)); break;
      case 'lose': [392, 349.23, 311.13, 261.63].forEach((f, i) => tone(c, i * 0.17, f, 0.5, 'sine', 0.2)); break;
      case 'draw': tone(c, 0, 440, 0.35, 'triangle', 0.14); tone(c, 0.16, 440, 0.45, 'triangle', 0.14); break;
      case 'solved': tone(c, 0, 659.25, 0.18, 'triangle', 0.15); tone(c, 0.09, 987.77, 0.32, 'triangle', 0.15); break;
      case 'wrong': tone(c, 0, 160, 0.22, 'sawtooth', 0.08); tone(c, 0.08, 130, 0.25, 'sawtooth', 0.08); break;
    }
  } catch {
    // Audio unavailable (autoplay policy, no device): ignore.
  }
}
