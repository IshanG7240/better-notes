import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { ReactFlowProvider } from "@xyflow/react";
import Canvas from "./Canvas";
import Outline from "./Outline";
import Toolbar from "./Toolbar";
import { Icon } from "./icons";
import ChatPanel from "./ChatPanel";
import AskPanel from "./AskPanel";
import { DocView, Palette, SettingsModal, Toasts, UsageChip } from "./Modals";
import { persistBoard, useStore } from "./store";
import { THEMES, type Theme } from "./types";
import { toMarkdown } from "./outline";

const SWATCH: Record<Theme, string> = {
  dark: "linear-gradient(135deg,#1b1f2a,#0f1115)",
  light: "linear-gradient(135deg,#ffffff,#e4e8f0)",
  paper: "linear-gradient(135deg,#e3dac4,#cfc29f)",
  dusk: "linear-gradient(135deg,#5b4b8a,#e0866b)",
  glass: "linear-gradient(135deg,#6ea8ff,#c084fc)",
};

function Resizer({ side, width, min, max, onChange }: { side: "left" | "right"; width: number; min: number; max: number; onChange: (w: number) => void }) {
  return (
    <div
      className="resizer"
      onMouseDown={(e) => {
        e.preventDefault();
        const x0 = e.clientX,
          w0 = width;
        document.body.classList.add("resizing");
        const move = (ev: MouseEvent) => {
          const d = ev.clientX - x0;
          onChange(Math.max(min, Math.min(max, side === "left" ? w0 + d : w0 - d)));
        };
        const up = () => {
          document.body.classList.remove("resizing");
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    />
  );
}

function Sidebar() {
  // narrow selectors: a whole-store subscription re-rendered this on every hover / drag tick
  const { boards, newBoard, addSampleBoard, openBoard, deleteBoard, rename, setBoardGroup } = useStore(
    useShallow((s) => ({ setBoardGroup: s.setBoardGroup, boards: s.boards, newBoard: s.newBoard, addSampleBoard: s.addSampleBoard, openBoard: s.openBoard, deleteBoard: s.deleteBoard, rename: s.rename })),
  );
  const board = useStore(useShallow((s) => ({ id: s.board.id, name: s.board.name })));
  const [armed, setArmed] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [orig, setOrig] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [newGroup, setNewGroup] = useState("");
  const [shut, setShut] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("bn.shutGroups") || "{}"); } catch { return {}; } });
  const toggle = (g: string) => setShut((o) => { const n = { ...o, [g]: !o[g] }; try { localStorage.setItem("bn.shutGroups", JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const groupNames = [...new Set(boards.map((b) => b.group).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b));
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".grp-menu, .grp-btn")) setMenu(null); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [menu]);
  const assign = (id: string, g: string) => { setBoardGroup(id, g); setMenu(null); setNewGroup(""); };
  const row = (b: (typeof boards)[number]) => (
    <div key={b.id} className={`board-row${b.id === board.id ? " active" : ""}${b.group ? " in-group" : ""}`} onClick={() => openBoard(b.id)} onDoubleClick={() => { openBoard(b.id); setOrig(board.id === b.id ? board.name : b.name); setEditing(b.id); }}>
      <span className="row-lead"><Icon name="note" size={15} /></span>
      {editing === b.id && board.id === b.id ? (
        <input
          className="bn-edit"
          ref={(el) => { if (el && document.activeElement !== el) { el.focus(); el.select(); } }}
          value={board.name}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onChange={(e) => rename(e.target.value)}
          onBlur={() => setEditing(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setEditing(null);
            if (e.key === "Escape") (rename(orig), setEditing(null));
          }}
        />
      ) : (
        <span className="bn" title="Double-click to rename">{(b.id === board.id ? board.name : b.name) || "Untitled"}</span>
      )}
      <button className="grp-btn row-ic" title="Put this board in a group (the assistant can read other boards of the same group)" onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenuPos({ x: r.right, y: r.bottom + 4 }); setMenu(menu === b.id ? null : b.id); }}><Icon name="folder" size={14} /></button>
      <button
        className={`row-ic${armed === b.id ? " armed" : ""}`}
        title={armed === b.id ? "Click again to delete" : "Delete"}
        onClick={(e) => {
          e.stopPropagation();
          if (armed === b.id) (setArmed(null), deleteBoard(b.id));
          else (setArmed(b.id), setTimeout(() => setArmed(null), 2500));
        }}
      >
        {armed === b.id ? <span className="sure">Delete?</span> : <Icon name="trash" size={14} />}
      </button>
      {menu === b.id && createPortal(
        <div className="grp-menu glass" style={{ left: Math.max(8, menuPos.x - 200), top: Math.min(menuPos.y, window.innerHeight - 260) }} onClick={(e) => e.stopPropagation()}>
          <div className="grp-title">Group</div>
          {groupNames.map((g) => <button key={g} className={b.group === g ? "on" : ""} onClick={() => assign(b.id, g)}><Icon name="folder" size={14} /><span>{g}</span>{b.group === g && <Icon name="check" size={14} />}</button>)}
          {b.group && <button className="mute" onClick={() => assign(b.id, "")}><Icon name="x" size={14} /><span>Remove from group</span></button>}
          <input
            placeholder="New group…"
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newGroup.trim()) assign(b.id, newGroup); if (e.key === "Escape") setMenu(null); e.stopPropagation(); }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
  return (
    <aside className="sidebar glass">
      <div className="side-head">
        <span>Boards</span>
        <span className="side-btns">
          <button className="sb-ic" onClick={addSampleBoard} title="Add the sample architecture board"><Icon name="sparkle" size={15} /></button>
          <button className="sb-ic" onClick={newBoard} title="New board"><Icon name="plus" size={15} /></button>
        </span>
      </div>
      <div className="side-list">
        {groupNames.map((g) => {
          const list = boards.filter((b) => b.group === g);
          return (
            <div key={g} className="grp">
              <div className="grp-head" onClick={() => toggle(g)}>
                <span className={`gch${shut[g] ? "" : " open"}`}><Icon name="chevR" size={13} /></span><Icon name="folder" size={14} /><span className="gn">{g}</span><span className="gc">{list.length}</span>
              </div>
              {!shut[g] && list.map(row)}
            </div>
          );
        })}
        {groupNames.length > 0 && boards.some((b) => !b.group) && <div className="grp-head plain"><span className="gn">Ungrouped</span></div>}
        {boards.filter((b) => !b.group).map(row)}
      </div>
    </aside>
  );
}

