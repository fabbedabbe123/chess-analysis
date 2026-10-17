import { useMemo, useState } from 'react';
import { GRADE_ORDER, type MoveGrade } from '@/analysis/classify';
import { FORCED_HELP, GRADE_HELP, GRADE_LABEL, TAG_LABEL } from '@/analysis/gradeInfo';
import { formatScore } from '@/analysis/eval';
import { pvToSan } from '@/analysis/pv';
import type { ReviewMove, ReviewResult } from '@/analysis/review';
import { getNode, hasNode, mainLine } from '@/chess/gameTree';
import { continueFromHere, goTo, useGame } from '@/stores/gameStore';
import { cancelReview, mainLineSignature, startReview, useReview } from '@/stores/reviewStore';
import { updateSettings, useSettings } from '@/stores/settingsStore';
import { usePuzzle } from '@/stores/puzzleStore';
import { usePlay } from '@/stores/playStore';
import { addFromReview, useStrength } from '@/stores/strengthStore';
import { formatPercent } from '@/utils/format';


export function EvalGraph({ values, ids, currentPly }: { values: number[]; ids: string[]; currentPly: number }) {
  const w = 320;
  const h = 70;
  const n = values.length;
  if (n < 2) return null;
  const x = (i: number) => (i / (n - 1)) * w;
  const y = (v: number) => h - (v / 100) * h;
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="White's winning chances through the game. Click to jump to a move."
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
        const id = ids[Math.max(0, Math.min(n - 1, i))];
        if (id !== undefined) goTo(id);
      }}
    >
      <rect x={0} y={0} width={w} height={h} className="g-bg" />
      <polygon points={`0,${h} ${points} ${w},${h}`} className="g-fill" />
      <line x1={0} x2={w} y1={h / 2} y2={h / 2} className="g-mid" />
      <polyline points={points} className="g-line" fill="none" />
      <line x1={x(currentPly)} x2={x(currentPly)} y1={0} y2={h} className="g-cursor" />
    </svg>
  );
}

function MomentRow({ m, label }: { m: ReviewMove; label?: string }) {
  const best = useMemo(() => {
    const first = m.before.bestMove;
    if (first === null || m.classification.isEngineBest) return null;
    const conv = pvToSan(m.fenBefore, m.before.bestPv.length > 0 ? m.before.bestPv : [first], 1);
    return conv.moves[0]?.san ?? null;
  }, [m]);
  const cls = m.classification.grade ?? m.classification.moveClass;
  const forced = m.classification.isEngineBest && cls !== null && !['inaccuracy', 'mistake', 'miss', 'blunder'].includes(cls);
  const grade = cls === null ? null : GRADE_BADGE[cls] ?? null;
  return (
    <li>
      <button className={`moment rv-moment ${cls ? `cls-${cls}` : ''}`} onClick={() => goTo(m.nodeId)}>
        <span className={`rv-badge cls-${cls ?? 'none'}`} aria-hidden>{grade ?? '•'}</span>
        <span className="rv-mtext">
          <span className="moment-move">{m.moveNumber}{m.color === 'w' ? '.' : '...'} {m.san}</span>
          {cls && <span className={`pill cls-${cls}`} title={GRADE_HELP[cls]}>{GRADE_LABEL[cls]}</span>}
          {forced && <span className="pill tag forced" title={FORCED_HELP} data-testid="forced-tag">Forced sequence</span>}
          {m.classification.tags.filter((t) => !(forced && t === 'allowed-mate')).map((t) => <span key={t} className="pill tag">{TAG_LABEL[t] ?? t}</span>)}
          <span className="muted rv-mdetail">
            {formatScore(m.before.score)} → {formatScore(m.after.score)}
            {best ? ` · engine preferred ${best}` : ''}
            {label ? ` · ${forced ? 'no better move existed' : label}` : ''}
          </span>
        </span>
      </button>
    </li>
  );
}

