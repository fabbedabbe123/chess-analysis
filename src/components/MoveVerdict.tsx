import { useEffect, useMemo, useRef } from 'react';
import { GRADE_HELP, GRADE_LABEL, TAG_LABEL, FORCED_HELP } from '@/analysis/gradeInfo';
import { formatScore } from '@/analysis/eval';
import { pvToSan } from '@/analysis/pv';
import { explainBadMove } from '@/analysis/whyBad';
import type { ReviewMove } from '@/analysis/review';
import { getNode, hasNode, mainLine } from '@/chess/gameTree';
import { goTo, playMove, useGame } from '@/stores/gameStore';
import { startReview, mainLineSignature, useReview } from '@/stores/reviewStore';
import { usePlay } from '@/stores/playStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { splitUci } from '@/analysis/pv';
import type { Square } from '@/types/game';

const BAD = new Set<string>(['inaccuracy', 'mistake', 'miss', 'blunder']);

/** Under the board in analysis mode: how good was the move on the board, and a way to walk through the errors. */
export function MoveVerdict() {
  const tree = useGame((s) => s.tree);
  const currentId = useGame((s) => s.currentId);
  const result = useReview((s) => s.result);
  const signature = useReview((s) => s.signature);
  const status = useReview((s) => s.status);
  const progress = useReview((s) => s.progress);
  const puzzleOpen = usePuzzle((p) => p.phase !== 'off');
  const playOpen = usePlay((p) => p.phase !== 'off');
  const busy = puzzleOpen || playOpen;

  const line = useMemo(() => mainLine(tree), [tree]);
  const fresh = result !== null && signature === mainLineSignature(tree);
  const byNode = useMemo(() => new Map<string, ReviewMove>((fresh ? result.moves : []).map((m) => [m.nodeId, m])), [fresh, result]);
  const mistakes = useMemo(() => (fresh ? result.moves.filter((m) => m.classification.grade !== null && BAD.has(m.classification.grade)) : []), [fresh, result]);

  // When a review has just finished and the user has not moved yet, take them to the first error.
  const prevStatus = useRef(status);
  useEffect(() => {
    const finished = prevStatus.current === 'running' && status === 'done';
    prevStatus.current = status;
    const first = mistakes[0];
    if (finished && fresh && !busy && first !== undefined && currentId === tree.rootId) goTo(first.nodeId);
  }, [status, fresh, busy, mistakes, currentId, tree.rootId]);

  if (busy) return null;
  const plies = line.length - 1;
  if (!fresh) {
    if (plies < 1) return null;
    return (
      <div className="verdict verdict-empty" data-testid="move-verdict">
        {status === 'running' ? (
          <span className="muted">Reviewing the game… {progress.done}/{progress.total}</span>
        ) : (
          <>
            <span className="muted">Want to see which moves were blunders or good?</span>
            <button className="btn small primary" onClick={() => void startReview()} data-testid="verdict-review">Review game</button>
          </>
        )}
      </div>
    );
  }

  const here = byNode.get(currentId) ?? null;
  const ply = Math.max(0, line.indexOf(currentId));
  const prev = [...mistakes].reverse().find((m) => m.ply < ply);
  const next = mistakes.find((m) => m.ply > ply);
  const cls = here?.classification.grade ?? null;

  let betterSan: string | null = null;
  let betterUci: string | null = null;
  if (here !== null && !here.classification.isEngineBest && here.before.bestMove !== null && cls !== 'book') {
    betterUci = here.before.bestMove;
    betterSan = pvToSan(here.fenBefore, [betterUci], 1).moves[0]?.san ?? null;
  }
  const tryBetter = () => {
    if (here === null || betterUci === null || !hasNode(tree, here.nodeId)) return;
    const mv = splitUci(betterUci);
    if (mv === null) return;
    goTo(getNode(tree, here.nodeId).parentId ?? tree.rootId);
    playMove({ from: mv.from as Square, to: mv.to as Square, ...(mv.promotion !== undefined ? { promotion: mv.promotion } : {}) } as never);
  };

  return (
    <div className="verdict" data-testid="move-verdict">
      <div className="verdict-main">
        {here === null ? (
          <span className="muted">{currentId === tree.rootId ? 'Start position' : 'Variation: only the main line is reviewed'}</span>
        ) : (
          <>
            <strong>{here.moveNumber}{here.color === 'w' ? '.' : '...'} {here.san}</strong>
            {cls !== null ? <span className={`pill cls-${cls}`} data-testid="verdict-class" title={GRADE_HELP[cls]}>{GRADE_LABEL[cls]}</span> : <span className="muted">not classified</span>}
            <span className="muted">{formatScore(here.before.score)} → {formatScore(here.after.score)}</span>
            {here.classification.tags.filter((t) => !(here.classification.isEngineBest && t === 'allowed-mate')).map((t) => <span key={t} className="pill tag">{TAG_LABEL[t] ?? t}</span>)}
            {here.classification.isEngineBest && here.classification.tags.includes('allowed-mate') && <span className="pill tag forced" title={FORCED_HELP}>Forced sequence</span>}
          </>
        )}
      </div>
      {here !== null && cls !== null && BAD.has(cls) && (
        <ul className="why-list" data-testid="verdict-why">
          {explainBadMove(here).map((r, i) => <li key={i} data-kind={r.kind}>{r.text}</li>)}
        </ul>
      )}
      {betterSan !== null && (
        <div className="verdict-better">
          Engine preferred <strong>{betterSan}</strong>
          <button className="btn small" onClick={tryBetter} data-testid="verdict-try">Try it on the board</button>
        </div>
      )}
      <div className="verdict-nav">
        <button className="btn small" disabled={prev === undefined} onClick={() => prev && goTo(prev.nodeId)} data-testid="verdict-prev">◀ Previous error</button>
        <span className="muted small-print">{mistakes.length} error{mistakes.length === 1 ? '' : 's'}</span>
        <button className="btn small" disabled={next === undefined} onClick={() => next && goTo(next.nodeId)} data-testid="verdict-next">{here === null && currentId === tree.rootId ? 'First error ▶' : 'Next error ▶'}</button>
      </div>
    </div>
  );
}
