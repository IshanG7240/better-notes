import dagre from "@dagrejs/dagre";
import { fullH } from "./heights";
import { boxRect, cardW, estHeight, FRAME_PAD, frameSize, parentMap, readingOrder, screenAspect } from "./layout";
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
 *  - linked cards: a tree / branching cluster is drawn as a tree (right or down, whichever fits the screen better);
 *    a plain chain keeps your arrangement and only a backwards link is fixed; a linked cluster moves as one block;
 *  - overlaps are pushed apart, in reading order, so earlier things keep their spot;
 *  - frames shrink or grow to fit what is inside them.
 * Nothing is packed into rows or columns. Works inside-out: the deepest frames first.
 */
export function tidy(nodes: AppNode[], edges: NoteEdge[], locked: Set<string>, fixedH: Map<string, number> = new Map(), fitOnly?: Set<string>) {
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
    // a frame holding a pinned card stays where it is, but the rest of its contents is tidied like anywhere else

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
    const unitOf = new Map<string, string[]>(); // linked cards move as one block in step 2, so a flow never gets split
    for (const start of adj.keys()) {
      if (done.has(start)) continue;
      const comp: string[] = [];
      const stack = [start];
      while (stack.length) { const x = stack.pop()!; if (done.has(x)) continue; done.add(x); comp.push(x); stack.push(...adj.get(x)!); }
      for (const id of comp) unitOf.set(id, comp);
      const ce = flow.filter(([a]) => comp.includes(a));
      // keep the arrangement you made (no levelling into one straight row); only a link that points backwards
      // (the later card sits up-and-left of the earlier one) is fixed, by moving the later card just past the earlier
      // one, in flow order so a fix carries down the chain. Cycles have no order: left alone.
      const indeg = new Map(comp.map((id) => [id, 0]));
      for (const [, b] of ce) indeg.set(b, indeg.get(b)! + 1);
      const ready = comp.filter((id) => indeg.get(id) === 0);
      const topo: string[] = [];
      while (ready.length) {
        const id = ready.shift()!;
        topo.push(id);
        for (const [a, b] of ce) if (a === id) { indeg.set(b, indeg.get(b)! - 1); if (indeg.get(b) === 0) ready.push(b); }
      }
      if (topo.length !== comp.length) continue;
      // a tree / branching graph is drawn as one: parents before children, branches fanned out, going right or down,
      // whichever gives a shape closer to the screen's. It keeps the spot where the cluster was.
      const outs = new Map<string, number>(), ins = new Map<string, number>();
      for (const [a, b] of ce) { outs.set(a, (outs.get(a) ?? 0) + 1); ins.set(b, (ins.get(b) ?? 0) + 1); }
      if (comp.length >= 3 && comp.some((id) => (outs.get(id) ?? 0) > 1 || (ins.get(id) ?? 0) > 1)) {
        const lay = (dir: "LR" | "TB") => {
          const g = new dagre.graphlib.Graph();
          g.setGraph({ rankdir: dir, nodesep: dir === "LR" ? 32 : 36, ranksep: dir === "LR" ? 90 : 60, marginx: 0, marginy: 0 });
          g.setDefaultEdgeLabel(() => ({}));
          // siblings keep the order they had across the flow (top to bottom when going right, left to right when going down)
          const cross = (id: string) => (dir === "LR" ? rect.get(id)!.y : rect.get(id)!.x);
          const sorted = [...comp].sort((p, q) => cross(p) - cross(q));
          for (const id of sorted) g.setNode(id, { width: rect.get(id)!.w, height: rect.get(id)!.h });
          for (const [a, b] of [...ce].sort((p, q) => cross(p[1]) - cross(q[1]))) g.setEdge(a, b);
          dagre.layout(g);
          const box = g.graph() as { width?: number; height?: number };
          return { g, shape: Math.abs(Math.log((box.width ?? 1) / Math.max(1, box.height ?? 1) / screenAspect())) };
        };
        const isTree = comp.every((id) => (ins.get(id) ?? 0) <= 1);
        const lr = isTree ? treeLay(comp, ce, rect, "LR") : lay("LR"), tb = isTree ? treeLay(comp, ce, rect, "TB") : lay("TB");
        const { g } = lr.shape <= tb.shape ? lr : tb;
        const ox = Math.min(...comp.map((id) => rect.get(id)!.x)), oy = Math.min(...comp.map((id) => rect.get(id)!.y));
        const lx = Math.min(...comp.map((id) => g.node(id).x - g.node(id).width / 2)), ly = Math.min(...comp.map((id) => g.node(id).y - g.node(id).height / 2));
        for (const id of comp) {
          const n = g.node(id), r = rect.get(id)!;
          move(id, Math.round(n.x - n.width / 2 - lx + ox - r.x), Math.round(n.y - n.height / 2 - ly + oy - r.y));
        }
        continue;
      }
      // a plain chain keeps the arrangement you made (no levelling into one row): only fix backwards links
      const G = root ? 90 : 46;
      const corner = () => ({ x: Math.min(...comp.map((id) => rect.get(id)!.x)), y: Math.min(...comp.map((id) => rect.get(id)!.y)) });
      const was = corner();
      let fixed = false;
      for (const a of topo) {
        for (const [s, b] of ce) {
          if (s !== a || locked.has(b)) continue;
          const ra = rect.get(a)!, rb = rect.get(b)!;
          const back = rb.x + rb.w / 2 <= ra.x + ra.w / 2 && rb.y + rb.h / 2 <= ra.y + ra.h / 2;
          if (!back) continue;
          if (root) move(b, ra.x + ra.w + G - rb.x, 0);
          else move(b, 0, ra.y + ra.h + G - rb.y);
          fixed = true;
        }
      }
      // the cluster stays where it was: its top-left corner doesn't move
      if (fixed) { const now = corner(); for (const id of comp) if (!locked.has(id)) move(id, was.x - now.x, was.y - now.y); }
    }

    // 2) push overlaps apart in reading order; locked things and earlier things keep their place.
    //    A linked cluster moves as one block, so its flow keeps its shape and direction.
    const M = root ? 56 : 24;
    const order = readingOrder(items.map((id) => ({ id, ...rect.get(id)! })));
    const placed: string[] = items.filter((id) => locked.has(id));
    const handled = new Set<string>();
    for (const first of order) {
      if (locked.has(first) || handled.has(first)) continue;
      const unit = (unitOf.get(first) ?? [first]).filter((id) => !locked.has(id));
      for (const id of unit) handled.add(id);
      for (let guard = 0; guard < 400; guard++) {
        let push: { dx: number; dy: number } | null = null;
        for (const id of unit) {
          const r = rect.get(id)!;
          const hit = placed.find((p) => { const q = rect.get(p)!; return r.x < q.x + q.w + M && q.x < r.x + r.w + M && r.y < q.y + q.h + M && q.y < r.y + r.h + M; });
          if (!hit) continue;
          const q = rect.get(hit)!;
          const right = q.x + q.w + M - r.x, down = q.y + q.h + M - r.y;
          push = right <= down ? { dx: right, dy: 0 } : { dx: 0, dy: down };
          break;
        }
        if (!push) break;
        for (const id of unit) move(id, push.dx, push.dy);
      }
      placed.push(...unit);
    }

    // 3) a frame wraps what is inside it (with a selection: only the frames the selection touches)
    if (!root && (!fitOnly || fitOnly.has(c))) rect.set(c, wrap(items.map((id) => rect.get(id)!)));
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
 * A tidy tree (every card has at most one parent): depth goes along `dir`, children keep the order they already
 * had across it, and each parent is centred on its children. Same shape of result as the dagre layout.
 */
function treeLay(comp: string[], ce: [string, string][], rect: Map<string, R>, dir: "LR" | "TB") {
  const kids = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const [a, b] of ce) { kids.set(a, [...(kids.get(a) ?? []), b]); hasParent.add(b); }
  const along = (id: string) => (dir === "LR" ? rect.get(id)!.w : rect.get(id)!.h);
  const across = (id: string) => (dir === "LR" ? rect.get(id)!.h : rect.get(id)!.w);
  const crossPos = (id: string) => (dir === "LR" ? rect.get(id)!.y : rect.get(id)!.x);
  for (const k of kids.values()) k.sort((p, q) => crossPos(p) - crossPos(q));
  const RANK = dir === "LR" ? 90 : 60, SIB = dir === "LR" ? 32 : 36;
  const depth = new Map<string, number>();
  const roots = comp.filter((id) => !hasParent.has(id)).sort((p, q) => crossPos(p) - crossPos(q));
  const walk = (id: string, d: number) => { depth.set(id, d); for (const k of kids.get(id) ?? []) walk(k, d + 1); };
  roots.forEach((r) => walk(r, 0));
  const rankSize: number[] = [];
  for (const id of comp) { const d = depth.get(id)!; rankSize[d] = Math.max(rankSize[d] ?? 0, along(id)); }
  const rankStart: number[] = [];
  rankSize.reduce((acc, sz, i) => ((rankStart[i] = acc), acc + sz + RANK), 0);
  const pos = new Map<string, { a: number; c: number }>(); // a: along the flow, c: across (centre)
  const span = new Map<string, number>();
  const size = (id: string): number => {
    const k = kids.get(id) ?? [];
    const sum = k.reduce((t, c) => t + size(c), 0) + SIB * Math.max(0, k.length - 1);
    const v = Math.max(across(id), sum);
    span.set(id, v);
    return v;
  };
  const place = (id: string, c0: number) => {
    const k = kids.get(id) ?? [], sp = span.get(id)!;
    const sum = k.reduce((t, c) => t + span.get(c)!, 0) + SIB * Math.max(0, k.length - 1);
    let c = c0 + (sp - sum) / 2;
    for (const ch of k) { place(ch, c); c += span.get(ch)! + SIB; }
    pos.set(id, { a: rankStart[depth.get(id)!], c: c0 + sp / 2 });
  };
  let c0 = 0;
  for (const r of roots) { size(r); place(r, c0); c0 += span.get(r)! + SIB; }
  // same interface as a dagre graph: node(id) -> centre x/y + size
  const node = (id: string) => {
    const p = pos.get(id)!, w = rect.get(id)!.w, h = rect.get(id)!.h;
    return dir === "LR" ? { x: p.a + w / 2, y: p.c, width: w, height: h } : { x: p.c, y: p.a + h / 2, width: w, height: h };
  };
  const W = Math.max(...comp.map((id) => node(id).x + node(id).width / 2)) - Math.min(...comp.map((id) => node(id).x - node(id).width / 2));
  const H = Math.max(...comp.map((id) => node(id).y + node(id).height / 2)) - Math.min(...comp.map((id) => node(id).y - node(id).height / 2));
  return { g: { node }, shape: Math.abs(Math.log(W / Math.max(1, H) / screenAspect())) };
}