function TopBar() {
  // flat fields only: useShallow compares one level deep, so a nested object here would loop forever
  const f = useStore(
    useShallow((s) => ({
      sidebarOpen: s.sidebarOpen, setPanel: s.setPanel, boardName: s.board.name, rename: s.rename, view: s.view, setView: s.setView,
      busy: s.busy, fontScale: s.fontScale, setFontScale: s.setFontScale, fontFamily: s.fontFamily, setFontFamily: s.setFontFamily,
      theme: s.theme, setTheme: s.setTheme, setModal: s.setModal, model: s.settings.model, chatOpen: s.chatOpen,
    })),
  );
  const s = { ...f, board: { name: f.boardName }, settings: { model: f.model } };
  return (
    <header className="topbar glass">
      <button className="ghostbtn" title="Toggle boards panel" onClick={() => s.setPanel({ sidebarOpen: !s.sidebarOpen })}><Icon name="menu" size={17} /></button>
      <input className="board-name" value={s.board.name} onChange={(e) => s.rename(e.target.value)} placeholder="Board name" />
      <div className="seg">
        <button className={s.view === "canvas" ? "on" : ""} onClick={() => s.setView("canvas")}>Canvas</button>
        <button className={s.view === "outline" ? "on" : ""} onClick={() => s.setView("outline")}>Outline</button>
      </div>
      <div className="spacer" />
      {s.busy && <div className="busy"><span className="spin" />{s.busy}</div>}
      <UsageChip />
      <div className="fontctl" title="Text size in cards, outline and chat">
        <button onClick={() => s.setFontScale(s.fontScale - 0.1)} disabled={s.fontScale <= 0.7}>A−</button>
        <button className="fs-val" onClick={() => s.setFontScale(1)} title="Reset to 100%">{Math.round(s.fontScale * 100)}%</button>
        <button onClick={() => s.setFontScale(s.fontScale + 0.1)} disabled={s.fontScale >= 1.8}>A+</button>
      </div>
      <div className="fontpick" title="Font">
        {([["sans", "Aa", "Sans"], ["serif", "Aa", "Serif"], ["mono", "Aa", "Mono"]] as const).map(([f, l, t]) => (
          <button key={f} className={s.fontFamily === f ? "on" : ""} title={t} style={{ fontFamily: f === "sans" ? "Inter, sans-serif" : f === "serif" ? "Georgia, serif" : "ui-monospace, monospace" }} onClick={() => s.setFontFamily(f)}>{l}</button>
        ))}
      </div>
      <div className="themes" title="Theme">
        {THEMES.map((t) => (
          <button key={t} className={`sw${s.theme === t ? " on" : ""}`} style={{ background: SWATCH[t] }} title={t} onClick={() => s.setTheme(t)} />
        ))}
      </div>
      <button className="ghostbtn iconbtn" onClick={() => s.setModal("settings")} title={`Settings · ${s.settings.model}`}><Icon name="settings" size={22} /></button>
      <button className={`ghostbtn${s.chatOpen ? " active" : ""}`} onClick={() => s.setPanel({ chatOpen: !s.chatOpen })} title="Claude Code panel">Claude</button>
    </header>
  );
}

