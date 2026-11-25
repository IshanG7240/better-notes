import dagre from "@dagrejs/dagre";
import { fullH } from "./heights";
import { boxRect, cardW, estHeight, FRAME_PAD, frameSize, parentMap, readingOrder } from "./layout";
import { isCard, isFrame, type AppNode, type FrameNodeT, type NoteEdge } from "./types";

type R = { x: number; y: number; w: number; h: number };
const FRAME_MIN_W = 260;
/** The frame box that fits snugly around these rects (padding included). */
const wrap = (rs: R[]): R => {
  const x = Math.min(...rs.map((r) => r.x)) - FRAME_PAD.x, y = Math.min(...rs.map((r) => r.y)) - FRAME_PAD.top;
  const x2 = Math.max(...rs.map((r) => r.x + r.w)) + FRAME_PAD.x, y2 = Math.max(...rs.map((r) => r.y + r.h)) + FRAME_PAD.bottom;
  return { x, y, w: Math.max(x2 - x, FRAME_MIN_W), h: y2 - y };
};

/**
 * Gentle, context-aware tidy. Things stay roughly where you put them:
 *  - cards joined by links (3+ in a chain or tree) are laid out as a flow (left to right on the board,
 *    top to bottom inside a frame), anchored where that cluster already is;
 *  - overlaps are pushed apart, in reading order, so earlier things keep their spot;
 *  - frames shrink or grow to fit what is inside them.
 * Nothing is packed into rows or columns. Works inside-out: the deepest frames first.
 */
