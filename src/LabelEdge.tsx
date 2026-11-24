import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { reportLabel, useLabelOffset } from "./labels";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, type EdgeProps } from "@xyflow/react";
import { useStore } from "./store";
import { LINK_TYPES, typeOf } from "./linktypes";
import type { NoteEdge } from "./types";

function LabelEdge(p: EdgeProps) {
  const edgeStyle = useStore((s) => s.edgeStyle);
  const labelsOnFocus = useStore((s) => s.labelsOnFocus);
  const d = (p.data ?? {}) as { st?: string; so?: number; to?: number; del?: boolean };
  const resolve = useStore((s) => s.resolveEdgeDel);
  const shift = (pos: string, o: number) => (pos === "left" || pos === "right" ? [0, o] : [o, 0]);
  const [sdx, sdy] = shift(p.sourcePosition, d.so ?? 0);
  const [tdx, tdy] = shift(p.targetPosition, d.to ?? 0);
  const geo = {
    sourceX: p.sourceX + sdx, sourceY: p.sourceY + sdy, sourcePosition: p.sourcePosition,
    targetX: p.targetX + tdx, targetY: p.targetY + tdy, targetPosition: p.targetPosition,
  };
  let path: string, lx: number, ly: number;
  if (edgeStyle === "line") [path, lx, ly] = getStraightPath(geo);
  else if (edgeStyle === "step") {
    // spread parallel lines: each edge gets its own vertical lane near the middle
    let h = 0;
    for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const lane = ((Math.abs(h) % 7) - 3) * 10;
    {
      const horiz = (p.sourcePosition === "right" && p.targetPosition === "left") || (p.sourcePosition === "left" && p.targetPosition === "right");
      const vert = (p.sourcePosition === "bottom" && p.targetPosition === "top") || (p.sourcePosition === "top" && p.targetPosition === "bottom");
      [path, lx, ly] = getSmoothStepPath({
        ...geo,
        borderRadius: 10,
        offset: 22,
        centerX: horiz ? (p.sourceX + p.targetX) / 2 + lane : undefined,
        centerY: vert ? (p.sourceY + p.targetY) / 2 + lane : undefined,
      });
    }
  } else [path, lx, ly] = getBezierPath(geo);
  const st = d.st ?? "";
  const editing = useStore((s) => s.editingEdge === p.id);
  const setEditing = useStore((s) => s.setEditingEdge);
  const setLabel = useStore((s) => s.updateEdgeLabel);
  const setType = useStore((s) => s.setEdgeType);
  const lt = typeOf({ label: p.label, data: p.data } as NoteEdge);
  const explicit = !!(p.data as { type?: string } | undefined)?.type;
  const label = typeof p.label === "string" ? p.label : "";
  const [draft, setDraft] = useState(label);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      setDraft(label);
      setTimeout(() => ref.current?.select(), 0);
    }
  }, [editing]); // eslint-disable-line

  const commit = () => {
    setLabel(p.id, draft.trim());
    setEditing(null);
  };
  const full = editing || p.selected || st === "hot";
  const shown = full || label.length <= 26 ? label : label.slice(0, 25) + "…";
  const show = editing || p.selected || d.del || (label && !(labelsOnFocus && st !== "hot") && st !== "dim");
  const off = useLabelOffset(p.id);
  useLayoutEffect(() => {
    if (!show) { reportLabel(p.id, null); return; }
    reportLabel(p.id, { x: lx, y: ly, w: Math.max(40, (editing ? draft.length : shown.length || 7) * 6.6 + 22), h: 24 });
  }, [show, lx, ly, shown, editing, draft, p.id]);
  useEffect(() => () => reportLabel(p.id, null), [p.id]);
  return (
    <>
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} interactionWidth={22} className={`le-${st || "n"} lt-${explicit ? lt : "auto"}${d.del ? " le-del" : ""}`} />
      {show && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label nodrag nopan lt-${explicit ? lt : "auto"}${p.selected ? " sel" : ""}${label ? "" : " blank"}`}
            style={{ transform: `translate(-50%,-50%) translate(${lx + (off?.dx ?? 0)}px,${ly + (off?.dy ?? 0)}px)` }}
            onDoubleClick={() => setEditing(p.id)}
            title={label.length > 26 ? label : undefined}
            onClick={() => !label && setEditing(p.id)}
          >
            {editing ? (
              <input
                ref={ref}
                autoFocus
                value={draft}
                size={Math.max(6, draft.length + 1)}
                placeholder="label"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(null);
                  e.stopPropagation();
                }}
              />
            ) : d.del ? (
              <span className="del-edge">
                <span>Remove link{label ? ` “${shown}”` : ""}?</span>
                <button title="Remove" onClick={(e) => (e.stopPropagation(), resolve(p.id, true))}><Icon name="check" size={12} /></button>
                <button title="Keep" onClick={(e) => (e.stopPropagation(), resolve(p.id, false))}><Icon name="x" size={12} /></button>
              </span>
            ) : (
              shown || (explicit && lt !== "leads_to" ? LINK_TYPES.find((x) => x.id === lt)!.label : "+ label")
            )}
            {p.selected && !editing && !d.del && (
              <span className="lt-pick" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                {LINK_TYPES.map((x) => (
                  <button key={x.id} className={`lt-${x.id}${lt === x.id ? " on" : ""}`} title={x.tip} onClick={() => setType(p.id, x.id)}>{x.label}</button>
                ))}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
export default memo(LabelEdge);
