import { Chess } from 'chess.js';
import { formatScore, mateDistance } from '@/analysis/eval';
import { pvToSan } from '@/analysis/pv';
import type { ReviewMove } from '@/analysis/review';
import { describeMove } from '@/play/hints';

/**
 * Evidence-based reasons why a move lost ground. EVERY number and move comes from Stockfish's own lines stored in the review
 * (the evaluation before/after, the best line from the position before the move, and the best reply after it) or from
 * counting material along those lines with the rules of chess. Nothing here is guessed: when the lines show no concrete
 * material or mating consequence, the explanation says so instead of inventing a cause.
 */

export interface WhyReason {
  kind: 'eval' | 'mate' | 'refutation' | 'material' | 'hanging' | 'check' | 'missed-gain' | 'missed-win' | 'quiet';
  text: string;
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function material(chess: Chess, color: 'w' | 'b'): number {
  let sum = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell === null) continue;
      const v = VALUE[cell.type] ?? 0;
      sum += cell.color === color ? v : -v;
    }
  }
  return sum;
}

/** Material change for `color` after playing `pv` from `fen` (up to `plies`, extended through a running capture sequence). */
export function materialAlong(fen: string, pv: readonly string[], color: 'w' | 'b', plies = 4): { delta: number; plies: number } | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const start = material(chess, color);
  let played = 0;
  let lastCapture = false;
  const limit = Math.min(pv.length, plies + 2);
  while (played < limit) {
    if (played >= plies && !lastCapture) break;
    const uci = pv[played] as string;
    try {
      const mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length === 5 ? { promotion: uci[4] as string } : {}) });
      lastCapture = mv.captured !== undefined;
    } catch {
      break;
    }
    played += 1;
  }
  if (played === 0) return null;
  return { delta: material(chess, color) - start, plies: played };
}

function worth(points: number): string {
  const n = Math.abs(Math.round(points));
  const kind = n >= 9 ? ' (a queen or more)' : n >= 5 ? ' (about a rook)' : n >= 3 ? ' (about a minor piece)' : '';
  return `${n === 1 ? '1 pawn\'s' : `${n} pawns'`} worth${kind}`;
}

const line = (fen: string, pv: readonly string[], n: number): string => {
  const conv = pvToSan(fen, pv, n);
  return conv.moves.map((x, i) => `${x.color === 'w' ? `${x.moveNumber}.` : i === 0 ? `${x.moveNumber}...` : ''}${x.san}`).join(' ');
};

export function explainBadMove(m: ReviewMove): WhyReason[] {
  const out: WhyReason[] = [];
  const cls = m.classification;
  const mover = m.color;
  const depth = Math.min(m.before.depth, m.after.depth);
  const pct = (n: number) => `${Math.round(n)}%`;
  out.push({
    kind: 'eval',
    text: `Stockfish (depth ${depth}) rated the position ${formatScore(m.before.score)} before this move and ${formatScore(m.after.score)} after it: your winning chances fell from ${pct(cls.winBefore)} to ${pct(cls.winAfter)}.`,
  });

  // Mate
  if (cls.tags.includes('allowed-mate')) {
    const n = mateDistance(m.after.score);
    out.push({ kind: 'mate', text: `After this move the opponent has a forced mate${n !== null ? ` in ${n}` : ''}${m.after.bestPv.length > 0 ? `: ${line(m.after.fen, m.after.bestPv, 2 * (n ?? 2))}` : ''}.` });
  }
  if (cls.tags.includes('missed-mate')) {
    const n = mateDistance(m.before.score);
    out.push({ kind: 'mate', text: `You had a forced mate${n !== null ? ` in ${n}` : ''}${m.before.bestPv.length > 0 ? `: ${line(m.fenBefore, m.before.bestPv, 2 * (n ?? 2))}` : ''}.` });
  }
  if (cls.tags.includes('missed-win')) out.push({ kind: 'missed-win', text: `You were winning (${pct(cls.winBefore)}) and this move lets the advantage slip.` });

  // The opponent's best answer
  const reply = m.after.bestPv[0];
  if (reply !== undefined && !cls.tags.includes('allowed-mate')) {
    const conv = pvToSan(m.after.fen, m.after.bestPv, 4);
    const first = conv.moves[0];
    if (first !== undefined) {
      const lineText = conv.moves.map((x, i) => `${x.color === 'w' ? `${x.moveNumber}.` : i === 0 ? `${x.moveNumber}...` : ''}${x.san}`).join(' ');
      out.push({ kind: 'refutation', text: `Stockfish's best reply is ${first.san}${conv.moves.length > 1 ? ` (line: ${lineText})` : ''}.` });
    }
    const facts = describeMove(m.after.fen, reply);
    if (facts?.captured && reply.slice(2, 4) === m.uci.slice(2, 4)) {
      out.push({ kind: 'hanging', text: `That reply captures the ${NAME[facts.captured] ?? 'piece'} you just moved to ${m.uci.slice(2, 4)}.` });
    }
    if (facts?.check) out.push({ kind: 'check', text: 'The reply is check, so you do not get time to fix anything else.' });
    const lost = materialAlong(m.after.fen, m.after.bestPv, mover);
    if (lost !== null && lost.delta <= -1) {
      out.push({ kind: 'material', text: `Material: along that line you are ${worth(lost.delta)} down after ${lost.plies} half-move${lost.plies === 1 ? '' : 's'}.` });
    }
  }

  // What the better move would have achieved
  const best = m.before.bestMove;
  if (best !== null && !cls.isEngineBest) {
    const bestFacts = describeMove(m.fenBefore, best);
    const gain = m.before.bestPv.length > 0 ? materialAlong(m.fenBefore, m.before.bestPv, mover) : null;
    const bestSan = pvToSan(m.fenBefore, [best], 1).moves[0]?.san ?? best;
    if (gain !== null && gain.delta >= 1) {
      out.push({ kind: 'missed-gain', text: `The better move ${bestSan} wins material: ${worth(gain.delta)} up after ${gain.plies} half-move${gain.plies === 1 ? '' : 's'} of Stockfish's line${bestFacts?.captured ? ` (it captures the ${NAME[bestFacts.captured] ?? 'piece'})` : ''}.` });
    } else if (bestFacts?.mate) {
      out.push({ kind: 'missed-gain', text: `${bestSan} was checkmate.` });
    }
  }

  const concrete = out.some((r) => ['mate', 'material', 'hanging', 'missed-gain'].includes(r.kind));
  if (!concrete) {
    const purpose = best !== null && !cls.isEngineBest ? describeMove(m.fenBefore, best)?.purposeText : undefined;
    out.push({
      kind: 'quiet',
      text: `Stockfish's lines show no immediate loss of material or mate, so the drop comes from the quality of the position itself (piece activity, pawn structure, king safety, or threats beyond the few moves of the line).${purpose ? ` The preferred move: ${purpose.charAt(0).toLowerCase()}${purpose.slice(1)}` : ''}`,
    });
  }
  return out;
}
