import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Inline, MdLines, toggleLine } from "./md";

/** Click-to-edit. Uses the click event (not mouseup): React Flow's drag handling swallows mouseup,
 *  and it also suppresses the click after a real drag, so dragging a card never starts editing. */
function useCleanClick(onClick: () => void) {
  return {
    onClick: (e: React.MouseEvent) => {
      if (!(e.target as HTMLElement).closest("a, input")) onClick();
    },
  };
}

/** Single-line text: shows plain text, click to edit. Draggable while not editing. */
export function Title({
  value, onChange, placeholder, className, autoFocus, onAutoFocused, onEnter,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
  autoFocus?: boolean; onAutoFocused?: () => void; onEnter?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) {
      setEditing(true);
      onAutoFocused?.();
    }
  }, [autoFocus]); // eslint-disable-line
  useEffect(() => {
    if (!editing) return;
    // a just-created node stays visibility:hidden until React Flow measures it, and hidden inputs can't take focus: retry
    let tries = 0, raf = 0;
    const go = () => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (document.activeElement !== el && tries++ < 20) raf = requestAnimationFrame(go);
    };
    go();
    return () => cancelAnimationFrame(raf);
  }, [editing]);
  const click = useCleanClick(() => setEditing(true));
  if (editing)
    return (
      <input
        ref={ref}
        className={`${className ?? ""} title-edit nodrag nopan`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            setEditing(false);
            onEnter?.();
          }
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  return (
    <div className={`${className ?? ""} title-view${value ? "" : " empty"}`} {...click}>
      {value ? (/https?:\/\//.test(value) ? <Inline text={value} /> : value) : placeholder}
    </div>
  );
}

/** Multi-line markdown note: rendered view, click to edit in an auto-growing textarea. */
export function Notes({
  value, onChange, placeholder = "Notes",
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const startedEmpty = useRef(false);
  const click = useCleanClick(() => { startedEmpty.current = !value.trim(); setEditing(true); });

  useLayoutEffect(() => {
    const el = ref.current;
    if (editing && el) {
      el.style.height = "0px";
      el.style.height = el.scrollHeight + "px";
    }
  }, [editing, value]);
  useEffect(() => {
    if (editing && ref.current) {
      const el = ref.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === "Escape") return el.blur();
    const a = el.selectionStart;
    const ls = el.value.lastIndexOf("\n", a - 1) + 1;
    if (e.key === "Tab") {
      // nest / un-nest every line touched by the cursor or selection
      e.preventDefault();
      e.stopPropagation();
      const b = el.selectionEnd;
      const le = el.value.indexOf("\n", Math.max(a, b - (b > a && el.value[b - 1] === "\n" ? 1 : 0)));
      const end = le < 0 ? el.value.length : le;
      const block = el.value.slice(ls, end).split("\n");
      let first = 0, total = 0;
      const out = block.map((l, i) => {
        const nl = e.shiftKey ? l.replace(/^(\t| {1,2})/, "") : "  " + l;
        const d = nl.length - l.length;
        if (i === 0) first = d;
        total += d;
        return nl;
      });
      onChange(el.value.slice(0, ls) + out.join("\n") + el.value.slice(end));
      const na = Math.max(ls, a + first), nb = b + total;
      requestAnimationFrame(() => el.setSelectionRange(na, a === b ? na : Math.max(na, nb)));
    } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      // continue list markers
      const line = el.value.slice(ls, a);
      const m = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s/.exec(line);
      if (m) {
        e.preventDefault();
        if (line.trim() === m[0].trim()) {
          if (m[1]) {
            // empty sub-point -> step out one level (like Google Docs)
            const out = line.replace(/^(\t| {1,2})/, "");
            onChange(el.value.slice(0, ls) + out + el.value.slice(a));
            requestAnimationFrame(() => el.setSelectionRange(ls + out.length, ls + out.length));
            return;
          }
          // empty bullet -> end the list
          onChange(el.value.slice(0, ls) + el.value.slice(a));
          return;
        }
        const marker = /\d/.test(m[2]) ? `${parseInt(m[2]) + 1}${m[2].slice(-1)}` : m[2];
        const ins = `\n${m[1]}${marker}${m[3] ? " [ ]" : ""} `;
        onChange(el.value.slice(0, a) + ins + el.value.slice(a));
        requestAnimationFrame(() => el.setSelectionRange(a + ins.length, a + ins.length));
      }
    }
  };

  if (editing)
    return (
      <textarea
        ref={ref}
        className={`notes-edit nodrag nopan nowheel${startedEmpty.current ? " new" : ""}`}
        value={value}
        rows={2}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={onKey}
      />
    );
  return (
    <div className="notes-view" {...click}>
      {value.trim() ? <MdLines value={value} onToggle={(i) => onChange(toggleLine(value, i))} /> : <div className="empty">{placeholder}</div>}
    </div>
  );
}
