import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GRADE_LABEL } from '@/analysis/gradeInfo';
import type { MoveGrade } from '@/analysis/classify';
import { splitUci } from '@/analysis/pv';
import { mainLineSignature, useReview } from '@/stores/reviewStore';
import { useGame } from '@/stores/gameStore';

const FILES = 'abcdefgh';
const MARK: Record<MoveGrade, string> = { brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓', book: '≡', inaccuracy: '?!', mistake: '?', miss: '✕', blunder: '??' };

/** The grade of the move just played, as a small round badge on its destination square (like Chess.com). Only after a review. */
export function GradeMark({ orientation }: { orientation: 'white' | 'black' }) {
  const tree = useGame((s) => s.tree);
  const currentId = useGame((s) => s.currentId);
  const result = useReview((s) => s.result);
  const signature = useReview((s) => s.signature);
  const layer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<number | null>(null);
  const move = useMemo(() => (result !== null && signature === mainLineSignature(tree) ? result.moves.find((m) => m.nodeId === currentId) ?? null : null), [result, signature, tree, currentId]);
  const on = move !== null;
  useLayoutEffect(() => {
    const el = layer.current;
    const wrap = el?.parentElement;
    if (!on || el === null || el === undefined || !wrap) return;
    const measure = () => {
      const cg = wrap.querySelector('cg-board');
      const w = cg === null ? 0 : cg.getBoundingClientRect().width;
      setSize(w > 0 ? w : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [on]);
  if (move === null) return null;
  const grade = move.classification.grade ?? move.classification.moveClass;
  const to = splitUci(move.uci)?.to;
  if (grade === null) return null;
  if (to === undefined) return null;
  const f = FILES.indexOf(to[0] ?? 'a');
  const r = Number(to[1]) - 1;
  const col = orientation === 'white' ? f : 7 - f;
  const row = orientation === 'white' ? 7 - r : r;
  return (
    <div ref={layer} className="grade-layer" aria-hidden="true" data-testid="grade-layer" style={size === null ? undefined : { width: size, height: size, right: 'auto', bottom: 'auto' }}>
      <div className="grade-sq" style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }}>
        <span className={`grade-mark cls-${grade}`} title={GRADE_LABEL[grade]} data-testid="grade-mark" data-grade={grade}>{MARK[grade]}</span>
      </div>
    </div>
  );
}
