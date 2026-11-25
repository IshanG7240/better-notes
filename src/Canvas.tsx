import { useEffect, useMemo, useRef, useState } from "react";
import { collapsedOwners, viewEdges } from "./lines";
import { Background, BackgroundVariant, ConnectionMode, MiniMap, ReactFlow, useReactFlow, type Node } from "@xyflow/react";
import CardNode from "./CardNode";
import FrameNode from "./FrameNode";
import LabelEdge from "./LabelEdge";
import { useStore } from "./store";
import { useDismiss } from "./useDismiss";
import { isCard, isFrame, KINDS, type AppNode, type FrameNodeT, type NoteEdge as AppEdge } from "./types";
import { setSpawn } from "./spawn";
import { boxRect, CARD_W, descendants, frameSize, parentMap } from "./layout";
import { fullH } from "./heights";
import SearchBar from "./SearchBar";


const minimapColor = (n: Node) => (isFrame(n as AppNode) ? "transparent" : KIND_COLOR[(n.data as { kind: string }).kind] ?? "#888");

/** Shallow equality of two edges (one level into `data`), so unchanged edges keep their identity and skip re-rendering. */
function sameEdge(a: Record<string, unknown>, b: Record<string, unknown>) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] === b[k]) continue;
    if (k !== "data" || !a[k] || !b[k]) return false;
    const da = a[k] as Record<string, unknown>, db = b[k] as Record<string, unknown>;
    const dk = Object.keys(da);
    if (dk.length !== Object.keys(db).length || dk.some((x) => da[x] !== db[x])) return false;
  }
  return true;
}

const nodeTypes = { card: CardNode, frame: FrameNode };
const edgeTypes = { default: LabelEdge };
const KIND_COLOR: Record<string, string> = { idea: "#7c9cff", question: "#f5c451", risk: "#ff6b6b", task: "#5ad1a0", note: "#9aa4b2" };

export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
export const inTerminal = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest(".xterm");

