import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { getNode, needsPromotion, statusAt } from '@/chess/gameTree';
import { splitUci } from '@/analysis/pv';
import { gameStore, playMove, setShapes, useGame } from '@/stores/gameStore';
import { engineStore, useEngine } from '@/stores/engineStore';
import { useSettings } from '@/stores/settingsStore';
import { useUi } from '@/stores/uiStore';
import { boardLocked, useOrientation, usePuzzle } from '@/stores/puzzleStore';
import { playBoardLocked, usePlay } from '@/stores/playStore';
import type { MoveInput, PromotionPiece, Shape, ShapeColor, Square } from '@/types/game';
import { playSound } from '@/utils/sound';

const USER_BRUSHES = new Set<string>(['green', 'red', 'blue', 'yellow']);

function legalDests(fen: string): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  try {
    const chess = new Chess(fen);
    for (const m of chess.moves({ verbose: true })) {
      const list = dests.get(m.from as Key) ?? [];
      list.push(m.to as Key);
      dests.set(m.from as Key, list);
    }
  } catch {
    // invalid position: nothing is movable
  }
  return dests;
}

function toDrawShapes(shapes: readonly Shape[]): DrawShape[] {
  return shapes.map((s) => ({ orig: s.from as Key, ...(s.to !== undefined ? { dest: s.to as Key } : {}), brush: s.color }));
}

function fromDrawShapes(shapes: readonly DrawShape[]): Shape[] {
  const out: Shape[] = [];
  for (const s of shapes) {
    if (s.brush === undefined || !USER_BRUSHES.has(s.brush)) continue;
    out.push({
      from: s.orig as Square,
      ...(s.dest !== undefined && s.dest !== s.orig ? { to: s.dest as Square } : {}),
      color: s.brush as ShapeColor,
    });
  }
  return out;
}

const sameShapes = (a: readonly Shape[], b: readonly Shape[]) =>
  a.length === b.length && a.every((s, i) => s.from === b[i]?.from && s.to === b[i]?.to && s.color === b[i]?.color);

const PROMOTION_CHOICES: PromotionPiece[] = ['q', 'r', 'b', 'n'];

