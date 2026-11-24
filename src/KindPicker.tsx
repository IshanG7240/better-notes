import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "./store";
import { KINDS, type Kind } from "./types";

export const KIND_INFO: Record<Kind, string> = {
  idea: "A thought, option or proposal",
  question: "Something open that needs an answer",
  risk: "What could go wrong",
  task: "Something to do",
  note: "Background, facts, reference",
};

/**
 * Card type chip. One click opens all five types; one more click picks one (for every selected card when
 * this card is selected). Keys 1–5 do the same while the picker is open, or on the canvas with cards selected.
 */
export function KindPicker({ id, kind, variant = "chip" }: { id: string; kind: Kind; variant?: "chip" | "dot" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const setKind = useStore((s) => s.setKind);
  // the menu lives outside the canvas (portal), so it is full size at any zoom; place it under the chip, inside the window
  useLayoutEffect(() => {
    if (!open) { setAt(null); return; }
    const r = ref.current!.getBoundingClientRect();
    const mh = menu.current?.offsetHeight ?? 230, mw = menu.current?.offsetWidth ?? 320;
    const top = r.bottom + 6 + mh > window.innerHeight - 8 ? Math.max(8, r.top - 6 - mh) : r.bottom + 6;
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)), top });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setOpen(false);
    const away = () => setOpen(false); // canvas panned / zoomed: the chip moved
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
      const i = Number(e.key) - 1;
      if (i >= 0 && i < KINDS.length) { e.preventDefault(); e.stopPropagation(); setKind(id, KINDS[i]); setOpen(false); }
    };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("wheel", away, true);
    window.addEventListener("blur", away);
    return () => { window.removeEventListener("mousedown", down, true); window.removeEventListener("keydown", key, true); window.removeEventListener("wheel", away, true); window.removeEventListener("blur", away); };
  }, [open, id, setKind]);
  return (
    <div ref={ref} className={`kind-pick nodrag nopan nowheel${open ? " open" : ""} kp-${variant}`} onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button className={`kind kind-${kind}`} title={`Type: ${kind}. Click to change (or select cards and press 1–5)`} onClick={() => setOpen(!open)}>
        {variant === "chip" && <><i />{kind}<span className="kind-caret">▾</span></>}
      </button>
      {open && createPortal(
        <div ref={menu} className="kind-menu glass" role="menu" style={at ? { left: at.left, top: at.top } : { visibility: "hidden", left: 0, top: 0 }}>
          {KINDS.map((k, i) => (
            <button key={k} role="menuitem" className={`kind-opt kind-${k}${k === kind ? " on" : ""}`} onClick={() => { setKind(id, k); setOpen(false); }}>
              <i />
              <span className="ko-name">{k}</span>
              <span className="ko-tip">{KIND_INFO[k]}</span>
              <kbd>{i + 1}</kbd>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
