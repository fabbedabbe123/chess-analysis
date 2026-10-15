import { Chess } from 'chess.js';
import { useMemo } from 'react';
import { useSettings } from '@/stores/settingsStore';
import { BOARD_COLORS } from '@/utils/boardStyle';

/** Static, lightweight board used for line previews (no interaction). */
export function MiniBoard({ fen, size = 168, highlight, flip: flipProp }: { fen: string; size?: number; highlight?: string[]; flip?: boolean }) {
  const { pieceSet, boardTheme, orientation } = useSettings();
  const [light, dark] = BOARD_COLORS[boardTheme];
  const squares = useMemo(() => {
    try {
      return new Chess(fen).board();
    } catch {
      return null;
    }
  }, [fen]);
  if (squares === null) return null;
  const cell = size / 8;
  const flip = flipProp ?? orientation === 'black';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Position ${fen}`} className="mini-board">
      {squares.map((row, r) =>
        row.map((sq, f) => {
          const file = flip ? 7 - f : f;
          const rank = flip ? 7 - r : r;
          const name = `${'abcdefgh'[f] as string}${8 - r}`;
          const x = file * cell;
          const y = rank * cell;
          const isLight = (r + f) % 2 === 0;
          return (
            <g key={name}>
              <rect x={x} y={y} width={cell} height={cell} fill={isLight ? light : dark} />
              {highlight?.includes(name) && <rect x={x} y={y} width={cell} height={cell} fill="rgba(255,213,0,.45)" />}
              {sq !== null && (
                <image
                  href={`${import.meta.env.BASE_URL}pieces/${pieceSet}/${sq.color}${sq.type.toUpperCase()}.svg`}
                  x={x}
                  y={y}
                  width={cell}
                  height={cell}
                />
              )}
            </g>
          );
        }),
      )}
    </svg>
  );
}
