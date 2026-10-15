import type { MoveGrade } from './classify';

export const GRADE_LABEL: Record<MoveGrade, string> = {
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Miss',
  blunder: 'Blunder',
};

/** Short marks shown next to a move in the move list (empty = no mark). */
export const GRADE_SYMBOL: Record<MoveGrade, string> = {
  brilliant: '!!',
  great: '!',
  best: '★',
  excellent: '',
  good: '',
  book: '≡',
  inaccuracy: '?!',
  mistake: '?',
  miss: '✕',
  blunder: '??',
};

export const GRADE_HELP: Record<MoveGrade, string> = {
  brilliant: 'A real sacrifice that is still the best (or nearly best) move: you are material down after the exchanges in the engine\'s line, were not already clearly winning, and are not worse afterwards.',
  great: 'The only good move: Stockfish\'s best move, with the second-best at least 15 winning-chance points worse.',
  best: 'Stockfish\'s first choice.',
  excellent: 'Almost as good as the best move (loses at most 2 winning-chance points).',
  good: 'A solid move (loses at most 5 points).',
  book: 'A known opening move from the Lichess opening database, with every earlier move also in the book.',
  inaccuracy: 'Loses 5-10 winning-chance points.',
  mistake: 'Loses 10-20 winning-chance points.',
  miss: 'The chance was there and was not taken: an inaccuracy or mistake right after the opponent erred (10+ points), or a missed forced mate or clear win that leaves you still at 40% or better.',
  blunder: 'Loses more than 20 winning-chance points.',
};
