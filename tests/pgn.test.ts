import { describe, expect, it } from 'vitest';
import { addMove, createTree, getNode, mainLine, mainLineLength, setComment, setHeaders, setShapes, toggleNag } from '@/chess/gameTree';
import { exportPgn, parsePgn, tokenizeMovetext } from '@/pgn/pgn';
import type { GameTree } from '@/types/game';

/** Structure of the tree independent of node ids (for round-trip comparisons). */
type Shape = [string, number[], string, string, Shape[]];
function shapeOf(tree: GameTree, id: string = tree.rootId): Shape {
  const n = getNode(tree, id);
  // Order of drawn shapes carries no meaning (the exporter writes squares before arrows).
  const shapes = n.shapes.map((s) => `${s.color}:${s.from}${s.to ?? ''}`).sort().join(',');
  return [n.san, n.nags, n.comment, shapes, n.children.map((c) => shapeOf(tree, c))];
}

function firstGame(text: string) {
  const parsed = parsePgn(text);
  const game = parsed.games[0];
  if (game === undefined) throw new Error(`no game parsed: ${parsed.errors.join('; ')}`);
  return game;
}

function sans(tree: GameTree): string[] {
  return mainLine(tree).slice(1).map((id) => getNode(tree, id).san);
}

describe('PGN import', () => {
  it('imports a simple game with result', () => {
    const game = firstGame('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0');
    expect(sans(game.tree)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(game.result).toBe('1-0');
    expect(game.warnings).toEqual([]);
    expect(game.tree.headers['Result']).toBe('1-0');
  });

  it('reads headers, including escaped quotes', () => {
    const game = firstGame(`[Event "Club \\"Spring\\" Open"]
[Site "Lund, SWE"]
[Date "2026.03.14"]
[White "Alice"]
[Black "Bob"]
[Result "1/2-1/2"]
[WhiteElo "1850"]

1. d4 d5 1/2-1/2`);
    expect(game.tree.headers['Event']).toBe('Club "Spring" Open');
    expect(game.tree.headers['White']).toBe('Alice');
    expect(game.tree.headers['WhiteElo']).toBe('1850');
    expect(game.result).toBe('1/2-1/2');
  });

  it('parses comments, NAGs and suffix annotations', () => {
    const game = firstGame('1. e4 {Best by test by far} e5 $1 2. Nf3! Nc6?! *');
    const line = mainLine(game.tree).map((id) => getNode(game.tree, id));
    expect(line[1]?.comment).toBe('Best by test by far');
    expect(line[2]?.nags).toEqual([1]);
    expect(line[3]?.nags).toEqual([1]); // "!"
    expect(line[4]?.nags).toEqual([6]); // "?!"
  });

  it('parses variations and nested variations onto the right parent', () => {
    const game = firstGame('1. e4 e5 (1... c5 (1... e6 2. d4) 2. Nf3) 2. Nf3 *');
    const tree = game.tree;
    const e4 = getNode(tree, getNode(tree, tree.rootId).children[0] as string);
    const replies = e4.children.map((id) => getNode(tree, id));
    expect(replies.map((n) => n.san)).toEqual(['e5', 'c5', 'e6']);
    // 2. Nf3 follows e5 (main), 2. Nf3 also follows c5 (variation)
    expect(getNode(tree, replies[0]?.children[0] as string).san).toBe('Nf3');
    expect(getNode(tree, replies[1]?.children[0] as string).san).toBe('Nf3');
    expect(getNode(tree, replies[2]?.children[0] as string).san).toBe('d4');
    expect(game.warnings).toEqual([]);
  });

  it('handles castling written with zeros, promotion and en passant', () => {
    const castling = firstGame('[SetUp "1"]\n[FEN "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"]\n\n1. 0-0 0-0-0 *');
    expect(sans(castling.tree)).toEqual(['O-O', 'O-O-O']);

    // the new queen on a8 does not attack the king on h7, so there is no check suffix
    const promotion = firstGame('[FEN "8/P6k/8/8/8/8/7K/8 w - - 0 1"]\n\n1. a8=Q Kg6 *');
    expect(sans(promotion.tree)).toEqual(['a8=Q', 'Kg6']);
    // a check suffix written by the source ("+") is accepted and regenerated correctly
    const withCheck = firstGame('[FEN "7k/P7/8/8/8/8/8/K7 w - - 0 1"]\n\n1. a8=Q+ *');
    expect(sans(withCheck.tree)).toEqual(['a8=Q+']);
    expect(withCheck.warnings).toEqual([]);

    const ep = firstGame('1. e4 a6 2. e5 d5 3. exd6 *');
    expect(sans(ep.tree)[4]).toBe('exd6');
    expect(ep.warnings).toEqual([]);
  });

  it('accepts move numbers glued to moves and ; comments, % lines and CRLF/BOM', () => {
    const text = '﻿[Event "x"]\r\n\r\n% ignored escape line\r\n1.e4 e5 ; rest of line comment\r\n2.Nf3 Nc6 *\r\n';
    const game = firstGame(text);
    expect(sans(game.tree)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(getNode(game.tree, mainLine(game.tree)[2] as string).comment).toBe('rest of line comment');
  });

  it('takes the result from the header when the movetext has none', () => {
    const game = firstGame('[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4#');
    expect(game.result).toBe('0-1');
  });

  it('parses [%cal] and [%csl] drawing commands into shapes and keeps other commands', () => {
    const game = firstGame('1. e4 {[%cal Ge2e4,Rd1h5] [%csl Gd4] [%clk 0:05:00] Opening move} e5 *');
    const e4 = getNode(game.tree, mainLine(game.tree)[1] as string);
    expect(e4.shapes).toHaveLength(3);
    expect(e4.shapes).toContainEqual({ from: 'e2', to: 'e4', color: 'green' });
    expect(e4.shapes).toContainEqual({ from: 'd1', to: 'h5', color: 'red' });
    expect(e4.shapes).toContainEqual({ from: 'd4', color: 'green' });
    expect(e4.comment).toBe('[%clk 0:05:00] Opening move');
  });

  it('imports several games from one file', () => {
    const text = `[Event "One"]\n\n1. e4 e5 *\n\n[Event "Two"]\n\n1. d4 d5 0-1\n\n[Event "Three"]\n\n1. c4 *`;
    const parsed = parsePgn(text);
    expect(parsed.games).toHaveLength(3);
    expect(parsed.games.map((g) => g.tree.headers['Event'])).toEqual(['One', 'Two', 'Three']);
    expect(parsed.games[1]?.result).toBe('0-1');
  });

  it('does not mistake "[" inside a comment for a header', () => {
    const parsed = parsePgn('1. e4 {see\n[Event "not a header"]\nmore} e5 *');
    expect(parsed.games).toHaveLength(1);
    expect(sans(parsed.games[0]?.tree as GameTree)).toEqual(['e4', 'e5']);
  });
});

describe('PGN import errors (never silently discard data)', () => {
  it('imports up to an illegal move and warns with a useful message', () => {
    const game = firstGame('1. e4 e5 2. Nf6 Nc6 *');
    expect(sans(game.tree)).toEqual(['e4', 'e5']);
    expect(game.warnings).toHaveLength(1);
    expect(game.warnings[0]).toContain('Nf6');
    expect(game.warnings[0]).toContain('after 1... e5');
    expect(game.warnings[0]).toContain('Imported 2 moves');
  });

  it('skips only the broken variation and keeps the rest of the game', () => {
    const game = firstGame('1. e4 e5 (1... Qh5 2. Nf3) 2. Nf3 Nc6 *');
    expect(sans(game.tree)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(game.warnings[0]).toContain('Qh5');
    expect(game.warnings[0]).toContain('variation was skipped');
    // the e4 node must have only the e5 reply
    const e4 = getNode(game.tree, mainLine(game.tree)[1] as string);
    expect(e4.children).toHaveLength(1);
  });

  it('reports null moves as unsupported', () => {
    const game = firstGame('1. e4 -- 2. d4 *');
    expect(game.warnings.join(' ')).toContain('null moves');
  });

  it('warns about unclosed variations and stray parentheses', () => {
    const unclosed = firstGame('1. e4 e5 (1... c5 2. Nf3 *');
    expect(unclosed.warnings.join(' ')).toContain('not closed');
    const stray = firstGame('1. e4 e5 ) 2. Nf3 *');
    expect(stray.warnings.join(' ')).toContain('stray');
  });

  it('returns an error for empty input', () => {
    const parsed = parsePgn('   \n  ');
    expect(parsed.games).toHaveLength(0);
    expect(parsed.errors[0]).toContain('No PGN data');
  });

  it('warns when the text contains no readable moves', () => {
    const parsed = parsePgn('hello world');
    expect(parsed.games).toHaveLength(1);
    expect(parsed.games[0]?.warnings.join(' ')).toContain('hello');
  });

  it('rejects unsupported variants and invalid FEN headers per game, still importing the others', () => {
    const parsed = parsePgn(`[Variant "Crazyhouse"]\n\n1. e4 e5 *\n\n[Event "ok"]\n\n1. d4 *\n\n[FEN "not a fen"]\n\n1. e4 *`);
    expect(parsed.games).toHaveLength(1);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0]).toContain('Crazyhouse');
    expect(parsed.errors[1]).toContain('FEN');
  });
});

describe('PGN export', () => {
  function buildAnnotated(): GameTree {
    let tree = createTree(undefined, { Event: 'Round trip', White: 'Alice', Black: 'Bob', Result: '1-0' });
    const play = (parent: string, san: string): string => {
      const r = addMove(tree, parent, san);
      if (!r.ok) throw new Error(r.error);
      tree = r.tree;
      return r.nodeId;
    };
    const e4 = play(tree.rootId, 'e4');
    const e5 = play(e4, 'e5');
    const nf3 = play(e5, 'Nf3');
    play(nf3, 'Nc6');
    const c5 = play(e4, 'c5'); // variation at move 1 for Black
    play(c5, 'Nf3');
    const bc4 = play(e5, 'Bc4'); // variation at move 2 for White
    tree = setComment(tree, e4, 'Best by test');
    tree = toggleNag(tree, nf3, 1);
    tree = setComment(tree, bc4, 'Italian');
    tree = setShapes(tree, e4, [
      { from: 'e2', to: 'e4', color: 'green' },
      { from: 'd4', color: 'red' },
    ]);
    return tree;
  }

  it('writes the seven tag roster first, with defaults for missing tags', () => {
    const pgn = exportPgn(createTree());
    const lines = pgn.split('\n');
    expect(lines.slice(0, 7)).toEqual([
      '[Event "?"]',
      '[Site "?"]',
      '[Date "????.??.??"]',
      '[Round "?"]',
      '[White "?"]',
      '[Black "?"]',
      '[Result "*"]',
    ]);
    expect(pgn.trimEnd().endsWith('*')).toBe(true);
  });

  it('writes variations, comments and NAGs with correct move numbers', () => {
    const pgn = exportPgn(buildAnnotated());
    expect(pgn).toContain('1. e4');
    expect(pgn).toContain('(1... c5 2. Nf3)');
    expect(pgn).toContain('(2. Bc4 {Italian})');
    expect(pgn).toContain('$1');
    expect(pgn).toContain('{[%csl Rd4] [%cal Ge2e4] Best by test}');
    // after a comment Black's move repeats the move number
    expect(pgn).toContain('1... e5');
    expect(pgn.trimEnd().endsWith('1-0')).toBe(true);
  });

  it('can omit variations and comments', () => {
    const pgn = exportPgn(buildAnnotated(), { includeVariations: false, includeComments: false });
    expect(pgn).not.toContain('(');
    expect(pgn).not.toContain('{');
    expect(pgn).not.toContain('$1');
    expect(pgn).toContain('1. e4 e5 2. Nf3 Nc6');
  });

  it('round-trips structure, comments, NAGs, shapes and headers', () => {
    const original = buildAnnotated();
    const reparsed = firstGame(exportPgn(original)).tree;
    expect(shapeOf(reparsed)).toEqual(shapeOf(original));
    expect(reparsed.headers['Event']).toBe('Round trip');
    expect(reparsed.headers['White']).toBe('Alice');
  });

  it('round-trips a game starting from a custom position', () => {
    let tree = createTree('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 9');
    const r = addMove(tree, tree.rootId, 'O-O');
    if (!r.ok) throw new Error(r.error);
    tree = r.tree;
    const pgn = exportPgn(tree);
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain('[FEN "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 9"]');
    expect(pgn).toContain('9... O-O');
    const again = firstGame(pgn).tree;
    expect(shapeOf(again)).toEqual(shapeOf(tree));
  });

  it('escapes quotes in headers and braces in comments', () => {
    let tree = setHeaders(createTree(), { Event: 'The "Big" one' });
    const r = addMove(tree, tree.rootId, 'e4');
    if (!r.ok) throw new Error(r.error);
    tree = setComment(r.tree, r.nodeId, 'nasty } comment');
    const pgn = exportPgn(tree);
    expect(pgn).toContain('[Event "The \\"Big\\" one"]');
    const again = firstGame(pgn).tree;
    expect(again.headers['Event']).toBe('The "Big" one');
    expect(getNode(again, mainLine(again)[1] as string).comment).toBe('nasty ) comment');
  });

  it('wraps movetext at 80 columns', () => {
    const long = firstGame(
      '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8 *',
    );
    const pgn = exportPgn(long.tree);
    const movetext = pgn.split('\n\n')[1] as string;
    for (const line of movetext.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    expect(movetext.split('\n').length).toBeGreaterThan(1);
    // wrapping must not change the content
    expect(sans(firstGame(pgn).tree)).toEqual(sans(long.tree));
  });
});

describe('tokenizer', () => {
  it('splits movetext into typed tokens', () => {
    const tokens = tokenizeMovetext('1. e4 {c} e5 $2 (1... c5) 1-0');
    expect(tokens.map((t) => t.type)).toEqual(['move', 'comment', 'move', 'nag', 'open', 'move', 'close', 'result']);
  });

  it('does not treat a move number prefix like "1-0" inside a SAN as a result', () => {
    const tokens = tokenizeMovetext('1. e4 1-0');
    expect(tokens.filter((t) => t.type === 'result')).toHaveLength(1);
  });
});

describe('tags on one line', () => {
  it('reads several tags written on the same line', () => {
    const r = parsePgn('[Event "Casual"][White "Fabian"][Black "Opp"][Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 1-0');
    expect(r.errors).toEqual([]);
    expect(r.games).toHaveLength(1);
    const h = r.games[0]!.tree.headers;
    expect(h['White']).toBe('Fabian');
    expect(h['Result']).toBe('1-0');
    expect(mainLineLength(r.games[0]!.tree)).toBe(4);
  });
  it('does not treat a bracket inside a comment as tags', () => {
    const r = parsePgn('[Event "x"]\n\n1. e4 {[White "no"]} e5 *');
    expect(r.games[0]!.tree.headers['White']).not.toBe('no');
  });
});
