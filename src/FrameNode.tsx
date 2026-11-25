import { memo, useState } from "react";
import { Icon } from "./icons";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { AllHandles } from "./Handles";
import type { FrameNodeT } from "./types";
import { useStore } from "./store";

export const FRAME_COLORS = ["#7c9cff", "#5ad1a0", "#f5c451", "#ff8a65", "#c58bff", "#6ad4e8"];

function FrameNode({ id, data, selected }: NodeProps<FrameNodeT>) {
  const upd = useStore((s) => s.updateFrame);
  const bump = useStore((s) => s.bumpFont);
  const toggle = useStore((s) => s.toggleCollapse);
  const [editing, setEditing] = useState(false);
  const count = useStore((s) => (data.collapsed ? s.board.nodes.filter((n) => n.type === "card" && data.members?.includes(n.id)).length : 0));
  const c = FRAME_COLORS[data.color % FRAME_COLORS.length];
  return (
    <div className={`frame${data.collapsed ? " collapsed" : ""}${data.ghost ? " ghost" : ""}`} style={{ ["--fc" as string]: c, ["--cfs" as string]: data.fs ?? 1 }}>
      <NodeResizer
        isVisible={!!selected && !data.collapsed}
        minWidth={200}
        minHeight={120}
        lineClassName="frame-line"
        handleClassName="frame-handle"
        // your size sticks (fitting only grows it from now on); if it grew into its neighbours, they step aside
        onResizeEnd={() => { upd(id, { sized: true }); setTimeout(() => useStore.getState().makeRoom([id]), 0); }}
      />
      <AllHandles hidden />
      <div className="frame-head">
        <button className="frame-chev nodrag" title={data.collapsed ? "Expand group" : "Collapse group into one block"} onClick={() => toggle(id)}><Icon name={data.collapsed ? "chevR" : "chev"} size={13} /></button>
        <button className="frame-dot nodrag" title="Change color" onClick={() => upd(id, { color: data.color + 1 })} />
        {editing || data.focus ? (
          <input
            className="frame-title nodrag nopan"
            value={data.title}
            autoFocus
            placeholder="Group name"
            onFocus={(e) => { e.target.select(); if (data.focus) upd(id, { focus: false }); setEditing(true); }}
            onChange={(e) => upd(id, { title: e.target.value })}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLElement).blur(); e.stopPropagation(); }}
          />
        ) : (
          // a plain label: click selects the frame, drag moves it, double-click renames it
          <span className={`frame-title frame-label${data.title ? "" : " empty"}`} title="Click to select · drag to move · double-click to rename" onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}>
            {data.title || "Group name"}
          </span>
        )}
        {data.collapsed && <span className="frame-count">{count} card{count === 1 ? "" : "s"}</span>}
        {selected && !data.collapsed && (
          <span className="frame-fs nodrag">
            <button onClick={() => bump(id, -0.15)} title="Smaller name">A−</button>
            <button onClick={() => bump(id, 0.15)} title="Bigger name">A+</button>
          </span>
        )}
      </div>
    </div>
  );
}
export default memo(FrameNode);
