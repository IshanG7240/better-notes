import { fullH } from "./heights";
import dagre from "@dagrejs/dagre";
import { isCard, isFrame, type AppNode, type CardNodeT, type FrameNodeT, type NoteEdge } from "./types";

export let CARD_W = 480;
export const setCardDefault = (w: number) => { CARD_W = w; };
/** a card's width: its own (resized) width, else the default */
export const cardW = (n: { width?: number | null }) => n.width ?? CARD_W;
/** A card's full-detail height, guessed from its text (wrapped at its width) before it has been seen at full detail. */
export const guessHeight = (n: { width?: number | null; data: CardNodeT["data"] }) => {
  const perLine = Math.max(24, Math.floor((cardW(n) - 44) / 7.4));
  const lines = n.data.bullets.split("\n").filter((l) => l.trim()).reduce((t, l) => t + Math.max(1, Math.ceil(l.trim().length / perLine)), 0);
  const titleLines = Math.max(1, Math.ceil((n.data.title.length || 1) / Math.max(20, perLine - 8)));
  return 44 + titleLines * 24 + (n.data.kind === "idea" || n.data.kind === "note" ? 0 : 24) + Math.max(1, lines) * 28;
};
export const estHeight = (n: CardNodeT) => n.measured?.height ?? guessHeight(n);

/**
 * Lay out `fresh` nodes (positions ignored) and return top-left positions.
 * `anchors` are existing nodes connected to fresh ones; the layout is translated
 * so it lines up with them. With no anchors it lands to the right of `existing`.
 */
export function layoutNew(
  fresh: CardNodeT[],
  edges: NoteEdge[],
  anchors: CardNodeT[],
  existing: CardNodeT[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 110 });
  g.setDefaultEdgeLabel(() => ({}));
  const all = [...fresh, ...anchors];
  for (const n of all) g.setNode(n.id, { width: cardW(n), height: estHeight(n) });
  const ids = new Set(all.map((n) => n.id));
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const tl = (id: string) => {
    const p = g.node(id);
    return { x: p.x - p.width / 2, y: p.y - p.height / 2 };
  };

  let dx: number, dy: number;
  if (anchors.length) {
    dx = dy = 0;
    for (const a of anchors) {
      const l = tl(a.id);
      dx += a.position.x - l.x;
      dy += a.position.y - l.y;
    }
    dx /= anchors.length;
    dy /= anchors.length;
  } else {
    let minX = Infinity,
      minY = Infinity;
    for (const n of fresh) {
      const l = tl(n.id);
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
    }
    let tx = 0,
      ty = 0;
    if (existing.length) {
      tx = Math.max(...existing.map((n) => n.position.x + cardW(n))) + 140;
      ty = Math.min(...existing.map((n) => n.position.y));
    }
    dx = tx - minX;
    dy = ty - minY;
  }

  const out = new Map<string, { x: number; y: number }>();
  // keep new cards off everything already on the board: slide each one to the nearest free spot
  const taken = existing.map((n) => ({ x: n.position.x, y: n.position.y, w: cardW(n), h: fullH.get(n.id) ?? estHeight(n) }));
  const GAP = 24;
  const free = (x: number, y: number, w: number, h: number) =>
    !taken.some((t) => x < t.x + t.w + GAP && x + w + GAP > t.x && y < t.y + t.h + GAP && y + h + GAP > t.y);
  const spots: [number, number][] = [];
  for (let i = -14; i <= 14; i++) for (let j = -14; j <= 14; j++) spots.push([i * 80, j * 60]);
  spots.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  for (const n of fresh) {
    const l = tl(n.id);
    const x0 = Math.round(l.x + dx), y0 = Math.round(l.y + dy);
    const w = cardW(n), h = estHeight(n);
    const [ox, oy] = spots.find(([ox, oy]) => free(x0 + ox, y0 + oy, w, h)) ?? [0, 0];
    out.set(n.id, { x: x0 + ox, y: y0 + oy });
    taken.push({ x: x0 + ox, y: y0 + oy, w, h });
  }
  return out;
}

