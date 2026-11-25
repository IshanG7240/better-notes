import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { Rich } from "./ChatPanel";
import { useStore } from "./store";
import type { AskAction } from "./types";

const ACTIONS: { id: AskAction; label: string; icon: string; tip: string; ph: string; sel?: boolean; chips?: string[] }[] = [
  { id: "ask", label: "Ask", icon: "sparkle", tip: "Chat about the board; it can also change it", ph: "Ask a question, or tell me what to change…" },
  { id: "expand", label: "Expand", icon: "expand", sel: true, tip: "Add child cards under the selected cards", ph: "Optional: what kind of children? (steps, options, examples…)", chips: ["Concrete steps", "Options to compare", "Examples"] },
  { id: "rewrite", label: "Rewrite", icon: "rewrite", sel: true, tip: "Reword the selected cards", ph: "How should I rewrite them? (blank = clearer and shorter)", chips: ["Shorter", "Clearer", "More formal", "Casual", "Fix grammar", "Bullet points"] },
  { id: "condense", label: "Condense", icon: "merge", tip: "Merge overlapping and fragment cards into fewer, denser ones (selected cards, a selected frame, or the whole board). Links move onto the merged cards; one click undoes it.", ph: "Optional: how hard? (merge only duplicates, about 5 cards…)", chips: ["Only duplicates", "Aggressive"] },
  { id: "group", label: "Cluster", icon: "canvas", sel: true, tip: "Sort the selected cards (or the whole board) into themed frames without changing them; select a frame to split it into sub-groups", ph: "Optional: how to cluster? (by theme, by owner, by phase…)", chips: ["By theme", "By phase", "By owner"] },
  { id: "split", label: "Split", icon: "expand", sel: true, tip: "Break the selected cards into smaller single-idea cards", ph: "Optional: how fine? (2 parts, one per bullet…)", chips: ["One idea per card", "Split by bullet"] },
  { id: "risks", label: "Risks", icon: "risk", tip: "What could go wrong?", ph: "Optional: focus area…" },
  { id: "gaps", label: "Gaps", icon: "gap", tip: "What is missing?", ph: "Optional: focus area…" },
  { id: "connect", label: "Links", icon: "link", tip: "Find missing connections", ph: "Optional: what to connect…" },
  { id: "dump", label: "From text", icon: "text", tip: "Paste notes or a doc: it becomes sections (frames) of cards in the order of your text", ph: "Paste your notes or document here…" },
  { id: "arrange", label: "Arrange", icon: "organize", tip: "Regroup the board (or 3+ selected cards) into titled sections in reading order. Card text is kept.", ph: "Optional: how to arrange? (by phase, problem → solution…)", chips: ["Problem → solution", "By phase", "By theme"] },
  { id: "doc", label: "Doc", icon: "doc", tip: "Write a document from the board", ph: "What kind? (PRD, summary, outline, email…)", chips: ["PRD", "Summary", "Outline", "Meeting notes"] },
];

const SUGGEST = ["Summarize this board", "What are the biggest risks here?", "What decisions are still open?", "What should I do next?"];

