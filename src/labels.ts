import { useSyncExternalStore } from "react";

/** Edge labels report where they'd naturally sit; a tiny solver nudges them apart so pills never overlap. */
type Rect = { x: number; y: number; w: number; h: number };
const natural = new Map<string, Rect>();
let offsets = new Map<string, { dx: number; dy: number }>();
const subs = new Set<() => void>();
let queued = false;

function solve() {
  queued = false;
  const items = [...natural.entries()].sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x);
  const placed: Rect[] = [];
  const next = new Map<string, { dx: number; dy: number }>();
  const hit = (r: Rect) => placed.some((p) => Math.abs(p.x - r.x) < (p.w + r.w) / 2 + 3 && Math.abs(p.y - r.y) < (p.h + r.h) / 2 + 3);
  for (const [id, r] of items) {
    let best = { dx: 0, dy: 0 };
    if (hit(r)) {
      let found = false;
      for (let k = 1; k <= 12 && !found; k++) {
        for (const dy of [k * (r.h + 4), -k * (r.h + 4)]) {
          if (!hit({ ...r, y: r.y + dy })) { best = { dx: 0, dy }; found = true; break; }
        }
      }
    }
    placed.push({ ...r, x: r.x + best.dx, y: r.y + best.dy });
    if (best.dx || best.dy) next.set(id, best);
  }
  let changed = next.size !== offsets.size;
  if (!changed) for (const [id, o] of next) { const p = offsets.get(id); if (!p || p.dx !== o.dx || p.dy !== o.dy) { changed = true; break; } }
  if (changed) { offsets = next; subs.forEach((f) => f()); }
}

export function reportLabel(id: string, r: Rect | null) {
  if (!r) { if (natural.delete(id)) schedule(); return; }
  const p = natural.get(id);
  if (p && Math.abs(p.x - r.x) < 0.5 && Math.abs(p.y - r.y) < 0.5 && p.w === r.w) return;
  natural.set(id, r);
  schedule();
}
function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(solve);
}
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useLabelOffset = (id: string) => useSyncExternalStore(sub, () => offsets.get(id));
