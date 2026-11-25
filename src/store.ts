import { create } from "zustand";
import {
  applyEdgeChanges,
  applyNodeChanges,
  addEdge,
  MarkerType,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import {
  isCard,
  isFrame,
  type AppNode,
  type Board,
  type BoardMeta,
  type CardData,
  type CardNodeT,
  type FrameData,
  type EdgeStyle,
  type FrameNodeT,
  type LineMode,
  type GraphOps,
  type AskEntry,
  type AskAction,
  type AgentResult,
  type StructureResult,
  type ImportDetail,
  type Kind,
  type NoteEdge,
  type Settings,
  type Theme,
  type UsageSummary,
  type View,
} from "./types";
import { sampleBoard } from "./sample";
import { guideBoard, GUIDE_NAME } from "./guide";
import { aggregateEdges, collapsedOwners } from "./lines";
import { spawnPoint } from "./spawn";
import { CARD_W, setCardDefault, cardW, FRAME_PAD, boxRect, descendants, estHeight, guessHeight, frameSize, layoutNew, membersOf, organize, COLLAPSED, parentMap, readingOrder } from "./layout";
import { fullH } from "./heights";
import { spaceOut, tidy, fitFrames } from "./tidy";
import { flowEdges, isLinkType, type LinkType } from "./linktypes";

const uid = () => crypto.randomUUID().slice(0, 8);

const filePrefs: Record<string, unknown> = (() => { try { return window.api.prefs.all(); } catch { return {}; } })();
function pref<T>(key: string, def: T): T {
  if (key in filePrefs) return filePrefs[key] as T;
  try {
    // older versions kept preferences in the browser profile; honour them until they are saved to the file
    const v = localStorage.getItem("bn." + key);
    return v === null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}
function setPref(key: string, v: unknown) {
  filePrefs[key] = v;
  try { window.api.prefs.set(key, v); } catch { /* ignore */ }
}

const arrow = { type: MarkerType.ArrowClosed, color: "#7b8494" };
const mkEdge = (source: string, target: string, label = "", ghost = false, type?: string): NoteEdge => ({
  id: `e_${uid()}`,
  source,
  target,
  label: label || undefined,
  markerEnd: arrow,
  className: ghost ? "edge-ghost" : undefined,
  data: { ghost, ...(isLinkType(type) ? { type } : {}) },
});

const welcome = (): Pick<Board, "nodes" | "edges"> => {
  const a: CardNodeT = {
    id: "w1",
    type: "card",
    position: { x: 0, y: 0 },
    data: {
      title: "Welcome",
      kind: "idea",
      bullets:
        "Right-click the canvas to add a card\nClick text to edit, **markdown** works\n- [ ] try a checkbox\nSelect a card + Tab adds a child\nUse the dock below to run AI actions",
    },
  };
  const b: CardNodeT = {
    id: "w2",
    type: "card",
    position: { x: 400, y: 0 },
    data: { title: "AI suggestions are ghosts", kind: "note", bullets: "Dashed = proposed, not yet yours\nEnter accepts all, Esc rejects all\nOr ✓ / ✕ on a single card" },
  };
  return { nodes: [a, b], edges: [mkEdge("w1", "w2", "try it")] };
};

interface State {
  board: Board;
  boards: BoardMeta[];
  settings: Settings;
  usage: UsageSummary | null;
  busy: string | null;
  error: string | null;
  note: string | null;
  doc: string | null;
  modal: null | "palette" | "settings" | "help";
  /** the next fit zooms to just these nodes */
  fitOnly: string[] | null;
  askDraft: string;
  searchOpen: boolean;
  searchQ: string;
  setSearchOpen(b: boolean): void;
  setSearch(q: string): void;
  fitTick: number;
  animating: boolean;
  editingEdge: string | null;

  theme: Theme;
  view: View;
  sidebarOpen: boolean;
  sidebarW: number;
  chatOpen: boolean;
  chatW: number;
  chatMode: "chat" | "terminal";
  setChatMode(m: "chat" | "terminal"): void;
  fontScale: number;
  fontFamily: "sans" | "serif" | "mono";
  setFontFamily(f: "sans" | "serif" | "mono"): void;
  setFontScale(n: number): void;
  zoomSpeed: number;
  setZoomSpeed(n: number): void;
  panSpeed: number;
  setPanSpeed(n: number): void;
  showMap: boolean;
  setShowMap(b: boolean): void;
  pinchSpeed: number;
  cardDefault: number;
  lineOpacity: number;
  dimOpacity: number;
  setLineOpacity(n: number): void;
  setDimOpacity(n: number): void;
  setCardDefault(n: number): void;
  setPinchSpeed(n: number): void;
  lineMode: LineMode;
  setLineMode(m: LineMode): void;
  toggleLines(): void;
  edgeStyle: EdgeStyle;
  setEdgeStyle(m: EdgeStyle): void;
  labelsOnFocus: boolean;
  setLabelsOnFocus(b: boolean): void;
  hoverId: string | null;
  setHover(id: string | null): void;
  toggleCollapse(frameId: string): void;
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  setTheme(t: Theme): void;
  setView(v: View): void;
  setPanel(p: Partial<Pick<State, "sidebarOpen" | "sidebarW" | "chatOpen" | "chatW">>): void;

  init(): Promise<void>;
  setModal(m: State["modal"]): void;
  setAskDraft(t: string): void;
  clearToast(): void;
  saveNow(): Promise<void>;
  newBoard(): Promise<void>;
  addSampleBoard(): Promise<void>;
  addGuideBoard(): Promise<void>;
  openBoard(id: string): Promise<void>;
  deleteBoard(id: string): Promise<void>;
  setBoardGroup(id: string, name: string): Promise<void>;
  rename(name: string): void;

  onNodesChange(c: NodeChange<AppNode>[]): void;
  onEdgesChange(c: EdgeChange<NoteEdge>[]): void;
  onConnect(c: Connection): void;
  updateData(id: string, patch: Partial<CardData>): void;
  updateFrame(id: string, patch: Partial<FrameData>): void;
  bumpFont(id: string, delta: number | "reset"): void;
  /** set the type of a card; of every selected card when `id` is part of the selection (or when id is omitted) */
  setKind(id: string | null, kind: Kind): void;
  togglePin(id?: string): void;
  setCardWidth(w: number): void;
  autoFitWidth(): void;
  setEditingEdge(id: string | null): void;
  updateEdgeLabel(id: string, label: string): void;
  setEdgeType(id: string, type: LinkType): void;
  addCard(pos: { x: number; y: number }, focus?: boolean): string;
  addRootCard(): void;
  addChild(parentId: string, focus?: boolean): void;
  addChildSilently(parentId: string): void;
  removeCard(id: string): void;
  selectOnly(id: string): void;
  selectIds(ids: string[], additive: boolean): void;
  addFrame(pos: { x: number; y: number }): void;
  groupSelection(): void;
  movePositions(pos: Map<string, { x: number; y: number }>): void;
  /** "Line up" (default): keep places, flow linked clusters, push overlaps apart, fit frames. "space": only un-crowd, frames only grow */
  organizeLayout(mode?: "space", quiet?: boolean): void;
  /** after a drop or new cards: frames grow to hold them and close neighbours move aside (nothing else moves) */
  makeRoom(ids: string[]): void;
  /** a drag ended with the cursor over `target` (a frame, or null for open canvas): what was dragged moves fully into it (or out of
   *  frames it doesn't belong to), then makeRoom */
  dropInto(ids: string[], target: string | null, cursor?: { x: number; y: number }): void;
  /** tight reading-order packing of the selected frame(s), else the selected cards, else the whole board */
  compactLayout(second?: boolean, only?: string[]): void;
  ghostCount(): number;
  acceptGhosts(id?: string, withDeletes?: boolean): void;
  resolveEdgeDel(edgeId: string, accept: boolean): void;
  rejectGhosts(id?: string): void;

  openRewrite(id?: string): void;
  askLog: AskEntry[];
  askOpen: boolean;
  askAction: AskAction;
  setAskAction(a: AskAction): void;
  runAction(a: AskAction, text: string): Promise<void>;
  asking: boolean;
  askLive: string[];
  setAskOpen(b: boolean): void;
  loadAsk(boardId: string): void;
  clearAsk(): void;
  ask(q: string, opts?: { mode?: string; label?: string; guided?: boolean; selectedIds?: string[]; text?: string; detail?: ImportDetail; arrange?: unknown }): Promise<void>;
  importDetail: ImportDetail;
  setImportDetail(d: ImportDetail): void;
  cancelAsk(): Promise<void>;
  agentMode: "review" | "auto" | "full";
  setAgentMode(m: "review" | "auto" | "full"): void;
  applyAgentOps(p: Partial<AgentResult> & { nodes?: GraphOps["nodes"]; edges?: GraphOps["edges"] }): void;
  aiTouched: Record<string, number>;
  askUndo: { entryId: string; board: Board } | null;
  undoAsk(): void;
  askPending: string | null;
  askStream: string;
  makeDoc(kind: string): Promise<void>;
  closeDoc(): void;
  saveSettings(p: { apiKey?: string; model?: string; effort?: string; budget?: number }): Promise<void>;
}

const serialize = (board: Board) => ({
  nodes: board.nodes
    .filter(isCard)
    .filter((n) => !n.data.ghost)
    .map((n) => ({ id: n.id, title: n.data.title, bullets: n.data.bullets, kind: n.data.kind })),
  edges: board.edges
    .filter((e) => !e.data?.ghost)
    .map((e) => ({ from: e.source, to: e.target, label: typeof e.label === "string" ? e.label : "" })),
});

/** Cards to rewrite: selected cards plus every card inside selected frames. */
export function rewriteTargets(board: Board): CardNodeT[] {
  const out = new Map<string, CardNodeT>();
  for (const n of board.nodes) {
    if (!n.selected) continue;
    if (isCard(n)) out.set(n.id, n);
    else for (const d of descendants(n, board.nodes)) if (isCard(d)) out.set(d.id, d);
  }
  return [...out.values()].filter((c) => !c.data.ghost);
}

/** What counts as an edit: content, not selection / measuring / viewing. Opening a board must not reorder the sidebar. */
const boardSig = (b: Board) =>
  JSON.stringify([
    b.name,
    b.nodes.map((n) => [n.id, n.type, Math.round(n.position.x), Math.round(n.position.y), n.width ?? null, n.type === "frame" ? n.height ?? null : null, n.data]),
    b.edges.map((e) => [e.id, e.source, e.target, e.label ?? null, (e.data as { type?: string } | undefined)?.type ?? null]),
  ]);
const savedSig = new Map<string, string>();
/** Write the board only if its content changed since it was loaded/last saved; bumps "last edited" only then. */
export async function persistBoard(b: Board): Promise<boolean> {
  const sig = boardSig(b);
  if (savedSig.get(b.id) === sig) return false;
  await window.api.boards.save({ ...b, updatedAt: Date.now() });
  savedSig.set(b.id, sig);
  return true;
}

/** An AI turn belongs to the board it started on: stop it (and its spending) before leaving that board. */
async function stopAskForSwitch(get: () => State) {
  if (!get().asking) return;
  await window.api.ai.cancel?.();
  useStore.setState({ note: "Stopped the running assistant turn because you switched boards." });
}

let run: { boardId: string; snapshot: Board; refs: Map<string, string>; applied: Set<string>; counts: { added: number; edited: number; links: number; removed: number; unlinked: number; grouped: number }; notes: string[] } | null = null;

const mapNode = (nodes: AppNode[], id: string, fn: (n: AppNode) => AppNode) => nodes.map((n) => (n.id === id ? fn(n) : n));

export const useStore = create<State>()((set, get) => ({
  board: { id: "tmp", name: "Untitled", nodes: [], edges: [], updatedAt: Date.now() },
  boards: [],
  settings: { hasKey: false, model: "claude-sonnet-5-5", effort: "medium", budget: 400 },
  usage: null,
  busy: null,
  error: null,
  note: null,
  doc: null,
  modal: null,
  fitOnly: null,
  askDraft: "",
  searchOpen: false,
  searchQ: "",
  setSearchOpen: (b) => set(b ? { searchOpen: true } : { searchOpen: false, searchQ: "" }),
  setSearch: (q) => set({ searchQ: q }),
  fitTick: 0,
  animating: false,
  editingEdge: null,

  lineMode: pref<LineMode>("lineMode", "focus"),
  toggleLines() {
    const cur = get().lineMode;
    if (cur !== "off") { setPref("lineModeBack", cur); get().setLineMode("off"); }
    else get().setLineMode(pref<LineMode>("lineModeBack", "focus"));
  },
  setLineMode(m) {
    setPref("lineMode", m);
    set({ lineMode: m });
  },
  edgeStyle: pref<EdgeStyle>("edgeStyle", "curve"),
  setEdgeStyle(m) {
    setPref("edgeStyle", m);
    set({ edgeStyle: m });
  },
  labelsOnFocus: pref("labelsOnFocus", false),
  setLabelsOnFocus(b) {
    setPref("labelsOnFocus", b);
    set({ labelsOnFocus: b });
  },
  hoverId: null,
  setHover: (hoverId) => set((st) => (st.hoverId === hoverId ? st : { hoverId })),
  canUndo: false,
  canRedo: false,
  undo: () => stepHistory(-1),
  redo: () => stepHistory(1),
  toggleCollapse(id) {
    set((s) => {
      const f = s.board.nodes.find((n) => n.id === id);
      if (!f || !isFrame(f)) return s;
      const wrap = (fn: (n: AppNode) => AppNode) => ({ board: { ...s.board, nodes: s.board.nodes.map(fn) } });
      if (f.data.collapsed) {
        const box = f.data.box ?? { w: 420, h: 300 };
        return wrap((n) =>
          n.id === id ? ({ ...n, width: box.w, height: box.h, data: { ...n.data, collapsed: false, members: undefined, box: undefined } } as AppNode) : n,
        );
      }
      const members = descendants(f, s.board.nodes).map((n) => n.id);
      const ms = new Set(members);
      const { w, h } = frameSize(f);
      return wrap((n) => {
        if (n.id === id)
          return { ...n, width: COLLAPSED.w, height: COLLAPSED.h, data: { ...n.data, collapsed: true, members, box: { w, h } } } as AppNode;
        return ms.has(n.id) && n.selected ? { ...n, selected: false } : n;
      });
    });
  },
  lineOpacity: (() => { const v = pref("lineOpacity", 0.8); document.documentElement.style.setProperty("--line-op", String(v)); return v; })(),
  dimOpacity: (() => { const v = pref("dimOpacity", 0.09); document.documentElement.style.setProperty("--dim-op", String(v)); return v; })(),
  setLineOpacity(n) { setPref("lineOpacity", n); document.documentElement.style.setProperty("--line-op", String(n)); set({ lineOpacity: n }); },
  setDimOpacity(n) { setPref("dimOpacity", n); document.documentElement.style.setProperty("--dim-op", String(n)); set({ dimOpacity: n }); },
  cardDefault: (() => { const w = pref("cardDefault", 480); setCardDefault(w); return w; })(),
  setCardDefault(n) {
    setPref("cardDefault", n);
    setCardDefault(n);
    set({ cardDefault: n });
    setTimeout(() => get().organizeLayout(), 300);
  },
  pinchSpeed: pref("pinchSpeed", 1),
  setPinchSpeed(n) {
    setPref("pinchSpeed", n);
    set({ pinchSpeed: n });
  },
  showMap: pref("showMap", false),
  setShowMap(b) {
    setPref("showMap", b);
    set({ showMap: b });
  },
  panSpeed: pref("panSpeed2", 1),
  setPanSpeed(n) {
    setPref("panSpeed2", n);
    set({ panSpeed: n });
  },
  zoomSpeed: pref("zoomSpeed", 0.7),
  setZoomSpeed(n) {
    setPref("zoomSpeed", n);
    set({ zoomSpeed: n });
  },
  fontFamily: (() => { const f = pref<"sans" | "serif" | "mono">("fontFamily", "sans"); document.documentElement.dataset.font = f; return f; })(),
  setFontFamily(f) { setPref("fontFamily", f); document.documentElement.dataset.font = f; set({ fontFamily: f }); setTimeout(() => get().organizeLayout(), 300); },
  fontScale: pref("fontScale", 1),
  setFontScale(n) {
    const v = Math.round(Math.max(0.7, Math.min(1.8, n)) * 100) / 100;
    setPref("fontScale", v);
    document.documentElement.style.setProperty("--fs", String(v));
    set({ fontScale: v });
  },
  theme: pref<Theme>("theme", "light"),
  view: pref<View>("view", "canvas"),
  sidebarOpen: pref("sidebarOpen", true),
  sidebarW: pref("sidebarW", 210),
  chatOpen: pref("chatOpen", false),
  chatW: pref("chatW", 440),
  chatMode: pref<"chat" | "terminal">("chatMode", "chat"),
  setChatMode(m) {
    setPref("chatMode", m);
    set({ chatMode: m });
  },
  setTheme(theme) {
    setPref("theme", theme);
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },
  setView(view) {
    setPref("view", view);
    set({ view });
  },
  setPanel(p) {
    for (const [k, v] of Object.entries(p)) setPref(k, v);
    set(p);
  },

  async init() {
    const settings = await window.api.settings.get();
    set({ settings, usage: await window.api.usage.get() });
    let boards = await window.api.boards.list();
    let guide: Board | null = null;
    if (!pref("guideSeeded", false)) {
      // one-time (first launch, or the first launch after an update): the Getting started board, opened
      setPref("guideSeeded", true);
      guide = { id: uid(), name: GUIDE_NAME, ...guideBoard(), updatedAt: Date.now() + 2000 };
      await window.api.boards.save(guide);
      if (boards.length) set({ note: "New: a Getting started board (in the sidebar), and press ? any time for help." });
      boards = await window.api.boards.list();
    }
    if (!boards.length) {
      const b: Board = { id: uid(), name: "My first board", ...welcome(), updatedAt: Date.now() };
      await window.api.boards.save(b);
      boards = await window.api.boards.list();
    }
    let first = await window.api.boards.load(boards[0].id);
    let seeded = false;
    if (!pref("sampleSeeded", false)) {
      // one-time: add the sample board and open it
      setPref("sampleSeeded", true);
      const sb: Board = { id: uid(), name: "Sample · Food-delivery architecture", ...sampleBoard(), updatedAt: Date.now() + 1000 };
      await window.api.boards.save(sb);
      boards = await window.api.boards.list();
      first = sb;
      seeded = true;
    }
    if (guide) { first = guide; seeded = true; set({ fitOnly: ["gf0", "gf1"] }); }
    set((st) => ({ boards, board: first!, fitTick: st.fitTick + 1 }));
    if (seeded) setTimeout(() => get().organizeLayout(), 1200); // sample positions predate the wider default cards
    if (!settings.hasKey) set({ modal: "settings" });
  },

  setModal: (modal) => set({ modal }),
  setAskDraft: (t) => set({ askDraft: t }),
  clearToast: () => set({ error: null, note: null }),

  async saveNow() {
    await persistBoard(get().board);
    set({ boards: await window.api.boards.list() });
  },
  async newBoard() {
    await stopAskForSwitch(get);
    await get().saveNow();
    const b: Board = { id: uid(), name: "Untitled", nodes: [], edges: [], updatedAt: Date.now() };
    await window.api.boards.save(b);
    set({ board: b, boards: await window.api.boards.list() });
  },
  async addGuideBoard() {
    await stopAskForSwitch(get);
    await get().saveNow();
    const gb: Board = { id: uid(), name: GUIDE_NAME, ...guideBoard(), updatedAt: Date.now() };
    await window.api.boards.save(gb);
    set((st) => ({ board: gb, modal: null, fitOnly: ["gf0", "gf1"], fitTick: st.fitTick + 1 }));
    set({ boards: await window.api.boards.list() });
    setTimeout(() => get().organizeLayout(), 1200);
  },
  async addSampleBoard() {
    await stopAskForSwitch(get);
    await get().saveNow();
    const sb: Board = { id: uid(), name: "Sample · Food-delivery architecture", ...sampleBoard(), updatedAt: Date.now() };
    await window.api.boards.save(sb);
    set((st) => ({ board: sb, boards: st.boards, fitTick: st.fitTick + 1 }));
    set({ boards: await window.api.boards.list() });
    setTimeout(() => get().organizeLayout(), 1200);
  },
  async openBoard(id) {
    if (id === get().board.id) return;
    await stopAskForSwitch(get);
    await get().saveNow();
    const b = await window.api.boards.load(id);
    if (b) set((st) => ({ board: b, fitTick: st.fitTick + 1 }));
  },
  async setBoardGroup(id, name) {
    await window.api.boards.setGroup(id, name);
    set({ boards: await window.api.boards.list() });
  },
  async deleteBoard(id) {
    if (id === get().board.id) await stopAskForSwitch(get);
    await window.api.boards.remove(id);
    window.api.chat.kill(id);
    let boards = await window.api.boards.list();
    if (!boards.length) {
      const b: Board = { id: uid(), name: "Untitled", nodes: [], edges: [], updatedAt: Date.now() };
      await window.api.boards.save(b);
      boards = await window.api.boards.list();
    }
    if (id === get().board.id) set({ board: (await window.api.boards.load(boards[0].id))! });
    set({ boards });
  },
  rename: (name) => set((s) => ({ board: { ...s.board, name } })),

  onNodesChange: (c) => set((s) => ({ board: { ...s.board, nodes: applyNodeChanges(c, s.board.nodes) } })),
  onEdgesChange: (c) => set((s) => ({ board: { ...s.board, edges: applyEdgeChanges(c, s.board.edges) } })),
  onConnect: (c) => set((s) => ({ board: { ...s.board, edges: addEdge({ ...mkEdge(c.source, c.target) }, s.board.edges) } })),
  updateData: (id, patch) =>
    set((s) => ({
      board: { ...s.board, nodes: mapNode(s.board.nodes, id, (n) => (isCard(n) ? { ...n, data: { ...n.data, ...patch } } : n)) },
    })),
  updateFrame: (id, patch) =>
    set((s) => ({
      board: { ...s.board, nodes: mapNode(s.board.nodes, id, (n) => (isFrame(n) ? { ...n, data: { ...n.data, ...patch } } : n)) },
    })),
  setKind(id, kind) {
    set((s) => {
      const self = id ? s.board.nodes.find((n) => n.id === id) : null;
      const ids = new Set(!id || self?.selected ? s.board.nodes.filter((n) => n.selected && isCard(n)).map((n) => n.id) : [id]);
      if (!ids.size) return {};
      return { board: { ...s.board, nodes: s.board.nodes.map((n) => (ids.has(n.id) && isCard(n) ? ({ ...n, data: { ...n.data, kind } } as AppNode) : n)) } };
    });
  },
  bumpFont(id, delta) {
    set((s) => {
      const self = s.board.nodes.find((n) => n.id === id);
      const ids = new Set(self?.selected ? s.board.nodes.filter((n) => n.selected).map((n) => n.id) : [id]);
      const next = (cur?: number) =>
        delta === "reset" ? undefined : Math.round(Math.max(0.6, Math.min(3, (cur ?? 1) + delta)) * 100) / 100;
      return {
        board: {
          ...s.board,
          nodes: s.board.nodes.map((n) => {
            if (!ids.has(n.id)) return n;
            const fs = next(n.data.fs);
            return { ...n, data: { ...n.data, fs } } as AppNode;
          }),
        },
      };
    });
  },
  selectIds(ids, additive) {
    const set_ = new Set(ids);
    set((s) => ({
      board: { ...s.board, nodes: s.board.nodes.map((n) => ((additive ? n.selected || set_.has(n.id) : set_.has(n.id)) === !!n.selected ? n : { ...n, selected: additive ? !!n.selected || set_.has(n.id) : set_.has(n.id) })) },
    }));
  },
  autoFitWidth() {
    const cs = getComputedStyle(document.querySelector(".react-flow__node-card .card") ?? document.body);
    const family = cs.fontFamily || "serif";
    const ctx = document.createElement("canvas").getContext("2d")!;
    const strip = (l: string) => l.replace(/^\s*([-*]|\d+\.|- \[[ x]\])\s+/, "").replace(/[*_`#>]/g, "");
    const fit = (d: CardData) => {
      const k = useStore.getState().fontScale * (d.fs ?? 1);
      ctx.font = `600 ${15 * k}px ${family}`;
      let w = ctx.measureText(d.title || "").width;
      ctx.font = `${13 * k}px ${family}`;
      for (const l of d.bullets.split("\n")) w = Math.max(w, ctx.measureText(strip(l)).width + 18 * k);
      return Math.round(Math.max(360, Math.min(800, w + 48)) / 10) * 10;
    };
    set((s) => {
      const anySel = s.board.nodes.some((n) => n.selected && isCard(n));
      return {
        board: { ...s.board, nodes: s.board.nodes.map((n) => (isCard(n) && (!anySel || n.selected) ? ({ ...n, width: fit(n.data) } as AppNode) : n)) },
      };
    });
    setTimeout(() => get().organizeLayout(), 300); // widths changed: re-flow so nothing overlaps
  },
  setCardWidth(w) {
    set((s) => {
      const anySel = s.board.nodes.some((n) => n.selected && isCard(n));
      return {
        board: { ...s.board, nodes: s.board.nodes.map((n) => (isCard(n) && (!anySel || n.selected) ? ({ ...n, width: w, measured: undefined } as AppNode) : n)) },
      };
    });
    setTimeout(() => get().organizeLayout(), 300); // widths changed: re-flow so nothing overlaps
  },
  togglePin(id) {
    set((s) => {
      const sel = s.board.nodes.filter((n) => isCard(n) && n.selected);
      const ids = new Set(id && !sel.some((n) => n.id === id) ? [id] : sel.map((n) => n.id));
      if (!ids.size) return s;
      const all = s.board.nodes.filter((n) => ids.has(n.id) && isCard(n)).every((n) => (n.data as CardData).pinned);
      return {
        board: {
          ...s.board,
          nodes: s.board.nodes.map((n) => (ids.has(n.id) && isCard(n) ? ({ ...n, data: { ...n.data, pinned: all ? undefined : true } } as AppNode) : n)),
        },
      };
    });
  },
  setEditingEdge: (editingEdge) => set({ editingEdge }),
  updateEdgeLabel: (id, label) =>
    set((s) => ({ board: { ...s.board, edges: s.board.edges.map((e) => (e.id === id ? { ...e, label: label || undefined } : e)) } })),
  setEdgeType: (id, type) =>
    set((s) => ({ board: { ...s.board, edges: s.board.edges.map((e) => (e.id === id ? { ...e, data: { ...e.data, type } } : e)) } })),

  addCard(pos, focus = true) {
    const id = `n_${uid()}`;
    const node: CardNodeT = { id, type: "card", position: pos, selected: true, data: { title: "", bullets: "", kind: "idea", focus } };
    set((s) => ({ board: { ...s.board, nodes: [...s.board.nodes.map((n) => ({ ...n, selected: false })), node] } }));
    return id;
  },
  addRootCard() {
    const p = spawnPoint();
    get().addCard({ x: Math.round(p.x - cardW({}) / 2), y: Math.round(p.y - 30) });
  },
  addChild(parentId, focus = true) {
    const p = get().board.nodes.find((n) => n.id === parentId);
    if (!p || !isCard(p)) return;
    const sibs = get().board.edges.filter((e) => e.source === parentId).length;
    const id = get().addCard({ x: p.position.x + cardW(p) + 90, y: p.position.y + sibs * (estHeight(p) + 24) }, focus);
    set((s) => ({ board: { ...s.board, edges: [...s.board.edges, mkEdge(parentId, id)] } }));
  },
  addChildSilently: (parentId) => get().addChild(parentId, false),
  removeCard(id) {
    set((s) => ({
      board: {
        ...s.board,
        nodes: s.board.nodes.filter((n) => n.id !== id),
        edges: s.board.edges.filter((e) => e.source !== id && e.target !== id),
      },
    }));
  },
  selectOnly: (id) =>
    set((s) => ({ board: { ...s.board, nodes: s.board.nodes.map((n) => (!!n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })) } })),

  addFrame(pos0) {
    const pos = pos0.x === 0 && pos0.y === 0 ? (() => { const p = spawnPoint(); return { x: Math.round(p.x - 230), y: Math.round(p.y - 30) }; })() : pos0;
    const id = `f_${uid()}`;
    const n = get().board.nodes.filter(isFrame).length;
    const f: FrameNodeT = {
      id,
      type: "frame",
      position: pos,
      width: 460,
      height: 320,
      zIndex: -1,
      selected: true,
      style: { pointerEvents: "none" },
      dragHandle: ".frame-head",
      data: { title: "", color: n, focus: true },
    };
    set((s) => ({ board: { ...s.board, nodes: [f, ...s.board.nodes.map((x) => ({ ...x, selected: false }))] } }));
  },
  groupSelection() {
    const { board } = get();
    const sel = board.nodes.filter((n) => n.selected);
    if (!sel.length) return;
    const rs = sel.map(boxRect);
    const x = Math.min(...rs.map((r) => r.x)) - FRAME_PAD.x;
    const y = Math.min(...rs.map((r) => r.y)) - FRAME_PAD.top;
    const x2 = Math.max(...rs.map((r) => r.x + r.w)) + FRAME_PAD.x;
    const y2 = Math.max(...rs.map((r) => r.y + r.h)) + FRAME_PAD.bottom;
    const id = `f_${uid()}`;
    const f: FrameNodeT = {
      id,
      type: "frame",
      position: { x, y },
      width: x2 - x,
      height: y2 - y,
      zIndex: -1,
      selected: true,
      style: { pointerEvents: "none" },
      dragHandle: ".frame-head",
      data: { title: "", color: board.nodes.filter(isFrame).length, focus: true },
    };
    set((s) => ({ board: { ...s.board, nodes: [f, ...s.board.nodes.map((n) => ({ ...n, selected: false }))] } }));
  },
  movePositions: (pos) =>
    set((s) => ({ board: { ...s.board, nodes: s.board.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)) } })),

  dropInto(ids, target, cursor) {
    const nodes = get().board.nodes;
    const { hidden } = collapsedOwners(nodes);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // what moves: the dragged things plus everything inside dragged frames
    const moving = new Set<string>();
    for (const id of ids) {
      const n = byId.get(id);
      if (!n) continue;
      moving.add(id);
      if (isFrame(n)) for (const d of n.data.collapsed ? nodes.filter((x) => n.data.members?.includes(x.id)) : descendants(n, nodes)) moving.add(d.id);
    }
    const group = [...moving].map((id) => byId.get(id)!).filter((n) => !hidden.has(n.id));
    if (!group.length) return get().makeRoom(ids);
    const rectOf = (n: AppNode) => { const b = boxRect(n); return { ...b, h: isCard(n) ? fullH.get(n.id) ?? Math.max(b.h, estHeight(n)) : b.h }; };
    const rs = group.map(rectOf);
    const box = { x: Math.min(...rs.map((r) => r.x)), y: Math.min(...rs.map((r) => r.y)), r: Math.max(...rs.map((r) => r.x + r.w)), b: Math.max(...rs.map((r) => r.y + r.h)) };
    let dx = 0, dy = 0;
    const others = nodes.filter((n) => isFrame(n) && !moving.has(n.id) && !hidden.has(n.id)).map((f) => ({ f, r: rectOf(f) }));
    const T = target ? others.find((o) => o.f.id === target) ?? null : null;
    const holds = (o: { r: { x: number; y: number; w: number; h: number } }, x: number, y: number) => x >= o.r.x && x <= o.r.x + o.r.w && y >= o.r.y && y <= o.r.y + o.r.h;
    const isAncOrT = (o: { r: { x: number; y: number; w: number; h: number } }) => !!T && o.r.x <= T.r.x && o.r.y <= T.r.y && o.r.x + o.r.w >= T.r.x + T.r.w && o.r.y + o.r.h >= T.r.y + T.r.h;
    for (let pass = 0; pass < 4; pass++) {
      const bx = box.x + dx, by = box.y + dy, br = box.r + dx, bb = box.b + dy;
      const cx = (bx + br) / 2, cy = (by + bb) / 2;
      // inside a frame the cursor is not over: step out of it (the shortest way)
      const wrong = others.find((o) => !isAncOrT(o) && holds(o, cx, cy));
      if (wrong) {
        const G = 40, r = wrong.r;
        const opts = [r.x - G - br, r.x + r.w + G - bx].map((v) => ({ dx: v, dy: 0 })).concat([r.y - G - bb, r.y + r.h + G - by].map((v) => ({ dx: 0, dy: v })));
        // out the side the cursor went past (else the shortest way)
        const side = cursor && !holds(wrong, cursor.x, cursor.y)
          ? cursor.x < r.x ? 0 : cursor.x > r.x + r.w ? 1 : cursor.y < r.y ? 2 : 3
          : -1;
        const best = side >= 0 ? opts[side] : opts.sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - Math.abs(b.dx) - Math.abs(b.dy))[0];
        dx += best.dx; dy += best.dy;
        continue;
      }
      if (T) {
        // fully inside the target, clear of its title (it grows downward / rightward if needed)
        const r = T.r, P = FRAME_PAD;
        const nx = Math.min(Math.max(bx, r.x + P.x), Math.max(r.x + P.x, r.x + r.w - P.x - (br - bx)));
        const ny = Math.max(by, r.y + P.top);
        if (nx !== bx || ny !== by) { dx += nx - bx; dy += ny - by; continue; }
      }
      break;
    }
    if (dx || dy) {
      set((s) => ({
        animating: true,
        board: { ...s.board, nodes: s.board.nodes.map((n) => (moving.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)) },
      }));
    }
    get().makeRoom(ids);
  },
  makeRoom(ids) {
    const { board } = get();
    const { hidden } = collapsedOwners(board.nodes);
    const visible = board.nodes.filter((n) => !hidden.has(n.id));
    const touch = ids.filter((id) => visible.some((n) => n.id === id));
    if (!touch.length) return;
    const pm = parentMap(visible);
    const locked = new Set<string>();
    for (const n of visible) {
      if (!(isCard(n) && n.data.pinned)) continue;
      locked.add(n.id);
      for (let p = pm.get(n.id); p; p = pm.get(p)) locked.add(p);
    }
    for (const id of touch) locked.delete(id); // what you just moved may still make room for itself
    const fixedH = new Map(visible.filter(isFrame).filter((f) => f.data.collapsed).map((f) => [f.id, COLLAPSED.h]));
    const { pos, size } = spaceOut(visible, locked, fixedH, { touch, growOnly: true });
    if (!pos.size && !size.size) return;
    const blocks = visible.filter(isFrame).filter((f) => f.data.collapsed);
    const shift = new Map<string, { dx: number; dy: number }>();
    for (const f of blocks) { const np = pos.get(f.id); if (np) for (const m of f.data.members ?? []) shift.set(m, { dx: np.x - f.position.x, dy: np.y - f.position.y }); }
    set((s) => ({
      animating: true,
      board: {
        ...s.board,
        nodes: s.board.nodes.map((n) => {
          const p = pos.get(n.id), z = size.get(n.id), sh = shift.get(n.id);
          if (!p && !z && !sh) return n;
          return { ...n, ...(p ? { position: p } : sh ? { position: { x: n.position.x + sh.dx, y: n.position.y + sh.dy } } : {}), ...(z ?? {}) } as AppNode;
        }),
      },
    }));
    setTimeout(() => set({ animating: false }), 450);
  },
  organizeLayout(mode, quiet) {
    settleUndo();
    const { board } = get();
    const { hidden } = collapsedOwners(board.nodes);
    const visible = board.nodes.filter((n) => !hidden.has(n.id));
    const pm = parentMap(visible);
    const locked = new Set<string>();
    for (const n of visible) {
      if (!(isCard(n) && n.data.pinned)) continue;
      locked.add(n.id);
      let p = pm.get(n.id);
      while (p) { locked.add(p); p = pm.get(p); }
    }
    const blocks = visible.filter(isFrame).filter((f) => f.data.collapsed);
    const fixedH = new Map(blocks.map((f) => [f.id, COLLAPSED.h]));
    const { pos, size } = mode === "space" ? spaceOut(visible, locked, fixedH) : tidy(visible, flowEdges(aggregateEdges(board.nodes, board.edges)), locked, fixedH);
    if (!pos.size && !size.size) { if (!quiet) set({ note: mode === "space" ? "Everything already has room." : "Already lined up." }); return; }
    const shift = new Map<string, { dx: number; dy: number }>();
    for (const f of blocks) {
      const np = pos.get(f.id);
      if (np) for (const m of f.data.members ?? []) shift.set(m, { dx: np.x - f.position.x, dy: np.y - f.position.y });
    }
    set((s) => ({
      animating: true,
      note: null,
      board: {
        ...s.board,
        nodes: s.board.nodes.map((n) => {
          const p = pos.get(n.id), z = size.get(n.id), sh = shift.get(n.id);
          if (!p && !z && !sh) return n;
          return { ...n, ...(p ? { position: p } : sh ? { position: { x: n.position.x + sh.dx, y: n.position.y + sh.dy } } : {}), ...(z ?? {}) } as AppNode;
        }),
      },
    }));
    setTimeout(() => set({ animating: false }), 600);
  },
  compactLayout(second, only) {
    if (!second) settleUndo();
    const { board } = get();
    const { hidden } = collapsedOwners(board.nodes);
    const visible = board.nodes.filter((n) => !hidden.has(n.id));
    const pm = parentMap(visible);
    // pinned cards never move; a pinned card also locks the frames around it and everything inside them
    const lockedFrames = new Set<string>();
    for (const n of visible) {
      if (!(isCard(n) && n.data.pinned)) continue;
      let p = pm.get(n.id);
      while (p) {
        lockedFrames.add(p);
        p = pm.get(p);
      }
    }
    const locked = new Set<string>();
    for (const n of visible) {
      if (isCard(n) && n.data.pinned) locked.add(n.id);
      let p = pm.get(n.id);
      while (p) {
        if (lockedFrames.has(p)) locked.add(n.id);
        p = pm.get(p);
      }
    }
    for (const f of lockedFrames) locked.add(f);
    // a collapsed frame holding a pinned card is locked too
    for (const f of visible.filter(isFrame))
      if (f.data.collapsed && (f.data.members ?? []).some((m) => board.nodes.some((x) => x.id === m && isCard(x) && x.data.pinned))) locked.add(f.id);

    // scope: selected frame(s) and everything inside them; else selected cards; else the whole board
    const selFrames = (only ? visible.filter((n) => only.includes(n.id)) : visible.filter((n) => n.selected)).filter(isFrame).filter((f) => !f.data.collapsed && !locked.has(f.id));
    const inScope = new Set<string>();
    for (const f of selFrames) { inScope.add(f.id); for (const d of descendants(f, visible)) inScope.add(d.id); }
    const framed = selFrames.length > 0;
    const cards = visible.filter(isCard).filter((n) => !locked.has(n.id)).filter((n) => !framed || inScope.has(n.id));
    const selCards = framed ? [] : cards.filter((n) => n.selected);
    const partial = selCards.length > 1;
    // collapsed frames take part as fixed-size blocks; their hidden members travel with them
    const blocks = partial ? [] : visible.filter(isFrame).filter((f) => f.data.collapsed && !locked.has(f.id) && (!framed || inScope.has(f.id)));
    const pseudo: CardNodeT[] = blocks.map((f) => ({
      id: f.id,
      type: "card",
      position: f.position,
      data: { title: f.data.title, bullets: "", kind: "note" },
    }));
    const target = partial ? selCards : [...cards, ...pseudo];
    if (target.length < 2) {
      set({ note: locked.size ? "Nothing to organize — everything else is pinned." : null });
      return;
    }
    const frames = partial ? [] : visible.filter(isFrame).filter((f) => !f.data.collapsed && !locked.has(f.id) && (!framed || inScope.has(f.id)));
    const fixedH = new Map(blocks.map((f) => [f.id, COLLAPSED.h]));
    const { cardPos, framePos } = organize(target, frames, flowEdges(aggregateEdges(board.nodes, board.edges)), fixedH);

    // dodge pinned / locked things: slide the organized block to the nearest free spot
    const obstacles = visible.filter((n) => locked.has(n.id)).map(boxRect);
    if (obstacles.length) {
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const n of target) {
        const p = cardPos.get(n.id)!;
        placed.push({ x: p.x, y: p.y, w: cardW(n), h: fixedH.get(n.id) ?? fullH.get(n.id) ?? estHeight(n) });
      }
      for (const [, f] of framePos) placed.push({ x: f.x, y: f.y, w: f.width, h: f.height });
      const M = 40;
      const hit = (dx: number, dy: number) =>
        placed.some((r) => obstacles.some((o) => r.x + dx < o.x + o.w + M && o.x < r.x + dx + r.w + M && r.y + dy < o.y + o.h + M && o.y < r.y + dy + r.h + M));
      let best: { dx: number; dy: number } | null = null;
      if (!hit(0, 0)) best = { dx: 0, dy: 0 };
      else {
        const cands: { dx: number; dy: number; d: number }[] = [];
        for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) cands.push({ dx: i * 80, dy: j * 80, d: Math.hypot(i, j) });
        cands.sort((a, b) => a.d - b.d);
        best = cands.find((c) => !hit(c.dx, c.dy)) ?? null;
      }
      if (best) {
        for (const p of cardPos.values()) { p.x += best.dx; p.y += best.dy; }
        for (const f of framePos.values()) { f.x += best.dx; f.y += best.dy; }
      }
    }

    const blockIds = new Set(blocks.map((f) => f.id));
    const shift = new Map<string, { dx: number; dy: number }>();
    for (const f of blocks) {
      const np = cardPos.get(f.id);
      if (!np) continue;
      for (const m of f.data.members ?? []) shift.set(m, { dx: np.x - f.position.x, dy: np.y - f.position.y });
    }
    set((s) => ({
      animating: true,
      note: second ? s.note : locked.size ? `${[...locked].filter((id) => isCard(board.nodes.find((n) => n.id === id)!)).length} pinned/locked card(s) stayed in place.` : null,
      fitTick: partial || framed || second ? s.fitTick : s.fitTick + 1,
      board: {
        ...s.board,
        nodes: s.board.nodes.map((n) => {
          if (cardPos.has(n.id)) return { ...n, position: cardPos.get(n.id)! } as AppNode;
          const fp = framePos.get(n.id);
          if (fp && !blockIds.has(n.id)) return { ...n, position: { x: fp.x, y: fp.y }, width: fp.width, height: fp.height } as AppNode;
          const sh = shift.get(n.id);
          if (sh) return { ...n, position: { x: n.position.x + sh.dx, y: n.position.y + sh.dy } } as AppNode;
          return n;
        }),
      },
    }));
    // card heights/widths settle after the first pass renders; lay out once more with the real sizes
    if (!second) { const keep = selFrames.map((f) => f.id); setTimeout(() => get().compactLayout(true, keep.length ? keep : undefined), 400); }
    else if (framed) setTimeout(() => get().organizeLayout(), 300); // a compacted frame changed size: clear any overlap it made
    else if (lockedFrames.size) {
      // frames holding a pinned card stayed put; still fit them around what is inside
      const fit = fitFrames(get().board.nodes.filter((n) => !hidden.has(n.id)), lockedFrames, fixedH);
      if (fit.size) set((s) => ({ board: { ...s.board, nodes: s.board.nodes.map((n) => { const f = fit.get(n.id); return f ? ({ ...n, position: { x: f.x, y: f.y }, width: f.width, height: f.height } as AppNode) : n; }) } }));
    }
    setTimeout(() => set({ animating: false }), 600);
  },

  ghostCount: () =>
    get().board.nodes.filter((n) => isCard(n) && (n.data.ghost || n.data.proposal || n.data.del)).length + get().board.edges.filter((e) => e.data?.ghost || e.data?.del).length,

  acceptGhosts(id, withDeletes = true) {
    set((s) => {
      const hit = (nid: string) => !id || nid === id;
      const removed = new Set(withDeletes ? s.board.nodes.filter((n) => isCard(n) && n.data.del && hit(n.id)).map((n) => n.id) : []);
      const nodes = s.board.nodes
        .filter((n) => !removed.has(n.id))
        .map((n) => {
          if (isFrame(n) && n.data.ghost && !id) return { ...n, data: { ...n.data, ghost: false } };
          if (!isCard(n) || !hit(n.id)) return n;
          const d = { ...n.data };
          if (d.proposal) {
            d.title = d.proposal.title;
            d.bullets = d.proposal.bullets;
            delete d.proposal;
          }
          d.ghost = false;
          return { ...n, data: d };
        });
      const okIds = new Set(nodes.filter((n) => !(isCard(n) && n.data.ghost)).map((n) => n.id));
      const edges = s.board.edges
        .filter((e) => !(removed.has(e.source) || removed.has(e.target)) && !(withDeletes && e.data?.del && (!id || e.source === id || e.target === id)))
        .map((e) =>
          e.data?.ghost && (!id || e.source === id || e.target === id) && okIds.has(e.source) && okIds.has(e.target)
            ? { ...e, className: undefined, data: { ghost: false } }
            : e,
        );
      return { board: { ...s.board, nodes, edges } };
    });
  },
  rejectGhosts(id) {
    set((s) => {
      const gone = new Set(s.board.nodes.filter((n) => (isCard(n) || !id) && n.data.ghost && (!id || n.id === id)).map((n) => n.id));
      return {
        board: {
          ...s.board,
          nodes: s.board.nodes
            .filter((n) => !gone.has(n.id))
            .map((n) => {
              if (isCard(n) && (n.data.proposal || n.data.del) && (!id || n.id === id)) {
                const d = { ...n.data };
                delete d.proposal;
                delete d.del;
                return { ...n, data: d };
              }
              return n;
            }),
          edges: s.board.edges
            .filter((e) => !(gone.has(e.source) || gone.has(e.target)) && !(e.data?.ghost && (!id || e.source === id || e.target === id)))
            .map((e) => (e.data?.del && (!id || e.source === id || e.target === id) ? { ...e, className: undefined, data: { ...e.data, del: false } } : e)),
        },
      };
    });
  },
  resolveEdgeDel(edgeId, accept) {
    set((s) => ({
      board: {
        ...s.board,
        edges: accept
          ? s.board.edges.filter((e) => e.id !== edgeId)
          : s.board.edges.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, del: false } } : e)),
      },
    }));
  },

  openRewrite(id) {
    if (id) {
      const n = get().board.nodes.find((x) => x.id === id);
      if (n && !n.selected) get().selectOnly(id);
    }
    set({ askAction: "rewrite", askOpen: true, modal: null });
  },
  askLog: [],
  askOpen: false,
  askAction: "ask",
  setAskAction: (a) => set({ askAction: a, askOpen: true }),
  async runAction(a, text) {
    const t = text.trim();
    const sel = get().board.nodes.filter((n) => n.selected && isCard(n));
    if (a === "ask") return get().ask(t);
    if (a === "dump") return t ? get().ask(`Turn this text into cards:\n"""\n${t}\n"""`, { mode: "dump", text: t, detail: get().importDetail, label: "From text: " + t.slice(0, 60).replace(/\s+/g, " ") + (t.length > 60 ? "…" : "") }) : undefined;
    if (a === "arrange") {
      const pick = arrangeTargets(get().board);
      if (pick.cards.length < 3) return void set({ error: "Arrange needs at least 3 cards (pinned cards and cards in collapsed frames stay out)." });
      const what = pick.partial ? `${pick.cards.length} selected cards` : "the board";
      return get().ask(`Arrange ${what} into sections in reading order.${t ? " Guidance: " + t : ""}`, { mode: "arrange", label: `Arrange ${what}${t ? " — " + (t.length > 60 ? t.slice(0, 59) + "…" : t) : ""}`, arrange: { cards: pick.cards.map((c) => ({ id: c.id, title: c.data.title, bullets: c.data.bullets, kind: c.data.kind, frame: pick.frameOf.get(c.id) ?? "" })), frames: pick.frameTitles, guidance: t } });
    }
    if (a === "condense") {
      const pick = condenseTargets(get().board);
      if (pick.cards.length < 2) return void set({ error: "Condense needs at least 2 cards (select cards or a frame, or none for the whole board)." });
      const what = pick.scope;
      return get().ask(`Condense ${what} into fewer, denser cards.${t ? " Guidance: " + t : ""}`, { mode: "condense", label: `Condense ${what}${t ? " — " + (t.length > 60 ? t.slice(0, 59) + "…" : t) : ""}`, arrange: { cards: pick.cards.map((c) => ({ id: c.id, title: c.data.title, bullets: c.data.bullets, kind: c.data.kind, frame: pick.frameOf.get(c.id) ?? "" })), guidance: t } });
    }
    if (a === "doc") return get().makeDoc(t);
    if (a === "group" || a === "split") {
      const targets = rewriteTargets(get().board);
      if (a === "split" && !targets.length) return void set({ error: "Select the cards you want to split." });
      const what = targets.length ? `${targets.length} selected card${targets.length > 1 ? "s" : ""}` : "the whole board";
      const label = a === "group" ? `Group ${what}` : `Split ${what}`;
      return get().ask(t ? `${a === "group" ? "Group" : "Split"} ${what}. Guidance: ${t}` : `${a === "group" ? "Group" : "Split"} ${what}.`, { mode: a, guided: !!t, label: t ? `${label} — ${t.length > 60 ? t.slice(0, 59) + "…" : t}` : label, selectedIds: targets.map((x) => x.id) });
    }
    if (a === "rewrite") {
      const targets = rewriteTargets(get().board);
      if (!targets.length) return void set({ error: "Select one or more cards (or a group frame) to rewrite." });
      return get().ask(t ? `Rewrite the selected cards: ${t}` : "Rewrite the selected cards for clarity and concision.", { mode: "rewrite", guided: !!t, label: `Rewrite ${targets.length} card${targets.length > 1 ? "s" : ""}${t ? " — " + (t.length > 70 ? t.slice(0, 69) + "…" : t) : ""}`, selectedIds: targets.map((x) => x.id) });
    }
    if (a === "expand" && !sel.length) return void set({ error: "Select one or more cards first, then use Expand." });
    const base: Record<string, [string, string]> = {
      expand: ["Expand the selected cards", "Expand the selected cards with child cards."],
      risks: ["Find risks", "What could go wrong here? Add risk cards."],
      gaps: ["Find gaps", "What is missing? Add the gaps as cards."],
      connect: ["Suggest links", "Suggest missing links between existing cards."],
    };
    const [label, q] = base[a];
    await get().ask(t ? `${q} Extra guidance: ${t}` : q, { mode: a, guided: !!t, label: t ? `${label} — ${t.length > 70 ? t.slice(0, 69) + "…" : t}` : label });
  },
  importDetail: pref<ImportDetail>("importDetail", "normal"),
  setImportDetail(d) { setPref("importDetail", d); set({ importDetail: d }); },
  asking: false,
  askLive: [],
  askPending: null,
  askStream: "",
  agentMode: pref<"review" | "auto" | "full">("agentMode", "auto"),
  setAgentMode(m) { setPref("agentMode", m); set({ agentMode: m }); },
  aiTouched: {},
  askUndo: null,
  undoAsk() {
    const u = get().askUndo;
    if (!u || u.board.id !== get().board.id) return;
    set({ board: u.board, askUndo: null });
  },
  applyAgentOps(p) {
    const r = run;
    if (!r || get().board.id !== r.boardId) return;
    const mode = get().agentMode;
    const touched: string[] = [];
    const nodes = (p.nodes ?? []).filter((n) => !r.applied.has("n:" + n.id));
    const edges = (p.ops?.edges ?? p.edges ?? []).filter((e) => !r.applied.has(`e:${e.from}>${e.to}`));
    nodes.forEach((n) => r.applied.add("n:" + n.id));
    edges.forEach((e) => r.applied.add(`e:${e.from}>${e.to}`));
    if (nodes.length || edges.length) {
      const ids = applyOps({ summary: "", nodes, edges }, set, get, { refs: r.refs, ghost: mode === "review" });
      touched.push(...ids);
      r.counts.added += nodes.length;
      r.counts.links += edges.length;
      if (nodes.length) r.notes.push(`added ${nodes.map((n) => `[${r.refs.get(n.id) ?? n.id}] "${n.title}"`).join(", ")}`);
    }
    const grp = (p.groups ?? []).filter((g) => !r.applied.has("g:" + g.title + g.members.join()));
    if (grp.length) {
      grp.forEach((g) => r.applied.add("g:" + g.title + g.members.join()));
      // members may be refs of cards staged earlier in this turn
      const real = grp.map((g) => ({ ...g, members: g.members.map((m) => r.refs.get(m) ?? m) }));
      applyGroups(real, set, get);
      r.counts.grouped += grp.length;
      r.notes.push(`grouped into frames ${grp.map((g) => `"${g.title}" (${g.members.length})`).join(", ")}`);
      touched.push(...real.flatMap((g) => g.members));
    }
    const edits = (p.edits ?? []).filter((e) => !r.applied.has("m:" + e.id));
    const dels = (p.deletes ?? []).filter((d) => !r.applied.has("d:" + d.id));
    const unl = (p.unlinks ?? []).filter((u) => !r.applied.has(`u:${u.from}>${u.to}`));
    edits.forEach((e) => r.applied.add("m:" + e.id));
    dels.forEach((d) => r.applied.add("d:" + d.id));
    unl.forEach((u) => r.applied.add(`u:${u.from}>${u.to}`));
    if (edits.length) r.notes.push(`edited ${edits.map((e) => `[${e.id}] → "${e.title}"`).join(", ")}`);
    if (dels.length) r.notes.push(`${mode === "full" ? "removed" : "suggested removing"} ${dels.map((d) => `[${d.id}]`).join(", ")}`);
    if (edits.length || dels.length || unl.length) {
      const byId = new Map(edits.map((e) => [e.id, e]));
      const dmap = new Map(dels.map((d) => [d.id, d.reason]));
      const ul = new Set(unl.map((u) => `${u.from}>${u.to}`));
      set((st) => {
        const gone = new Set<string>();
        const nextNodes: AppNode[] = [];
        for (const n of st.board.nodes) {
          if (!isCard(n)) { nextNodes.push(n); continue; }
          let d = n.data;
          const ed = byId.get(n.id);
          if (ed) {
            const bullets = ed.bullets.join("\n");
            if (ed.title !== d.title || bullets !== d.bullets) {
              d = mode === "review" ? { ...d, proposal: { title: ed.title, bullets } } : { ...d, title: ed.title, bullets };
              r.counts.edited++;
              if (mode !== "review") touched.push(n.id);
            }
          }
          if (dmap.has(n.id)) {
            r.counts.removed++;
            if (mode === "full") { gone.add(n.id); continue; }
            d = { ...d, del: dmap.get(n.id) || "Suggested removal" };
          }
          nextNodes.push(d === n.data ? n : { ...n, data: d });
        }
        const nextEdges = st.board.edges.flatMap((e) => {
          if (gone.has(e.source) || gone.has(e.target)) return [];
          if (!ul.has(`${e.source}>${e.target}`)) return [e];
          r.counts.unlinked++;
          return mode === "full" ? [] : [{ ...e, data: { ...e.data, del: true } }];
        });
        return { board: { ...st.board, nodes: nextNodes, edges: nextEdges } };
      });
    }
    if (touched.length) {
      const now = Date.now();
      set((st) => ({ aiTouched: { ...st.aiTouched, ...Object.fromEntries(touched.map((id) => [id, now])) } }));
      setTimeout(() => set((st) => ({ aiTouched: Object.fromEntries(Object.entries(st.aiTouched).filter(([, t]) => Date.now() - t < 2800)) })), 3000);
    }
  },
  setAskOpen: (askOpen) => set({ askOpen }),
  loadAsk(boardId) {
    let log: AskEntry[] = [];
    try {
      log = window.api.chats.load(boardId)?.ask ?? JSON.parse(localStorage.getItem("askLog:" + boardId) ?? "[]");
    } catch { /* ignore */ }
    set({ askLog: log, asking: false, askLive: [] });
  },
  clearAsk() {
    try { localStorage.removeItem("askLog:" + get().board.id); window.api.chats.save(get().board.id, "ask", []); } catch { /* ignore */ }
    set({ askLog: [] });
  },
  async ask(q, opts = {}) {
    const question = q.trim();
    if (!question || get().asking) return;
    // earlier plain additions are taken as accepted; edits and removals stay pending until you decide
    if (get().board.nodes.some((n) => isCard(n) && n.data.ghost) || get().board.edges.some((e) => e.data?.ghost)) get().acceptGhosts(undefined, false);
    const { board } = get();
    const mode = opts.mode ?? "ask";
    const cards = board.nodes.filter(isCard).filter((n) => !n.data.ghost);
    const groups = board.nodes.filter(isFrame).map((f) => ({ id: f.id, title: f.data.title, members: membersOf(f, cards).map((c) => c.id) }));
    const selectedIds = opts.selectedIds ?? board.nodes.filter((n) => n.selected && isCard(n)).map((n) => n.id);
    const boardId = board.id;
    const label = opts.label ?? question;
    const save = (log: AskEntry[]) => { try { window.api.chats.save(boardId, "ask", log); } catch { /* ignore */ } };
    const fail = (msg: string) => {
      if (get().board.id !== boardId) {
        run = null;
        (absorbUntil = Math.min(absorbUntil, Date.now() + 2500)), set({ asking: false, busy: null, askPending: null, askLive: [], askStream: "" });
        return;
      }
      const log = [...get().askLog, { id: uid(), q: label, a: msg, t: Date.now(), added: 0, edited: 0, links: 0, steps: 0, error: true }];
      save(log);
      run = null;
      (absorbUntil = Math.min(absorbUntil, Date.now() + 2500)), set({ asking: false, busy: null, askPending: null, askLive: [], askStream: "", askLog: log });
    };
    settleUndo(10 * 60 * 1000); // the whole assistant turn is one undo step
    run = { boardId, snapshot: board, refs: new Map(), applied: new Set(), counts: { added: 0, edited: 0, links: 0, removed: 0, unlinked: 0, grouped: 0 }, notes: [] };
    set({ askStream: "", askUndo: null, asking: true, busy: mode === "ask" ? "Thinking…" : label, askPending: label, askOpen: true, askLive: ["Reading the board…"], error: null, note: null });
    let res;
    try {
      if (!window.api.ai.agent) throw new Error("The app's background process is out of date. Quit and restart Better Notes.");
      res = await Promise.race([
        window.api.ai.agent({ question, mode, guided: !!opts.guided, text: opts.text, detail: opts.detail, arrange: opts.arrange, autonomy: get().agentMode, boardId: board.id, board: { ...serialize(board), groups }, selectedIds, history: get().askLog.filter((e) => !e.error).slice(-8).map((e) => ({ q: e.full ?? e.q, a: e.a, changes: e.changes })) }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("No response after 3 minutes. If the app was updated, quit and restart it, then try again.")), 180000)),
      ]);
    } catch (err) {
      if (get().board.id === boardId) fail(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(err));
      return;
    }
    if (get().board.id !== boardId) { (absorbUntil = Math.min(absorbUntil, Date.now() + 2500)), set({ asking: false, busy: null, askPending: null, askLive: [] }); return; }
    if (!res.ok) { fail(res.error); return; }
    const { answer, ops, edits, deletes, unlinks, groups: grp, steps, structure, trace } = res.data;
    const r = run;
    if (structure && r) applyStructure(structure, r, set, get);
    else if (mode !== "doc") get().applyAgentOps({ nodes: ops.nodes, edges: ops.edges, edits, deletes, unlinks, groups: grp }); // reconcile anything the live stream missed
    run = null;
    absorbUntil = Date.now() + 2500; // its follow-up layout passes still belong to it
    const c = r?.counts ?? { added: 0, edited: 0, links: 0, removed: 0, unlinked: 0, grouped: 0 };
    if (mode === "doc") set({ doc: answer, usage: res.usage });
    const entry: AskEntry = {
      id: uid(),
      q: label,
      a: mode === "doc" ? "Your document is ready — it opened in the viewer. (Reopen it any time with Doc.)" : answer,
      t: Date.now(),
      added: c.added,
      edited: c.edited,
      links: c.links,
      removed: c.removed,
      unlinked: c.unlinked,
      grouped: c.grouped,
      changes: r?.notes.join("; ").slice(0, 1500) || undefined,
      steps,
      ...(question !== label ? { full: question.slice(0, 4000) } : {}),
      ...(trace?.length ? { trace } : {}),
    };
    if (r && (structure?.kind === "arrange" || structure?.kind === "condense")) set({ askUndo: { entryId: entry.id, board: r.snapshot } });
    else if (r && get().agentMode !== "review" && (c.added || c.edited || c.links || c.grouped || (get().agentMode === "full" && (c.removed || c.unlinked)))) set({ askUndo: { entryId: entry.id, board: r.snapshot } });
    const log = [...get().askLog, entry];
    save(log);
    (absorbUntil = Math.min(absorbUntil, Date.now() + 2500)), set({ asking: false, busy: null, askPending: null, askLive: [], askStream: "", askLog: log, usage: res.usage });
  },
  async cancelAsk() {
    if (!get().asking) return;
    await window.api.ai.cancel?.();
  },
  async makeDoc(kind) {
    await get().ask(`Write a ${kind || "structured"} document from this board.`, { mode: "doc", label: `Write a document: ${kind || "structured"}` });
  },
  closeDoc: () => set({ doc: null }),

  async saveSettings(p) {
    await window.api.settings.set(p);
    set({ settings: await window.api.settings.get(), usage: await window.api.usage.get(), modal: null });
  },
}));

/** Cards Condense works on: selected cards (2+), else cards inside selected frames, else every visible card. Pinned, ghost and collapsed-away cards stay out. */
function condenseTargets(board: Board) {
  const { hidden } = collapsedOwners(board.nodes);
  const visible = board.nodes.filter((n) => !hidden.has(n.id));
  const ok = (c: CardNodeT) => !c.data.ghost && !c.data.pinned && !c.data.proposal;
  const all = visible.filter(isCard).filter(ok);
  const selCards = all.filter((c) => c.selected);
  const selFrames = visible.filter(isFrame).filter((n) => n.selected);
  let cardsIn = all, scope = "the board";
  if (selCards.length >= 2) { cardsIn = selCards; scope = `${selCards.length} selected cards`; }
  else if (selFrames.length) {
    const inside = new Set(selFrames.flatMap((f) => descendants(f, visible).map((d) => d.id)));
    cardsIn = all.filter((c) => inside.has(c.id));
    scope = selFrames.length === 1 ? `"${(selFrames[0] as FrameNodeT).data.title || "frame"}"` : `${selFrames.length} frames`;
  }
  const pm = parentMap(visible);
  const byId = new Map(visible.map((n) => [n.id, n]));
  const order = readingOrder(cardsIn.map((c) => ({ id: c.id, ...boxRect(c) })));
  const cmap = new Map(cardsIn.map((c) => [c.id, c]));
  const cards = order.map((id) => cmap.get(id)!);
  const frameOf = new Map<string, string>();
  for (const c of cards) { const f = pm.get(c.id); if (f) frameOf.set(c.id, `${(byId.get(f) as FrameNodeT).data.title || "Untitled frame"}#${f.slice(-4)}`); }
  return { cards, scope, frameOf };
}

/** Cards Arrange works on: the selection (3+ cards) or every visible card; pinned cards stay where they are. */
function arrangeTargets(board: Board) {
  const { hidden } = collapsedOwners(board.nodes);
  const visible = board.nodes.filter((n) => !hidden.has(n.id));
  const all = visible.filter(isCard).filter((c) => !c.data.ghost && !c.data.pinned);
  const sel = all.filter((c) => c.selected);
  const partial = sel.length >= 3;
  const pm = parentMap(visible);
  const byId = new Map(visible.map((n) => [n.id, n]));
  const cardsIn = partial ? sel : all;
  const order = readingOrder(cardsIn.map((c) => ({ id: c.id, ...boxRect(c) })));
  const cmap = new Map(cardsIn.map((c) => [c.id, c]));
  const cards = order.map((id) => cmap.get(id)!);
  const frameOf = new Map<string, string>();
  for (const c of cards) { const f = pm.get(c.id); if (f) frameOf.set(c.id, (byId.get(f) as FrameNodeT).data.title || "Untitled frame"); }
  // every open frame, so guidance like "put them in the Integration frame" can name one
  const frameTitles = [...new Set(visible.filter(isFrame).filter((f) => !f.data.collapsed).map((f) => f.data.title || "Untitled frame"))];
  return { cards, partial, frameOf, frameTitles };
}

/** Lay out just these nodes (cards + frames) with organize(), keeping their block's top-left corner. */
function relayout(ids: Set<string>, set: (p: Partial<State> | ((s: State) => Partial<State>)) => void, get: () => State) {
  const nodes = get().board.nodes.filter((n) => ids.has(n.id));
  const cards = nodes.filter(isCard);
  const frames = nodes.filter(isFrame);
  if (!cards.length) return;
  const { cardPos, framePos } = organize(cards, frames, []);
  set((s) => ({
    board: {
      ...s.board,
      nodes: s.board.nodes.map((n) => {
        if (cardPos.has(n.id)) return { ...n, position: cardPos.get(n.id)! } as AppNode;
        const f = framePos.get(n.id);
        return f ? ({ ...n, position: { x: f.x, y: f.y }, width: f.width, height: f.height } as AppNode) : n;
      }),
    },
  }));
}

/**
 * Turn a structure result into frames + cards in reading order.
 * Import: new frames and cards (ghosts in Suggest mode), placed right of the board.
 * Arrange: the old frames around these cards go, new section frames take their place.
 */
function applyStructure(st: StructureResult, r: NonNullable<typeof run>, set: (p: Partial<State> | ((s: State) => Partial<State>)) => void, get: () => State) {
  const board = get().board;
  const ghost = get().agentMode === "review" && st.kind === "import";
  const COLW = CARD_W + FRAME_PAD.x * 2 + 120;
  let color = board.nodes.filter(isFrame).length;
  const mkFrame = (title: string, x: number, y: number, n: number): FrameNodeT => ({
    id: `f_${uid()}`, type: "frame", position: { x, y }, width: CARD_W + FRAME_PAD.x * 2, height: FRAME_PAD.top + FRAME_PAD.bottom + n * 400,
    zIndex: -1, style: { pointerEvents: "none" }, dragHandle: ".frame-head", data: { title, color: color++, ...(ghost ? { ghost: true } : {}) },
  });
  const ids = new Set<string>();

  if (st.kind === "condense") {
    const byId = new Map(board.nodes.map((n) => [n.id, n]));
    const repl = new Map<string, string>(); // old card id -> merged card id
    const fresh: CardNodeT[] = [];
    for (const m of st.merges) {
      const src = m.from.map((id) => byId.get(id)).filter((n): n is CardNodeT => !!n && isCard(n));
      if (src.length < 2) continue;
      const id = `n_${uid()}`;
      const first = src[0];
      fresh.push({ id, type: "card", position: { ...first.position }, ...(first.width ? { width: first.width } : {}), data: { title: m.title, bullets: m.bullets.join("\n"), kind: m.kind } });
      for (const c of src) repl.set(c.id, id);
    }
    if (!fresh.length) return;
    const seen = new Set<string>();
    const edges: NoteEdge[] = [];
    for (const e of board.edges) {
      const s = repl.get(e.source) ?? e.source, t = repl.get(e.target) ?? e.target;
      if (s === t || seen.has(`${s}>${t}`)) continue;
      seen.add(`${s}>${t}`);
      edges.push(s === e.source && t === e.target ? e : { ...e, id: `e_${uid()}`, source: s, target: t });
    }
    set((s) => ({ board: { ...s.board, nodes: [...s.board.nodes.filter((n) => !repl.has(n.id)).map((n) => ({ ...n, selected: false })), ...fresh], edges } }));
    r.counts.added += fresh.length;
    r.notes.push(`condensed ${repl.size} cards into ${fresh.length}: ${st.merges.map((m) => `"${m.title}"`).join(", ")}`);
    const now = Date.now();
    set((s2) => ({ aiTouched: { ...s2.aiTouched, ...Object.fromEntries(fresh.map((n) => [n.id, now])) } }));
    // merged cards are taller: clear overlaps and refit frames once real heights are known
    setTimeout(() => get().organizeLayout(), 400);
    return;
  }
  if (st.kind === "import") {
    const fresh: AppNode[] = [];
    const refId = new Map<string, string>();
    let x = 0;
    if (st.summary) {
      const id = `n_${uid()}`;
      fresh.push({ id, type: "card", position: { x, y: 0 }, data: { title: st.title || "Summary", bullets: st.summary, kind: "note", ghost } });
      x += CARD_W + 120;
    }
    st.sections.forEach((sec, si) => {
      const f = mkFrame(sec.title, x, 0, sec.cards.length);
      fresh.push(f);
      sec.cards.forEach((c, ci) => {
        const id = `n_${uid()}`;
        refId.set(`c${si}_${ci}`, id);
        fresh.push({ id, type: "card", position: { x: x + FRAME_PAD.x, y: FRAME_PAD.top + ci * 400 }, data: { title: c.title, bullets: c.bullets.join("\n"), kind: c.kind, ghost } });
      });
      x += COLW;
    });
    const edges = st.links.map((l) => ({ s: refId.get(l.from), t: refId.get(l.to), label: l.label, type: l.type })).filter((e) => e.s && e.t).map((e) => mkEdge(e.s!, e.t!, e.label, ghost, e.type));
    // lay the new block out on its own, then park it to the right of everything already there
    const { cardPos, framePos } = organize(fresh.filter(isCard), fresh.filter(isFrame), []);
    const placed = fresh.map((n) => {
      const f = framePos.get(n.id);
      return f ? ({ ...n, position: { x: f.x, y: f.y }, width: f.width, height: f.height } as AppNode) : ({ ...n, position: cardPos.get(n.id) ?? n.position } as AppNode);
    });
    const old = board.nodes.filter((n) => !(isCard(n) && n.data.ghost));
    const ox = old.length ? Math.max(...old.map((n) => boxRect(n).x + boxRect(n).w)) + 200 : 0;
    const oy = old.length ? Math.min(...old.map((n) => boxRect(n).y)) : 0;
    for (const n of placed) { n.position = { x: n.position.x + ox, y: n.position.y + oy }; ids.add(n.id); }
    const rename = /^(untitled|my first board)?$/i.test(board.name.trim()) && st.title ? st.title : null;
    set((s) => ({ board: { ...s.board, ...(rename ? { name: rename } : {}), nodes: [...placed.filter(isFrame), ...s.board.nodes.map((n) => ({ ...n, selected: false })), ...placed.filter(isCard)], edges: [...s.board.edges, ...edges] } }));
    const nCards = placed.filter(isCard).length;
    r.counts.added += nCards;
    r.counts.grouped += st.sections.length;
    r.counts.links += edges.length;
    r.notes.push(`imported text as ${st.sections.length} sections (${st.sections.map((x) => `"${x.title}"`).join(", ")}) with ${nCards} cards`);
    const touched = placed.filter(isCard).map((n) => n.id);
    const now = Date.now();
    set((s2) => ({ aiTouched: { ...s2.aiTouched, ...Object.fromEntries(touched.map((id) => [id, now])) }, fitTick: s2.fitTick + 1 }));
  } else {
    const byId = new Map(board.nodes.map((n) => [n.id, n]));
    const arranged = new Set([...st.sections.flatMap((x) => x.ids), ...st.loose]);
    const cards = [...arranged].map((id) => byId.get(id)).filter((n): n is CardNodeT => !!n && isCard(n));
    if (!cards.length) return;
    // frames that only held arranged cards are replaced by the new sections
    const { hidden } = collapsedOwners(board.nodes);
    const allCards = board.nodes.filter(isCard);
    const dropFrames = new Set(
      board.nodes.filter(isFrame).filter((f) => !f.data.collapsed && !hidden.has(f.id)).filter((f) => {
        const inside = descendants(f, board.nodes);
        const m = membersOf(f, allCards);
        return m.length > 0 && m.every((c) => arranged.has(c.id)) && !inside.some((n) => isFrame(n) && n.data.collapsed);
      }).map((f) => f.id),
    );
    const renamed = new Map(st.renames.map((q) => [q.id, q.title]));
    const dataOf = (c: CardNodeT) => (renamed.has(c.id) ? { ...c.data, title: renamed.get(c.id)! } : c.data);
    // a section named like a frame that stays (the user asked to add cards to it): stack its cards under that frame's cards
    const kept = board.nodes.filter(isFrame).filter((f) => !dropFrames.has(f.id) && !f.data.collapsed && !hidden.has(f.id));
    const norm = (t: string) => t.trim().toLowerCase();
    const intoPos = new Map<string, { x: number; y: number }>();
    const intoBox = new Map<string, { x: number; y: number; width: number; height: number }>();
    const blockSecs = st.sections.filter((sec) => {
      const f = kept.find((k) => norm(k.data.title) === norm(sec.title));
      if (!f) return true;
      const fr = boxRect(f);
      const stay = membersOf(f, allCards).filter((c) => !arranged.has(c.id)).map(boxRect);
      let y = stay.length ? Math.max(...stay.map((q) => q.y + q.h)) + 24 : fr.y + FRAME_PAD.top;
      let w = fr.w;
      for (const id of sec.ids) {
        const c = byId.get(id) as CardNodeT;
        intoPos.set(id, { x: fr.x + FRAME_PAD.x, y });
        y += estHeight(c) + 24;
        w = Math.max(w, cardW(c) + FRAME_PAD.x * 2);
      }
      intoBox.set(f.id, { x: fr.x, y: fr.y, width: w, height: Math.max(fr.h, y - 24 + FRAME_PAD.bottom - fr.y) });
      return false;
    });
    const blockCards = cards.filter((c) => !intoPos.has(c.id));
    const pos = new Map<string, { x: number; y: number }>();
    const frames: FrameNodeT[] = [];
    let x = 0;
    blockSecs.forEach((sec) => {
      frames.push(mkFrame(sec.title, x, 0, sec.ids.length));
      sec.ids.forEach((id, i) => pos.set(id, { x: x + FRAME_PAD.x, y: FRAME_PAD.top + i * 400 }));
      x += COLW;
    });
    st.loose.forEach((id, i) => pos.set(id, { x, y: i * 400 }));
    const finalPos = new Map(intoPos);
    let newFrames: FrameNodeT[] = [];
    if (blockCards.length) {
      const rects = blockCards.map(boxRect);
      let ax = Math.min(...rects.map((q) => q.x)), ay = Math.min(...rects.map((q) => q.y));
      const moved = blockCards.map((c) => ({ ...c, position: pos.get(c.id)!, data: dataOf(c) }));
      const { cardPos, framePos } = organize(moved, frames, []);
      const all = [...[...cardPos.values()].map((p) => ({ x: p.x, y: p.y })), ...[...framePos.values()]];
      const minX = Math.min(...all.map((p) => p.x)), minY = Math.min(...all.map((p) => p.y));
      const boxes = [
        ...moved.map((c) => { const p = cardPos.get(c.id)!; return { x: p.x - minX, y: p.y - minY, w: cardW(c), h: estHeight(c) }; }),
        ...[...framePos.values()].map((f) => ({ x: f.x - minX, y: f.y - minY, w: f.width, h: f.height })),
      ];
      // the new block must not land on what stays put: if it would, park it to the right of everything
      const stays = board.nodes
        .filter((n) => !hidden.has(n.id) && !dropFrames.has(n.id) && !arranged.has(n.id) && !(isCard(n) && n.data.ghost))
        .map((n) => { const q = boxRect(n); const b2 = intoBox.get(n.id); return b2 ? { x: b2.x, y: b2.y, w: b2.width, h: b2.height } : q; });
      const hits = (dx: number, dy: number) => boxes.some((r) => stays.some((o) => r.x + dx < o.x + o.w + 40 && o.x < r.x + dx + r.w + 40 && r.y + dy < o.y + o.h + 40 && o.y < r.y + dy + r.h + 40));
      if (stays.length && hits(ax, ay)) {
        ax = Math.max(...stays.map((o) => o.x + o.w)) + 200;
        ay = Math.min(...stays.map((o) => o.y));
      }
      const shift = (p: { x: number; y: number }) => ({ x: p.x - minX + ax, y: p.y - minY + ay });
      newFrames = frames.map((f) => { const q = framePos.get(f.id)!; return { ...f, position: shift(q), width: q.width, height: q.height }; });
      for (const c of moved) finalPos.set(c.id, shift(cardPos.get(c.id)!));
    }
    set((s) => ({
      board: {
        ...s.board,
        nodes: [
          ...newFrames,
          ...s.board.nodes.filter((n) => !dropFrames.has(n.id)).map((n) => {
            const p = finalPos.get(n.id);
            if (p && isCard(n)) return { ...n, data: dataOf(n), position: p } as AppNode;
            const b2 = intoBox.get(n.id);
            return b2 ? ({ ...n, position: { x: b2.x, y: b2.y }, width: b2.width, height: b2.height } as AppNode) : n;
          }),
        ],
      },
    }));
    newFrames.forEach((f) => ids.add(f.id));
    blockCards.forEach((c) => ids.add(c.id));
    // real heights are known after render: fit frames and clear overlaps with whatever stayed put
    setTimeout(() => get().organizeLayout("space", true), 1400);
    r.counts.grouped += st.sections.length;
    r.counts.edited += st.renames.length;
    r.notes.push(`arranged ${cards.length} cards into sections ${st.sections.map((q) => `"${q.title}" (${q.ids.length})`).join(", ")}`);
  }
  // real card heights are known only after render: lay the block out again with them
  setTimeout(() => relayout(ids, set, get), 350);
  setTimeout(() => relayout(ids, set, get), 1000);
}

/** Put each group's cards in a fresh labelled frame in free space (2 cards wide), then re-organize around them. */
function applyGroups(groups: { title: string; members: string[] }[], set: (p: Partial<State> | ((s: State) => Partial<State>)) => void, get: () => State) {
  set((st) => {
    const nodes = st.board.nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let x0 = Math.max(0, ...nodes.map((n) => boxRect(n).x + boxRect(n).w)) + 140;
    let y = Math.min(0, ...nodes.map((n) => boxRect(n).y));
    const moved = new Map<string, { x: number; y: number }>();
    const frames: FrameNodeT[] = [];
    let colorIdx = nodes.filter(isFrame).length;
    for (const g of groups) {
      const cards = g.members.map((m) => byId.get(m)).filter((n): n is CardNodeT => !!n && isCard(n));
      if (cards.length < 2) continue;
      const w = CARD_W;
      const gap = 24;
      const cols = 2;
      const colX = [0, w + gap];
      const rowH: number[] = [];
      cards.forEach((c, i) => { const r = Math.floor(i / cols); rowH[r] = Math.max(rowH[r] ?? 0, estHeight(c)); });
      const rowY: number[] = [];
      rowH.reduce((acc, h, i) => ((rowY[i] = acc), acc + h + gap), 0);
      cards.forEach((c, i) => moved.set(c.id, { x: x0 + FRAME_PAD.x + colX[i % cols], y: y + FRAME_PAD.top + rowY[Math.floor(i / cols)] }));
      const width = FRAME_PAD.x * 2 + (cards.length > 1 ? w * 2 + gap : w);
      const height = FRAME_PAD.top + FRAME_PAD.bottom + rowH.reduce((a, h) => a + h, 0) + gap * (rowH.length - 1);
      frames.push({ id: `f_${uid()}`, type: "frame", position: { x: x0, y }, width, height, zIndex: -1, style: { pointerEvents: "none" }, dragHandle: ".frame-head", data: { title: g.title, color: colorIdx++ } } as FrameNodeT);
      y += height + 60;
    }
    return { board: { ...st.board, nodes: [...frames, ...nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n))] } };
  });
  setTimeout(() => get().organizeLayout("space", true), 150);
}

function applyOps(ops: GraphOps, set: (p: Partial<State> | ((s: State) => Partial<State>)) => void, get: () => State, o: { refs?: Map<string, string>; ghost?: boolean } = {}): string[] {
  const asGhost = o.ghost ?? true;
  const { board } = get();
  const cards = board.nodes.filter(isCard);
  const existingIds = new Set(cards.map((n) => n.id));
  const idMap = o.refs ?? new Map<string, string>();
  const kinds: Kind[] = ["idea", "question", "risk", "task", "note"];

  const fresh: CardNodeT[] = ops.nodes.map((n) => {
    const id = `n_${uid()}`;
    idMap.set(n.id, id);
    return {
      id,
      type: "card",
      position: { x: 0, y: 0 },
      data: { title: n.title, bullets: n.bullets.join("\n"), kind: kinds.includes(n.kind) ? n.kind : "idea", ghost: asGhost },
    };
  });
  const resolve = (x: string) => idMap.get(x) ?? (existingIds.has(x) ? x : null);

  const seen = new Set(board.edges.map((e) => `${e.source}>${e.target}`));
  const edges: NoteEdge[] = [];
  for (const e of ops.edges) {
    const s = resolve(e.from),
      t = resolve(e.to);
    if (!s || !t || s === t || seen.has(`${s}>${t}`)) continue;
    seen.add(`${s}>${t}`);
    edges.push(mkEdge(s, t, e.label, asGhost, e.type));
  }

  const freshIds = new Set(fresh.map((n) => n.id));
  const anchorIds = new Set<string>();
  for (const e of edges) {
    if (freshIds.has(e.source) && !freshIds.has(e.target)) anchorIds.add(e.target);
    if (freshIds.has(e.target) && !freshIds.has(e.source)) anchorIds.add(e.source);
  }
  const anchors = cards.filter((n) => anchorIds.has(n.id));
  let grown = new Map<string, { x: number; y: number; width: number; height: number }>();
  if (fresh.length) {
    const pos = layoutNew(fresh, edges, anchors, cards);
    for (const n of fresh) n.position = pos.get(n.id) ?? n.position;
    if (anchors.length) grown = placeNearAnchors(fresh, edges, board.nodes);
  }
  set((s) => ({
    board: {
      ...s.board,
      nodes: [...s.board.nodes.map((n) => { const g = grown.get(n.id); return g ? ({ ...n, selected: false, position: { x: g.x, y: g.y }, width: g.width, height: g.height } as AppNode) : { ...n, selected: false }; }), ...fresh],
      edges: [...s.board.edges, ...edges],
    },
  }));
  // once the new cards have real sizes: frames grow to hold them, neighbours step aside
  const ids = fresh.map((n) => n.id);
  if (ids.length) { setTimeout(() => get().makeRoom(ids), 450); setTimeout(() => get().makeRoom(ids), 1300); }
  return ids;
}

/**
 * Put new cards next to the card they belong to, never on top of other things:
 * - the anchor sits in a frame: the new cards go inside that frame, under what is already there, and the frame grows;
 * - otherwise: a free spot to the right of the anchor (then below / further right), clear of every card and frame.
 * New cards that only link to other new cards travel with them. Returns the new boxes of frames that grew.
 */
function placeNearAnchors(fresh: CardNodeT[], edges: NoteEdge[], nodes: AppNode[]) {
  const { hidden } = collapsedOwners(nodes);
  const visible = nodes.filter((n) => !hidden.has(n.id));
  const pm = parentMap(visible);
  const byId = new Map(visible.map((n) => [n.id, n]));
  const freshIds = new Set(fresh.map((n) => n.id));
  const GAP = 36, SPACE = 64;
  // components of new cards (joined by links between new cards), each with the existing card it hangs off
  const adj = new Map<string, string[]>();
  for (const e of edges) if (freshIds.has(e.source) && freshIds.has(e.target)) { adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]); adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]); }
  const anchorOf = (id: string) => { for (const e of edges) { if (e.source === id && byId.has(e.target) && isCard(byId.get(e.target)!)) return e.target; if (e.target === id && byId.has(e.source) && isCard(byId.get(e.source)!)) return e.source; } return null; };
  const seen = new Set<string>();
  const taken: { x: number; y: number; w: number; h: number }[] = visible.map(boxRect);
  const grown = new Map<string, { x: number; y: number; width: number; height: number }>();
  const hits = (r: { x: number; y: number; w: number; h: number }, m: number) => taken.some((o) => r.x < o.x + o.w + m && o.x < r.x + r.w + m && r.y < o.y + o.h + m && o.y < r.y + r.h + m);
  for (const start of fresh) {
    if (seen.has(start.id)) continue;
    const comp: CardNodeT[] = [];
    const stack = [start.id];
    while (stack.length) { const x = stack.pop()!; if (seen.has(x)) continue; seen.add(x); comp.push(fresh.find((f) => f.id === x)!); stack.push(...(adj.get(x) ?? [])); }
    comp.sort((a, b) => fresh.indexOf(a) - fresh.indexOf(b));
    const anchorId = comp.map((c) => anchorOf(c.id)).find(Boolean);
    const anchor = anchorId ? byId.get(anchorId)! : null;
    if (!anchor) continue; // nothing to sit next to: keep the default spot (right of the board)
    const w = Math.max(...comp.map(cardW));
    const hs = comp.map((c) => guessHeight(c));
    const h = hs.reduce((t, x) => t + x, 0) + GAP * (comp.length - 1);
    const frameId = pm.get(anchor.id);
    let x: number, y: number;
    if (frameId) {
      // inside the anchor's frame, under everything already in it
      const f = byId.get(frameId) as FrameNodeT;
      const fb = grown.get(frameId) ?? (() => { const r = boxRect(f); return { x: r.x, y: r.y, width: r.w, height: r.h }; })();
      const inside = visible.filter((n) => n.id !== frameId && pm.get(n.id) === frameId).map(boxRect);
      const placedHere = taken.filter((t) => (t as { f?: string }).f === frameId); // new cards already put in this frame
      const bottom = Math.max(fb.y + FRAME_PAD.top - GAP, ...inside.map((r) => r.y + r.h), ...placedHere.map((r) => r.y + r.h));
      x = boxRect(anchor).x;
      y = bottom + GAP;
      const right = Math.max(fb.x + fb.width, x + w + FRAME_PAD.x), low = y + h + FRAME_PAD.bottom;
      grown.set(frameId, { x: fb.x, y: fb.y, width: right - fb.x, height: Math.max(fb.height, low - fb.y) });
    } else {
      const a = boxRect(anchor);
      let spot: { x: number; y: number } | null = null;
      for (let col = 0; col < 12 && !spot; col++) {
        for (let k = 0; k < 60 && !spot; k++) {
          const cand = { x: a.x + a.w + 110 + col * (w + 110), y: a.y + k * 40, w, h };
          if (!hits(cand, SPACE)) spot = cand;
        }
      }
      ({ x, y } = spot ?? { x: Math.max(...taken.map((t) => t.x + t.w)) + 200, y: a.y });
    }
    let cy = y;
    comp.forEach((c, i) => {
      c.position = { x, y: cy };
      taken.push(Object.assign({ x, y: cy, w: cardW(c), h: hs[i] }, frameId ? { f: frameId } : {}));
      cy += hs[i] + GAP;
    });
  }
  return grown;
}

export { membersOf, frameSize };

/** True when two node lists differ only in selection / drag / measured size (cheap: compares references). */
function onlyViewStateChanged(a: AppNode[], b: AppNode[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (x.id !== y.id || x.data !== y.data || x.position !== y.position || x.width !== y.width || x.height !== y.height || x.hidden !== y.hidden || x.type !== y.type) return false;
  }
  return true;
}

// ---------- undo / redo (whole-board snapshots, recorded after 350ms of quiet) ----------
type Snap = { nodes: AppNode[]; edges: NoteEdge[] };
let past: Snap[] = [];
let future: Snap[] = [];
let committed: Snap | null = null;
let committedKey = "";
let histBoard = "";
let histTimer: ReturnType<typeof setTimeout> | undefined;
const UNDO_STEPS = 200;
/** each board keeps its own undo history while the app is open, so switching boards doesn't wipe it */
const shelved = new Map<string, { past: Snap[]; future: Snap[]; committed: Snap | null; committedKey: string }>();
// automatic follow-up passes (re-layout once real card sizes are known, frame fitting) belong to the action
// that started them: changes inside this window merge into that action's undo step
let absorbFrom = 0, absorbUntil = 0, lastPush = 0;
/** Start one undo step for an action and its follow-up passes (inside a running one: just extend it). */
export function settleUndo(ms = 2500) {
  const now = Date.now();
  if (now < absorbUntil) { absorbUntil = Math.max(absorbUntil, now + ms); return; }
  commitHistory(); // what you did before this is its own step
  absorbFrom = now;
  absorbUntil = now + ms;
}
const keyOf = (b: Snap) =>
  JSON.stringify([
    b.nodes.map((n) => [n.id, n.type, n.position, n.width, n.height, n.hidden, n.data]),
    b.edges.map((e) => [e.id, e.source, e.target, e.label, e.data]),
  ]);
const snapOf = (b: Board): Snap => ({ nodes: b.nodes, edges: b.edges });
const flags = () => useStore.setState({ canUndo: past.length > 0, canRedo: future.length > 0 });

function commitHistory() {
  clearTimeout(histTimer);
  const b = useStore.getState().board;
  if (b.id !== histBoard) return;
  const key = keyOf(snapOf(b));
  if (key === committedKey) return;
  const now = Date.now();
  const merge = now < absorbUntil && lastPush >= absorbFrom; // a follow-up pass: fold into the step just made
  if (committed && !merge) { past.push(committed); lastPush = now; }
  if (past.length > UNDO_STEPS) past.shift();
  future.length = 0;
  committed = snapOf(b);
  committedKey = key;
  flags();
}

function stepHistory(dir: -1 | 1) {
  commitHistory();
  absorbUntil = 0;
  const from = dir < 0 ? past : future;
  const to = dir < 0 ? future : past;
  const snap = from.pop();
  if (!snap || !committed) return;
  to.push(committed);
  committed = snap;
  committedKey = keyOf(snap);
  useStore.setState((s) => ({
    animating: true,
    board: { ...s.board, nodes: snap.nodes.map((n) => ({ ...n, selected: false })) as AppNode[], edges: snap.edges.map((e) => ({ ...e, selected: false })) },
  }));
  flags();
  setTimeout(() => useStore.setState({ animating: false }), 500);
}

useStore.subscribe((s, prev) => {
  if (s.board === prev.board) return;
  if (s.board.id !== histBoard) {
    if (histBoard) {
      shelved.set(histBoard, { past, future, committed, committedKey });
      if (shelved.size > 15) shelved.delete(shelved.keys().next().value!);
    }
    histBoard = s.board.id;
    const back = shelved.get(histBoard);
    shelved.delete(histBoard);
    past = back?.past ?? [];
    future = back?.future ?? [];
    committed = snapOf(s.board);
    committedKey = keyOf(committed);
    // the board as loaded may differ from where we left it (saved, reloaded): only resume if it is the same
    if (back && back.committedKey !== committedKey) { past = []; future = []; }
    flags();
    return;
  }
  // selection / hover / measuring don't make an undo step: skip the full-board JSON compare for those
  if (s.board.edges === prev.board.edges && s.board.name === prev.board.name && onlyViewStateChanged(s.board.nodes, prev.board.nodes)) return;
  clearTimeout(histTimer);
  histTimer = setTimeout(commitHistory, 350);
});

// baseline for "unchanged since opened": taken whenever a different board becomes the active one
useStore.subscribe((s, prev) => {
  if (s.board.id !== prev.board.id) savedSig.set(s.board.id, boardSig(s.board));
});