export default function AskPanel() {
  const open = useStore((s) => s.askOpen);
  const log = useStore((s) => s.askLog);
  const asking = useStore((s) => s.asking);
  const live = useStore((s) => s.askLive);
  const pending = useStore((s) => s.askPending);
  const stream = useStore((s) => s.askStream);
  const mode = useStore((s) => s.agentMode);
  const undo = useStore((s) => s.askUndo);
  const boardId = useStore((s) => s.board.id);
  const hasKey = useStore((s) => s.settings.hasKey);
  const detail = useStore((s) => s.importDetail);
  const action = useStore((s) => s.askAction);
  const nSel = useStore((s) => s.board.nodes.filter((n) => n.selected && n.type === "card").length);
  const draft = useStore((s) => s.askDraft);
  const [q, setQ] = useState("");
  useEffect(() => { if (draft) { setQ(draft); useStore.getState().setAskDraft(""); } }, [draft]);
  const act = ACTIONS.find((a) => a.id === action) ?? ACTIONS[0];
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => useStore.getState().loadAsk(boardId), [boardId]);
  useEffect(() => {
    window.api.ai.onProgress((p) => {
      if (p.apply) useStore.getState().applyAgentOps(p.apply);
      if (p.stream !== undefined) useStore.setState({ askStream: p.stream });
      const t = p.text;
      if (t) useStore.setState((s) => (s.asking ? { askLive: [...s.askLive.filter((x) => x !== "Thinking…" && x !== "Reading the board…"), t].slice(-6) } : {}));
    });
  }, []);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" }); }, [log.length, asking, live.length, stream.length > 0 && Math.floor(stream.length / 200)]);

  if (!open) return null;
  const st = useStore.getState();
  const needsText = action === "ask" || action === "dump";
  const send = (text: string) => {
    if (asking || (needsText && !text.trim())) return;
    st.runAction(action, text);
    setQ("");
    if (action !== "ask") st.setAskAction("ask");
  };
  return (
    <div className="ask glass" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ask-head">
        <Icon name="sparkle" size={18} />
        <span className="ask-title">Assistant</span>
        <span className="spacer" />
        {log.length > 0 && <button className="ask-x" title="Clear this conversation" onClick={() => st.clearAsk()}>Clear</button>}
        <button className="ask-x" title="Close" onClick={() => st.setAskOpen(false)}><Icon name="x" size={15} /></button>
      </div>
      <div className="ask-body" ref={box}>
        {!log.length && !asking && (
          <div className="ask-empty">
            <Icon name="sparkle" size={28} />
            <h3>What are you thinking about?</h3>
            <p>{hasKey ? "Ask anything about this board. I read your cards, answer in plain words, and can suggest new cards, links or edits you accept or reject." : "Add your Anthropic API key in Settings to use this."}</p>
            <div className="ask-sug">{SUGGEST.map((t) => <button key={t} onClick={() => send(t)} disabled={!hasKey}>{t}</button>)}</div>
          </div>
        )}
        {log.map((e) => (
          <div key={e.id} className="ask-turn">
            <div className="ask-q" title={e.full}>{e.q}</div>
            <div className={`ask-a${e.error ? " err" : ""}`}><Rich text={e.a} /></div>
            {!e.error && (undo?.entryId === e.id || e.added > 0 || e.edited > 0 || e.links > 0 || (e.removed ?? 0) > 0 || (e.unlinked ?? 0) > 0 || (e.grouped ?? 0) > 0 || e.steps > 0) && (
              <div className="ask-meta">
                {e.added > 0 && <span className="chip-s">+{e.added} card{e.added > 1 ? "s" : ""} {mode === "review" ? "suggested" : "added"}</span>}
                {e.edited > 0 && <span className="chip-s">✎ {e.edited} edit{e.edited > 1 ? "s" : ""} {mode === "review" ? "suggested" : "applied"}</span>}
                {e.links > 0 && e.added === 0 && <span className="chip-s">⤳ {e.links} link{e.links > 1 ? "s" : ""} {mode === "review" ? "suggested" : "added"}</span>}
                {(e.removed ?? 0) > 0 && <span className="chip-s del">🗑 {e.removed} removal{e.removed! > 1 ? "s" : ""} suggested</span>}
                {(e.grouped ?? 0) > 0 && <span className="chip-s">▢ {e.grouped} group{e.grouped! > 1 ? "s" : ""} made</span>}
                {(e.unlinked ?? 0) > 0 && <span className="chip-s del">✂ {e.unlinked} link removal{e.unlinked! > 1 ? "s" : ""} suggested</span>}
                {undo?.entryId === e.id && <button className="chip-s undo" title="Put the board back as it was before this turn" onClick={() => st.undoAsk()}>↩ Undo this turn</button>}
                {e.steps > 0 && <span className="chip-s dim">{e.steps} lookup{e.steps > 1 ? "s" : ""}</span>}
              </div>
            )}
          </div>
        ))}
        {asking && (
          <div className="ask-turn pending">
            {pending && <div className="ask-q">{pending}</div>}
            {stream && <div className="ask-a streaming"><Rich text={stream} /></div>}
            <div className="ask-live">
              {live.map((l, i) => <div key={i} className={i === live.length - 1 ? "now" : ""}>{i === live.length - 1 && <span className="spin" />}{l}{i === live.length - 1 && <button className="ask-stop" onClick={() => st.cancelAsk()}>Stop</button>}</div>)}
            </div>
          </div>
        )}
      </div>
      <div className="ask-acts">
        {ACTIONS.map((a) => (
          <button key={a.id} className={action === a.id ? "on" : ""} title={a.tip} disabled={asking || !hasKey} onClick={() => st.setAskAction(a.id)}>
            <Icon name={a.icon} size={14} />{a.label}
          </button>
        ))}
      </div>
      {action !== "ask" && (
        <div className="ask-ctx">
          {act.sel ? (nSel ? `Applies to ${nSel} selected card${nSel > 1 ? "s" : ""}` : "Select cards on the canvas first") : act.tip}
          {action === "dump" && (
            <span className="seg mini ask-detail" title="How many cards to make">
              {(["compact", "normal", "detailed"] as const).map((d) => <button key={d} className={detail === d ? "on" : ""} onClick={() => st.setImportDetail(d)}>{d[0].toUpperCase() + d.slice(1)}</button>)}
            </span>
          )}
          {act.chips && <span className="ask-presets">{act.chips.map((c) => <button key={c} onClick={() => setQ((v) => (v ? v + ", " : "") + c.toLowerCase())}>{c}</button>)}</span>}
        </div>
      )}
      <div className="ask-foot">
        <div className="ask-box">
        <textarea
          rows={action === "dump" ? 5 : 1}
          value={q}
          disabled={asking}
          placeholder={asking ? "Working…" : act.ph}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(q); }
            if (e.key === "Escape") st.setAskOpen(false);
          }}
        />
        <button className="primary send" disabled={asking || (needsText && !q.trim())} onClick={() => send(q)}>{action === "ask" ? "Send" : "Run"}</button>
        </div>
        <div className="ask-modes"><span>Changes:</span>
        <div className="ask-mode" title="How the assistant's changes land on the board">
          {([["review", "Suggest", "Everything it changes arrives as a suggestion you accept or reject."], ["auto", "Apply", "New cards, links and edits are applied right away (undoable). Removals still wait for your OK."], ["full", "Auto", "Everything, including removals, is applied right away. One click undoes the whole turn."]] as const).map(([m, l, t]) => (
            <button key={m} className={mode === m ? "on" : ""} title={t} onClick={() => st.setAgentMode(m)}>{l}</button>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}
