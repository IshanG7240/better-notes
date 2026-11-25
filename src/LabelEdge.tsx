import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { reportLabel, useLabelOffset } from "./labels";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getStraightPath, useStore as useFlow, type EdgeProps } from "@xyflow/react";
import { stepRoute, type Side } from "./route";
import { useStore } from "./store";
import { LINK_TYPES, typeOf } from "./linktypes";
import type { NoteEdge } from "./types";

/** how much to enlarge arrowheads and labels so they stay readable when zoomed out (1 at 100% and closer; at most 3x;
 *  in steps, so zooming doesn't redraw every link on every frame) */
const boost = (zoom: number) => Math.min(3, Math.max(1, Math.round((1 / zoom) * 4) / 4));

function LabelEdge(p: EdgeProps) {
  const k = useFlow((s) => boost(s.transform[2]));
  const edgeStyle = useStore((s) => s.edgeStyle);
  const labelsOnFocus = useStore((s) => s.labelsOnFocus);
  const d = (p.data ?? {}) as { st?: string; so?: number; to?: number; del?: boolean; ay?: number; ax?: number };
  const resolve = useStore((s) => s.resolveEdgeDel);
  const shift = (pos: string, o: number) => (pos === "left" || pos === "right" ? [0, o] : [o, 0]);
  const [sdx, sdy] = shift(p.sourcePosition, d.so ?? 0);
  const [tdx, tdy] = shift(p.targetPosition, d.to ?? 0);
  const geo = {
    sourceX: p.sourceX + sdx, sourceY: p.sourceY + sdy, sourcePosition: p.sourcePosition,
    targetX: p.targetX + tdx, targetY: p.targetY + tdy, targetPosition: p.targetPosition,
  };
  // cards whose edges overlap: one straight line across (see straightAcross in lines.ts)
  if (d.ay !== undefined) geo.sourceY = geo.targetY = d.ay;
  if (d.ax !== undefined) geo.sourceX = geo.targetX = d.ax;
  let path: string, lx: number, ly: number;
  if (edgeStyle === "line") [path, lx, ly] = getStraightPath(geo);
  else if (edgeStyle === "step") {
    // parallel Z-links get their own middle lane (stepRoute keeps it between the two cards)
    let h = 0;
    for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const lane = ((Math.abs(h) % 7) - 3) * 8;
    [path, lx, ly] = stepRoute(geo.sourceX, geo.sourceY, p.sourcePosition as Side, geo.targetX, geo.targetY, p.targetPosition as Side, lane);
  } else [path, lx, ly] = getBezierPath(geo);
  const st = d.st ?? "";
  // the arrowhead: drawn here (not as an SVG marker) so it can be large, stay readable when zoomed out, and take the
  // link's colour. It points the way the line enters the target card (straight lines: along the line).
  const A = 13 * k;
  let ux = 0, uy = 0;
  if (edgeStyle === "line") { const dx = geo.targetX - geo.sourceX, dy = geo.targetY - geo.sourceY, l = Math.hypot(dx, dy) || 1; ux = dx / l; uy = dy / l; }
  else ({ left: () => (ux = 1), right: () => (ux = -1), top: () => (uy = 1), bottom: () => (uy = -1) } as Record<string, () => number>)[p.targetPosition]?.();
  const tx = geo.targetX, ty = geo.targetY, bx = tx - ux * A, by = ty - uy * A, wx = -uy * A * 0.55, wy = ux * A * 0.55;
  const head = `M${tx},${ty} L${bx + wx},${by + wy} L${bx - wx},${by - wy} Z`;
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
    reportLabel(p.id, { x: lx, y: ly, w: Math.max(40, (editing ? draft.length : shown.length || 7) * 7.2 + 24) * k, h: 26 * k });
  }, [show, lx, ly, shown, editing, draft, p.id, k]);
  useEffect(() => () => reportLabel(p.id, null), [p.id]);
  return (
    <>
      <BaseEdge id={p.id} path={path} interactionWidth={22} className={`le-${st || "n"} lt-${explicit ? lt : "auto"}${d.del ? " le-del" : ""}`} />
      {p.markerEnd && <path d={head} className={`edge-arrow le-${st || "n"} lt-${explicit ? lt : "auto"}${d.del ? " le-del" : ""}${p.selected ? " sel" : ""}`} />}
      {show && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label nodrag nopan lt-${explicit ? lt : "auto"}${p.selected ? " sel" : ""}${label ? "" : " blank"}`}
            style={{ transform: `translate(${lx + (off?.dx ?? 0)}px,${ly + (off?.dy ?? 0)}px) scale(${k}) translate(-50%,-50%)`, transformOrigin: "0 0" }}
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