/** Gap kept around things: on the open board, and between things inside a frame. Same as tidy() so the two agree. */
const GAP_ROOT = 56;
const GAP_IN = 36;
/** on the open board, things further apart than this are separate areas: evening out leaves that gap alone */
const SEPARATE = 1200;

/**
 * Even gaps that keep the shape. Each thing is compared with the things it faces: side by side (their heights
 * overlap) or one above the other (their widths overlap). "Overlap" is counted with the gap as slack, so two
 * things whose corners come closer than the gap also face each other, and frames, cards and diagonal pairs are all
 * treated alike. Each facing pair is set exactly `M` apart (closer ones pushed apart, further ones pulled together),
 * left to right, then top to bottom, repeated until nothing moves:
 *  - a thing moves only along the line it faces its neighbour on; everything keeps its order and its offset
 *    sideways, so zig-zags and staggered columns stay;
 *  - the first thing on each line (nothing before it) stays; a thing with nothing to its left moves sideways with
 *    the thing above it (and one with nothing above moves up or down with the thing to its left), so shapes travel
 *    together instead of being stretched;
 *  - pinned / out-of-scope things never move; the others line up against them.
 */
function evenGaps(items: string[], rect: Map<string, R>, M: number, far: number, fixed: (id: string) => boolean, move: (id: string, dx: number, dy: number) => void) {
  const pass = (ax: "x" | "y") => {
    const o = ax === "x" ? "y" : "x", W = ax === "x" ? "w" : "h", OW = ax === "x" ? "h" : "w";
    const sep = (a: R, b: R, k: "x" | "y", K: "w" | "h") => Math.max(b[k] - (a[k] + a[K]), a[k] - (b[k] + b[K]));
    const mid = (r: R, k: "x" | "y", K: "w" | "h") => r[k] + r[K] / 2;
    const preds = new Map<string, string[]>(), opreds = new Map<string, string[]>();
    for (const id of items) { preds.set(id, []); opreds.set(id, []); }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      let a = items[i], b = items[j];
      const ra = rect.get(a)!, rb = rect.get(b)!;
      const sa = sep(ra, rb, ax, W), so = sep(ra, rb, o, OW);
      if (sa >= M && so >= M) continue; // diagonal, with room at the corners: neither line
      // they face each other along the axis they are further apart on (ties: side by side)
      const along = sa > so || (sa === so && ax === "x");
      if ((along ? sa : so) > far) continue; // a separate area
      const k = along ? ax : o, K = along ? W : OW;
      if (mid(ra, k, K) > mid(rb, k, K) || (mid(ra, k, K) === mid(rb, k, K) && a > b)) [a, b] = [b, a];
      (along ? preds : opreds).get(b)!.push(a);
    }
    // what each thing's new place depends on: the things before it on this line, else the one it moves sideways with
    const end = (id: string, k: "x" | "y", K: "w" | "h") => rect.get(id)![k] + rect.get(id)![K];
    const lead = new Map<string, string>();
    for (const id of items) {
      if (preds.get(id)!.length) continue;
      const op = opreds.get(id)!;
      if (op.length) lead.set(id, op.reduce((best, p) => (end(p, o, OW) > end(best, o, OW) ? p : best)));
    }
    const order: string[] = [], state = new Map<string, 1 | 2>();
    const visit = (id: string) => {
      if (state.get(id)) return; // done, or a loop (rare): use its current place
      state.set(id, 1);
      for (const p of preds.get(id)!) visit(p);
      const l = lead.get(id);
      if (l) visit(l);
      state.set(id, 2);
      order.push(id);
    };
    for (const id of [...items].sort((a, b) => mid(rect.get(a)!, ax, W) - mid(rect.get(b)!, ax, W) || (a < b ? -1 : 1))) visit(id);
    const shift = new Map<string, number>();
    let moved = 0;
    for (const id of order) {
      let d = 0;
      if (!fixed(id)) {
        const ps = preds.get(id)!;
        if (ps.length) d = Math.max(...ps.map((p) => end(p, ax, W) + M)) - rect.get(id)![ax];
        else { const l = lead.get(id); d = l ? shift.get(l) ?? 0 : 0; }
      }
      if (Math.abs(d) < 0.5) d = 0;
      shift.set(id, d);
      if (d) { moved += Math.abs(d); ax === "x" ? move(id, d, 0) : move(id, 0, d); }
    }
    return moved;
  };
  for (let round = 0; round < 30; round++) if (pass("x") + pass("y") < 1) break;
}

