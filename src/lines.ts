import { cardW, descendants, estHeight, frameSize } from "./layout";
import { fullH } from "./heights";
import { isCard, isFrame, type AppNode, type LineMode, type NoteEdge } from "./types";

/** Which nodes are hidden inside collapsed frames, and which visible collapsed frame owns them. */
export function collapsedOwners(nodes: AppNode[]) {
  const collapsed = nodes.filter(isFrame).filter((f) => f.data.collapsed);
  const hidden = new Set<string>();
  for (const f of collapsed) for (const m of f.data.members ?? []) hidden.add(m);
  const owner = new Map<string, string>();
  for (const f of collapsed) {
    if (hidden.has(f.id)) continue;
    for (const m of f.data.members ?? []) owner.set(m, f.id);
  }
  return { hidden, owner };
}

/** Edges as drawn: links into collapsed frames are re-pointed at the frame and merged ("3 links"). */
export function aggregateEdges(nodes: AppNode[], edges: NoteEdge[]): NoteEdge[] {
  const { owner } = collapsedOwners(nodes);
  if (!owner.size) return edges;
  const out: NoteEdge[] = [];
  const agg = new Map<string, { e: NoteEdge; n: number }>();
  for (const e of edges) {
    const s = owner.get(e.source) ?? e.source;
    const t = owner.get(e.target) ?? e.target;
    if (s === e.source && t === e.target) {
      out.push(e);
      continue;
    }
    if (s === t) continue; // internal to a collapsed frame
    const k = `${s}>${t}`;
    const hit = agg.get(k);
    if (hit) hit.n++;
    else agg.set(k, { e: { ...e, id: `agg_${k}`, source: s, target: t, selected: false, data: { ...e.data, agg: true } }, n: 1 });
  }
  for (const { e, n } of agg.values()) out.push({ ...e, label: n > 1 ? `${n} links` : e.label });
  return out;
}

/** Edges to render: aggregation + focus/dim/hide according to the line mode. */
export function viewEdges(nodes: AppNode[], edges: NoteEdge[], mode: LineMode, hover: string | null): NoteEdge[] {
  const list = aggregateEdges(nodes, edges);
  const { owner } = collapsedOwners(nodes);
  const focus = new Set<string>();
  const add = (id: string) => focus.add(owner.get(id) ?? id);
  for (const n of nodes) {
    if (!n.selected) continue;
    add(n.id);
    if (isFrame(n) && !n.data.collapsed) for (const d of descendants(n, nodes)) add(d.id);
  }
  if (hover) add(hover);
  const anyEdgeSel = list.some((e) => e.selected);
  const active = focus.size > 0 || anyEdgeSel;
  const rects = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const n of nodes) {
    if (isFrame(n)) {
      const { w, h } = frameSize(n);
      rects.set(n.id, { x: n.position.x, y: n.position.y, w, h });
    } else if (isCard(n)) rects.set(n.id, { x: n.position.x, y: n.position.y, w: cardW(n), h: fullH.get(n.id) ?? n.measured?.height ?? estHeight(n) });
  }
  // spread links that share a side of a card along that side, ordered to avoid crossings
  const side = new Map<string, { e: string; k: number }[]>();
  const sideOf = new Map<string, [string, string]>();
  const mid = (id: string) => { const r = rects.get(id); return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 0, y: 0 }; };
  // solid things a corner-turning (L) link should not run through
  const solids = nodes.filter((n) => isCard(n) || (isFrame(n) && n.data.collapsed)).map((n) => [n.id, rects.get(n.id)!] as const).filter(([, r]) => !!r);
  for (const e of list) {
    const ra = rects.get(e.source), rb = rects.get(e.target);
    let sh = pickSides(ra, rb);
    if (!sh) continue;
    if (isL(sh) && lCrosses(ra!, rb!, sh, solids.filter(([id]) => id !== e.source && id !== e.target).map(([, r]) => r))) sh = pickSides(ra, rb, false);
    if (!sh) continue;
    sideOf.set(e.id, sh);
    for (const [node, h, other] of [[e.source, sh[0], e.target], [e.target, sh[1], e.source]] as const) {
      const o = mid(other);
      const vertSide = h.endsWith("l") || h.endsWith("r");
      const key = `${node}|${h}`;
      if (!side.has(key)) side.set(key, []);
      side.get(key)!.push({ e: e.id + "|" + (h[0] === "s" ? "s" : "t"), k: vertSide ? o.y : o.x });
    }
  }
  const port = new Map<string, number>();
  for (const [key, arr] of side) {
    arr.sort((a, b) => a.k - b.k);
    const n = arr.length;
    const span = key.endsWith("l") || key.endsWith("r") ? 90 : 200;
    const gap = Math.min(18, span / Math.max(1, n - 1));
    arr.forEach((a, i) => port.set(a.e, (i - (n - 1) / 2) * gap));
  }
  return list.map((e) => {
    const sh = sideOf.get(e.id) ?? null; // computed above; don't run pickSides twice per edge
    const rel = e.selected || focus.has(e.source) || focus.has(e.target);
    let st: "" | "hot" | "dim" = "";
    let hidden = false;
    if (mode === "off") hidden = true;
    else if (mode === "selected") (rel ? (st = "hot") : (hidden = true));
    else if (mode === "focus" && active) st = rel ? "hot" : "dim";
    const so = port.get(e.id + "|s") ?? 0, to = port.get(e.id + "|t") ?? 0;
    return { ...e, hidden, sourceHandle: sh?.[0] ?? e.sourceHandle, targetHandle: sh?.[1] ?? e.targetHandle, data: { ...e.data, st, so, to, ...straightAcross(rects.get(e.source), rects.get(e.target), sh, so) } };
  });
}

