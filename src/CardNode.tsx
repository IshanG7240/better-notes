import { memo, useEffect, useRef } from "react";
import { fullH } from "./heights";
import { Icon } from "./icons";
import { NodeResizeControl, useStore as useFlowStore, type NodeProps } from "@xyflow/react";
import { AllHandles } from "./Handles";
import { KINDS, type CardNodeT } from "./types";
import { useStore } from "./store";
import { Notes, Title } from "./Editable";
import { MdLines } from "./md";
import { matcher } from "./search";

function CardNode({ id, data, selected }: NodeProps<CardNodeT>) {
  const update = useStore((s) => s.updateData);
  const accept = useStore((s) => s.acceptGhosts);
  const reject = useStore((s) => s.rejectGhosts);
  const openRewrite = useStore((s) => s.openRewrite);
  const bump = useStore((s) => s.bumpFont);
  const pin = useStore((s) => s.togglePin);
  // match against this card's own data: no O(n) board scan per card on every store update
  const hit = useStore((s) => (s.searchQ.trim() ? (matcher(s.searchQ)({ type: "card", data } as CardNodeT) ? 1 : 2) : 0));
  const touched = useStore((s) => !!s.aiTouched[id]);
  // subscribe to the boolean, not the zoom value: otherwise every card re-renders on every zoom tick
  const compact = useFlowStore((s) => s.transform[2] < 0.55);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || compact) return;
    const ro = new ResizeObserver(() => fullH.set(id, el.offsetHeight));
    ro.observe(el);
    fullH.set(id, el.offsetHeight);
    return () => ro.disconnect();
  }, [id, compact]);
  const count = data.bullets.split("\n").filter((l) => l.trim()).length;

  return (
    <div ref={ref} className={`card kind-${data.kind}${selected ? " selected" : ""}${data.ghost ? " ghost" : ""}${data.pinned ? " pinned" : ""}${data.del ? " del" : ""}${data.proposal ? " prop" : ""}${touched ? " ai-touch" : ""}${hit === 1 ? " s-hit" : hit === 2 ? " s-dim" : ""}`} style={{ width: "100%", ["--cfs" as string]: data.fs ?? 1, minHeight: compact ? fullH.get(id) : undefined }}>
      <NodeResizeControl position="right" resizeDirection="horizontal" minWidth={200} maxWidth={900} className="card-resize" />
      <AllHandles />
      {data.del && (
        <div className="del-bar nodrag">
          <span title={data.del}>🗑 Suggested removal{data.del !== "Suggested removal" ? ` — ${data.del}` : ""}</span>
          <button title="Remove this card" onClick={() => accept(id)}><Icon name="check" size={12} /> Remove</button>
          <button title="Keep it" onClick={() => reject(id)}><Icon name="x" size={12} /> Keep</button>
        </div>
      )}
      {data.ghost && (
        <div className="ghost-actions nodrag">
          <button title="Accept" onClick={() => accept(id)}><Icon name="check" size={13} /></button>
          <button title="Reject" onClick={() => reject(id)}><Icon name="x" size={13} /></button>
        </div>
      )}
      <div className="card-tools nodrag">
        <button title="Smaller text (all selected cards if several)" onClick={() => bump(id, -0.15)}>A−</button>
        <button title="Reset text size" className={data.fs ? "set" : ""} onClick={() => bump(id, "reset")}>{data.fs ? `${Math.round(data.fs * 100)}%` : "Aa"}</button>
        <button title="Bigger text (all selected cards if several)" onClick={() => bump(id, 0.15)}>A+</button>
        <button title={data.pinned ? "Unpin (layout tools may move it)" : "Pin: layout tools will not move this card"} className={data.pinned ? "set" : ""} onClick={() => pin(id)}>{data.pinned ? "Unpin" : "Pin"}</button>
        <button title="Rewrite with AI (this card, or all selected)" onClick={() => openRewrite(id)}>✎ Rewrite</button>
      </div>
      {data.pinned && <span className="pin-badge" title="Pinned: layout tools leave this card where it is"><Icon name="pin" size={13} /></span>}
      <button
        className="kind nodrag"
        title="Click to change type"
        onClick={() => update(id, { kind: KINDS[(KINDS.indexOf(data.kind) + 1) % KINDS.length] })}
      >
        {data.kind}
      </button>
      {data.proposal ? (
        <div className="proposal">
          <div className="p-bar nodrag">
            <span>✎ Suggested rewrite</span>
            <button title="Accept" onClick={() => accept(id)}><Icon name="check" size={12} /> Accept</button>
            <button title="Reject" onClick={() => reject(id)}><Icon name="x" size={13} /></button>
          </div>
          <div className="p-title">{data.proposal.title || "Untitled"}</div>
          <MdLines value={data.proposal.bullets} />
          <details className="p-orig nodrag" onClick={(e) => e.stopPropagation()}>
            <summary>Original</summary>
            <div className="p-title dim">{data.title || "Untitled"}</div>
            <MdLines value={data.bullets} />
          </details>
        </div>
      ) : (
      <>
      <Title
        className={`title${compact ? " big" : ""}`}
        value={data.title}
        placeholder="Title"
        autoFocus={data.focus}
        onAutoFocused={() => update(id, { focus: false })}
        onChange={(v) => update(id, { title: v })}
      />
      {compact ? (
        count > 0 && <div className="more">+{count} points</div>
      ) : (
        <Notes value={data.bullets} onChange={(v) => update(id, { bullets: v })} />
      )}
      </>
      )}
    </div>
  );
}
export default memo(CardNode);
