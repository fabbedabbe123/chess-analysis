import { describe, expect, it } from 'vitest';
import { parseBestMove, parseInfoLine, parseOptionLine } from '@/engine/uci';

describe('parseInfoLine', () => {
  it('parses a real Stockfish 19 line with a forced mate', () => {
    // captured from the bundled engine
    const info = parseInfoLine('info depth 8 seldepth 2 multipv 1 score mate 1 nodes 2746 nps 119391 hashfull 1 time 23 pv h5f7');
    expect(info).toEqual({
      depth: 8,
      seldepth: 2,
      multipv: 1,
      score: { pov: 'stm', kind: 'mate', value: 1 },
      bound: 'exact',
      nodes: 2746,
      nps: 119391,
      hashfull: 1,
      timeMs: 23,
      pv: ['h5f7'],
    });
  });

  it('parses negative centipawn scores and long principal variations', () => {
    const info = parseInfoLine(
      'info depth 12 seldepth 20 multipv 3 score cp -229 nodes 13242 nps 136515 hashfull 6 time 97 pv h5g5 f6e4 g5d8 e8d8 c4f7 f8c5 g1f3',
    );
    expect(info?.multipv).toBe(3);
    expect(info?.score).toEqual({ pov: 'stm', kind: 'cp', value: -229 });
    expect(info?.pv).toHaveLength(7);
    expect(info?.pv[0]).toBe('h5g5');
  });

  it('negative mate scores mean the side to move gets mated', () => {
    const info = parseInfoLine('info depth 20 multipv 1 score mate -3 nodes 1 nps 1 time 1 pv e1e2');
    expect(info?.score).toEqual({ pov: 'stm', kind: 'mate', value: -3 });
  });

  it('flags lowerbound and upperbound scores', () => {
    expect(parseInfoLine('info depth 20 seldepth 25 multipv 1 score cp 55 lowerbound nodes 123 nps 1 time 5 pv e2e4')?.bound).toBe('lower');
    expect(parseInfoLine('info depth 20 seldepth 25 multipv 1 score cp 55 upperbound nodes 123 nps 1 time 5 pv e2e4')?.bound).toBe('upper');
    expect(parseInfoLine('info depth 20 multipv 1 score cp 55 nodes 123 pv e2e4')?.bound).toBe('exact');
  });

  it('defaults multipv to 1 when the engine omits it', () => {
    expect(parseInfoLine('info depth 5 score cp 10 nodes 5 pv e2e4')?.multipv).toBe(1);
  });

  it('parses win/draw/loss when UCI_ShowWDL is on', () => {
    const info = parseInfoLine('info depth 10 seldepth 12 multipv 1 score cp 20 wdl 400 500 100 nodes 100 nps 1000 time 10 pv e2e4');
    expect(info?.wdl).toEqual([400, 500, 100]);
    expect(info?.nodes).toBe(100);
  });

  it('keeps promotion moves in the PV', () => {
    expect(parseInfoLine('info depth 9 multipv 1 score mate 2 pv e7e8q h7g6 e8e6')?.pv).toEqual(['e7e8q', 'h7g6', 'e8e6']);
  });

  it('allows a score without a pv', () => {
    const info = parseInfoLine('info depth 1 seldepth 1 multipv 1 score cp 0 nodes 1 nps 1 time 0');
    expect(info?.pv).toEqual([]);
  });

  it.each([
    ['info string NNUE evaluation using nn-61e7af4bb97d.nnue'],
    ['info depth 12 currmove e2e4 currmovenumber 1'],
    ['info nodes 100 nps 5000'],
    ['info depth 5 nodes 1000'], // no score
    ['bestmove e2e4'],
    ['uciok'],
    [''],
  ])('ignores lines without a usable search result: %s', (line) => {
    expect(parseInfoLine(line)).toBeNull();
  });

  it('does not read "string" text as numbers', () => {
    expect(parseInfoLine('info string depth 99 score cp 12345')).toBeNull();
  });
});

describe('parseBestMove', () => {
  it('parses move and ponder', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ move: 'e2e4', ponder: 'e7e5' });
  });

  it('parses a move without ponder and a promotion', () => {
    expect(parseBestMove('bestmove h5f7')).toEqual({ move: 'h5f7', ponder: null });
    expect(parseBestMove('bestmove e7e8q')).toEqual({ move: 'e7e8q', ponder: null });
  });

  it('maps "no legal move" answers to null', () => {
    expect(parseBestMove('bestmove (none)')).toEqual({ move: null, ponder: null });
    expect(parseBestMove('bestmove 0000')).toEqual({ move: null, ponder: null });
  });

  it('returns null for other lines', () => {
    expect(parseBestMove('info depth 1 score cp 0 pv e2e4')).toBeNull();
    expect(parseBestMove('readyok')).toBeNull();
  });
});

describe('parseOptionLine', () => {
  it('parses spin options with multi-word names (real engine lines)', () => {
    expect(parseOptionLine('option name Skill Level type spin default 20 min 0 max 20')).toEqual({
      name: 'Skill Level',
      type: 'spin',
      default: '20',
      min: 0,
      max: 20,
    });
    expect(parseOptionLine('option name UCI_Elo type spin default 1320 min 1320 max 3190')).toMatchObject({
      name: 'UCI_Elo',
      min: 1320,
      max: 3190,
    });
  });

  it('parses check, button, string and combo options', () => {
    expect(parseOptionLine('option name UCI_LimitStrength type check default false')).toEqual({
      name: 'UCI_LimitStrength',
      type: 'check',
      default: 'false',
    });
    expect(parseOptionLine('option name Clear Hash type button')).toEqual({ name: 'Clear Hash', type: 'button' });
    expect(parseOptionLine('option name EvalFile type string default nn-61e7af4bb97d.nnue')).toMatchObject({
      type: 'string',
      default: 'nn-61e7af4bb97d.nnue',
    });
    expect(parseOptionLine('option name Style type combo default Normal var Solid var Normal var Risky')).toEqual({
      name: 'Style',
      type: 'combo',
      default: 'Normal',
      vars: ['Solid', 'Normal', 'Risky'],
    });
  });

  it('returns null for malformed option lines', () => {
    expect(parseOptionLine('option foo')).toBeNull();
    expect(parseOptionLine('option name Broken')).toBeNull();
    expect(parseOptionLine('option name X type weird')).toBeNull();
    expect(parseOptionLine('id name Stockfish')).toBeNull();
  });
});
