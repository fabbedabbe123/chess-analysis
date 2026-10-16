import { currentFen, useGame } from '@/stores/gameStore';
import { headlineScore, useEngine } from '@/stores/engineStore';
import { useSetting } from '@/stores/settingsStore';
import { useOrientation } from '@/stores/puzzleStore';
import { usePlay } from '@/stores/playStore';
import { describeScore, evalBarWhiteShare, formatScore } from '@/analysis/eval';

/**
 * Vertical evaluation bar. Convention: the WHITE part is always the share of
 * White's winning chances (cp -> win% model), growing from White's side of the board.
 * With the board flipped, the bar flips with it so White stays on White's side.
 */
export function EvalBar() {
  const fen = useGame((s) => currentFen(s));
  const engineScore = useEngine((s) => headlineScore(s, fen));
  const playOpen = usePlay((s) => s.phase !== 'off');
  const showPlayEval = usePlay((s) => s.settings.showEval);
  const playScore = usePlay((s) => s.evals[fen]?.score ?? null);
  const score = playOpen ? (showPlayEval ? playScore : null) : engineScore;
  const analyzing = useEngine((s) => s.analyzing);
  const mode = useSetting('evalDisplay');
  const orientation = useOrientation();
  const share = evalBarWhiteShare(score);
  const whiteOnTop = orientation === 'black';
  const label = formatScore(score, mode);
  const whiteAhead = score === null || (score.kind === 'cp' ? score.value >= 0 : score.value === 0 ? score.winner !== 'b' : score.value > 0);

  return (
    <div
      className={`eval-bar ${whiteOnTop ? 'white-top' : ''} ${analyzing ? 'busy' : ''}`}
      role="meter"
      aria-label="Evaluation bar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-valuetext={describeScore(score)}
      title={describeScore(score)}
      data-testid="eval-bar"
    >
      <div className="eval-white" style={{ height: `${share * 100}%`, ['--w' as string]: `${share * 100}%` }} />
      <span className={`eval-label ${whiteAhead ? 'at-white' : 'at-black'}`}>{label}</span>
    </div>
  );
}
