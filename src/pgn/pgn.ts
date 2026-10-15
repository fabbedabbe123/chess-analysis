import { validateAndNormalizeFen } from '@/chess/fen';
import {
  addMove,
  createTree,
  getNode,
  rootNode,
  setComment,
  setHeaders,
  setShapes,
} from '@/chess/gameTree';
import type {
  GameResultText,
  GameTree,
  MoveNode,
  PgnHeaders,
  Shape,
  ShapeColor,
  Square,
} from '@/types/game';

// ------------------------------------------------------------------ constants

const SEVEN_TAG_ORDER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'] as const;
const SEVEN_TAG_DEFAULTS: Record<string, string> = {
  Event: '?',
  Site: '?',
  Date: '????.??.??',
  Round: '?',
  White: '?',
  Black: '?',
  Result: '*',
};

const SUFFIX_NAGS: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
const NAG_SUFFIX: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };
const SHAPE_LETTER: Record<string, ShapeColor> = { G: 'green', R: 'red', B: 'blue', Y: 'yellow' };
const SHAPE_COLOR_LETTER: Record<ShapeColor, string> = { green: 'G', red: 'R', blue: 'B', yellow: 'Y' };

export function nagToSymbol(nag: number): string | null {
  return NAG_SUFFIX[nag] ?? null;
}

// --------------------------------------------------------------------- result

export interface ParsedGame {
  tree: GameTree;
  result: GameResultText | null;
  /** Non-fatal problems (partial import, ignored data ...). Always show these to the user. */
  warnings: string[];
}

export interface PgnParseResult {
  games: ParsedGame[];
  /** Problems that prevented importing a whole game. */
  errors: string[];
}

// ---------------------------------------------------------------- game splitting

const HEADER_RE = /^\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/;

const TAG_SRC = '\\[\\s*[A-Za-z0-9_]+\\s+"(?:[^"\\\\]|\\\\.)*"\\s*\\]';
const MULTI_TAG_LINE = new RegExp(`^(?:${TAG_SRC}\\s*)+$`);
const TAG_G = new RegExp(TAG_SRC, 'g');

interface RawGame {
  headerLines: string[];
  moveLines: string[];
}

function splitGames(text: string): RawGame[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const games: RawGame[] = [];
  let current: RawGame | null = null;
  let sawMoves = false;
  let braceDepth = 0;

  for (const line of lines) {
    if (line.startsWith('%')) continue; // PGN escape mechanism
    const trimmed = line.trim();
    // Several tags on one line (`[Event "x"][White "y"]`, as some sites and copy-pastes produce) count as separate tag lines.
    const tags = braceDepth === 0 ? (HEADER_RE.test(trimmed) ? [trimmed] : MULTI_TAG_LINE.test(trimmed) ? (trimmed.match(TAG_G) ?? []) : []) : [];
    if (tags.length > 0) {
      if (current === null || sawMoves) {
        current = { headerLines: [], moveLines: [] };
        games.push(current);
        sawMoves = false;
      }
      current.headerLines.push(...tags);
      continue;
    }
    if (trimmed.length === 0) continue;
    if (current === null) {
      current = { headerLines: [], moveLines: [] };
      games.push(current);
    }
    current.moveLines.push(line);
    sawMoves = true;
    // Track braces so a "[" inside a comment is never mistaken for a header.
    for (const ch of line) {
      if (ch === '{') braceDepth = 1;
      else if (ch === '}') braceDepth = 0;
    }
  }
  return games;
}

