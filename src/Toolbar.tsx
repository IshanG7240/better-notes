import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore, rewriteTargets } from "./store";
import { isCard } from "./types";
import { shareBoard } from "./share";
import { Icon } from "./icons";

function Btn({ icon, label, onClick, disabled, tip, on }: { icon: string; label?: string; onClick: () => void; disabled?: boolean; tip?: string; on?: boolean }) {
  return (
    <button className={`tbtn${on ? " on" : ""}${label ? "" : " icon-only"}`} disabled={disabled} title={tip} onClick={onClick}>
      <Icon name={icon} />
      {label && <span>{label}</span>}
    </button>
  );
}
const Sep = () => <span className="tsep" />;

function Pop({ icon, label, children }: { icon: string; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="pop" ref={ref}>
      <button className={`tbtn${open ? " on" : ""}`} onClick={() => setOpen(!open)} title={label}>
        <Icon name={icon} />
        <span>{label}</span>
        <Icon name="chev" size={12} />
      </button>
      {open && <div className="pop-panel glass">{children}</div>}
    </div>
  );
}

function Seg<T extends string>({ value, opts, onChange }: { value: T; opts: [T, string, string?][]; onChange: (v: T) => void }) {
  return (
    <span className="seg mini">
      {opts.map(([v, l, t]) => (
        <button key={v} className={value === v ? "on" : ""} title={t} onClick={() => onChange(v)}>{l}</button>
      ))}
    </span>
  );
}

export default function Toolbar() {
  const st = useStore.getState();
  const view = useStore((s) => s.view);
  const busy = useStore((s) => s.busy);
  const nodes = useStore((s) => s.board.nodes);
  const selCards = nodes.filter((n) => n.selected && isCard(n));
  const selBoxes = nodes.filter((n) => n.selected).length;
  const selFrames = nodes.some((n) => n.selected && n.type === "frame");
  const rewritable = useStore((s) => rewriteTargets(s.board).length);
  const ghosts = useStore((s) => s.board.nodes.filter((n) => isCard(n) && (n.data.ghost || n.data.proposal || n.data.del)).length + s.board.edges.filter((e) => e.data?.ghost || e.data?.del).length);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const askOpen = useStore((s) => s.askOpen);
  const lineMode = useStore((s) => s.lineMode);
  const edgeStyle = useStore((s) => s.edgeStyle);
  const labelsOnFocus = useStore((s) => s.labelsOnFocus);
  const showMap = useStore((s) => s.showMap);
  const [q, setQ] = useState("");
  const canvas = view === "canvas";
  const allPinned = selCards.length > 0 && selCards.every((n) => isCard(n) && n.data.pinned);
  const scope = selBoxes ? `${selBoxes} selected` : "the board";
  const ask = () => {
    if (!q.trim() || busy) return;
    st.ask(q.trim());
    setQ("");
  };

  return (
    <div className="toolbar">
      {canvas && (
        <>
          <Btn icon="card" label="Card" tip="Add a card at the cursor (or press N)" onClick={() => st.addRootCard()} />
          <Btn icon="frame" label="Frame" tip="Add an empty frame" onClick={() => st.addFrame({ x: 0, y: 0 })} />
          <Btn icon="group" label="Group" tip="Wrap the selection in a frame · Ctrl+G" disabled={!selBoxes} onClick={() => st.groupSelection()} />
          <Sep />
          <Btn icon="organize" label="Tidy" tip="Keeps things where you put them: linked cards line up as a flow, overlaps get pushed apart, frames fit their cards · Ctrl+L (pinned cards stay put)" onClick={() => st.organizeLayout()} />
          <Btn icon="compact" label="Compact" tip={selFrames ? "Pack the selected frame tightly in reading order · Ctrl+Shift+L" : "Pack the whole board tightly: sections side by side, cards stacked in reading order · Ctrl+Shift+L"} onClick={() => st.compactLayout()} />
          <Btn icon="pin" label={allPinned ? "Unpin" : "Pin"} tip="Pinned cards keep their position when you Organize" disabled={!selCards.length} on={allPinned} onClick={() => st.togglePin()} />
          <Btn icon="fit" label="Fit" tip="Fit everything on screen" onClick={() => useStore.setState((s) => ({ fitTick: s.fitTick + 1 }))} />
          <Sep />
          <Btn icon="undo" tip="Undo · Ctrl+Z" disabled={!canUndo} onClick={() => st.undo()} />
          <Btn icon="redo" tip="Redo · Ctrl+Y" disabled={!canRedo} onClick={() => st.redo()} />
          <Btn
            icon={lineMode === "off" ? "eyeoff" : "eye"}
            label={lineMode === "off" ? "Show lines" : "Hide lines"}
            tip={lineMode === "off" ? "Connections hidden — click to show · Ctrl+H" : "Hide all connections · Ctrl+H"}
            on={lineMode === "off"}
            onClick={() => st.toggleLines()}
          />
          <Pop icon="lines" label="View">
            <div className="pop-row"><span>Connections</span>
              <Seg value={lineMode} onChange={st.setLineMode} opts={[["all", "All", "Show every line"], ["focus", "Focus", "Dim lines not touching the selected / hovered card"], ["selected", "Selected", "Only lines of the selected / hovered card"], ["off", "Off", "Hide all lines"]]} />
            </div>
            <div className="pop-row"><span>Line style</span>
              <Seg value={edgeStyle} onChange={st.setEdgeStyle} opts={[["curve", "Curved"], ["step", "Angled"], ["line", "Straight"]]} />
            </div>
            <div className="pop-row"><span>Card width{selCards.length ? " (selected)" : ""}</span>
              <span className="seg mini">
                {([["Narrow", 360], ["Normal", 480], ["Wide", 640], ["X-wide", 800]] as const).map(([l, w]) => (
                  <button key={l} onClick={() => st.setCardWidth(w)}>{l}</button>
                ))}
                <button title="Fit each card's width to its longest line (360–800 px)" onClick={() => st.autoFitWidth()}>Auto-fit</button>
              </span>
            </div>
            <label className="pop-check"><input type="checkbox" checked={labelsOnFocus} onChange={(e) => st.setLabelsOnFocus(e.target.checked)} /> Show labels only for the focused card</label>
            <label className="pop-check"><input type="checkbox" checked={showMap} onChange={(e) => st.setShowMap(e.target.checked)} /> Show minimap</label>
          </Pop>
          <Sep />
        </>
      )}
      <div className="tb-right">
        <Btn icon="doc" label="Share" tip="Save a read-only copy as a single web page you can open in any browser or on your phone" onClick={() => shareBoard()} />
      {ghosts > 0 && (
        <div className="ghostbar">
          <span>{ghosts} AI suggestion{ghosts > 1 ? "s" : ""}</span>
          <button className="primary" onClick={() => st.acceptGhosts()}>Accept all</button>
          <button onClick={() => st.rejectGhosts()}>Reject</button>
        </div>
      )}
      <Btn icon="sparkle" label="Assistant" tip="Open the assistant (chat history stays on this laptop) · Ctrl+J" on={askOpen} onClick={() => st.setAskOpen(!askOpen)} />
      <div className="tb-ask">
        <input
          value={q}
          disabled={!!busy}
          placeholder={`Ask about ${scope}…`}
          onFocus={() => st.setAskOpen(true)}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
            e.stopPropagation();
          }}
        />
        <button className="primary" disabled={!q.trim() || !!busy} onClick={ask}>Ask</button>
      </div>
      </div>
    </div>
  );
}