/** The shape frames aim for (width / height): the screen's, so a full frame reads without much scrolling. */
export const screenAspect = () => {
  const w = typeof window !== "undefined" ? window.innerWidth : 1600, h = typeof window !== "undefined" ? window.innerHeight : 900;
  return Math.min(2.4, Math.max(1, w / Math.max(1, h)));
};

export const COLLAPSED = { w: 260, h: 74 };
export const FRAME_PAD = { x: 44, top: 70, bottom: 44 };

export function frameSize(f: FrameNodeT) {
  return { w: f.width ?? f.measured?.width ?? 420, h: f.height ?? f.measured?.height ?? 300 };
}
const frameArea = (f: FrameNodeT) => {
  const { w, h } = frameSize(f);
  return w * h;
};
export const boxRect = (n: AppNode) => {
  if (isFrame(n)) {
    const { w, h } = frameSize(n);
    return { x: n.position.x, y: n.position.y, w, h };
  }
  return { x: n.position.x, y: n.position.y, w: cardW(n), h: estHeight(n) };
};

/** child id -> id of the smallest frame that contains it (frames nest inside bigger frames). */
export function parentMap(nodes: AppNode[]): Map<string, string> {
  const frames = nodes.filter(isFrame).sort((a, b) => frameArea(a) - frameArea(b));
  const out = new Map<string, string>();
  for (const n of nodes) {
    const r = boxRect(n);
    const cx = r.x + r.w / 2,
      cy = r.y + r.h / 2;
    for (const f of frames) {
      if (f.id === n.id) continue;
      if (isFrame(n) && frameArea(f) <= frameArea(n)) continue;
      const fr = boxRect(f);
      if (cx >= fr.x && cx <= fr.x + fr.w && cy >= fr.y && cy <= fr.y + fr.h) {
        out.set(n.id, f.id);
        break;
      }
    }
  }
  return out;
}

/** Every node (cards and frames, any depth) sitting inside `frame`. */
export function descendants(frame: FrameNodeT, nodes: AppNode[]): AppNode[] {
  const pm = parentMap(nodes);
  return nodes.filter((n) => {
    let p = pm.get(n.id);
    while (p) {
      if (p === frame.id) return true;
      p = pm.get(p);
    }
    return false;
  });
}

export const membersOf = (frame: FrameNodeT, cards: CardNodeT[]): CardNodeT[] =>
  descendants(frame, [...cards, frame]).filter(isCard);

/** Names of the frames around a node, outermost first. */
export function frameChain(id: string, pm: Map<string, string>, byId: Map<string, FrameNodeT>): string[] {
  const out: string[] = [];
  let p = pm.get(id);
  while (p) {
    out.unshift(byId.get(p)?.data.title || "Group");
    p = pm.get(p);
  }
  return out;
}

type Rect = { id: string; x: number; y: number; w: number; h: number };

/**
 * Reading order of boxes as a person would read them: rows top to bottom (boxes whose vertical
 * spans overlap share a row), then columns left to right inside a row, then top to bottom.
 * It reproduces the order organize() lays things out in, so Line up never shuffles a tidy board.
 */
export function readingOrder(rects: Rect[]): string[] {
  const byY = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Rect[][] = [];
  let bottom = -Infinity;
  for (const r of byY) {
    if (!rows.length || r.y >= bottom - 8) { rows.push([r]); bottom = r.y + r.h; }
    else { rows[rows.length - 1].push(r); bottom = Math.max(bottom, r.y + r.h); }
  }
  const out: string[] = [];
  for (const row of rows) {
    const byX = [...row].sort((a, b) => a.x - b.x);
    const cols: Rect[][] = [];
    for (const r of byX) {
      const c = cols[cols.length - 1];
      if (c && r.x < c[0].x + c[0].w * 0.5) c.push(r);
      else cols.push([r]);
    }
    for (const c of cols) out.push(...c.sort((a, b) => a.y - b.y).map((r) => r.id));
  }
  return out;
}