function parseHeaders(lines: string[]): PgnHeaders {
  const headers: PgnHeaders = {};
  for (const line of lines) {
    const match = HEADER_RE.exec(line);
    if (match === null) continue;
    const key = match[1] as string;
    const value = (match[2] as string).replace(/\\(["\\])/g, '$1');
    headers[key] = value;
  }
  return headers;
}

// -------------------------------------------------------------------- tokenizer

type Token =
  | { type: 'move'; text: string }
  | { type: 'comment'; text: string }
  | { type: 'nag'; value: number }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'result'; text: GameResultText };

function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || /[\s(){};]/.test(ch);
}

export function tokenizeMovetext(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '{') {
      const end = text.indexOf('}', i + 1);
      const body = end === -1 ? text.slice(i + 1) : text.slice(i + 1, end);
      tokens.push({ type: 'comment', text: body.replace(/\s+/g, ' ').trim() });
      i = end === -1 ? n : end + 1;
    } else if (ch === ';') {
      const end = text.indexOf('\n', i);
      tokens.push({ type: 'comment', text: text.slice(i + 1, end === -1 ? n : end).trim() });
      i = end === -1 ? n : end + 1;
    } else if (ch === '(') {
      tokens.push({ type: 'open' });
      i += 1;
    } else if (ch === ')') {
      tokens.push({ type: 'close' });
      i += 1;
    } else if (ch === '$') {
      let j = i + 1;
      while (j < n && /\d/.test(text[j] as string)) j += 1;
      const value = Number.parseInt(text.slice(i + 1, j), 10);
      if (Number.isFinite(value)) tokens.push({ type: 'nag', value });
      i = Math.max(j, i + 1);
    } else {
      // result tokens
      const rest = text.slice(i, i + 8);
      const resultMatch = /^(1-0|0-1|1\/2-1\/2|\*)/.exec(rest);
      if (resultMatch !== null && isBoundary(text[i + (resultMatch[1] as string).length])) {
        tokens.push({ type: 'result', text: resultMatch[1] as GameResultText });
        i += (resultMatch[1] as string).length;
        continue;
      }
      // move numbers: "12." "12..." "12. ..." - skip digits and dots
      const numMatch = /^\d+\s*\.+/.exec(text.slice(i, i + 12));
      if (numMatch !== null) {
        i += numMatch[0].length;
        continue;
      }
      let j = i;
      while (j < n && !isBoundary(text[j]) && text[j] !== '$') j += 1;
      if (j === i) {
        i += 1; // stray character, skip
        continue;
      }
      tokens.push({ type: 'move', text: text.slice(i, j) });
      i = j;
    }
  }
  return tokens;
}

