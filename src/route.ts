/**
 * Right-angled ("Angled" style) link paths. Short and calm:
 *  - facing sides (→ ←, ↓ ↑): one Z with its middle leg kept strictly between the two cards, never behind
 *    either one, so close cards (24px apart inside a frame) don't get hooks that double back;
 *  - nearly level ends (≤ 12px off) become one straight segment;
 *  - a side and a top/bottom (diagonal targets, see pickSides): a single L bend;
 *  - anything else (overlapping cards): a plain straight line.
 * Corners are rounded. Returns [svg path, label x, label y] with the label at the halfway point along the path.
 */
export type Side = "left" | "right" | "top" | "bottom";
type P = { x: number; y: number };

const DIR: Record<Side, P> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
const horiz = (s: Side) => s === "left" || s === "right";
export const SNAP = 12; // ends closer than this (across the line) are drawn straight
const RADIUS = 10;
const STUB = 14; // the first/last leg is at least this long when there is room

export function stepRoute(sx: number, sy: number, sp: Side, tx: number, ty: number, tp: Side, lane = 0): [string, number, number] {
  const S = { x: sx, y: sy }, T = { x: tx, y: ty };
  const ds = DIR[sp], dt = DIR[tp];
  let pts: P[];
  if (horiz(sp) && horiz(tp) && ds.x === -dt.x && (tx - sx) * ds.x > 0) {
    // → ←  (target ahead of the source)
    const gap = Math.abs(tx - sx);
    if (Math.abs(ty - sy) <= SNAP) {
      const y = (sy + ty) / 2;
      pts = [{ x: sx, y }, { x: tx, y }];
    } else {
      const stub = Math.min(STUB, gap / 2);
      const lo = Math.min(sx, tx) + stub, hi = Math.max(sx, tx) - stub;
      const mx = clamp((sx + tx) / 2 + lane, lo, hi);
      pts = [S, { x: mx, y: sy }, { x: mx, y: ty }, T];
    }
  } else if (!horiz(sp) && !horiz(tp) && ds.y === -dt.y && (ty - sy) * ds.y > 0) {
    // ↓ ↑
    const gap = Math.abs(ty - sy);
    if (Math.abs(tx - sx) <= SNAP) {
      const x = (sx + tx) / 2;
      pts = [{ x, y: sy }, { x, y: ty }];
    } else {
      const stub = Math.min(STUB, gap / 2);
      const lo = Math.min(sy, ty) + stub, hi = Math.max(sy, ty) - stub;
      const my = clamp((sy + ty) / 2 + lane, lo, hi);
      pts = [S, { x: sx, y: my }, { x: tx, y: my }, T];
    }
  } else if (horiz(sp) !== horiz(tp)) {
    // L: leave along the source's direction, arrive along the target's
    const c = horiz(sp) ? { x: tx, y: sy } : { x: sx, y: ty };
    const ahead = (c.x - sx) * ds.x + (c.y - sy) * ds.y > 0; // corner lies in front of the source side
    const into = (c.x - tx) * dt.x + (c.y - ty) * dt.y > 0; // and in front of the target side
    pts = ahead && into ? [S, c, T] : [S, T];
  } else pts = [S, T];
  return [roundedPath(pts), ...halfway(pts)];
}

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

function roundedPath(pts: P[]): string {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const r = Math.min(RADIUS, dist(a, b) / 2, dist(b, c) / 2);
    if (r < 0.5) { d += ` L ${b.x} ${b.y}`; continue; }
    const p1 = toward(b, a, r), p2 = toward(b, c, r);
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L ${z.x} ${z.y}`;
}

function halfway(pts: P[]): [number, number] {
  const total = pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (left <= l) { const t = l ? left / l : 0; return [pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t]; }
    left -= l;
  }
  return [pts[0].x, pts[0].y];
}

const dist = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y);
const toward = (from: P, to: P, r: number) => { const l = dist(from, to) || 1; return { x: from.x + ((to.x - from.x) / l) * r, y: from.y + ((to.y - from.y) / l) * r }; };
