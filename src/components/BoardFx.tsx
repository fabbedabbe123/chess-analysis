import { useEffect, useRef, useState } from 'react';
import { usePlay } from '@/stores/playStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { useSettings } from '@/stores/settingsStore';
import { playSound, type SoundKind } from '@/utils/sound';

type Fx = { id: number; kind: 'win' | 'lose' | 'draw' | 'solved' | 'wrong' };

const SOUND: Record<Fx['kind'], SoundKind> = { win: 'win', lose: 'lose', draw: 'draw', solved: 'solved', wrong: 'wrong' };
const CONFETTI = ['#81b64c', '#e0a93a', '#4aa3e0', '#e0524a', '#f2f2f2', '#b07ae0'];

/**
 * Short celebratory / sad effects on top of the board when a game ends or a puzzle is solved or missed.
 * Pure decoration: pointer-events are off and nothing is drawn when the setting is off or motion is reduced.
 * The matching sound is played here as well (when "Move sounds" is on).
 */
export function BoardFx() {
  const settings = useSettings();
  const outcome = usePlay((s) => s.result?.outcome ?? null);
  const puzzlePhase = usePuzzle((s) => s.phase);
  const wrong = usePuzzle((s) => s.wrong);
  const [fx, setFx] = useState<Fx | null>(null);
  const prev = useRef({ outcome, puzzlePhase, wrong });
  const counter = useRef(0);

  useEffect(() => {
    const was = prev.current;
    prev.current = { outcome, puzzlePhase, wrong };
    let kind: Fx['kind'] | null = null;
    if (outcome !== null && was.outcome === null) kind = outcome === 'win' ? 'win' : outcome === 'loss' ? 'lose' : 'draw';
    else if (puzzlePhase === 'solved' && was.puzzlePhase !== 'solved') kind = 'solved';
    else if (puzzlePhase === 'solving' && wrong > was.wrong) kind = 'wrong';
    if (kind === null) return;
    if (settings.soundEnabled) setTimeout(() => playSound(SOUND[kind]), kind === 'wrong' ? 0 : 250);
    if (!settings.winAnimations) return;
    counter.current += 1;
    setFx({ id: counter.current, kind });
    const t = setTimeout(() => setFx(null), kind === 'win' ? 2600 : 1400);
    return () => clearTimeout(t);
  }, [outcome, puzzlePhase, wrong, settings.soundEnabled, settings.winAnimations]);

  if (fx === null) return null;
  return (
    <div className={`board-fx fx-${fx.kind}`} key={fx.id} aria-hidden="true" data-testid="board-fx" data-fx={fx.kind}>
      {(fx.kind === 'win' || fx.kind === 'solved') &&
        Array.from({ length: fx.kind === 'win' ? 36 : 14 }, (_, i) => (
          <span
            key={i}
            className="confetti"
            style={{
              left: `${(i * 37 + 11) % 100}%`,
              background: CONFETTI[i % CONFETTI.length] as string,
              animationDelay: `${((i * 53) % 40) / 100}s`,
              ['--dx' as string]: `${((i * 29) % 80) - 40}px`,
              ['--rot' as string]: `${(i * 97) % 360}deg`,
            }}
          />
        ))}
      <div className="fx-badge">{{ win: '🏆', lose: '💔', draw: '🤝', solved: '✓', wrong: '✗' }[fx.kind]}</div>
    </div>
  );
}
