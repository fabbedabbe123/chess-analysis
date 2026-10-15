import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { MoveList } from '@/components/MoveList';
import { getNode } from '@/chess/gameTree';
import { goStart, gameStore, loadGame, playMove, resetGameStoreForTests } from '@/stores/gameStore';
import { parsePgn } from '@/pgn/pgn';

const html = () => renderToString(createElement(MoveList));
const nodeIds = (h: string) => [...h.matchAll(/data-node="([^"]+)"/g)].map((m) => m[1]);

beforeEach(() => resetGameStoreForTests());

describe('move list rendering', () => {
  it('shows every node exactly once, including a variation that starts at move 1 (regression: duplicated root alternatives)', () => {
    playMove('e4');
    goStart();
    playMove('d4');
    const ids = nodeIds(html());
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('renders each node of a complex tree once and marks only the selected one', () => {
    const game = parsePgn('1. e4 (1. d4 d5 (1... Nf6 2. c4) 2. c4) 1... e5 (1... c5 2. Nf3 (2. c3)) 2. Nf3 *').games[0]!;
    loadGame(game.tree);
    const h = html();
    const ids = nodeIds(h);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(Object.keys(gameStore.get().tree.nodes).length - 1);
    expect(h.match(/aria-current="true"/g) ?? []).toHaveLength(0); // cursor is at the start position
    expect(getNode(gameStore.get().tree, gameStore.get().currentId).ply).toBe(0);
  });
});