export default function Canvas() {
  const board = useStore((s) => s.board);
  const theme = useStore((s) => s.theme);
  const cardDefault = useStore((s) => s.cardDefault);
  const fitTick = useStore((s) => s.fitTick);
  const animating = useStore((s) => s.animating);
  const { onNodesChange, onEdgesChange, onConnect, addCard, addFrame } = useStore.getState();
  const rf = useReactFlow();
  const wrap = useRef<HTMLDivElement>(null);

  // while the view is moving, nodes ignore the pointer (no hover effects / hover-state churn as cards slide under
  // the cursor) and zoom-dependent title sizing is held; both settle shortly after the view stops.
  const moveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const markMoving = () => {
    const el = wrap.current;
    if (!el) return;
    if (!el.classList.contains("moving")) el.classList.add("moving");
    clearTimeout(moveTimer.current);
    moveTimer.current = setTimeout(() => { el.classList.remove("moving"); applyZi(); }, 160);
  };
  // 1/zoom (never below 1) as --zi, so titles keep a readable on-screen size when zoomed out. Applied when the view
  // comes to rest, not on every zoom tick: each change restyles and re-lays-out every card, which was the single
  // biggest cost of zooming (measured: ~60% of main-thread time on a 240-card board).
  const applyZi = () => {
    const el = wrap.current;
    if (!el) return;
    const zi = String(Math.round(Math.max(1, 1 / rf.getViewport().zoom) * 20) / 20);
    if (el.style.getPropertyValue("--zi") !== zi) el.style.setProperty("--zi", zi);
  };
  useEffect(() => { applyZi(); }); // cheap no-op unless the zoom changed (covers fitView / board switches)

  // Viewport writes are batched to one per animation frame: touchpads / high-rate mice deliver several wheel and
  // move events per frame, and each setViewport re-renders React Flow and everything subscribed to its transform.
  // Reads go through the pending value so accumulated deltas are never lost.
  const vpPending = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const vpRaf = useRef(0);
  const getVp = () => vpPending.current ?? rf.getViewport();
  const setVp = (v: { x: number; y: number; zoom: number }) => {
    vpPending.current = v;
    markMoving();
    if (vpRaf.current) return;
    vpRaf.current = requestAnimationFrame(() => {
      vpRaf.current = 0;
      const p = vpPending.current;
      vpPending.current = null;
      if (p) rf.setViewport(p);
    });
  };
  useEffect(() => () => cancelAnimationFrame(vpRaf.current), []);
  // the canvas rect, cached: reading it in every wheel event forced a synchronous layout after each viewport update
  const rectCache = useRef<DOMRect | null>(null);
  const canvasRect = () => (rectCache.current ??= wrap.current!.getBoundingClientRect());
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const reset = () => { rectCache.current = null; };
    const ro = new ResizeObserver(reset);
    ro.observe(el);
    window.addEventListener("resize", reset);
    return () => { ro.disconnect(); window.removeEventListener("resize", reset); };
  }, []);

  // remember the mouse so new cards/frames appear where you are pointing
  const mouse = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const mv = (e: MouseEvent) => (mouse.current = { x: e.clientX, y: e.clientY });
    const lv = () => (mouse.current = null);
    el.addEventListener("mousemove", mv, true);
    el.addEventListener("mouseleave", lv);
    setSpawn(() => {
      const r = el.getBoundingClientRect();
      return rf.screenToFlowPosition(mouse.current ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    });
    return () => { el.removeEventListener("mousemove", mv, true); el.removeEventListener("mouseleave", lv); };
  }, [rf]);

  // Damped, cursor-centred wheel/pinch zoom (touchpads fire lots of tiny wheel events)
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".nowheel, textarea, .ctx")) return;
      e.preventDefault();
      e.stopPropagation();
      markMoving();
      // pinch (ctrl+wheel), two-finger scroll and the mouse wheel all zoom; panning is click-and-drag
      const mouseLike = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
      const dy = Math.max(-80, Math.min(80, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
      const { zoomSpeed, pinchSpeed, panSpeed } = useStore.getState();
      // plain two-finger drag pans; Ctrl/Cmd + drag (and a real pinch, which arrives as ctrl+wheel) zooms; a mouse wheel still zooms
      if (!e.ctrlKey && !e.metaKey && !mouseLike) {
        const f = (e.deltaMode === 1 ? 16 : 1) * panSpeed;
        const v0 = getVp();
        setVp({ zoom: v0.zoom, x: v0.x - e.deltaX * f, y: v0.y - e.deltaY * f });
        return;
      }
      const step = Math.max(-0.12, Math.min(0.12, e.ctrlKey || e.metaKey ? -dy * 0.0077 * pinchSpeed : mouseLike ? -dy * 0.0011 * zoomSpeed : -dy * 0.0025 * panSpeed));
      const r = canvasRect();
      const ax = e.clientX - r.left, ay = e.clientY - r.top;
      const v = getVp();
      const z = Math.max(0.1, Math.min(2, v.zoom * Math.exp(step)));
      const k = z / v.zoom;
      setVp({ zoom: z, x: ax - (ax - v.x) * k, y: ay - (ay - v.y) * k }); // applied on the next frame: no smoothing, no lag, stops with your fingers
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [rf]);

  const [menu, setMenu] = useState<{ x: number; y: number; fx: number; fy: number } | null>(null);
  useDismiss(!!menu, (t) => !!(t instanceof Element ? t : t.parentElement)?.closest(".ctx"), () => setMenu(null));

  useEffect(() => {
    if (!fitTick) return;
    // fitOnly: zoom to just these nodes (e.g. the first frames of the Getting started board) instead of everything
    const only = useStore.getState().fitOnly;
    if (only) useStore.setState({ fitOnly: null });
    setTimeout(() => rf.fitView({ padding: only ? 0.12 : 0.25, maxZoom: 1, duration: 500, ...(only ? { nodes: only.map((id) => ({ id })) } : {}) }), 50);
  }, [fitTick, rf]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const term = inTerminal(e.target);
      if (!term && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        st.setModal(st.modal === "palette" ? null : "palette");
        return;
      }
      if (!term && !isTyping(e.target) && !st.modal && (e.ctrlKey || e.metaKey) && ["z", "y"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        if (e.key.toLowerCase() === "y" || e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (!term && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        st.setSearchOpen(true);
        return;
      }
      if (!term && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        st.setAskOpen(!st.askOpen);
        return;
      }
      if (!term && !st.modal && !isTyping(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        st.addRootCard();
        return;
      }
      if (!term && !st.modal && !isTyping(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        st.addFrame({ x: 0, y: 0 }); // an empty frame under the mouse
        return;
      }
      if (!term && !isTyping(e.target) && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        st.organizeLayout("space");
        return;
      }
      if (!term && !st.modal && !isTyping(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-5]$/.test(e.key) && st.board.nodes.some((n) => n.selected && n.type === "card")) {
        e.preventDefault();
        st.setKind(null, KINDS[Number(e.key) - 1]); // 1 idea · 2 question · 3 risk · 4 task · 5 note
        return;
      }
      if (!term && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        if (e.shiftKey) st.compactLayout(); else st.organizeLayout();
        return;
      }
      if (!term && !isTyping(e.target) && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
        e.preventDefault();
        st.toggleLines();
        return;
      }
      if (!term && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        st.groupSelection();
        return;
      }
      if (!term && (e.key === "F1" || (e.key === "?" && !isTyping(e.target) && !e.ctrlKey && !e.metaKey))) {
        e.preventDefault();
        if (!e.repeat) st.setModal(e.key === "F1" && st.modal === "help" ? null : "help");
        return;
      }
      if (e.key === "Escape" && st.modal === "help") { st.setModal(null); return; }
      if (st.modal || isTyping(e.target) || term) return;
      const sel = st.board.nodes.filter((n) => n.selected && isCard(n));
      const selEdge = st.board.edges.find((x) => x.selected);
      if (e.key === "Tab" && sel.length === 1) {
        e.preventDefault();
        st.addChild(sel[0].id);
      } else if (e.key === "Enter" && st.ghostCount()) {
        e.preventDefault();
        st.acceptGhosts(undefined, false); // Enter never deletes; use the ✓ buttons or Accept all
      } else if (e.key === "Enter" && selEdge) {
        e.preventDefault();
        st.setEditingEdge(selEdge.id);
      } else if (e.key === "Escape" && st.ghostCount()) st.rejectGhosts();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // ---- marquee selection: double-click then drag (or Shift+drag) on empty canvas ----
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const mq = useRef<{ x0: number; y0: number; add: boolean; alt?: boolean } | null>(null);
  const lastClick = useRef({ t: 0, x: 0, y: 0 });
  const down = useRef({ x: 0, y: 0 });
  const isPane = (t: EventTarget) => (t as HTMLElement).classList?.contains("react-flow__pane");
  useEffect(() => {
    const rectOf = () => wrap.current!.getBoundingClientRect();
    const move = (e: MouseEvent) => {
      const m = mq.current;
      if (!m) return;
      const r = rectOf();
      setMarquee({ x0: m.x0, y0: m.y0, x1: e.clientX - r.left, y1: e.clientY - r.top });
    };
    const up = (e: MouseEvent) => {
      const m = mq.current;
      if (!m) return;
      mq.current = null;
      setMarquee(null);
      const r = rectOf();
      const x1 = e.clientX - r.left, y1 = e.clientY - r.top;
      if (Math.hypot(x1 - m.x0, y1 - m.y0) < 4) {
        if (m.add) { useStore.getState().selectIds([], false); return; }
        // double-click on empty canvas: new card right there (Alt + double-click: a new frame), kept selected through the trailing click
        const eat = (ev: Event) => ev.stopPropagation();
        window.addEventListener("click", eat, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", eat, true), 80);
        const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        if (m.alt || e.altKey) useStore.getState().addFrame({ x: Math.round(p.x - 230), y: Math.round(p.y - 30) });
        else useStore.getState().addCard({ x: Math.round(p.x - cardDefault / 2), y: Math.round(p.y - 30) });
        return;
      }
      // the click that follows mouseup would clear the selection (React Flow's pane click)
      const eat = (ev: Event) => ev.stopPropagation();
      window.addEventListener("click", eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", eat, true), 80);
      const a = rf.screenToFlowPosition({ x: Math.min(m.x0, x1) + r.left, y: Math.min(m.y0, y1) + r.top });
      const b = rf.screenToFlowPosition({ x: Math.max(m.x0, x1) + r.left, y: Math.max(m.y0, y1) + r.top });
      const st = useStore.getState();
      const hid = collapsedOwners(st.board.nodes).hidden;
      const ids = st.board.nodes
        .filter((n) => !hid.has(n.id))
        .filter((n) => {
          const bx = boxRect(n);
          const h = isCard(n) ? fullH.get(n.id) ?? bx.h : bx.h;
          const inter = bx.x < b.x && bx.x + bx.w > a.x && bx.y < b.y && bx.y + h > a.y;
          const inside = bx.x >= a.x && bx.x + bx.w <= b.x && bx.y >= a.y && bx.y + h <= b.y;
          if (!isFrame(n)) return inter;
          // a frame: when fully enclosed, or when the box was started outside it and reaches into it
          const s0 = rf.screenToFlowPosition({ x: m.x0 + r.left, y: m.y0 + r.top });
          const startedOutside = !(s0.x >= bx.x && s0.x <= bx.x + bx.w && s0.y >= bx.y && s0.y <= bx.y + h);
          return inside || (inter && startedOutside);
        })
        .map((n) => n.id);
      st.selectIds(ids, m.add);
    };
    // React Flow's pan/drag handlers swallow mouseup, so watch it in the capture phase on window
    const upCapture = (e: MouseEvent) => {
      if (e.button !== 0 || mq.current) return;
      const d = down.current;
      if (isPane(e.target!) && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) lastClick.current = { t: performance.now(), x: e.clientX, y: e.clientY };
    };
    // Shift held + sliding one finger (no click): draw a selection box; letting go of Shift selects
    const hover = { on: false, x: 0, y: 0 };
    const hoverMove = (e: MouseEvent) => {
      if (!e.shiftKey || e.buttons !== 0) return;
      const t = e.target as HTMLElement | null;
      if (!hover.on) {
        if (!t?.closest?.(".react-flow") || isTyping(t) || inTerminal(t) || mq.current) return;
        const r = rectOf();
        hover.on = true;
        mq.current = { x0: e.clientX - r.left, y0: e.clientY - r.top, add: false };
      }
      hover.x = e.clientX;
      hover.y = e.clientY;
    };
    // Ctrl/Cmd held + sliding one finger (no click): pan the board
    const hoverPan = (e: MouseEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.buttons !== 0) return;
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".react-flow") || isTyping(t) || inTerminal(t)) return;
      const v = getVp();
      setVp({ zoom: v.zoom, x: v.x + e.movementX, y: v.y + e.movementY });
    };
    const hoverEnd = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || !hover.on) return;
      hover.on = false;
      const m = mq.current;
      const r = rectOf();
      if (m && Math.hypot(hover.x - r.left - m.x0, hover.y - r.top - m.y0) < 6) { mq.current = null; setMarquee(null); return; }
      up({ clientX: hover.x, clientY: hover.y } as MouseEvent);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mousemove", hoverMove);
    window.addEventListener("mousemove", hoverPan);
    window.addEventListener("keyup", hoverEnd);
    window.addEventListener("mouseup", up, true);
    window.addEventListener("mouseup", upCapture, true);
    return () => {
      window.removeEventListener("mousemove", hoverMove);
      window.removeEventListener("mousemove", hoverPan);
      window.removeEventListener("keyup", hoverEnd);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up, true);
      window.removeEventListener("mouseup", upCapture, true);
    };
  }, [rf, cardDefault]);

  // ---- frames carry the cards inside them ----
  const carry = useRef<{ start: { x: number; y: number }; items: { id: string; x: number; y: number }[] } | null>(null);
  const dragStart = (_: unknown, node: Node) => {
    if (node.type !== "frame") return;
    const all = useStore.getState().board.nodes;
    const fr = node as unknown as FrameNodeT;
    const inside = fr.data.collapsed ? all.filter((n) => fr.data.members?.includes(n.id)) : descendants(fr, all);
    carry.current = {
      start: { ...node.position },
      items: inside.map((c) => ({ id: c.id, x: c.position.x, y: c.position.y })),
    };
  };
  // ---- drop target: the innermost frame under the cursor (not the card's centre) ----
  const dropT = useRef<{ id: string | null; skip: Set<string>; home?: string | null }>({ id: null, skip: new Set() });
  const frameUnder = (ev: MouseEvent | TouchEvent) => {
    const e = "touches" in ev ? ev.changedTouches[0] ?? ev.touches[0] : ev;
    if (!e) return null;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const st = useStore.getState();
    const hid = collapsedOwners(st.board.nodes).hidden;
    return st.board.nodes
      .filter((n) => isFrame(n) && !n.data.collapsed && !hid.has(n.id) && !dropT.current.skip.has(n.id))
      .map((n) => ({ n, b: boxRect(n) }))
      .filter(({ b }) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
      .sort((a, b) => a.b.w * a.b.h - b.b.w * b.b.h)[0]?.n.id ?? null;
  };
  const markDrop = (id: string | null) => {
    if (dropT.current.id === id) {
      if (id) document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.classList.add("drop-target");
      return;
    }
    document.querySelectorAll(".react-flow__node.drop-target").forEach((el) => el.classList.remove("drop-target"));
    dropT.current.id = id;
    if (id) document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.classList.add("drop-target");
  };
  const dragBegin = (e: MouseEvent | TouchEvent, node: Node, dragged: Node[]) => {
    dragStart(e, node);
    // dragged frames (and frames inside them) can't be the target
    const all = useStore.getState().board.nodes;
    const skip = new Set<string>();
    for (const d of dragged?.length ? dragged : [node]) {
      skip.add(d.id);
      const n = all.find((x) => x.id === d.id);
      if (n && isFrame(n)) for (const k of descendants(n, all)) skip.add(k.id);
    }
    // the frame it starts in counts as "where it is": show nothing until the cursor moves somewhere else
    const st = all.filter((n) => isFrame(n) && !skip.has(n.id)).map((n) => ({ n, b: boxRect(n) }));
    const home = (dragged?.length ? dragged : [node]).map((d) => {
      const r = boxRect(all.find((x) => x.id === d.id) ?? (d as AppNode)), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      return st.filter(({ b }) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h).sort((a, b) => a.b.w * a.b.h - b.b.w * b.b.h)[0]?.n.id ?? null;
    })[0] ?? null;
    dropT.current = { id: null, skip, home };
  };
  const dragging = (e: MouseEvent | TouchEvent, node: Node) => {
    const t = frameUnder(e);
    markDrop(t && t !== dropT.current.home ? t : null);
    const c = carry.current;
    if (!c || node.type !== "frame") return;
    const dx = node.position.x - c.start.x,
      dy = node.position.y - c.start.y;
    useStore.getState().movePositions(new Map(c.items.map((i) => [i.id, { x: i.x + dx, y: i.y + dy }])));
  };

  // bigger frames sit behind smaller (nested) ones
  const hiddenIds = useMemo(() => collapsedOwners(board.nodes).hidden, [board.nodes]);
  // Reuse the previous view object for every node whose source and derived props are unchanged. React Flow skips
  // nodes by identity, so rebuilding all of them made every drag tick / selection re-process the whole board.
  const nodeCache = useRef(new Map<string, { src: AppNode; key: string; out: AppNode }>());
  const nodes = useMemo(
    () => {
      const pm = parentMap(board.nodes.filter(isFrame)); // depth is only needed for frames, and only frames nest frames
      const depth = (id: string) => { let d = 0; for (let p = pm.get(id); p; p = pm.get(p)) d++; return d; };
      const prev = nodeCache.current, next = new Map<string, { src: AppNode; key: string; out: AppNode }>();
      const out = board.nodes.map((n) => {
        const hide = hiddenIds.has(n.id);
        let key: string, make: () => AppNode;
        if (!isFrame(n)) {
          key = `${hide}|${cardDefault}`;
          make = () => ({ ...n, width: n.width ?? cardDefault, ...(hide ? { hidden: true } : {}) });
        } else {
          const { w, h } = frameSize(n);
          const cls = `fd${Math.min(2, depth(n.id))}`;
          const z = -Math.min(9000, Math.round((w * h) / 100)) - 1;
          key = `${hide}|${cls}|${z}`;
          make = () => ({
            ...n,
            hidden: hide,
            className: cls,
            style: { ...n.style, pointerEvents: n.data.collapsed ? ("all" as const) : ("none" as const) },
            zIndex: z,
          });
        }
        const c = prev.get(n.id);
        const o = c && c.src === n && c.key === key ? c.out : make();
        next.set(n.id, { src: n, key, out: o });
        return o;
      });
      nodeCache.current = next;
      return out;
    },
    [board.nodes, hiddenIds, cardDefault],
  );
  const lineMode = useStore((s) => s.lineMode);
  const showMap = useStore((s) => s.showMap);
  // hover only changes what's drawn in focus / selected line modes: don't re-derive every edge for it otherwise
  const hoverId = useStore((s) => (s.lineMode === "focus" || s.lineMode === "selected" ? s.hoverId : null));
  const edgeCache = useRef(new Map<string, AppEdge>());
  const edges = useMemo(() => {
    const prev = edgeCache.current, next = new Map<string, AppEdge>();
    const out = viewEdges(board.nodes, board.edges, lineMode, hoverId).map((e) => {
      const p = prev.get(e.id);
      const o = p && sameEdge(p as unknown as Record<string, unknown>, e as unknown as Record<string, unknown>) ? p : e;
      next.set(e.id, o);
      return o;
    });
    edgeCache.current = next;
    return out;
  }, [board.nodes, board.edges, lineMode, hoverId]);
  const light = theme === "light" || theme === "paper";

  const startPan = (x0: number, y0: number, kind: "mouse" | "touch") => {
    const v0 = rf.getViewport();
    document.body.classList.add("panning");
    const move = (ev: MouseEvent | TouchEvent) => {
      const p = "touches" in ev ? ev.touches[0] : ev;
      if (!p) return;
      setVp({ zoom: v0.zoom, x: v0.x + p.clientX - x0, y: v0.y + p.clientY - y0 });
    };
    const up = () => {
      document.body.classList.remove("panning");
      window.removeEventListener(kind === "mouse" ? "mousemove" : "touchmove", move as EventListener);
      window.removeEventListener(kind === "mouse" ? "mouseup" : "touchend", up, true);
    };
    window.addEventListener(kind === "mouse" ? "mousemove" : "touchmove", move as EventListener);
    window.addEventListener(kind === "mouse" ? "mouseup" : "touchend", up, true);
  };

  return (
    <div
      ref={wrap}
      className={`canvas${animating ? " animating" : ""}`}
      onTouchStartCapture={(e) => {
        if (!(e.ctrlKey || e.metaKey) || e.touches.length !== 1 || inTerminal(e.target)) return;
        e.stopPropagation();
        const t0 = e.touches[0];
        startPan(t0.clientX, t0.clientY, "touch");
      }}
      onMouseDownCapture={(e) => {
        if (!(e.target as Element).closest?.(".ctx")) setMenu(null);
        if ((e.ctrlKey || e.metaKey) && e.button === 0 && !inTerminal(e.target)) {
          // Ctrl + drag pans from anywhere, even on top of cards and frames
          e.stopPropagation();
          e.preventDefault();
          startPan(e.clientX, e.clientY, "mouse");
          return;
        }
        down.current = { x: e.clientX, y: e.clientY };
        if (e.button !== 0 || !isPane(e.target)) return;
        const L = lastClick.current;
        const dbl = performance.now() - L.t < 450 && Math.hypot(e.clientX - L.x, e.clientY - L.y) < 10;
        if (dbl || e.shiftKey) {
          e.stopPropagation();
          e.preventDefault();
          const r = wrap.current!.getBoundingClientRect();
          mq.current = { x0: e.clientX - r.left, y0: e.clientY - r.top, add: e.shiftKey, alt: e.altKey };
          setMarquee({ x0: mq.current.x0, y0: mq.current.y0, x1: mq.current.x0, y1: mq.current.y0 });
          lastClick.current.t = 0;
        }
      }}
    >
      <SearchBar />
      <ReactFlow<AppNode>
        key={board.id}
        nodes={nodes}
        elevateNodesOnSelect={false}
        // big boards: only mount cards/links in (or near) view; small boards keep everything mounted
        onlyRenderVisibleElements={board.nodes.length > 150}
        edges={edges}
        onNodeMouseEnter={(e, n) => {
          const st = useStore.getState();
          if (e.buttons || (st.lineMode !== "focus" && st.lineMode !== "selected")) return; // hover is unused otherwise
          st.setHover(n.id);
        }}
        onNodeMouseLeave={() => useStore.getState().setHover(null)}
        onMove={markMoving}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={() => wrap.current?.classList.add("linking")}
        onConnectEnd={(e, cs) => {
          wrap.current?.classList.remove("linking");
          if (cs.isValid || !cs.fromNode) return; // landed on a connection point: onConnect already ran
          // dropped anywhere on a card (not just on a connection point): attach to that card
          const pt = "changedTouches" in e ? e.changedTouches[0] : e;
          const el = document.elementFromPoint(pt.clientX, pt.clientY)?.closest<HTMLElement>(".react-flow__node");
          const to = el?.dataset.id;
          if (!to || to === cs.fromNode.id) return;
          const from = cs.fromNode.id;
          onConnect({ source: from, target: to, sourceHandle: null, targetHandle: null });
        }}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={48}
        onNodeDragStart={dragBegin}
        onNodeDrag={dragging}
        onNodeDragStop={(e, node, dragged) => {
          carry.current = null;
          // the cursor decides where it lands: into the frame under the cursor (which grows to hold it), or out onto open canvas
          const target = frameUnder(e);
          const pt = "touches" in e ? e.changedTouches[0] : e;
          const cursor = pt ? rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY }) : undefined;
          markDrop(null);
          const ids = (dragged?.length ? dragged : [node]).map((n) => n.id);
          setTimeout(() => useStore.getState().dropInto(ids, target, cursor), 0);
        }}
        onEdgeDoubleClick={(_, e) => useStore.getState().setEditingEdge(e.id)}
        onPaneClick={(e) => {
          // a click on the empty inside of a frame selects that frame (the innermost one)
          const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          const st = useStore.getState();
          const hid = collapsedOwners(st.board.nodes).hidden;
          const hit = st.board.nodes.filter((n) => isFrame(n) && !hid.has(n.id)).map((n) => ({ n, b: boxRect(n) }))
            .filter(({ b }) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
            .sort((a, b) => a.b.w * a.b.h - b.b.w * b.b.h)[0];
          if (hit) st.selectIds([hit.n.id], e.shiftKey);
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, fx: p.x, fy: p.y });
        }}
        zoomOnScroll={false}
        zoomOnPinch={false}
        panOnScroll={false}
        zoomOnDoubleClick={false}
        panOnDrag={[0, 1]}
        selectionOnDrag={false}
        minZoom={0.1}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        deleteKeyCode={["Delete", "Backspace"]}
        proOptions={{ hideAttribution: true }}
        colorMode={light ? "light" : "dark"}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--dots)" />
        {showMap && <MiniMap
          pannable
          zoomable
          position="top-right"
          nodeColor={minimapColor}
          maskColor="var(--minimask)"
        />}
      </ReactFlow>
      {!board.nodes.length && (
        <div className="empty-hint">
          <div className="eh-title">An empty board</div>
          <div>Double-click anywhere to add a card, or press <kbd>N</kbd></div>
          <div><kbd>Alt</kbd>+double-click (or <kbd>F</kbd>) adds a frame</div>
          <div>Or open the assistant (<kbd>Ctrl</kbd>+<kbd>K</kbd>) and use <b>From text</b> to turn notes into cards</div>
          <button className="eh-help" onClick={() => useStore.getState().setModal("help")}>Press <kbd>?</kbd> for the guide</button>
        </div>
      )}
      {marquee && (
        <div className="marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />
      )}
      {menu && (
        <div className="ctx" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <button onClick={() => (addCard({ x: menu.fx - 130, y: menu.fy - 20 }), setMenu(null))}>＋ New card here</button>
          <button onClick={() => (addFrame({ x: menu.fx, y: menu.fy }), setMenu(null))}>▢ New group frame here</button>
          <button onClick={() => (useStore.getState().setAskAction("dump"), setMenu(null))}>🧠 Brain dump…</button>
          <button title="Evens out the gaps between neighbouring cards and frames, keeping their shape" onClick={() => (useStore.getState().organizeLayout("space"), setMenu(null))}>↔ Space out (even gaps)</button>
          <button title="Space out, plus links read forwards; nothing is redrawn as a tree" onClick={() => (useStore.getState().organizeLayout(), setMenu(null))}>▦ Line up (even gaps + links forwards)</button>
          <button title="Rearranges everything tightly in reading order" onClick={() => (useStore.getState().compactLayout(), setMenu(null))}>▤ Pack (rearrange tightly)</button>
          <button onClick={() => (useStore.setState((s) => ({ fitTick: s.fitTick + 1 })), setMenu(null))}>⤢ Fit to screen</button>
        </div>
      )}
    </div>
  );
}
