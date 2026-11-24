import { useMemo, useState } from "react";
import { Icon } from "./icons";
import { useStore } from "./store";
import { buildTree, toMarkdown, type TreeItem } from "./outlineTree";
import { Notes, Title } from "./Editable";
import { KindPicker } from "./KindPicker";

function Item({ it, depth }: { it: TreeItem; depth: number }) {
  const update = useStore((s) => s.updateData);
  const addChild = useStore((s) => s.addChildSilently);
  const select = useStore((s) => s.selectOnly);
  const remove = useStore((s) => s.removeCard);
  const n = it.node;
  return (
    <div className="ol-item" style={{ marginLeft: depth ? 22 : 0 }}>
      <div className={`ol-row kind-${n.data.kind}${n.selected ? " sel" : ""}${n.data.ghost ? " ghost" : ""}`} style={{ ["--cfs" as string]: n.data.fs ?? 1 }} onMouseDown={() => select(n.id)}>
        <KindPicker id={n.id} kind={n.data.kind} variant="dot" />
        <div className="ol-main">
          <div className="ol-titleline">
            {it.edgeLabel && <span className="ol-edge">{it.edgeLabel} →</span>}
            <Title className="ol-title" value={n.data.title} placeholder="Untitled" onChange={(v) => update(n.id, { title: v })} />
            {it.frame && <span className="ol-frame">{it.frame}</span>}
            <span className="ol-actions">
              <button title="Smaller text" onClick={() => useStore.getState().bumpFont(n.id, -0.15)}>A−</button>
              <button title="Bigger text" onClick={() => useStore.getState().bumpFont(n.id, 0.15)}>A+</button>
              <button title="Add child" onClick={() => addChild(n.id)}><Icon name="plus" size={13} /></button>
              <button title="Delete card" onClick={() => remove(n.id)}><Icon name="x" size={13} /></button>
            </span>
          </div>
          <Notes value={n.data.bullets} onChange={(v) => update(n.id, { bullets: v })} />
        </div>
      </div>
      {it.children.map((c) => (
        <Item key={c.node.id} it={c} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function Outline() {
  const nodes = useStore((s) => s.board.nodes);
  const edges = useStore((s) => s.board.edges);
  const name = useStore((s) => s.board.name);
  const addRoot = useStore((s) => s.addRootCard);
  const tree = useMemo(() => buildTree(nodes, edges), [nodes, edges]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="outline">
      <div className="ol-head">
        <h2>{name || "Untitled"}</h2>
        <div className="spacer" />
        <button onClick={addRoot}><Icon name="plus" size={13} /> Card</button>
        <button
          onClick={() => {
            navigator.clipboard.writeText(toMarkdown(name, nodes, edges));
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? "Copied ✓" : "Copy as Markdown"}
        </button>
      </div>
      {tree.length === 0 && <p className="muted">Nothing here yet. Add a card, or paste a brain dump.</p>}
      {tree.map((t) => (
        <Item key={t.node.id} it={t} depth={0} />
      ))}
    </div>
  );
}
