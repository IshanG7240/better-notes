import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import { useReactFlow } from "@xyflow/react";
import { useStore } from "./store";
import { matcher } from "./search";
import { boxRect } from "./layout";

/** Ctrl+F: highlight matching cards, dim the rest, Enter / Shift+Enter to jump between hits. */
export default function SearchBar() {
  const open = useStore((s) => s.searchOpen);
  const q = useStore((s) => s.searchQ);
  const nodes = useStore((s) => s.board.nodes);
  const rf = useReactFlow();
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => (open && q.trim() ? nodes.filter(matcher(q)) : []), [open, q, nodes]);

  useEffect(() => { if (open) { ref.current?.focus(); ref.current?.select(); } }, [open]);
  useEffect(() => setI(0), [q]);

  const jump = (k: number) => {
    if (!hits.length) return;
    const n = hits[((k % hits.length) + hits.length) % hits.length];
    const r = boxRect(n);
    rf.setCenter(r.x + r.w / 2, r.y + r.h / 2, { zoom: Math.max(rf.getZoom(), 0.7), duration: 250 });
    useStore.getState().selectOnly(n.id);
  };
  // first hit scrolls into view as you type
  useEffect(() => { if (hits.length) jump(0); /* eslint-disable-next-line */ }, [q, hits.length > 0]);

  if (!open) return null;
  const st = useStore.getState();
  return (
    <div className="searchbar glass" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        value={q}
        placeholder="Find in this board…"
        onChange={(e) => st.setSearch(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") st.setSearchOpen(false);
          if (e.key === "Enter") { const k = e.shiftKey ? i - 1 : i + 1; setI(k); jump(k); }
        }}
      />
      <span className="sb-n">{q.trim() ? (hits.length ? `${(((i % hits.length) + hits.length) % hits.length) + 1}/${hits.length}` : "no match") : ""}</span>
      <button title="Previous (Shift+Enter)" disabled={!hits.length} onClick={() => { setI(i - 1); jump(i - 1); }}>↑</button>
      <button title="Next (Enter)" disabled={!hits.length} onClick={() => { setI(i + 1); jump(i + 1); }}>↓</button>
      <button title="Close (Esc)" onClick={() => st.setSearchOpen(false)}><Icon name="x" size={14} /></button>
    </div>
  );
}
