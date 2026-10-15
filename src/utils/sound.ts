/** Tiny WebAudio blips (no audio files needed). Silent unless the setting is on. */
let ctx: AudioContext | null = null;

export type SoundKind = 'move' | 'capture' | 'check' | 'end';

const FREQ: Record<SoundKind, number> = { move: 330, capture: 220, check: 520, end: 180 };

export function playSound(kind: SoundKind): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === 'capture' ? 'square' : 'sine';
    osc.frequency.value = FREQ[kind];
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  } catch {
    // Audio unavailable (autoplay policy, no device): ignore.
  }
}
