/**
 * Knight-move arrows drawn as an "L" (two squares along the long side, then one across), like on Lichess.
 * Chessground only draws straight lines, so its SVG is post-processed.
 * Coordinates are Chessground's user space: one unit per square, y grows downwards.
 */
export function knightPath(x1: number, y1: number, x2: number, y2: number): string | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const ax = Math.round(Math.abs(dx));
  const ay = Math.round(Math.abs(dy));
  if (!((ax === 1 && ay === 2) || (ax === 2 && ay === 1))) return null;
  // the end point is pulled back from the square centre by at most ~0.35 for the arrow head
  if (Math.abs(Math.abs(dx) - ax) > 0.4 || Math.abs(Math.abs(dy) - ay) > 0.4) return null;
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  const cx = ax === 2 ? x1 + sx * 2 : x1;
  const cy = ax === 2 ? y1 : y1 + sy * 2;
  const tx = x1 + sx * ax;
  const ty = y1 + sy * ay;
  const pull = Math.hypot(tx - x2, ty - y2);
  const len = Math.hypot(tx - cx, ty - cy); // 1
  const ex = tx - ((tx - cx) / len) * pull;
  const ey = ty - ((ty - cy) / len) * pull;
  const f = (n: number) => Number(n.toFixed(4));
  return `M ${f(x1)} ${f(y1)} L ${f(cx)} ${f(cy)} L ${f(ex)} ${f(ey)}`;
}

/** Replace the straight line of every knight-move arrow below `root` with an L-shaped path. */
export function bendKnightArrows(root: ParentNode): void {
  for (const line of Array.from(root.querySelectorAll('line'))) {
    const n = (a: string) => Number(line.getAttribute(a));
    const d = knightPath(n('x1'), n('y1'), n('x2'), n('y2'));
    if (d === null || line.getAttribute('marker-end') === null) continue;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    for (const a of ['stroke', 'stroke-width', 'stroke-linecap', 'marker-end', 'opacity']) {
      const v = line.getAttribute(a);
      if (v !== null) path.setAttribute(a, v);
    }
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('fill', 'none');
    path.setAttribute('d', d);
    line.replaceWith(path);
  }
}

/** Keep a Chessground shapes layer bent. Returns a cleanup function. */
export function watchKnightArrows(board: HTMLElement): () => void {
  const svg = board.querySelector('svg.cg-shapes');
  if (svg === null) return () => undefined;
  const run = () => bendKnightArrows(svg);
  const mo = new MutationObserver(run);
  mo.observe(svg, { childList: true, subtree: true });
  run();
  return () => mo.disconnect();
}
