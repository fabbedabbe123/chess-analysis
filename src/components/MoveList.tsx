import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getNode, isOnMainLine, lineEnd } from '@/chess/gameTree';
import { nagToSymbol } from '@/pgn/pgn';
import {
  deleteFromHere,
  goTo,
  makeMainLine,
  promoteVariation,
  setComment,
  toggleNag,
  useGame,
} from '@/stores/gameStore';
import { mainLineSignature, useReview } from '@/stores/reviewStore';
import type { MoveGrade } from '@/analysis/classify';
import { GRADE_LABEL, GRADE_SYMBOL } from '@/analysis/gradeInfo';
import type { GameTree, MoveNode } from '@/types/game';


const ERROR_GRADES = new Set<string>(['inaccuracy', 'mistake', 'miss', 'blunder']);

interface TokenProps {
  node: MoveNode;
  selected: boolean;
  showNumber: boolean;
  badge: MoveGrade | null;
}

const Token = memo(function Token({ node, selected, showNumber, badge }: TokenProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const nags = node.nags.map(nagToSymbol).filter((s): s is string => s !== null).join('');
  return (
    <>
      {showNumber && <span className="mv-num">{node.moveNumber}{node.color === 'w' ? '.' : '...'}</span>}
      <button
        ref={ref}
        className={`mv ${selected ? 'selected' : ''} ${badge ? `cls-${badge}` : ''}`}
        onClick={() => goTo(node.id)}
        aria-current={selected ? 'true' : undefined}
        data-node={node.id}
      >
        {node.san}
        {nags && <span className="nag">{nags}</span>}
        {badge && GRADE_SYMBOL[badge] && <span className={`badge cls-${badge}`} title={GRADE_LABEL[badge]}>{GRADE_SYMBOL[badge]}</span>}
      </button>
      {node.comment && <span className="mv-comment">{node.comment}</span>}
    </>
  );
});

interface RenderCtx {
  tree: GameTree;
  currentId: string;
  badges: Map<string, MoveGrade>;
}

/** Render `startId` and its main continuation; alternatives of each move follow it in brackets. */
function renderFrom(ctx: RenderCtx, startId: string, depth: number, forceNumber: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  let cur: string | undefined = startId;
  let needNumber = forceNumber;
  while (cur !== undefined) {
    const node = getNode(ctx.tree, cur);
    const showNumber = node.color === 'w' || needNumber;
    out.push(
      <Token key={node.id} node={node} selected={node.id === ctx.currentId} showNumber={showNumber} badge={ctx.badges.get(node.id) ?? null} />,
    );
    needNumber = node.comment !== '';
    const parent = node.parentId === null ? null : getNode(ctx.tree, node.parentId);
    if (parent !== null && parent.children[0] === node.id && parent.children.length > 1) {
      for (const variationId of parent.children.slice(1)) {
        out.push(
          <span key={`v${variationId}`} className={`variation depth-${Math.min(depth + 1, 3)}`}>
            <span className="paren">(</span>
            {renderFrom(ctx, variationId, depth + 1, true)}
            <span className="paren">)</span>
          </span>,
        );
        needNumber = true;
      }
    }
    cur = node.children[0];
  }
  return out;
}

export function MoveList() {
  const tree = useGame((s) => s.tree);
  const currentId = useGame((s) => s.currentId);
  const review = useReview((s) => s.result);
  const reviewSig = useReview((s) => s.signature);

  const [errorsOnly, setErrorsOnly] = useState(false);
  const badges = useMemo(() => {
    const map = new Map<string, MoveGrade>();
    if (review !== null && reviewSig === mainLineSignature(tree)) {
      for (const m of review.moves) {
        if (m.classification.moveClass === null) continue;
        const g = m.classification.grade ?? m.classification.moveClass;
        if (errorsOnly && !ERROR_GRADES.has(g)) continue;
        map.set(m.nodeId, g);
      }
    }
    return map;
  }, [review, reviewSig, tree, errorsOnly]);
  const reviewed = review !== null && reviewSig === mainLineSignature(tree);

  const root = getNode(tree, tree.rootId);
  const first = root.children[0];
  const ctx: RenderCtx = { tree, currentId, badges };

  return (
    <div className="move-list" role="region" aria-label="Moves" data-testid="move-list">
      {reviewed && (
        <label className="errors-only small-print"><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} data-testid="errors-only" /> Show errors only</label>
      )}
      {first === undefined ? (
        <p className="muted pad">No moves yet. Drag a piece, or import a game.</p>
      ) : (
        <div className="moves-flow">
          {renderFrom(ctx, first, 0, false)}
        </div>
      )}
    </div>
  );
}

const NAG_BUTTONS: [number, string][] = [[1, '!'], [2, '?'], [3, '!!'], [4, '??'], [5, '!?'], [6, '?!']];

/** Comment, annotation symbols and tree editing for the selected move. */
export function MoveTools() {
  const tree = useGame((s) => s.tree);
  const currentId = useGame((s) => s.currentId);
  const node = getNode(tree, currentId);
  const isRoot = node.parentId === null;
  const onMain = isOnMainLine(tree, currentId);
  const hasContinuation = lineEnd(tree, currentId) !== currentId;
  return (
    <div className="move-tools">
      <div className="row">
        <span className="label">Annotate</span>
        {NAG_BUTTONS.map(([nag, symbol]) => (
          <button
            key={nag}
            className={`btn small nag-btn ${node.nags.includes(nag) ? 'active' : ''}`}
            disabled={isRoot}
            onClick={() => toggleNag(currentId, nag)}
            aria-pressed={node.nags.includes(nag)}
            title={`Toggle ${symbol}`}
          >
            {symbol}
          </button>
        ))}
      </div>
      <textarea
        key={currentId}
        className="comment-box"
        placeholder={isRoot ? 'Select a move to comment on it' : 'Comment on this move…'}
        defaultValue={node.comment}
        disabled={isRoot}
        rows={2}
        aria-label="Move comment"
        onBlur={(e) => {
          if (e.target.value !== node.comment) setComment(currentId, e.target.value);
        }}
      />
      <div className="row wrap">
        {!onMain && (
          <>
            <button className="btn small" onClick={() => promoteVariation(currentId)} title="Move this variation one step up">Promote variation</button>
            <button className="btn small" onClick={() => makeMainLine(currentId)} title="Make this line the main line">Make main line</button>
          </>
        )}
        <button className="btn small danger" disabled={isRoot} onClick={() => deleteFromHere(currentId)} title="Delete this move and everything after it">
          Delete from here
        </button>
        {hasContinuation && <span className="muted">Line continues after this move</span>}
      </div>
    </div>
  );
}
