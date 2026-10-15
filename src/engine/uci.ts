import type { ScoreBound, StmScore, UciBestMove, UciInfo, UciOptionSpec } from '@/types/engine';

/** Tokens that start a new field in an `info` line (everything after `pv` is moves). */
const INFO_KEYS = new Set([
  'depth',
  'seldepth',
  'multipv',
  'score',
  'nodes',
  'nps',
  'hashfull',
  'tbhits',
  'time',
  'wdl',
  'pv',
  'currmove',
  'currmovenumber',
  'refutation',
  'currline',
  'string',
  'cpuload',
  'sbhits',
]);

function toInt(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const n = Number.parseInt(token, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a UCI `info` line. Returns `null` for lines that carry no usable
 * search result (`info string ...`, `info currmove ...`, lines without a
 * depth or a score). Scores stay in the engine's side-to-move perspective.
 */
export function parseInfoLine(line: string): UciInfo | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'info') return null;
  if (tokens[1] === 'string') return null;

  let depth: number | undefined;
  let seldepth: number | undefined;
  let multipv = 1;
  let score: StmScore | undefined;
  let bound: ScoreBound = 'exact';
  let nodes: number | undefined;
  let nps: number | undefined;
  let timeMs: number | undefined;
  let hashfull: number | undefined;
  let tbhits: number | undefined;
  let wdl: [number, number, number] | undefined;
  let pv: string[] = [];

  let i = 1;
  while (i < tokens.length) {
    const key = tokens[i];
    switch (key) {
      case 'depth':
        depth = toInt(tokens[i + 1]);
        i += 2;
        break;
      case 'seldepth':
        seldepth = toInt(tokens[i + 1]);
        i += 2;
        break;
      case 'multipv':
        multipv = toInt(tokens[i + 1]) ?? 1;
        i += 2;
        break;
      case 'nodes':
        nodes = toInt(tokens[i + 1]);
        i += 2;
        break;
      case 'nps':
        nps = toInt(tokens[i + 1]);
        i += 2;
        break;
      case 'time':
        timeMs = toInt(tokens[i + 1]);
        i += 2;
        break;
      case 'hashfull':
        hashfull = toInt(tokens[i + 1]);
        i += 2;
        break;
      case 'tbhits':
        tbhits = toInt(tokens[i + 1]);
        i += 2;
        break;
      case 'wdl': {
        const w = toInt(tokens[i + 1]);
        const d = toInt(tokens[i + 2]);
        const l = toInt(tokens[i + 3]);
        if (w !== undefined && d !== undefined && l !== undefined) wdl = [w, d, l];
        i += 4;
        break;
      }
      case 'score': {
        const kind = tokens[i + 1];
        const value = toInt(tokens[i + 2]);
        i += 3;
        if ((kind === 'cp' || kind === 'mate') && value !== undefined) {
          score = { pov: 'stm', kind, value };
        }
        // Optional bound marker directly after the value.
        if (tokens[i] === 'lowerbound') {
          bound = 'lower';
          i += 1;
        } else if (tokens[i] === 'upperbound') {
          bound = 'upper';
          i += 1;
        }
        break;
      }
      case 'pv':
        pv = tokens.slice(i + 1).filter((t) => t.length > 0);
        i = tokens.length;
        break;
      case 'string':
        // Free text until the end of the line; nothing useful for us.
        i = tokens.length;
        break;
      default:
        // Skip unknown key and, if it's a known key without handler (currmove...),
        // its single argument.
        i += key !== undefined && INFO_KEYS.has(key) ? 2 : 1;
        break;
    }
  }

  if (depth === undefined || score === undefined) return null;

  const info: UciInfo = { depth, multipv, score, bound, pv };
  if (seldepth !== undefined) info.seldepth = seldepth;
  if (nodes !== undefined) info.nodes = nodes;
  if (nps !== undefined) info.nps = nps;
  if (timeMs !== undefined) info.timeMs = timeMs;
  if (hashfull !== undefined) info.hashfull = hashfull;
  if (tbhits !== undefined) info.tbhits = tbhits;
  if (wdl !== undefined) info.wdl = wdl;
  return info;
}

/** Parse `bestmove e2e4 [ponder e7e5]`. Returns `null` if the line is not a bestmove line. */
export function parseBestMove(line: string): UciBestMove | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'bestmove') return null;
  const raw = tokens[1];
  const move = raw === undefined || raw === '(none)' || raw === '0000' ? null : raw;
  const ponderIdx = tokens.indexOf('ponder');
  const ponderRaw = ponderIdx >= 0 ? tokens[ponderIdx + 1] : undefined;
  const ponder = ponderRaw === undefined || ponderRaw === '(none)' || ponderRaw === '0000' ? null : ponderRaw;
  return { move, ponder };
}

/** Parse `option name <Name with spaces> type <t> [default <d>] [min <n>] [max <n>] [var <v>]...` */
export function parseOptionLine(line: string): UciOptionSpec | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'option' || tokens[1] !== 'name') return null;
  const typeIdx = tokens.indexOf('type');
  if (typeIdx < 0) return null;
  const name = tokens.slice(2, typeIdx).join(' ');
  const type = tokens[typeIdx + 1];
  if (type !== 'check' && type !== 'spin' && type !== 'combo' && type !== 'button' && type !== 'string') {
    return null;
  }

  const spec: UciOptionSpec = { name, type };
  const rest = tokens.slice(typeIdx + 2);
  const vars: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const t = rest[i];
    const next = rest[i + 1];
    if (t === 'default' && next !== undefined) {
      spec.default = next;
      i += 1;
    } else if (t === 'min' && next !== undefined) {
      const n = toInt(next);
      if (n !== undefined) spec.min = n;
      i += 1;
    } else if (t === 'max' && next !== undefined) {
      const n = toInt(next);
      if (n !== undefined) spec.max = n;
      i += 1;
    } else if (t === 'var' && next !== undefined) {
      vars.push(next);
      i += 1;
    }
  }
  if (vars.length > 0) spec.vars = vars;
  return spec;
}
