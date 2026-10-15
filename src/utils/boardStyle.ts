import type { BoardThemeId, PieceSetId } from '@/stores/settingsStore';

/** [light, dark] square colours. */
export const BOARD_COLORS: Record<BoardThemeId, [string, string]> = {
  green: ['#eeeed2', '#769656'],
  brown: ['#f0d9b5', '#b58863'],
  blue: ['#dee3e6', '#8ca2ad'],
  slate: ['#c9ced6', '#5f6b7d'],
  purple: ['#e8dff0', '#8b6fb0'],
};

const ROLES: [string, string][] = [
  ['pawn', 'P'],
  ['knight', 'N'],
  ['bishop', 'B'],
  ['rook', 'R'],
  ['queen', 'Q'],
  ['king', 'K'],
];

/** CSS that maps chessground piece elements to the SVG files in /pieces/<set>/. */
export function pieceSetCss(base: string): string {
  const sets: PieceSetId[] = ['cburnett', 'merida', 'chessnut', 'rhosgfx'];
  const b = base.endsWith('/') ? base : `${base}/`;
  let css = '';
  for (const set of sets) {
    for (const [role, letter] of ROLES) {
      for (const [color, c] of [['white', 'w'], ['black', 'b']] as const) {
        css += `.pieces-${set} piece.${role}.${color}{background-image:url('${b}pieces/${set}/${c}${letter}.svg')}\n`;
      }
    }
  }
  return css;
}

let installed = false;
export function installPieceCss(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const el = document.createElement('style');
  el.dataset['purpose'] = 'piece-sets';
  el.textContent = pieceSetCss(import.meta.env.BASE_URL);
  document.head.appendChild(el);
}