export function ChessBoard() {
  const settings = useSettings();
  const tree = useGame((s) => s.tree);
  const currentId = useGame((s) => s.currentId);
  const node = getNode(tree, currentId);
  const fen = node.fen;
  const status = useMemo(() => statusAt(tree, currentId), [tree, currentId]);
  const snapshot = useEngine((s) => s.snapshot);
  const requestedFen = useEngine((s) => s.requestedFen);

  const tacticSquares = useUi((s) => s.tacticSquares);
  const idRef = useRef(currentId);
  idRef.current = currentId;
  const host = useRef<HTMLDivElement>(null);
  const cg = useRef<Api | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const lastSoundNode = useRef<string>(currentId);

  const turn = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const puzzleOpen = usePuzzle((s) => s.phase !== 'off');
  const puzzleLocked = usePuzzle(boardLocked);
  const playLocked = usePlay(playBoardLocked);
  const locked = puzzleOpen ? puzzleLocked : playLocked;
  const orientation = useOrientation();
  const gameOver = status.kind !== 'ongoing';
  const noMoves = gameOver || locked;
  const inCheck = status.kind === 'checkmate' || (status.kind === 'ongoing' && status.inCheck);

  // Create the board once.
  useEffect(() => {
    if (host.current === null) return;
    const api = Chessground(host.current, {
      animation: { enabled: true, duration: 160 },
      highlight: { lastMove: true, check: true },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      premovable: { enabled: false },
      drawable: {
        enabled: true,
        onChange: (shapes) => {
          const next = fromDrawShapes(shapes);
          if (!sameShapes(getNode(gameStore.get().tree, idRef.current).shapes, next)) setShapes(idRef.current, next);
        },
      },
    });
    cg.current = api;
    return () => {
      api.destroy();
      cg.current = null;
    };
  }, []);


  // Position, highlights, movable squares.
  useEffect(() => {
    const api = cg.current;
    if (api === null) return;
    const last = node.uci !== '' ? splitUci(node.uci) : null;
    api.set({
      fen,
      orientation,
      turnColor: turn,
      check: inCheck ? turn : false,
      lastMove: last !== null && settings.highlightLastMove ? [last.from as Key, last.to as Key] : undefined,
      coordinates: settings.showCoordinates,
      movable: {
        free: false,
        color: noMoves ? undefined : turn,
        dests: noMoves ? new Map() : legalDests(fen),
        showDests: settings.showLegalMoves,
        events: {
          after: (orig, dest) => {
            const from = orig as Square;
            const to = dest as Square;
            if (needsPromotion(fen, from, to)) {
              setPromotion({ from, to });
              return;
            }
            const result = playMove({ from, to });
            if (!result.ok) api.set({ fen }); // snap back
          },
        },
      },
    });
  }, [fen, node.uci, turn, inCheck, noMoves, orientation, settings.highlightLastMove, settings.showCoordinates, settings.showLegalMoves]);

  // User drawn arrows / squares belong to the selected node.
  useEffect(() => {
    const api = cg.current;
    if (api === null) return;
    api.setShapes(toDrawShapes(node.shapes));
  }, [node.shapes, currentId]);

  // Engine arrows (never drawn for another position than the one displayed).
  const engineArrows = useMemo<DrawShape[]>(() => {
    if (!settings.showEngineArrows || snapshot === null || requestedFen !== fen || snapshot.fen !== fen || gameOver) return [];
    const arrows: DrawShape[] = [];
    snapshot.lines.slice(0, 3).forEach((line, i) => {
      const first = line.pv[0] !== undefined ? splitUci(line.pv[0]) : null;
      if (first === null) return;
      arrows.push({
        orig: first.from as Key,
        dest: first.to as Key,
        brush: i === 0 ? 'paleBlue' : 'paleGrey',
        modifiers: { lineWidth: i === 0 ? 11 : 7 },
      });
    });
    return arrows;
  }, [snapshot, requestedFen, fen, settings.showEngineArrows, gameOver]);

  const autoShapes = useMemo<DrawShape[]>(
    () => [...engineArrows, ...tacticSquares.map((sq): DrawShape => ({ orig: sq as Key, brush: 'yellow' }))],
    [engineArrows, tacticSquares],
  );

  // A board hidden by a mobile tab has no size; drawing arrows then produces NaN SVG coordinates. Draw once it is visible.
  const userShapesRef = useRef(node.shapes);
  userShapesRef.current = node.shapes;
  const autoShapesRef = useRef(autoShapes);
  autoShapesRef.current = autoShapes;
  useEffect(() => {
    const el = host.current;
    if (el !== null && el.offsetWidth === 0) return;
    cg.current?.setAutoShapes(autoShapes);
  }, [autoShapes]);
  useEffect(() => {
    const el = host.current;
    if (el === null || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const api = cg.current;
      if (api === null) return;
      if (el.offsetWidth > 0) {
        api.setAutoShapes(autoShapesRef.current);
        api.setShapes(toDrawShapes(userShapesRef.current));
      } else {
        api.setAutoShapes([]);
        api.setShapes([]);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Optional sound on new positions.
  useEffect(() => {
    if (lastSoundNode.current === currentId) return;
    lastSoundNode.current = currentId;
    if (!settings.soundEnabled || node.uci === '') return;
    playSound(gameOver ? 'end' : inCheck ? 'check' : node.san.includes('x') ? 'capture' : 'move');
  }, [currentId, settings.soundEnabled, node.uci, node.san, gameOver, inCheck]);

  const choosePromotion = (piece: PromotionPiece | null) => {
    const pending = promotion;
    setPromotion(null);
    if (pending === null) return;
    if (piece === null) {
      cg.current?.set({ fen }); // cancelled: restore the board
      return;
    }
    const input: MoveInput = { from: pending.from, to: pending.to, promotion: piece };
    if (!playMove(input).ok) cg.current?.set({ fen });
  };

  const color = turn === 'white' ? 'w' : 'b';
  return (
    <div className="board-frame">
      <div
        className={`board-wrap pieces-${settings.pieceSet} theme-${settings.boardTheme}`}
        role="application"
        data-fen={fen}
        data-node={currentId}
        aria-label={`Chess board. ${turn === 'white' ? 'White' : 'Black'} to move.`}
      >
        <div ref={host} className="board-host" data-testid="board" />
        {promotion !== null && (
          <div className="promotion" role="dialog" aria-label="Choose promotion piece" onClick={() => choosePromotion(null)}>
            <div className="promotion-box" onClick={(e) => e.stopPropagation()}>
              {PROMOTION_CHOICES.map((p) => (
                <button
                  key={p}
                  className="promo-btn"
                  aria-label={{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[p]}
                  onClick={() => choosePromotion(p)}
                  style={{
                    backgroundImage: `url('${import.meta.env.BASE_URL}pieces/${settings.pieceSet}/${color}${p.toUpperCase()}.svg')`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Used by tests/other components that need the live (non-React) engine state. */
export const peekEngine = () => engineStore.get();