export function tidy(nodes: AppNode[], edges: NoteEdge[], locked: Set<string>, fixedH: Map<string, number> = new Map()) {
  const pm = parentMap(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rect = new Map<string, R>();
  for (const n of nodes) {
    const b = boxRect(n);
    rect.set(n.id, isCard(n) ? { x: b.x, y: b.y, w: cardW(n), h: fixedH.get(n.id) ?? fullH.get(n.id) ?? Math.max(n.measured?.height ?? 0, estHeight(n)) } : { ...b, h: fixedH.get(n.id) ?? b.h });
  }
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    const p = pm.get(n.id) ?? "";
    kids.set(p, [...(kids.get(p) ?? []), n.id]);
  }
  const depth = (id: string) => { let d = 0, p = pm.get(id); while (p) { d++; p = pm.get(p); } return d; };
  const descendants = (id: string): string[] => (kids.get(id) ?? []).flatMap((k) => [k, ...descendants(k)]);
  const move = (id: string, dx: number, dy: number) => {
    if (!dx && !dy) return;
    for (const k of [id, ...(isFrame(byId.get(id)!) ? descendants(id) : [])]) {
      const r = rect.get(k)!;
      rect.set(k, { ...r, x: r.x + dx, y: r.y + dy });
    }
  };
  // which direct child of container `c` holds node `id` (itself, or the frame around it)
  const itemOf = (id: string, c: string) => {
    let cur: string | undefined = id;
    while (cur && (pm.get(cur) ?? "") !== c) cur = pm.get(cur);
    return cur;
  };
  const collapsed = (id: string) => { const n = byId.get(id); return !!n && isFrame(n) && !!n.data.collapsed; };
  const solid = (id: string) => isCard(byId.get(id)!) || collapsed(id); // behaves like a single card

  const containers = ["", ...nodes.filter((n) => isFrame(n) && !n.data.collapsed).map((n) => n.id)].sort((a, b) => (b ? depth(b) + 1 : 0) - (a ? depth(a) + 1 : 0));

  for (const c of containers) {
    const items = kids.get(c) ?? [];
    if (!items.length) continue;
    const root = c === "";
    // a frame holding a pinned card keeps its contents where they are, but still fits around them
    if (c && locked.has(c)) { rect.set(c, wrap(items.map((id) => rect.get(id)!))); continue; }

    // 1) flow: link clusters among the loose cards of this container
    const cardItems = new Set(items.filter((id) => solid(id) && !locked.has(id)));
    const adj = new Map<string, Set<string>>();
    const flow: [string, string][] = [];
    const seen = new Set<string>();
    for (const e of edges) {
      const a = itemOf(e.source, c), b = itemOf(e.target, c);
      if (!a || !b || a === b || !cardItems.has(a) || !cardItems.has(b) || seen.has(a + ">" + b) || seen.has(b + ">" + a)) continue;
      seen.add(a + ">" + b);
      flow.push([a, b]);
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
    const done = new Set<string>();
    for (const start of adj.keys()) {
      if (done.has(start)) continue;
      const comp: string[] = [];
      const stack = [start];
      while (stack.length) { const x = stack.pop()!; if (done.has(x)) continue; done.add(x); comp.push(x); stack.push(...adj.get(x)!); }
      const ce = flow.filter(([a]) => comp.includes(a));
      if (comp.length < 3 || ce.length > comp.length + 1) continue; // only chains / trees read as a flow
      const g = new dagre.graphlib.Graph();
      g.setGraph({ rankdir: root ? "LR" : "TB", nodesep: root ? 40 : 26, ranksep: root ? 90 : 46, marginx: 0, marginy: 0 });
      g.setDefaultEdgeLabel(() => ({}));
      for (const id of comp) g.setNode(id, { width: rect.get(id)!.w, height: rect.get(id)!.h });
      for (const [a, b] of ce) g.setEdge(a, b);
      dagre.layout(g);
      const ox = Math.min(...comp.map((id) => rect.get(id)!.x)), oy = Math.min(...comp.map((id) => rect.get(id)!.y));
      const lx = Math.min(...comp.map((id) => g.node(id).x - g.node(id).width / 2)), ly = Math.min(...comp.map((id) => g.node(id).y - g.node(id).height / 2));
      for (const id of comp) {
        const n = g.node(id), r = rect.get(id)!;
        move(id, Math.round(n.x - n.width / 2 - lx + ox - r.x), Math.round(n.y - n.height / 2 - ly + oy - r.y));
      }
    }

    // 2) push overlaps apart in reading order; locked things and earlier things keep their place
    const M = root ? 56 : 24;
    const order = readingOrder(items.map((id) => ({ id, ...rect.get(id)! })));
    const placed: string[] = items.filter((id) => locked.has(id));
    for (const id of order) {
      if (locked.has(id)) continue;
      for (let guard = 0; guard < 400; guard++) {
        const r = rect.get(id)!;
        const hit = placed.find((p) => { const q = rect.get(p)!; return r.x < q.x + q.w + M && q.x < r.x + r.w + M && r.y < q.y + q.h + M && q.y < r.y + r.h + M; });
        if (!hit) break;
        const q = rect.get(hit)!;
        const right = q.x + q.w + M - r.x, down = q.y + q.h + M - r.y;
        if (right <= down) move(id, right, 0); else move(id, 0, down);
      }
      placed.push(id);
    }

    // 3) a frame wraps what is inside it
    if (!root) rect.set(c, wrap(items.map((id) => rect.get(id)!)));
  }

  const pos = new Map<string, { x: number; y: number }>();
  const size = new Map<string, { width: number; height: number }>();
  for (const n of nodes) {
    const r = rect.get(n.id)!;
    if (Math.round(r.x) !== Math.round(n.position.x) || Math.round(r.y) !== Math.round(n.position.y)) pos.set(n.id, { x: Math.round(r.x), y: Math.round(r.y) });
    if (isFrame(n) && !n.data.collapsed) {
      const s = frameSize(n);
      if (Math.round(r.w) !== Math.round(s.w) || Math.round(r.h) !== Math.round(s.h)) size.set(n.id, { width: Math.round(r.w), height: Math.round(r.h) });
    }
  }
  return { pos, size };
}

/** Gap kept around things: on the open board, and between things inside a frame. Same as tidy() so the two agree. */
const GAP_ROOT = 56;
const GAP_IN = 24;

/**
 * "Space out": the gentlest layout. Only things that overlap or sit closer than the gap move, and only
 * as far as needed. Each crowded pair moves apart half each, along whichever axis needs less movement
 * (pinned things don't move; the other side takes the whole push). Frames move as a block with
 * everything inside them, and fit snugly around their contents. Works inside-out.
 */
export function spaceOut(nodes: AppNode[], locked: Set<string>, fixedH: Map<string, number> = new Map()) {
  const pm = parentMap(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rect = new Map<string, R>();
  for (const n of nodes) {
    const b = boxRect(n);
    rect.set(n.id, isCard(n) ? { x: b.x, y: b.y, w: cardW(n), h: fixedH.get(n.id) ?? fullH.get(n.id) ?? Math.max(n.measured?.height ?? 0, estHeight(n)) } : { ...b, h: fixedH.get(n.id) ?? b.h });
  }
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    const p = pm.get(n.id) ?? "";
    kids.set(p, [...(kids.get(p) ?? []), n.id]);
  }
  const depth = (id: string) => { let d = 0, p = pm.get(id); while (p) { d++; p = pm.get(p); } return d; };
  const descendants = (id: string): string[] => (kids.get(id) ?? []).flatMap((k) => [k, ...descendants(k)]);
  const move = (id: string, dx: number, dy: number) => {
    if (!dx && !dy) return;
    for (const k of [id, ...(isFrame(byId.get(id)!) ? descendants(id) : [])]) {
      const r = rect.get(k)!;
      rect.set(k, { ...r, x: r.x + dx, y: r.y + dy });
    }
  };
  const containers = ["", ...nodes.filter((n) => isFrame(n) && !n.data.collapsed).map((n) => n.id)].sort((a, b) => (b ? depth(b) + 1 : 0) - (a ? depth(a) + 1 : 0));

  for (const c of containers) {
    const items = kids.get(c) ?? [];
    if (!items.length) continue;
    const M = c === "" ? GAP_ROOT : GAP_IN;
    const fixed = (id: string) => locked.has(id);
    // how far a and b must separate on each axis to keep the gap (<= 0: they already have room)
    const need = (a: R, b: R) => ({
      x: Math.min(a.x + a.w + M - b.x, b.x + b.w + M - a.x),
      y: Math.min(a.y + a.h + M - b.y, b.y + b.h + M - a.y),
    });
    // 1) relax: nudge each crowded pair apart, a little at a time, until nobody is crowded
    for (let iter = 0; iter < 300; iter++) {
      let crowded = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          if (fixed(a) && fixed(b)) continue;
          const ra = rect.get(a)!, rb = rect.get(b)!;
          const n = need(ra, rb);
          if (n.x <= 0.5 || n.y <= 0.5) continue;
          crowded = true;
          // push along the cheaper axis; direction from the centres (ties: the later one goes right/down)
          const horiz = n.x <= n.y;
          const ca = horiz ? ra.x + ra.w / 2 : ra.y + ra.h / 2, cb = horiz ? rb.x + rb.w / 2 : rb.y + rb.h / 2;
          const sign = cb >= ca ? 1 : -1; // b goes this way, a the other
          const d = horiz ? n.x : n.y;
          const shareA = fixed(a) ? 0 : fixed(b) ? 1 : 0.5;
          const da = -sign * d * shareA, db = sign * d * (1 - shareA);
          if (horiz) { move(a, da, 0); move(b, db, 0); } else { move(a, 0, da); move(b, 0, db); }
        }
      }
      if (!crowded) break;
    }
    // 2) safety net for knots the relaxation didn't untie: greedy push in reading order
    const order = readingOrder(items.map((id) => ({ id, ...rect.get(id)! })));
    const placed: string[] = items.filter(fixed);
    for (const id of order) {
      if (fixed(id)) continue;
      for (let guard = 0; guard < 400; guard++) {
        const r = rect.get(id)!;
        const hit = placed.find((p) => { const n = need(r, rect.get(p)!); return n.x > 0.5 && n.y > 0.5; });
        if (!hit) break;
        const q = rect.get(hit)!;
        const right = q.x + q.w + M - r.x, down = q.y + q.h + M - r.y;
        if (right <= down) move(id, right, 0); else move(id, 0, down);
      }
      placed.push(id);
    }
    // 3) the frame fits snugly around what is inside it (grows or shrinks; the contents don't move)
    if (c) rect.set(c, wrap(items.map((id) => rect.get(id)!)));
  }

  const pos = new Map<string, { x: number; y: number }>();
  const size = new Map<string, { width: number; height: number }>();
  for (const n of nodes) {
    const r = rect.get(n.id)!;
    if (Math.round(r.x) !== Math.round(n.position.x) || Math.round(r.y) !== Math.round(n.position.y)) pos.set(n.id, { x: Math.round(r.x), y: Math.round(r.y) });
    if (isFrame(n) && !n.data.collapsed) {
      const s = frameSize(n);
      if (Math.round(r.w) !== Math.round(s.w) || Math.round(r.h) !== Math.round(s.h)) size.set(n.id, { width: Math.round(r.w), height: Math.round(r.h) });
    }
  }
  return { pos, size };
}

