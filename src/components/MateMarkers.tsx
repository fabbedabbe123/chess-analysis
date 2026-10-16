import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';

const FILES = 'abcdefgh';

function kingSquare(fen: string): string | null {
  try {
    const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    const rows = new Chess(fen).board();
    for (const row of rows) for (const sq of row) if (sq !== null && sq.type === 'k' && sq.color === turn) return sq.square;
  } catch {
    // invalid position
  }
  return null;
}

/** Position of a square as percentages of the board, for the given orientation. */
function place(square: string, orientation: 'white' | 'black'): { left: string; top: string } {
  const f = FILES.indexOf(square[0] ?? 'a');
  const r = Number(square[1]) - 1;
  const col = orientation === 'white' ? f : 7 - f;
  const row = orientation === 'white' ? 7 - r : r;
  return { left: `${col * 12.5}%`, top: `${row * 12.5}%` };
}

const CONFETTI = ['#81b64c', '#e0a93a', '#4aa3e0', '#e0524a', '#f2f2f2', '#b07ae0'];

/**
 * When the position on the board is checkmate: a red "#" badge on the mated king and a gold star on the piece that
 * moved to give mate, so the two sides are easy to tell apart. When the mate has just been played, and the person
 * looking did not get mated, a little confetti bursts around the mating piece.
 * `celebrate` is false when the mated side is the user (a lost game): then only the badges are shown.
 */
export function MateMarkers({ fen, mated, matingSquare, orientation, nodeId, celebrate, animate }: {
  fen: string; mated: boolean; matingSquare: string | null; orientation: 'white' | 'black'; nodeId: string; celebrate: boolean; animate: boolean;
}) {
  const [burst, setBurst] = useState<number | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  // Chessground rounds the board down to a multiple of 8 px, so the layer is sized from the real <cg-board>.
  const [size, setSize] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = layer.current;
    const wrap = el?.parentElement;
    if (!mated || el === null || el === undefined || !wrap) return;
    const measure = () => {
      const cgBoard = wrap.querySelector('cg-board');
      const w = cgBoard === null ? 0 : cgBoard.getBoundingClientRect().width;
      setSize(w > 0 ? w : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [mated]);
  const lastNode = useRef(nodeId);
  const counter = useRef(0);

  useEffect(() => {
    const changed = lastNode.current !== nodeId;
    lastNode.current = nodeId;
    if (!changed || !mated || !celebrate || !animate) return;
    counter.current += 1;
    setBurst(counter.current);
    const t = setTimeout(() => setBurst(null), 1900);
    return () => clearTimeout(t);
  }, [nodeId, mated, celebrate, animate]);

  if (!mated) return null;
  const king = kingSquare(fen);
  const by = matingSquare !== null && matingSquare !== king ? matingSquare : null;
  return (
    <div ref={layer} className="mate-layer" aria-hidden="true" data-testid="mate-markers" style={size === null ? undefined : { width: size, height: size, right: 'auto', bottom: 'auto' }}>
      {king !== null && (
        <div className="mate-sq" style={place(king, orientation)} data-testid="mate-king" data-square={king}>
          <span className="mate-badge mate-lost" title="Checkmated">#</span>
        </div>
      )}
      {by !== null && (
        <div className="mate-sq" style={place(by, orientation)} data-testid="mate-winner" data-square={by}>
          <span className="mate-badge mate-won" title="Delivered checkmate">★</span>
          {burst !== null && (
            <span className="mate-burst" key={burst} data-testid="mate-confetti">
              {Array.from({ length: 18 }, (_, i) => {
                const a = (i / 18) * Math.PI * 2;
                return (
                  <i
                    key={i}
                    style={{
                      background: CONFETTI[i % CONFETTI.length] as string,
                      ['--dx' as string]: `${Math.round(Math.cos(a) * (28 + (i % 3) * 8))}%`,
                      ['--dy' as string]: `${Math.round(Math.sin(a) * (28 + (i % 3) * 8))}%`,
                      ['--rot' as string]: `${(i * 67) % 360}deg`,
                      animationDelay: `${(i % 4) * 0.03}s`,
                    }}
                  />
                );
              })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
