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

/** Multi-line markdown note: rendered view, click to edit. */
export function Notes({
  value, onChange, placeholder = "Notes",
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const startedEmpty = useRef(false);
  const click = useCleanClick(() => { startedEmpty.current = !value.trim(); setEditing(true); });
  if (editing) return <LineEditor value={value} onChange={onChange} placeholder={placeholder} tall={startedEmpty.current} onDone={() => setEditing(false)} />;
  return (
    <div className="notes-view" {...click}>
      {value.trim() ? <MdLines value={value} onToggle={(i) => onChange(toggleLine(value, i))} /> : <div className="empty">{placeholder}</div>}
    </div>
  );
}

// ---- the notes editor ----
// A textarea spaces every line the same, so paragraphs run together while writing. This editor keeps one
// block per line (<div>), which CSS can space like the rendered card. The text is still plain: the value is
// the lines joined by "\n", and every edit that changes structure goes through the same string logic as before.

const esc = (t: string) => t.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
const paint = (el: HTMLElement, v: string) => {
  el.innerHTML = v.split("\n").map((l) => `<div>${l ? esc(l) : "<br>"}</div>`).join("");
};
/** The text, if the DOM is still one plain block per line (null if the browser restructured it). */
const readLines = (el: HTMLElement): string | null => {
  const kids = Array.from(el.childNodes);
  if (!kids.length || !kids.every((k) => k.nodeName === "DIV" && !(k as Element).querySelector("div, p"))) return null;
  return kids.map((k) => k.textContent ?? "").join("\n").replace(/ /g, " ");
};
/** Text offset of a DOM position (node, offset) inside the editor. */
function offsetOf(el: HTMLElement, node: Node, off: number): number {
  const lines = Array.from(el.children);
  const starts: number[] = [];
  let acc = 0;
  for (const d of lines) { starts.push(acc); acc += (d.textContent ?? "").length + 1; }
  if (node === el) return off >= lines.length ? Math.max(0, acc - 1) : starts[off];
  let d: Node | null = node;
  while (d && d.parentNode !== el) d = d.parentNode;
  const i = lines.indexOf(d as Element);
  if (i < 0) return 0;
  const r = document.createRange();
  r.setStart(d!, 0);
  r.setEnd(node, off);
  return starts[i] + r.toString().length;
}
function getSel(el: HTMLElement): { a: number; b: number } | null {
  const s = window.getSelection();
  if (!s || !s.rangeCount || !s.anchorNode || !s.focusNode || !el.contains(s.anchorNode) || !el.contains(s.focusNode)) return null;
  const x = offsetOf(el, s.anchorNode, s.anchorOffset), y = offsetOf(el, s.focusNode, s.focusOffset);
  return { a: Math.min(x, y), b: Math.max(x, y) };
}
function setSel(el: HTMLElement, a: number, b = a) {
  const pos = (o: number): [Node, number] => {
    const lines = Array.from(el.children);
    let acc = 0;
    for (const d of lines) {
      const len = (d.textContent ?? "").length;
      if (o <= acc + len) {
        let k = o - acc;
        const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
        for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
          if (k <= t.length) return [t, k];
          k -= t.length;
        }
        return [d, 0];
      }
      acc += len + 1;
    }
    const last = lines[lines.length - 1] ?? el;
    return last !== el ? [last, last.childNodes.length] : [el, 0];
  };
  const [an, ao] = pos(a), [fn, fo] = pos(b);
  window.getSelection()?.setBaseAndExtent(an, ao, fn, fo);
}

