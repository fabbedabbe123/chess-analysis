import { Chess } from 'chess.js';
import { stripClockTags, type TrackedGame } from '@/chesscom/api';
import { bookContinuations, type OpeningBook } from '@/analysis/openings';
import { scorePct, type Record3 } from '@/chesscom/stats';

/**
 * Repertoire view: for each opening you play (per colour), how the games went and WHERE you leave the opening book.
 * "Book" = the bundled offline opening book (no engine involved). A move that is not in the book is not necessarily bad.
 */

export interface RepertoireRow extends Record3 {
  key: string;
  color: 'w' | 'b';
  name: string;
  /** Games where the line could be read. */
  read: number;
  /** Mean half-move at which the game first left the book. */
  avgExitPly: number;
  /** Share (0-100) of games where YOU played the first move out of book. */
  youLeftPct: number;
  /** Your most common first move out of book, e.g. "7…a6", with how often. */
  topDeviation: { label: string; count: number } | null;
  score: number;
}

export interface Repertoire {
  rows: RepertoireRow[];
  /** Games that could not be read (invalid PGN). */
  unreadable: number;
  considered: number;
}

interface Exit { ply: number; byMe: boolean; label: string }

/** First half-move that is not in the book, who played it, and how to write it. A game that is book to its last move "leaves" after it. */
export function bookExit(pgn: string, myColor: 'w' | 'b', book: OpeningBook): Exit | 'unreadable' {
  const chess = new Chess();
  try {
    chess.loadPgn(stripClockTags(pgn));
  } catch {
    return 'unreadable';
  }
  const moves = chess.history({ verbose: true });
  if (moves.length === 0) return 'unreadable';
  for (let i = 0; i < moves.length; i += 1) {
    const m = moves[i]!;
    const uci = `${m.from}${m.to}${m.promotion ?? ''}`;
    if (!bookContinuations(book, m.before).some((b) => b.uci === uci)) {
      const num = Math.floor(i / 2) + 1;
      return { ply: i + 1, byMe: m.color === myColor, label: `${num}${m.color === 'w' ? '.' : '…'}${m.san}` };
    }
  }
  return { ply: moves.length + 1, byMe: false, label: '' };
}

export function buildRepertoire(games: readonly TrackedGame[], book: OpeningBook, maxGames = 300, minGames = 2): Repertoire {
  const used = games.slice(0, maxGames);
  const acc = new Map<string, RepertoireRow & { exitSum: number; youLeft: number; devs: Map<string, number> }>();
  let unreadable = 0;
  for (const g of used) {
    if (g.opening === null) continue;
    const exit = bookExit(g.pgn, g.color, book);
    if (exit === 'unreadable') { unreadable += 1; continue; }
    const key = `${g.color}|${g.opening}`;
    let r = acc.get(key);
    if (r === undefined) {
      r = { key, color: g.color, name: g.opening, win: 0, draw: 0, loss: 0, games: 0, read: 0, avgExitPly: 0, youLeftPct: 0, topDeviation: null, score: 0, exitSum: 0, youLeft: 0, devs: new Map() };
      acc.set(key, r);
    }
    r[g.outcome] += 1;
    r.games += 1;
    r.read += 1;
    r.exitSum += exit.ply;
    if (exit.byMe) {
      r.youLeft += 1;
      r.devs.set(exit.label, (r.devs.get(exit.label) ?? 0) + 1);
    }
  }
  const rows: RepertoireRow[] = [];
  for (const r of acc.values()) {
    if (r.games < minGames) continue;
    let top: RepertoireRow['topDeviation'] = null;
    for (const [label, count] of r.devs) if (top === null || count > top.count) top = { label, count };
    rows.push({
      key: r.key, color: r.color, name: r.name, win: r.win, draw: r.draw, loss: r.loss, games: r.games, read: r.read,
      avgExitPly: r.exitSum / r.read,
      youLeftPct: (r.youLeft / r.read) * 100,
      topDeviation: top,
      score: scorePct(r),
    });
  }
  rows.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  return { rows, unreadable, considered: used.length };
}