const GRADE_BADGE: Partial<Record<string, string>> = { brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓', book: '📖', inaccuracy: '?!', mistake: '?', miss: '✗', blunder: '??' };
const COMMON_GRADES: MoveGrade[] = ['best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];

const ERR_GRADES = ['blunder', 'miss', 'mistake', 'inaccuracy'] as const;
const ERR_WORD: Record<(typeof ERR_GRADES)[number], [string, string]> = { blunder: ['blunder', 'blunders'], miss: ['miss', 'misses'], mistake: ['mistake', 'mistakes'], inaccuracy: ['inaccuracy', 'inaccuracies'] };

/** One plain sentence per side: how many errors, and where to start. */
export function headline(summary: ReviewResult['summary'], white: string, black: string): string {
  const side = (c: 'w' | 'b', name: string): string => {
    const parts = ERR_GRADES.filter((g) => summary.grades[c][g] > 0).map((g) => `${summary.grades[c][g]} ${ERR_WORD[g][summary.grades[c][g] === 1 ? 0 : 1]}`);
    return `${name}: ${parts.length === 0 ? 'no errors' : parts.join(', ')}`;
  };
  return `${side('w', white)}. ${side('b', black)}. Use “Next error” under the board to go through them.`;
}

function hashOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Lets the user say which side they were, so this review feeds the Strength tab. */
function CountForStrength({ result, stale }: { result: ReviewResult; stale: boolean }) {
  const tree = useGame((s) => s.tree);
  const games = useStrength((s) => s.games);
  const id = `imp-${hashOf(mainLineSignature(tree))}`;
  const existing = games.find((g) => g.id === id);
  const [failed, setFailed] = useState(false);
  const count = (color: 'w' | 'b') => {
    const h = tree.headers;
    const label = `${h['White'] ?? 'White'} – ${h['Black'] ?? 'Black'}`;
    setFailed(!addFromReview(result, color, { id, source: 'import', endedAt: Date.now(), label }));
  };
  return (
    <div className="rp-card rp-row strength-count" data-testid="count-strength">
      <div className="rp-t"><b>Count for my strength</b><span className="muted small-print">{existing ? `Counted for your strength (as ${existing.userColor === 'w' ? 'White' : 'Black'}).` : failed ? 'Not counted: that side has no moves outside the opening book.' : 'Add this game to my strength estimate. I played as:'}</span></div>
      <div className="seg small">
        <button className={existing?.userColor === 'w' ? 'on' : ''} disabled={stale} onClick={() => count('w')} data-testid="count-white">White</button>
        <button className={existing?.userColor === 'b' ? 'on' : ''} disabled={stale} onClick={() => count('b')} data-testid="count-black">Black</button>
      </div>
    </div>
  );
}

export function ReviewPanel() {
  const settings = useSettings();
  const tree = useGame((s) => s.tree);
  const currentId = useGame((s) => s.currentId);
  const status = useReview((s) => s.status);
  const progress = useReview((s) => s.progress);
  const result = useReview((s) => s.result);
  const signature = useReview((s) => s.signature);
  const error = useReview((s) => s.error);
  const puzzleBusy = usePuzzle((p) => p.phase !== 'off');
  const playing = usePlay((p) => p.phase === 'playing');
  const playOpen = usePlay((p) => p.phase !== 'off');
  const puzzleOpen = puzzleBusy || playing;

  const line = useMemo(() => mainLine(tree), [tree]);
  const stale = result !== null && signature !== mainLineSignature(tree);
  const plies = line.length - 1;
  const currentPly = Math.max(0, line.indexOf(currentId));
  const summary = result?.summary;

  const firstError = summary?.criticalMoments[0] ?? summary?.studyPositions[0] ?? null;
  const rare = GRADE_ORDER.filter((g) => !COMMON_GRADES.includes(g));
  const name = (c: 'w' | 'b') => (c === 'w' ? tree.headers['White'] ?? 'White' : tree.headers['Black'] ?? 'Black');

  return (
    <section className="panel review-panel rp" aria-label="Game review">
      <header className="rp-head">
        <span className="rp-label">Game review{result ? ` · depth ${result.depth}` : ''}</span>
        <div className="spacer" />
        <label className="inline rp-depth" title="Review depth (also in Settings)">
          Depth
          <input type="number" min={6} max={30} value={settings.reviewDepth} disabled={status === 'running'}
            onChange={(e) => updateSettings({ reviewDepth: Number(e.target.value) })} aria-label="Review depth" />
        </label>
        {status === 'running' ? (
          <button className="btn small" onClick={cancelReview}>Cancel</button>
        ) : (
          <button className={`btn small ${result ? '' : 'primary'}`} onClick={() => void startReview()} disabled={plies < 1 || puzzleOpen} title={puzzleOpen ? 'Exit puzzles first' : undefined} data-testid="run-review">
            {result ? 'Re-run' : 'Review game'}
          </button>
        )}
      </header>

      {plies < 1 && (
        <div className="rp-empty"><b>Nothing to review yet</b><span>Play or import some moves first. The review analyses the main line.</span></div>
      )}
      {plies >= 1 && !result && status !== 'running' && (
        <div className="rp-cta"><div><strong>Review this game</strong><span>Every move gets a grade, and the mistakes are explained.</span></div><button className="btn primary" onClick={() => void startReview()} disabled={puzzleOpen}>Start</button></div>
      )}

      {status === 'running' && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          <span>Position {progress.done} / {progress.total}</span>
        </div>
      )}
      {status === 'error' && <div className="callout error" role="alert">Review failed: {error}</div>}
      {status === 'cancelled' && <p className="muted pad">Review cancelled.</p>}
      {stale && <div className="callout warn">The main line changed since this review. Results below may not match – re-run the review.</div>}

      {result && summary && (
        <>
          <div className="rp-acc">
            {(['w', 'b'] as const).map((c) => (
              <div key={c} className="rp-card accuracy">
                <span className="rp-who"><i className={c} />{name(c)}</span>
                <strong data-testid={`accuracy-${c}`}>{formatPercent(summary.accuracy[c])}</strong>
                <span className="label">accuracy (estimate)</span>
              </div>
            ))}
          </div>
          <EvalGraph values={result.whiteWinGraph} ids={line} currentPly={currentPly} />
          <div className="rp-sum">
            <p className="review-headline" data-testid="review-headline">{headline(summary, name('w'), name('b'))}</p>
            {firstError !== null && <button className="btn small primary" onClick={() => goTo(firstError.nodeId)}>Go to the first one</button>}
          </div>

          <div className="rp-sechead"><span className="rp-label">Moves</span><div className="spacer" /><span className="rp-legend">{name('w')} · {name('b')}</span></div>
          <div className="rp-grades counts">
            {COMMON_GRADES.map((g) => (
              <div key={g} className={`rp-grade cls-${g} ${summary.grades.w[g] + summary.grades.b[g] === 0 ? 'zero' : ''}`} title={GRADE_HELP[g]}>
                <span className={`rv-badge cls-${g}`} aria-hidden>{GRADE_BADGE[g]}</span>
                <span className="rp-gname">{GRADE_LABEL[g]}</span>
                <span className="rp-gc"><b data-testid={`grade-w-${g}`}>{summary.grades.w[g]}</b><em>·</em><b data-testid={`grade-b-${g}`}>{summary.grades.b[g]}</b></span>
              </div>
            ))}
          </div>
          <details className="rp-more">
            <summary>All grades: {rare.map((g) => GRADE_LABEL[g]).join(', ')}, missed mates and wins</summary>
            <div className="rp-grades">
              {rare.map((g) => (
                <div key={g} className={`rp-grade cls-${g} ${summary.grades.w[g] + summary.grades.b[g] === 0 ? 'zero' : ''}`} title={GRADE_HELP[g]}>
                  <span className={`rv-badge cls-${g}`} aria-hidden>{GRADE_BADGE[g]}</span>
                  <span className="rp-gname">{GRADE_LABEL[g]}</span>
                  <span className="rp-gc"><b data-testid={`grade-w-${g}`}>{summary.grades.w[g]}</b><em>·</em><b data-testid={`grade-b-${g}`}>{summary.grades.b[g]}</b></span>
                </div>
              ))}
              <div className="rp-grade"><span className="rp-gname">Missed mates</span><span className="rp-gc"><b>{summary.missedMates.w}</b><em>·</em><b>{summary.missedMates.b}</b></span></div>
              <div className="rp-grade"><span className="rp-gname">Missed wins</span><span className="rp-gc"><b>{summary.missedWins.w}</b><em>·</em><b>{summary.missedWins.b}</b></span></div>
              {summary.unclassified > 0 && <div className="rp-grade"><span className="rp-gname">Unclassified</span><span className="rp-gc"><b>{summary.unclassified}</b></span></div>}
            </div>
          </details>
          <details className="grade-legend rp-more">
            <summary>How accuracy and the grades are decided</summary>
            <p className="muted small-print">
              Accuracy is an estimate: the mean per-move score from the loss of winning chances (model adapted from Lichess's published formula). It is not Chess.com's or Lichess's number. Depth {result.depth}; moves classified from winning-chance loss, thresholds in settings.
            </p>
            <p className="muted small-print">These labels follow the familiar Chess.com scheme, but the rules are our own approximation: Chess.com's exact algorithm is not public. Everything comes from Stockfish's evaluations at the review depth.</p>
            <ul className="learn-ideas">
              {GRADE_ORDER.map((g) => <li key={g}><span className={`pill cls-${g}`}>{GRADE_LABEL[g]}</span> {GRADE_HELP[g]}</li>)}
            </ul>
          </details>

          <div className="rp-sechead"><span className="rp-label">Key moments</span></div>
          {summary.criticalMoments.length === 0 ? <p className="muted rp-quiet">None found – a clean game.</p> : (
            <ul className="moments">{summary.criticalMoments.map((m) => <MomentRow key={m.nodeId} m={m} />)}</ul>
          )}
          {summary.biggestSwings.some((m) => Math.abs(m.swing) >= 1) && (
            <>
              <div className="rp-sechead"><span className="rp-label">Biggest swings</span></div>
              <ul className="moments">
                {summary.biggestSwings.filter((m) => Math.abs(m.swing) >= 1).map((m) => <MomentRow key={m.nodeId} m={m} label={`White's win chance ${m.swing > 0 ? '+' : ''}${m.swing.toFixed(0)}%`} />)}
              </ul>
            </>
          )}
          <div className="rp-sechead"><span className="rp-label">Study positions</span></div>
          <p className="muted small-print rp-quiet">Positions from your own mistakes: the position <em>before</em> the move, where the engine knows a better one.</p>
          {summary.studyPositions.length === 0 ? <p className="muted rp-quiet">No mistakes to study.</p> : (
            <ul className="moments">
              {summary.studyPositions.slice(0, 8).map((m) => {
                const parent = hasNode(tree, m.nodeId) ? getNode(tree, m.nodeId).parentId : null;
                return (
                  <li key={m.nodeId} className="study">
                    <MomentRow m={m} />
                    {parent && (
                      <button className="btn small" onClick={() => { goTo(parent); }} title="Go to the position before the move">Show position</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="rp-sechead"><span className="rp-label">Use this game</span></div>
          <CountForStrength result={result} stale={stale} />
          <div className="rp-card rp-row">
            <div className="rp-t"><b>Study position</b><span className="muted small-print">Start a new analysis game from the selected move.</span></div>
            <button className="btn small" disabled={puzzleOpen || playOpen} onClick={continueFromHere} title="Start a new analysis game from the selected position">
              Start new game from selected position
            </button>
          </div>
        </>
      )}
    </section>
  );
}