/**
 * Lay the board out like a document. Each frame is a section; sections sit side by side in reading
 * order and wrap into rows. Cards inside a frame stack top to bottom in one column. Loose cards stack
 * in short columns between the sections. Order comes from where things are now, never from links,
 * so a tidy board stays as it is and your own ordering survives. The top-left corner stays put.
 */
/** the shape (width / height) Pack aims for inside a frame: fixed, so the result doesn't depend on the window size */
const SHAPE = 1.6;

export function organize(cards: CardNodeT[], frames: FrameNodeT[], _edges: NoteEdge[], fixedH: Map<string, number> = new Map()) {
  const pm = parentMap([...cards, ...frames]);
  const cardIds = new Set(cards.map((c) => c.id));
  const hasCards = new Set<string>();
  for (const c of cards) {
    let p = pm.get(c.id);
    while (p) {
      hasCards.add(p);
      p = pm.get(p);
    }
  }
  const used = frames.filter((f) => hasCards.has(f.id));
  const usedIds = new Set(used.map((f) => f.id));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const frameById = new Map(used.map((f) => [f.id, f]));

  const kids = new Map<string, string[]>();
  for (const id of [...cardIds, ...usedIds]) {
    let p = pm.get(id);
    while (p && !usedIds.has(p)) p = pm.get(p);
    kids.set(p ?? "", [...(kids.get(p ?? "") ?? []), id]);
  }

  type Box = { w: number; h: number; rel: Map<string, { x: number; y: number }> };
  const boxes = new Map<string, Box>();
  const size = (id: string) =>
    cardById.has(id)
      ? { w: cardW(cardById.get(id)!), h: fixedH.get(id) ?? fullH.get(id) ?? Math.max(cardById.get(id)!.measured?.height ?? 0, estHeight(cardById.get(id)!)) }
      : frameOuter(id);
  // a frame's outer size: snug around its laid-out contents (a frame sized by hand too: Pack trims it)
  const frameOuter = (id: string) => {
    const b = boxes.get(id)!;
    return { w: b.w + FRAME_PAD.x * 2, h: b.h + FRAME_PAD.top + FRAME_PAD.bottom };
  };
  const nowRect = (id: string): Rect => {
    const n = cardById.get(id) ?? frameById.get(id)!;
    const r = boxRect(n);
    return { id, x: r.x, y: r.y, w: r.w, h: r.h };
  };

  const build = (cid: string): Box => {
    const root = cid === "";
    const items = readingOrder((kids.get(cid) ?? []).map(nowRect)); // the order you see; links never reorder
    for (const id of items) if (usedIds.has(id)) boxes.set(id, build(id));
    const sz = new Map(items.map((id) => [id, size(id)]));
    const rel = new Map<string, { x: number; y: number }>();
    const CG = 36; // gap between things inside a frame (the same as Space out, so it leaves a packed frame alone)

    // Everything is laid out in rows, left to right, then the next row below: the same order you read it in (see
    // readingOrder), so packing again changes nothing.
    // A section holding only cards: a grid with as many columns as bring the frame closest to a fixed shape (about
    // 1.6 : 1, whatever the window size; a frame you sized by hand: as many as fit its width).
    if (!root && items.every((id) => cardById.has(id))) {
      const fr = frameById.get(cid)!;
      const maxW = fr.data.sized ? frameSize(fr).w - FRAME_PAD.x * 2 : Infinity;
      const grid = (k: number) => {
        const colW: number[] = [], rowH: number[] = [];
        items.forEach((id, i) => { const s = sz.get(id)!, c = i % k, r = Math.floor(i / k); colW[c] = Math.max(colW[c] ?? 0, s.w); rowH[r] = Math.max(rowH[r] ?? 0, s.h); });
        const rel = new Map<string, { x: number; y: number }>();
        items.forEach((id, i) => {
          const c = i % k, r = Math.floor(i / k);
          rel.set(id, { x: colW.slice(0, c).reduce((t, w) => t + w + CG, 0), y: rowH.slice(0, r).reduce((t, h) => t + h + CG, 0) });
        });
        return { w: colW.reduce((t, w) => t + w, 0) + CG * (colW.length - 1), h: rowH.reduce((t, h) => t + h, 0) + CG * (rowH.length - 1), rel };
      };
      const shape = (b: Box) => Math.abs(Math.log((b.w + FRAME_PAD.x * 2) / (b.h + FRAME_PAD.top + FRAME_PAD.bottom) / SHAPE));
      let best = grid(1);
      for (let k = 2; k <= Math.min(items.length, 8); k++) {
        const cand = grid(k);
        if (cand.w > maxW) break;
        if (fr.data.sized || shape(cand) < shape(best)) best = cand;
      }
      return best;
    }

    // Otherwise (the board, or a frame holding frames): each card or frame placed in rows. The gaps match Space out:
    // around a frame on the board 150, between two loose cards on the board 56, inside a frame 36.
    const isFr = (id: string) => !cardById.has(id);
    const gx = (a: string, b: string) => (root ? (isFr(a) || isFr(b) ? 150 : 56) : CG);
    const gy = (up: string[], down: string[]) => (root ? ([...up, ...down].some(isFr) ? 150 : 56) : CG);
    const want = root ? 1.7 : SHAPE; // target width / height of the whole block
    const shelve = (maxW: number) => {
      const rows: string[][] = [];
      let x = 0;
      for (const id of items) {
        const row = rows[rows.length - 1], w = sz.get(id)!.w;
        if (row && x + gx(row[row.length - 1], id) + w <= maxW) { x += gx(row[row.length - 1], id) + w; row.push(id); }
        else { rows.push([id]); x = w; }
      }
      const rowW = (r: string[]) => r.reduce((t, id, i) => t + sz.get(id)!.w + (i ? gx(r[i - 1], id) : 0), 0);
      const rowH = (r: string[]) => Math.max(...r.map((id) => sz.get(id)!.h));
      const W = Math.max(...rows.map(rowW));
      const H = rows.reduce((t, r, i) => t + rowH(r) + (i ? gy(rows[i - 1], r) : 0), 0);
      return { rows, W, H, rowH };
    };
    // try every row width that changes the wrapping; keep the one closest to the target shape
    let best = shelve(Infinity);
    for (let k = 1; k < items.length; k++) {
      const cand = shelve(shelve(Infinity).rows[0].slice(0, k).reduce((t, id, i, a) => t + sz.get(id)!.w + (i ? gx(a[i - 1], id) : 0), 0));
      if (Math.abs(Math.log(cand.W / cand.H / want)) < Math.abs(Math.log(best.W / best.H / want))) best = cand;
    }
    let y = 0;
    best.rows.forEach((row, r) => {
      if (r) y += best.rowH(best.rows[r - 1]) + gy(best.rows[r - 1], row);
      let x = 0;
      row.forEach((id, i) => { if (i) x += sz.get(row[i - 1])!.w + gx(row[i - 1], id); rel.set(id, { x, y }); });
    });
    return { w: best.W, h: best.H, rel };
  };
  const rootBox = build("");

  const cardPos = new Map<string, { x: number; y: number }>();
  const framePos = new Map<string, { x: number; y: number; width: number; height: number }>();
  const place = (box: Box, ox: number, oy: number) => {
    for (const [id, r] of box.rel) {
      const x = ox + r.x;
      const y = oy + r.y;
      if (cardById.has(id)) cardPos.set(id, { x: Math.round(x), y: Math.round(y) });
      else {
        const b = boxes.get(id)!;
        const o = frameOuter(id);
        framePos.set(id, { x: Math.round(x), y: Math.round(y), width: Math.round(o.w), height: Math.round(o.h) });
        place(b, x + FRAME_PAD.x, y + FRAME_PAD.top);
      }
    }
  };
  place(rootBox, 0, 0);

  const orig = [...cards, ...used].map(boxRect);
  const dx = Math.min(...orig.map((r) => r.x));
  const dy = Math.min(...orig.map((r) => r.y));
  for (const p of cardPos.values()) { p.x += dx; p.y += dy; }
  for (const p of framePos.values()) { p.x += dx; p.y += dy; }
  return { cardPos, framePos };
}