/**
 * "Space out": the gentlest layout. Only things that overlap or sit closer than the gap move, and only
 * as far as needed. Each crowded pair moves apart half each, along whichever axis needs less movement
 * (pinned things don't move; the other side takes the whole push). Frames move as a block with
 * everything inside them, and fit snugly around their contents. Works inside-out.
 */
export function spaceOut(nodes: AppNode[], locked: Set<string>, fixedH: Map<string, number> = new Map(), opt: { touch?: Iterable<string>; growOnly?: boolean; fitOnly?: Set<string>; even?: boolean } = {}) {
  // scoped ("make room"): only pairs involving the touched things (and whatever they push) are separated, the touched
  // things hold their spot, and frames only grow. Used after a drop and after the assistant adds cards.
  const scoped = !!opt.touch;
  const touch = new Set(opt.touch ?? []);
  const heavy = new Set(touch);
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
  // scoped: a frame with something touched inside grows to hold it; if it grew, it pushes its neighbours (and holds its spot)
  const fitScoped = (c: string, items: string[]) => {
    if (!c || !items.some((id) => touch.has(id))) return;
    const f = rect.get(c)!;
    // growOnly: fit around what was touched (the rest already sits where it was meant to; don't shift the frame's edges for it)
    const w = wrap((opt.growOnly ? items.filter((id) => touch.has(id)) : items).map((id) => rect.get(id)!));
    let g = { ...w };
    if (opt.growOnly) {
      // only grow a side when something really crowds it (cards already sitting a little inside keep the edge where it is)
      const cut = (inner: number, want: number, edge: number, pad: number, dir: 1 | -1) => (dir * (want - edge) > 0 && dir * (inner - edge) > -pad / 2 ? want : edge);
      const x = cut(w.x + FRAME_PAD.x, w.x, f.x, FRAME_PAD.x, -1), y = cut(w.y + FRAME_PAD.top, w.y, f.y, FRAME_PAD.top, -1);
      const r = cut(w.x + w.w - FRAME_PAD.x, w.x + w.w, f.x + f.w, FRAME_PAD.x, 1), b = cut(w.y + w.h - FRAME_PAD.bottom, w.y + w.h, f.y + f.h, FRAME_PAD.bottom, 1);
      g = { x, y, w: r - x, h: b - y };
    }
    if ([g.x - f.x, g.y - f.y, g.w - f.w, g.h - f.h].some((d) => Math.abs(d) >= 1)) { rect.set(c, g); touch.add(c); heavy.add(c); }
  };

  for (const c of containers) {
    const items = kids.get(c) ?? [];
    if (!items.length) continue;
    const M = c === "" ? GAP_ROOT : GAP_IN;
    const fixed = (id: string) => locked.has(id);
    const isFr = (id: string) => isFrame(byId.get(id)!);
    // share of the push that `a` takes (b takes the rest); null: neither may move
    const shareOf = (a: string, b: string): number | null => {
      if (fixed(a) && fixed(b)) return null;
      if (fixed(a)) return 0;
      if (fixed(b)) return 1;
      if (scoped) {
        if (isFr(a) !== isFr(b)) return isFr(a) ? 0 : 1; // a card makes way for a frame, not the other way round
        if (heavy.has(a) && heavy.has(b)) return null;
        if (heavy.has(a)) return 0;
        if (heavy.has(b)) return 1;
      }
      return 0.5;
    };
    // how far a and b must separate on each axis to keep the gap (<= 0: they already have room)
    const need = (a: R, b: R) => ({
      x: Math.min(a.x + a.w + M - b.x, b.x + b.w + M - a.x),
      y: Math.min(a.y + a.h + M - b.y, b.y + b.h + M - a.y),
    });
    // 1) "Space out" pressed: every gap evened out (see evenGaps). Otherwise: only crowded pairs are nudged apart,
    //    a little at a time, until nobody is crowded
    if (opt.even && !scoped) evenGaps(items, rect, M, c === "" ? SEPARATE : Infinity, fixed, move);
    for (let iter = 0; iter < 300; iter++) {
      let crowded = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          if (scoped && !touch.has(a) && !touch.has(b)) continue;
          const share = shareOf(a, b);
          if (share === null) continue;
          const ra = rect.get(a)!, rb = rect.get(b)!;
          const n = need(ra, rb);
          if (n.x <= 0.5 || n.y <= 0.5) continue;
          crowded = true;
          // push along the cheaper axis; direction from the centres (ties: the later one goes right/down)
          const horiz = n.x <= n.y;
          const ca = horiz ? ra.x + ra.w / 2 : ra.y + ra.h / 2, cb = horiz ? rb.x + rb.w / 2 : rb.y + rb.h / 2;
          const sign = cb >= ca ? 1 : -1; // b goes this way, a the other
          const d = horiz ? n.x : n.y;
          const shareA = share;
          const da = -sign * d * shareA, db = sign * d * (1 - shareA);
          if (scoped) { if (da) touch.add(a); if (db) touch.add(b); }
          if (horiz) { move(a, da, 0); move(b, db, 0); } else { move(a, 0, da); move(b, 0, db); }
        }
      }
      if (!crowded) break;
    }
    // 2) safety net for knots the relaxation didn't untie: greedy push in reading order
    if (scoped) { fitScoped(c, items); continue; }
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
    // 3) the frame fits snugly around what is inside it (grows or shrinks; the contents don't move). With a selection:
    //    only the frames the selection touches
    if (c && (!opt.fitOnly || opt.fitOnly.has(c))) rect.set(c, wrap(items.map((id) => rect.get(id)!)));
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