/**
 * Fit frames around their contents without moving anything else (inside-out, so nested frames fit first).
 * `only`: limit to these frames. Returns new boxes for the frames that change.
 */
export function fitFrames(nodes: AppNode[], only?: Set<string>, fixedH: Map<string, number> = new Map()) {
  const pm = parentMap(nodes);
  const rect = new Map<string, R>();
  for (const n of nodes) {
    const b = boxRect(n);
    rect.set(n.id, isCard(n) ? { x: b.x, y: b.y, w: cardW(n), h: fixedH.get(n.id) ?? fullH.get(n.id) ?? Math.max(n.measured?.height ?? 0, estHeight(n)) } : { ...b, h: fixedH.get(n.id) ?? b.h });
  }
  const kids = new Map<string, string[]>();
  for (const n of nodes) { const p = pm.get(n.id); if (p) kids.set(p, [...(kids.get(p) ?? []), n.id]); }
  const depth = (id: string) => { let d = 0, p = pm.get(id); while (p) { d++; p = pm.get(p); } return d; };
  const frames = nodes.filter((n) => isFrame(n) && !n.data.collapsed && (kids.get(n.id)?.length ?? 0) > 0).sort((a, b) => depth(b.id) - depth(a.id));
  const out = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const f of frames) {
    const r = wrap(kids.get(f.id)!.map((id) => rect.get(id)!));
    rect.set(f.id, r);
    if (only && !only.has(f.id)) continue;
    const s = frameSize(f as FrameNodeT);
    if ([r.x - f.position.x, r.y - f.position.y, r.w - s.w, r.h - s.h].some((d) => Math.abs(d) >= 1)) out.set(f.id, { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) });
  }
  return out;
}