type R = { x: number; y: number; w: number; h: number };
const L_MIN = 40; // both gaps at least this big before a link turns a corner (L) instead of a Z
const EDGE_IN = 12; // a straight link stays at least this far from a card's corner

const isL = (sh: [string, string]) => /[lr]$/.test(sh[0]) !== /[lr]$/.test(sh[1]);
const sidePoint = (r: R, h: string) => {
  const s = h.slice(-1);
  return s === "l" ? { x: r.x, y: r.y + r.h / 2 } : s === "r" ? { x: r.x + r.w, y: r.y + r.h / 2 } : s === "t" ? { x: r.x + r.w / 2, y: r.y } : { x: r.x + r.w / 2, y: r.y + r.h };
};
/** Would the L between these sides run through any of `others`? (both legs are axis-aligned) */
function lCrosses(a: R, b: R, sh: [string, string], others: R[]) {
  const S = sidePoint(a, sh[0]), T = sidePoint(b, sh[1]);
  const C = /[lr]$/.test(sh[0]) ? { x: T.x, y: S.y } : { x: S.x, y: T.y };
  const hits = (p: { x: number; y: number }, q: { x: number; y: number }, r: R) =>
    Math.max(p.x, q.x) > r.x - 4 && Math.min(p.x, q.x) < r.x + r.w + 4 && Math.max(p.y, q.y) > r.y - 4 && Math.min(p.y, q.y) < r.y + r.h + 4;
  return others.some((r) => hits(S, C, r) || hits(C, T, r));
}
/**
 * Cards facing each other whose edges overlap (side by side, or one above the other) get a straight
 * link across the overlap: `ay` (or `ax`) is the shared coordinate, in flow units. It follows the spread
 * port when that is inside the overlap, so parallel links stay apart.
 */
function straightAcross(a: R | undefined, b: R | undefined, sh: [string, string] | null, so: number): { ay?: number; ax?: number } {
  if (!a || !b || !sh || isL(sh)) return {};
  if (/[lr]$/.test(sh[0])) {
    const lo = Math.max(a.y, b.y) + EDGE_IN, hi = Math.min(a.y + a.h, b.y + b.h) - EDGE_IN;
    return hi >= lo ? { ay: Math.max(lo, Math.min(hi, a.y + a.h / 2 + so)) } : {};
  }
  const lo = Math.max(a.x, b.x) + EDGE_IN, hi = Math.min(a.x + a.w, b.x + b.w) - EDGE_IN;
  return hi >= lo ? { ax: Math.max(lo, Math.min(hi, a.x + a.w / 2 + so)) } : {};
}
/** Pick the facing sides of two boxes so links run the short way and stay uncluttered. */
function pickSides(a?: R, b?: R, allowL = true): [string, string] | null {
  if (!a || !b) return null;
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  // diagonal with clear room both ways: leave from a side, arrive at the top/bottom (or the reverse) — one bend, not two
  if (allowL && Math.min(gapX, gapY) >= L_MIN) {
    const right = b.x >= a.x, down = b.y >= a.y;
    if (gapX >= gapY) return [right ? "s-r" : "s-l", down ? "t-t" : "t-b"];
    return [down ? "s-b" : "s-t", right ? "t-l" : "t-r"];
  }
  const horizontal = gapX > 0 && (gapX >= gapY || gapY <= 0);
  if (horizontal) return b.x >= a.x ? ["s-r", "t-l"] : ["s-l", "t-r"];
  if (gapY > 0) return b.y >= a.y ? ["s-b", "t-t"] : ["s-t", "t-b"];
  return b.x + b.w / 2 >= a.x + a.w / 2 ? ["s-r", "t-l"] : ["s-l", "t-r"]; // overlapping boxes
}