function parseShapes(comment: string): { text: string; shapes: Shape[] } {
  const shapes: Shape[] = [];
  const text = comment
    .replace(/\[%(csl|cal)\s+([^\]]*)\]/g, (_whole, kind: string, body: string) => {
      for (const item of body.split(',')) {
        const m = (kind === 'csl' ? /^\s*([GRBY])([a-h][1-8])\s*$/ : /^\s*([GRBY])([a-h][1-8])([a-h][1-8])\s*$/).exec(item);
        if (m === null) continue;
        const color = SHAPE_LETTER[m[1] as string] as ShapeColor;
        if (kind === 'csl') shapes.push({ from: m[2] as Square, color });
        else if (m[2] === m[3]) shapes.push({ from: m[2] as Square, color });
        else shapes.push({ from: m[2] as Square, to: m[3] as Square, color });
      }
      return '';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { text, shapes };
}

// ----------------------------------------------------------------------- parse

function normalizeSan(raw: string): { san: string; nags: number[] } {
  let san = raw.replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
  san = san.replace(/e\.p\.$/i, '');
  const suffix = /[!?]+$/.exec(san);
  const nags: number[] = [];
  if (suffix !== null) {
    san = san.slice(0, san.length - suffix[0].length);
    const nag = SUFFIX_NAGS[suffix[0]];
    if (nag !== undefined) nags.push(nag);
  }
  return { san, nags };
}

function parseOneGame(raw: RawGame, index: number): { game: ParsedGame | null; error?: string } {
  const label = `Game ${index + 1}`;
  const headers = parseHeaders(raw.headerLines);
  const warnings: string[] = [];

  const variant = headers['Variant'];
  if (variant !== undefined && !/^(standard|chess|from position|fromposition)$/i.test(variant.trim())) {
    return { game: null, error: `${label}: the variant "${variant}" is not supported (standard chess only).` };
  }

  let startFen: string | undefined;
  const fenHeader = headers['FEN'];
  if (fenHeader !== undefined && fenHeader.trim().length > 0) {
    const checked = validateAndNormalizeFen(fenHeader);
    if (!checked.ok) {
      return { game: null, error: `${label}: the FEN header is invalid - ${checked.error}` };
    }
    startFen = checked.fen;
  }

  let tree = createTree(startFen, headers);
  // createTree adds SetUp/FEN only for non-standard starts; keep user-provided headers otherwise.
  tree = setHeaders(tree, { ...headers, ...(startFen !== undefined ? { SetUp: '1', FEN: startFen } : {}) });

  const tokens = tokenizeMovetext(raw.moveLines.join('\n'));
  let cursor = tree.rootId;
  const stack: string[] = [];
  let skipDepth = 0; // >0 while skipping the remainder of a broken variation
  let result: GameResultText | null = null;
  let movesParsed = 0;
  let stopped = false;

  for (const token of tokens) {
    if (stopped) break;

    if (skipDepth > 0) {
      if (token.type === 'open') skipDepth += 1;
      else if (token.type === 'close') {
        skipDepth -= 1;
        if (skipDepth === 0) cursor = stack.pop() ?? cursor;
      }
      continue;
    }

    switch (token.type) {
      case 'move': {
        const { san, nags } = normalizeSan(token.text);
        if (san === '--' || san === 'Z0' || san === '@@@@') {
          warnings.push(`${label}: null moves ("${token.text}") are not supported; the rest of the line was skipped.`);
          if (stack.length > 0) skipDepth = 1;
          else stopped = true;
          break;
        }
        const added = addMove(tree, cursor, san);
        if (!added.ok) {
          const node = getNode(tree, cursor);
          const where = node.ply === 0 ? 'at the start' : `after ${node.moveNumber}${node.color === 'w' ? '.' : '...'} ${node.san}`;
          const base = `${label}: could not read the move "${token.text}" ${where}`;
          if (stack.length > 0) {
            warnings.push(`${base}. That variation was skipped.`);
            skipDepth = 1;
          } else {
            warnings.push(`${base}. Imported ${movesParsed} move${movesParsed === 1 ? '' : 's'}; the rest of the game was ignored.`);
            stopped = true;
          }
          break;
        }
        tree = added.tree;
        cursor = added.nodeId;
        movesParsed += 1;
        if (nags.length > 0) {
          const node = getNode(tree, cursor);
          tree = { ...tree, nodes: { ...tree.nodes, [cursor]: { ...node, nags: [...new Set([...node.nags, ...nags])] } } };
        }
        break;
      }
      case 'comment': {
        const { text, shapes } = parseShapes(token.text);
        const node = getNode(tree, cursor);
        const merged = node.comment.length > 0 && text.length > 0 ? `${node.comment} ${text}` : node.comment || text;
        tree = setComment(tree, cursor, merged);
        if (shapes.length > 0) tree = setShapes(tree, cursor, [...node.shapes, ...shapes]);
        break;
      }
      case 'nag': {
        if (cursor === tree.rootId) break;
        const node = getNode(tree, cursor);
        if (!node.nags.includes(token.value)) {
          tree = { ...tree, nodes: { ...tree.nodes, [cursor]: { ...node, nags: [...node.nags, token.value] } } };
        }
        break;
      }
      case 'open': {
        const node = getNode(tree, cursor);
        if (node.parentId === null) {
          warnings.push(`${label}: a variation started before any move and was skipped.`);
          skipDepth = 1;
          stack.push(cursor);
        } else {
          stack.push(cursor);
          cursor = node.parentId;
        }
        break;
      }
      case 'close': {
        const restored = stack.pop();
        if (restored === undefined) warnings.push(`${label}: found a stray ")" and ignored it.`);
        else cursor = restored;
        break;
      }
      case 'result':
        if (stack.length === 0) {
          result = token.text;
          stopped = true;
        }
        break;
    }
  }

  if (!stopped && stack.length > 0) {
    warnings.push(`${label}: ${stack.length} variation${stack.length === 1 ? '' : 's'} were not closed; they were imported as far as they went.`);
  }

  const headerResult = headers['Result'];
  if (result === null && headerResult !== undefined && /^(1-0|0-1|1\/2-1\/2|\*)$/.test(headerResult)) {
    result = headerResult as GameResultText;
  }
  if (result !== null && headers['Result'] === undefined) {
    tree = setHeaders(tree, { ...tree.headers, Result: result });
  }
  if (movesParsed === 0 && raw.moveLines.length > 0 && warnings.length === 0 && tokens.every((t) => t.type !== 'result')) {
    warnings.push(`${label}: no moves were found.`);
  }
  return { game: { tree, result, warnings } };
}

/** Parse every game in a PGN text. Never throws; problems are reported in the result. */
export function parsePgn(text: string): PgnParseResult {
  const raws = splitGames(text);
  const games: ParsedGame[] = [];
  const errors: string[] = [];
  if (raws.length === 0) {
    return { games, errors: ['No PGN data found. Paste a game (e.g. "1. e4 e5 2. Nf3 Nc6") or choose a .pgn file.'] };
  }
  raws.forEach((raw, index) => {
    const { game, error } = parseOneGame(raw, index);
    if (game !== null) games.push(game);
    if (error !== undefined) errors.push(error);
  });
  if (games.length === 0 && errors.length === 0) errors.push('No playable game was found in the text.');
  return { games, errors };
}

// ----------------------------------------------------------------------- export

export interface ExportOptions {
  includeVariations?: boolean;
  includeComments?: boolean;
  /** Wrap movetext at this many columns (0 = no wrapping). */
  lineWidth?: number;
}

function escapeHeader(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function shapesToCommands(shapes: readonly Shape[]): string {
  const squares = shapes.filter((s) => s.to === undefined).map((s) => `${SHAPE_COLOR_LETTER[s.color]}${s.from}`);
  const arrows = shapes.filter((s) => s.to !== undefined).map((s) => `${SHAPE_COLOR_LETTER[s.color]}${s.from}${s.to as string}`);
  const parts: string[] = [];
  if (squares.length > 0) parts.push(`[%csl ${squares.join(',')}]`);
  if (arrows.length > 0) parts.push(`[%cal ${arrows.join(',')}]`);
  return parts.join(' ');
}

function commentToken(node: MoveNode, includeComments: boolean): string | null {
  if (!includeComments) return null;
  const cmds = shapesToCommands(node.shapes);
  const text = node.comment.replace(/\}/g, ')').replace(/\s+/g, ' ').trim();
  const body = [cmds, text].filter((s) => s.length > 0).join(' ');
  return body.length > 0 ? `{${body}}` : null;
}

export function gameResultOf(tree: GameTree): GameResultText {
  const r = tree.headers['Result'];
  return r === '1-0' || r === '0-1' || r === '1/2-1/2' ? r : '*';
}

export function exportPgn(tree: GameTree, options: ExportOptions = {}): string {
  const includeVariations = options.includeVariations ?? true;
  const includeComments = options.includeComments ?? true;
  const lineWidth = options.lineWidth ?? 80;

  const headers: PgnHeaders = { ...SEVEN_TAG_DEFAULTS, ...tree.headers };
  const headerLines: string[] = [];
  for (const key of SEVEN_TAG_ORDER) headerLines.push(`[${key} "${escapeHeader(headers[key] as string)}"]`);
  for (const key of Object.keys(headers).sort()) {
    if ((SEVEN_TAG_ORDER as readonly string[]).includes(key)) continue;
    headerLines.push(`[${key} "${escapeHeader(headers[key] as string)}"]`);
  }

  const tokens: string[] = [];
  const root = rootNode(tree);
  const rootComment = commentToken(root, includeComments);
  if (rootComment !== null) tokens.push(rootComment);

  const writeFrom = (startId: string, forceNumber: boolean): void => {
    let id: string | undefined = startId;
    let needNumber = forceNumber;
    while (id !== undefined) {
      const node = getNode(tree, id);
      if (node.color === 'w') tokens.push(`${node.moveNumber}.`);
      else if (needNumber) tokens.push(`${node.moveNumber}...`);
      tokens.push(node.san);
      if (includeComments) for (const nag of node.nags) tokens.push(`$${nag}`);
      const comment = commentToken(node, includeComments);
      if (comment !== null) tokens.push(comment);
      needNumber = comment !== null;

      if (includeVariations && node.parentId !== null) {
        const parent = getNode(tree, node.parentId);
        if (parent.children[0] === id) {
          for (const siblingId of parent.children.slice(1)) {
            tokens.push('(');
            writeFrom(siblingId, true);
            tokens.push(')');
            needNumber = true;
          }
        }
      }
      id = node.children[0];
    }
  };

  const first = root.children[0];
  if (first !== undefined) writeFrom(first, true);
  tokens.push(gameResultOf(tree));

  // join, gluing "(" to the next token and ")" to the previous one
  let lineLen = 0;
  const lines: string[] = [];
  let line = '';
  const flush = () => {
    if (line.length > 0) lines.push(line);
    line = '';
    lineLen = 0;
  };
  tokens.forEach((token, idx) => {
    const prev = tokens[idx - 1];
    const glue = token === ')' || prev === '(';
    const piece = idx === 0 || glue ? token : ` ${token}`;
    if (lineWidth > 0 && lineLen + piece.length > lineWidth && line.length > 0 && !glue) {
      flush();
      line = token;
      lineLen = token.length;
    } else {
      line += piece;
      lineLen += piece.length;
    }
  });
  flush();
  const movetext = lines.join('\n');

  return `${headerLines.join('\n')}\n\n${movetext}\n`;
}

/** Compact "1. e4 e5 2. Nf3" text of the main line up to (and including) a node, for opening lookup. */
export function movesToSanText(tree: GameTree, pathIds: readonly string[]): string {
  const parts: string[] = [];
  for (const id of pathIds) {
    const node = getNode(tree, id);
    if (node.ply === 0) continue;
    if (node.color === 'w') parts.push(`${node.moveNumber}.`);
    parts.push(node.san);
  }
  return parts.join(' ');
}