export default function App() {
  const init = useStore((s) => s.init);
  const modal = useStore((s) => s.modal);
  const view = useStore((s) => s.view);
  const { sidebarOpen, sidebarW, chatOpen, chatW, setPanel } = useStore(
    useShallow((s) => ({ sidebarOpen: s.sidebarOpen, sidebarW: s.sidebarW, chatOpen: s.chatOpen, chatW: s.chatW, setPanel: s.setPanel })),
  );
  const ready = useRef(false);

  useEffect(() => {
    const f2 = (e: KeyboardEvent) => {
      if (e.key !== "F2") return;
      e.preventDefault();
      const el = document.querySelector<HTMLInputElement>(".board-name");
      el?.focus();
      el?.select();
    };
    window.addEventListener("keydown", f2);
    return () => window.removeEventListener("keydown", f2);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = useStore.getState().theme;
    document.documentElement.style.setProperty("--fs", String(useStore.getState().fontScale));
    init().then(() => (ready.current = true));
  }, [init]);

  // window is closing: write the current board first, then tell the main process it may go
  useEffect(() => {
    window.api.lifecycle.onFlush(async () => {
      try {
        if (ready.current) await persistBoard(useStore.getState().board);
      } finally {
        window.api.lifecycle.flushed();
      }
    });
  }, []);

  // autosave + sync a markdown snapshot for the Claude Code chat to read
  // (a store subscription, not a React dependency on `board`: that re-rendered the whole app on every drag/selection tick)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    let lastSync = "";
    const unsub = useStore.subscribe((st, prev) => {
      if (st.board === prev.board || !ready.current) return;
      clearTimeout(t);
      t = setTimeout(() => {
        const b = { ...useStore.getState().board, updatedAt: Date.now() };
        persistBoard(useStore.getState().board).then(async (wrote) => {
          if (wrote) useStore.setState({ boards: await window.api.boards.list() });
        });
        // skip the IPC round-trip + disk write when the snapshot is identical
        const json = JSON.stringify({ name: b.name, nodes: b.nodes, edges: b.edges }, null, 2);
        if (b.id + json === lastSync) return;
        lastSync = b.id + json;
        window.api.workspace.sync(b.id, toMarkdown(b.name, b.nodes, b.edges), json);
      }, 700);
    });
    return () => { clearTimeout(t); unsub(); };
  }, []);

  return (
    <ReactFlowProvider>
      <div className="app">
        {sidebarOpen && (
          <>
            <div style={{ width: sidebarW }} className="panel-wrap"><Sidebar /></div>
            <Resizer side="left" width={sidebarW} min={150} max={380} onChange={(w) => setPanel({ sidebarW: w })} />
          </>
        )}
        <main>
          <TopBar />
          <Toolbar />
          <div className="stage">
            {view === "canvas" ? <Canvas /> : <Outline />}
            <AskPanel />
            <Toasts />
          </div>
        </main>
        {chatOpen && (
          <>
            <Resizer side="right" width={chatW} min={300} max={900} onChange={(w) => setPanel({ chatW: w })} />
            <div style={{ width: chatW }} className="panel-wrap"><ChatPanel /></div>
          </>
        )}
        {modal === "palette" && <Palette />}
        {modal === "settings" && <SettingsModal />}
        <DocView />
      </div>
    </ReactFlowProvider>
  );
}
