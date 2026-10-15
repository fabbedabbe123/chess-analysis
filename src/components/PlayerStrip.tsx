import { useMemo } from 'react';
import { currentFen, useGame } from '@/stores/gameStore';
import { formatClock } from '@/play/clock';
import { usePlay } from '@/stores/playStore';
import { useOrientation } from '@/stores/puzzleStore';
import type { Color } from '@/types/engine';

const START_COUNTS: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };
const ORDER = ['q', 'r', 'b', 'n', 'p'];

/** Pieces this side has captured (derived from the position; promotions can make it slightly off) and the material balance. */
export function capturedBy(fen: string): { w: string[]; b: string[]; diff: number } {
  const board = fen.split(' ')[0] ?? '';
  const have: Record<Color, Record<string, number>> = { w: {}, b: {} };
  for (const ch of board) {
    const lower = ch.toLowerCase();
    if (!(lower in START_COUNTS)) continue;
    const side: Color = ch === lower ? 'b' : 'w';
    have[side][lower] = (have[side][lower] ?? 0) + 1;
  }
  const lost = (side: Color): string[] =>
    ORDER.flatMap((t) => Array.from({ length: Math.max(0, (START_COUNTS[t] ?? 0) - (have[side][t] ?? 0)) }, () => t));
  const worth = (side: Color) => ORDER.reduce((n, t) => n + (have[side][t] ?? 0) * (VALUE[t] ?? 0), 0);
  // "w" = pieces White has captured = Black's missing pieces.
  return { w: lost('b'), b: lost('w'), diff: worth('w') - worth('b') };
}

function Strip({ color }: { color: Color }) {
  const fen = useGame((s) => currentFen(s));
  const headers = useGame((s) => s.tree.headers);
  const playPhase = usePlay((s) => s.phase);
  const userColor = usePlay((s) => s.userColor);
  const level = usePlay((s) => s.levelLabel);
  const clockMs = usePlay((s) => (s.clocks === null ? null : s.clocks[color]));
  const cap = useMemo(() => capturedBy(fen), [fen]);
  const turn: Color = fen.split(' ')[1] === 'b' ? 'b' : 'w';

  const headerName = headers[color === 'w' ? 'White' : 'Black'];
  const elo = headers[color === 'w' ? 'WhiteElo' : 'BlackElo'];
  let name = headerName && headerName !== '?' ? headerName : color === 'w' ? 'White' : 'Black';
  if (playPhase !== 'off') name = color === userColor ? 'You' : `Stockfish · ${level}`;
  const mine = cap[color];
  const adv = color === 'w' ? cap.diff : -cap.diff;

  return (
    <div className={`player-strip ${turn === color ? 'on-move' : ''}`} data-testid={`strip-${color}`}>
      <span className={`dot dot-${color}`} aria-hidden />
      <strong className="p-name">{name}</strong>
      {elo && elo !== '?' && <span className="muted small-print">{elo}</span>}
      <span className="captured" aria-label="Captured pieces">{mine.map((t, i) => <span key={i}>{GLYPH[t]}</span>)}</span>
      {adv > 0 && <span className="adv">+{adv}</span>}
      <span className="spacer" />
      {turn === color && <span className="to-move">to move</span>}
      {clockMs !== null && <span className={`clock ${clockMs < 20_000 ? 'low' : ''}`} data-testid={`clock-${color}`} aria-label={`${color === 'w' ? 'White' : 'Black'} clock`}>{formatClock(clockMs)}</span>}
    </div>
  );
}

/** Player bars above and below the board. The bottom one is the side the board is oriented to. */
export function PlayerStrip({ position }: { position: 'top' | 'bottom' }) {
  const orientation = useOrientation();
  const bottom: Color = orientation === 'white' ? 'w' : 'b';
  const color: Color = position === 'bottom' ? bottom : bottom === 'w' ? 'b' : 'w';
  return <Strip color={color} />;
}
