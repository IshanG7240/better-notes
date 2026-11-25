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
 * "Line up": Space out (even gaps, shape kept), plus links read forwards. A linked card that sits before the card it
 * comes from (up and to the left of it) is moved just past it: to the right on the open board, below inside a frame.
 * Links between cards in different frames count as links between those frames. Nothing is redrawn as a tree or
 * forced into rows: a card linked from early cards and to later ones stays where you put it. Links that go round in
 * a loop have no forwards, so they are left as they are (the gaps are still evened). Works inside-out.
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
  const containers = ["", ...nodes.filter((n) => isFrame(n) && !n.data.collapsed).map((n) => n.id)].sort((a, b) => (b ? depth(b) + 1 : 0) - (a ? depth(a) + 1 : 0));
  for (const c of containers) {
    const items = kids.get(c) ?? [];
    // a frame grows around anything moved below, so it keeps holding it (Space out trims it snugly afterwards)
    const grow = () => {
      if (!c) return;
      const f = rect.get(c)!, w = wrap(items.map((id) => rect.get(id)!));
      const x = Math.min(f.x, w.x), y = Math.min(f.y, w.y);
      rect.set(c, { x, y, w: Math.max(f.x + f.w, w.x + w.w) - x, h: Math.max(f.y + f.h, w.y + w.h) - y });
    };
    if (items.length < 2) { if (items.length) grow(); continue; }
    const G = c === "" ? GAP_FRAME : GAP_IN;
    const flow: [string, string][] = [];
    const seen = new Set<string>();
    for (const e of edges) {
      const a = itemOf(e.source, c), b = itemOf(e.target, c);
      if (!a || !b || a === b || !items.includes(a) || !items.includes(b) || seen.has(a + ">" + b)) continue;
      seen.add(a + ">" + b);
      flow.push([a, b]);
    }
    if (!flow.length) { grow(); continue; }
    // flow order (links that loop back have none: those cards are left out)
    const indeg = new Map(items.map((id) => [id, 0]));
    for (const [, b] of flow) indeg.set(b, indeg.get(b)! + 1);
    const ready = items.filter((id) => indeg.get(id) === 0);
    const topo: string[] = [];
    while (ready.length) {
      const id = ready.shift()!;
      topo.push(id);
      for (const [a, b] of flow) if (a === id) { indeg.set(b, indeg.get(b)! - 1); if (indeg.get(b) === 0) ready.push(b); }
    }
    for (const a of topo) {
      for (const [s, b] of flow) {
        if (s !== a || locked.has(b) || !topo.includes(b)) continue;
        const ra = rect.get(a)!, rb = rect.get(b)!;
        const back = rb.x + rb.w / 2 <= ra.x + ra.w / 2 && rb.y + rb.h / 2 <= ra.y + ra.h / 2;
        if (!back) continue;
        if (c === "") move(b, ra.x + ra.w + G - rb.x, 0);
        else move(b, 0, ra.y + ra.h + G - rb.y);
      }
    }
    grow();
  }
  // then even gaps everywhere, the same as Space out (this also clears any overlap a move above made, and fits frames)
  const moved = nodes.map((n) => {
    const r = rect.get(n.id)!;
    const b = boxRect(n);
    if (r.x === b.x && r.y === b.y && r.w === b.w && (isCard(n) || r.h === b.h)) return n;
    return (isFrame(n) && !n.data.collapsed ? { ...n, position: { x: r.x, y: r.y }, width: r.w, height: r.h, measured: { width: r.w, height: r.h } } : { ...n, position: { x: r.x, y: r.y } }) as AppNode;
  });
  const ev = spaceOut(moved, locked, fixedH, { fitOnly, even: true });
  const pos = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const m = moved.find((x) => x.id === n.id)!;
    const p = ev.pos.get(n.id) ?? m.position;
    if (Math.round(p.x) !== Math.round(n.position.x) || Math.round(p.y) !== Math.round(n.position.y)) pos.set(n.id, { x: Math.round(p.x), y: Math.round(p.y) });
  }
  const size = new Map<string, { width: number; height: number }>();
  for (const n of nodes) {
    if (!isFrame(n) || n.data.collapsed) continue;
    const m = moved.find((x) => x.id === n.id)!, z = ev.size.get(n.id) ?? frameSize(m as FrameNodeT), s0 = frameSize(n);
    const w = "width" in z ? z.width : z.w, h = "height" in z ? z.height : z.h;
    if (Math.round(w) !== Math.round(s0.w) || Math.round(h) !== Math.round(s0.h)) size.set(n.id, { width: Math.round(w), height: Math.round(h) });
  }
  return { pos, size };
}

/** Gap kept around things: on the open board, and between things inside a frame. Same as tidy() so the two agree. */
const GAP_ROOT = 56;
const GAP_IN = 36;
/** Space out, on the open board: the gap next to a frame (frames are sections and need room to breathe, and for the
 *  lines running between them). Two loose cards keep GAP_ROOT. */
const GAP_FRAME = 150;
/** on the open board, things further apart than this are separate areas: evening out leaves that gap alone */
const SEPARATE = 1200;

/**
 * Even gaps that keep the shape. Each thing is compared with the things it faces: side by side (their heights
 * overlap) or one above the other (their widths overlap). "Overlap" is counted with the gap as slack, so two
 * things whose corners come closer than the gap also face each other, and frames, cards and diagonal pairs are all
 * treated alike. Each facing pair is set exactly its gap apart (closer ones pushed apart, further ones pulled together),
 * left to right, then top to bottom, repeated until nothing moves:
 *  - a thing moves only along the line it faces its neighbour on; everything keeps its order and its offset
 *    sideways, so zig-zags and staggered columns stay;
 *  - the first thing on each line (nothing before it) stays; a thing with nothing to its left moves sideways with
 *    the thing above it (and one with nothing above moves up or down with the thing to its left), so shapes travel
 *    together instead of being stretched;
 *  - pinned / out-of-scope things never move; the others line up against them.
 */
function evenGaps(items: string[], rect: Map<string, R>, gapOf: (a: string, b: string) => number, far: number, fixed: (id: string) => boolean, move: (id: string, dx: number, dy: number) => void) {
  const pass = (ax: "x" | "y") => {
    const o = ax === "x" ? "y" : "x", W = ax === "x" ? "w" : "h", OW = ax === "x" ? "h" : "w";
    const sep = (a: R, b: R, k: "x" | "y", K: "w" | "h") => Math.max(b[k] - (a[k] + a[K]), a[k] - (b[k] + b[K]));
    const mid = (r: R, k: "x" | "y", K: "w" | "h") => r[k] + r[K] / 2;
    const preds = new Map<string, string[]>(), opreds = new Map<string, string[]>();
    for (const id of items) { preds.set(id, []); opreds.set(id, []); }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      let a = items[i], b = items[j];
      const ra = rect.get(a)!, rb = rect.get(b)!, M = gapOf(a, b);
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
        if (ps.length) d = Math.max(...ps.map((p) => end(p, ax, W) + gapOf(p, id))) - rect.get(id)![ax];
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
    if (opt.even && !scoped) {
      const gapOf = (a: string, b: string) => (c === "" && (isFr(a) || isFr(b)) ? GAP_FRAME : M);
      evenGaps(items, rect, gapOf, c === "" ? SEPARATE : Infinity, fixed, move);
    }
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
