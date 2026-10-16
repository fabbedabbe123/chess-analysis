import { describe, expect, it } from 'vitest';
import { formatPv, pvToSan, splitUci } from '@/analysis/pv';
import { START_FEN } from '@/chess/fen';
import {
  DEFAULT_SETTINGS,
  engineOptionsFrom,
  sanitizeSettings,
  searchLimitsFrom,
} from '@/stores/settingsStore';

describe('pvToSan', () => {
  it('converts a UCI line to SAN with numbering metadata', () => {
    const result = pvToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    expect(result.truncated).toBe(false);
    expect(result.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(result.moves.map((m) => [m.moveNumber, m.color])).toEqual([
      [1, 'w'],
      [1, 'b'],
      [2, 'w'],
      [2, 'b'],
    ]);
    expect(formatPv(result.moves)).toBe('1. e4 e5 2. Nf3 Nc6');
  });

  it('starts with "..." when Black is to move', () => {
    const result = pvToSan('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ['e7e5', 'g1f3']);
    expect(formatPv(result.moves)).toBe('1... e5 2. Nf3');
  });

  it('handles castling (king move in UCI), promotion, capture, check and mate flags', () => {
    const castle = pvToSan('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1g1']);
    expect(castle.moves[0]?.san).toBe('O-O');

    const promo = pvToSan('8/4P2k/8/8/8/8/7K/8 w - - 0 1', ['e7e8q']);
    expect(promo.moves[0]?.san).toBe('e8=Q');

    const mate = pvToSan('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', ['h5f7']);
    expect(mate.moves[0]).toMatchObject({ san: 'Qxf7#', isCapture: true, isCheck: true, isMate: true });
  });

  it('cuts the line at the first illegal move instead of throwing', () => {
    const result = pvToSan(START_FEN, ['e2e4', 'e7e5', 'e4e5', 'g1f3']);
    expect(result.truncated).toBe(true);
    expect(result.moves.map((m) => m.san)).toEqual(['e4', 'e5']);
  });

  it('handles garbage input safely', () => {
    expect(pvToSan('not a fen', ['e2e4'])).toEqual({ moves: [], truncated: true });
    expect(pvToSan(START_FEN, ['zzzz']).truncated).toBe(true);
    expect(pvToSan(START_FEN, []).moves).toEqual([]);
    expect(splitUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
    expect(splitUci('e7')).toBeNull();
  });

  it('respects the maximum number of plies', () => {
    const result = pvToSan(START_FEN, ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3'], 3);
    expect(result.moves).toHaveLength(3);
  });
});

describe('settings sanitising', () => {
  it('returns defaults for missing or corrupt data', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings([])).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and replaces invalid ones field by field', () => {
    const result = sanitizeSettings({
      theme: 'light',
      boardTheme: 'neon', // invalid
      pieceSet: 'merida',
      multiPv: 99, // clamped
      analysisDepth: -5, // clamped
      hashMb: 'big', // invalid
      soundEnabled: 'yes', // invalid
      elo: 5000, // clamped
    });
    expect(result.theme).toBe('light');
    expect(result.boardTheme).toBe(DEFAULT_SETTINGS.boardTheme);
    expect(result.pieceSet).toBe('merida');
    expect(result.multiPv).toBe(8);
    expect(result.analysisDepth).toBe(1);
    expect(result.hashMb).toBe(DEFAULT_SETTINGS.hashMb);
    expect(result.soundEnabled).toBe(true); // invalid value falls back to the default (on)
    expect(result.elo).toBe(3190);
  });

  it('keeps classification thresholds ordered', () => {
    const result = sanitizeSettings({ thresholds: { excellent: 10, good: 2, inaccuracy: 1, mistake: 0 } });
    const t = result.thresholds;
    expect(t.excellent).toBeLessThanOrEqual(t.good);
    expect(t.good).toBeLessThanOrEqual(t.inaccuracy);
    expect(t.inaccuracy).toBeLessThanOrEqual(t.mistake);
  });

  it('derives search limits from the analysis mode', () => {
    expect(searchLimitsFrom({ ...DEFAULT_SETTINGS, analysisMode: 'depth', analysisDepth: 22 })).toEqual({ depth: 22 });
    expect(searchLimitsFrom({ ...DEFAULT_SETTINGS, analysisMode: 'time', analysisTimeMs: 1500 })).toEqual({ movetimeMs: 1500 });
    expect(searchLimitsFrom({ ...DEFAULT_SETTINGS, analysisMode: 'infinite' })).toEqual({ infinite: true });
  });

  it('derives engine options', () => {
    const options = engineOptionsFrom({ ...DEFAULT_SETTINGS, hashMb: 64, limitStrength: true, elo: 1800 });
    expect(options).toMatchObject({ hashMb: 64, limitStrength: true, elo: 1800 });
  });
});