function LineEditor({ value, onChange, placeholder, tall, onDone }: { value: string; onChange: (v: string) => void; placeholder: string; tall: boolean; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cur = useRef(value); // the text as the editor has it now
  const past = useRef<{ v: string; a: number; b: number }[]>([]);
  const future = useRef<{ v: string; a: number; b: number }[]>([]);
  const lastSnap = useRef(0);
  const [blank, setBlank] = useState(!value);

  useLayoutEffect(() => {
    const el = ref.current!;
    paint(el, value);
    el.focus();
    setSel(el, value.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const snapshot = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastSnap.current < 700) return; // typing bursts undo together
    lastSnap.current = force ? 0 : now;
    const s = getSel(ref.current!) ?? { a: cur.current.length, b: cur.current.length };
    past.current.push({ v: cur.current, ...s });
    if (past.current.length > 200) past.current.shift();
    future.current = [];
  };
  const publish = (v: string) => { cur.current = v; setBlank(!v); onChange(v); };
  /** Replace the whole text (structure changed): repaint and put the caret / selection at [a, b]. */
  const commit = (v: string, a: number, b = a) => {
    snapshot(true);
    const el = ref.current!;
    paint(el, v);
    setSel(el, a, b);
    publish(v);
  };
  const restore = (from: typeof past, to: typeof past) => {
    const h = from.current.pop();
    if (!h) return;
    const el = ref.current!;
    const s = getSel(el) ?? { a: 0, b: 0 };
    to.current.push({ v: cur.current, ...s });
    paint(el, h.v);
    setSel(el, h.a, h.b);
    publish(h.v);
  };

  const onInput = () => {
    const el = ref.current!;
    let v = readLines(el);
    if (v === null) {
      // the browser left something other than one block per line (select-all + type, say): rebuild
      v = (el.innerText ?? "").replace(/\n$/, "").replace(/ /g, " ");
      paint(el, v);
      setSel(el, v.length);
    }
    snapshot(false);
    publish(v);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") { e.preventDefault(); el.blur(); return onDone(); } // close even if the window has no OS focus (blur may not fire)
    if (mod && !e.altKey && e.key.toLowerCase() === "z") {
      e.preventDefault(); e.stopPropagation();
      return e.shiftKey ? restore(future, past) : restore(past, future);
    }
    if (mod && !e.altKey && e.key.toLowerCase() === "y") { e.preventDefault(); e.stopPropagation(); return restore(future, past); }
    if (mod && ["b", "i", "u"].includes(e.key.toLowerCase())) return e.preventDefault(); // no rich formatting: the text is markdown
    const v = cur.current;
    const s = getSel(el);
    if (!s) return;
    const { a, b } = s;
    const ls = v.lastIndexOf("\n", a - 1) + 1;
    if (e.key === "Tab") {
      // nest / un-nest every line touched by the cursor or selection
      e.preventDefault();
      e.stopPropagation();
      const le = v.indexOf("\n", Math.max(a, b - (b > a && v[b - 1] === "\n" ? 1 : 0)));
      const end = le < 0 ? v.length : le;
      let first = 0, total = 0;
      const out = v.slice(ls, end).split("\n").map((l, i) => {
        const nl = e.shiftKey ? l.replace(/^(\t| {1,2})/, "") : "  " + l;
        if (i === 0) first = nl.length - l.length;
        total += nl.length - l.length;
        return nl;
      });
      const na = Math.max(ls, a + first);
      commit(v.slice(0, ls) + out.join("\n") + v.slice(end), na, a === b ? na : Math.max(na, b + total));
    } else if (e.key === "Enter" && !mod) {
      e.preventDefault();
      // continue list markers (Shift+Enter: plain new line)
      const line = v.slice(ls, a);
      const m = e.shiftKey ? null : /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s/.exec(line);
      if (m && a === b && line.trim() === m[0].trim()) {
        if (m[1]) {
          // empty sub-point -> step out one level (like Google Docs)
          const out = line.replace(/^(\t| {1,2})/, "");
          return commit(v.slice(0, ls) + out + v.slice(a), ls + out.length);
        }
        return commit(v.slice(0, ls) + v.slice(a), ls); // empty bullet -> end the list
      }
      const ind = m || e.shiftKey ? null : /^[\t ]+/.exec(line); // plain nested line: the next one stays at its level
      if (ind && a === b && !line.trim()) {
        // empty indented line -> step out one level
        const out = line.replace(/^(\t| {1,2})/, "");
        return commit(v.slice(0, ls) + out + v.slice(a), ls + out.length);
      }
      const ins = ind ? "\n" + ind[0] : m ? `\n${m[1]}${/\d/.test(m[2]) ? `${parseInt(m[2]) + 1}${m[2].slice(-1)}` : m[2]}${m[3] ? " [ ]" : ""} ` : "\n";
      commit(v.slice(0, a) + ins + v.slice(b), a + ins.length);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault(); // plain text only, split into lines like everything else
    const t = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    const s = getSel(e.currentTarget) ?? { a: cur.current.length, b: cur.current.length };
    commit(cur.current.slice(0, s.a) + t + cur.current.slice(s.b), s.a + t.length);
  };

  return (
    <div
      ref={ref}
      className={`notes-edit nodrag nopan nowheel nokey${tall ? " new" : ""}${blank ? " blank" : ""}`}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline
      data-ph={placeholder}
      onInput={onInput}
      onKeyDown={onKey}
      onPaste={onPaste}
      onDrop={(e) => e.preventDefault()}
      onBlur={onDone}
    />
  );
}
