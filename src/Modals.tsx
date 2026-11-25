import { useEffect, useRef, useState, type ReactNode } from "react";
import { rewriteTargets, useStore } from "./store";
import { THEMES, type AskAction, type Theme } from "./types";
import { Icon } from "./icons";

const SWATCH: Record<Theme, string> = {
  dark: "linear-gradient(135deg,#1b1f2a,#0f1115)",
  light: "linear-gradient(135deg,#ffffff,#e4e8f0)",
  paper: "linear-gradient(135deg,#e3dac4,#cfc29f)",
  dusk: "linear-gradient(135deg,#5b4b8a,#e0866b)",
  glass: "linear-gradient(135deg,#6ea8ff,#c084fc)",
};

const money = (n: number) => (n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);

export function UsageChip() {
  const u = useStore((s) => s.usage);
  const [open, setOpen] = useState(false);
  if (!u) return null;
  const pct = u.budget > 0 ? Math.min(100, (u.total.cost / u.budget) * 100) : 0;
  const rows: [string, { input: number; output: number; cost: number; calls: number } | null][] = [
    ["Last call", u.last ? { ...u.last, calls: 1 } : null],
    ["This session", u.session],
    ["Today", u.today],
    ["All time", u.total],
  ];
  return (
    <div className="usage">
      <button className="ghostbtn usage-chip" onClick={() => setOpen(!open)} title="AI usage (API credits)">
        <span className="usage-cost">{money(u.total.cost)}</span>
        <span className="usage-sep">·</span>
        <span>{tok(u.total.input + u.total.output)} tok</span>
        {u.budget > 0 && <span className="usage-bar"><i style={{ width: `${pct}%` }} /></span>}
      </button>
      {open && (
        <>
          <div className="usage-backdrop" onClick={() => setOpen(false)} />
          <div className="usage-pop glass">
            <table>
              <thead><tr><th></th><th>in</th><th>out</th><th>cost</th><th>calls</th></tr></thead>
              <tbody>
                {rows.map(([name, b]) => (
                  <tr key={name}>
                    <td>{name}</td><td>{b ? tok(b.input) : "–"}</td><td>{b ? tok(b.output) : "–"}</td>
                    <td>{b ? money(b.cost) : "–"}</td><td>{b ? b.calls : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {u.budget > 0 && (
              <p className="muted small">{money(u.total.cost)} of ${u.budget} credits used · {money(Math.max(0, u.budget - u.total.cost))} left</p>
            )}
            <p className="muted small">Output includes thinking tokens. Estimates from list prices. The Claude Code chat is not counted here.</p>
          </div>
        </>
      )}
    </div>
  );
}

export function Toasts() {
  const error = useStore((s) => s.error);
  const note = useStore((s) => s.note);
  const clearToast = useStore((s) => s.clearToast);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(clearToast, 6000);
    return () => clearTimeout(t);
  }, [note, clearToast]);
  if (!error && !note) return null;
  return <div className={`toast glass${error ? " err" : ""}`} onClick={clearToast}>{error ?? note}</div>;
}

const COMMANDS: { id: AskAction | "space" | "organize" | "compact" | "frame" | "aigroup" | "help" | "guide"; label: string; hint: string; icon: string }[] = [
  { id: "dump", label: "Brain dump → board", hint: "paste messy text, get structure", icon: "🧠" },
  { id: "expand", label: "Expand selection", hint: "add children to selected cards", icon: "🌱" },
  { id: "rewrite", label: "Rewrite selection…", hint: "reword cards with AI", icon: "✎" },
  { id: "risks", label: "Find risks (devil's advocate)", hint: "what could go wrong", icon: "⚠️" },
  { id: "gaps", label: "Find gaps", hint: "what's missing / undecided", icon: "🕳️" },
  { id: "connect", label: "Connect the dots", hint: "suggest links between cards", icon: "🔗" },
  { id: "group", label: "Group selection into frame", hint: "Ctrl+G", icon: "▢" },
  { id: "aigroup", label: "AI: cluster into themed frames", hint: "assistant", icon: "▦" },
  { id: "condense", label: "AI: condense into fewer cards", hint: "assistant", icon: "⇊" },
  { id: "split", label: "AI: split cards", hint: "assistant", icon: "✂" },
  { id: "frame", label: "New empty frame", hint: "", icon: "▢＋" },
  { id: "space", label: "Space out (fix overlaps & gaps, nothing else moves)", hint: "Ctrl+E", icon: "↔" },
  { id: "organize", label: "Line up (linked cards as flows, fit frames)", hint: "Ctrl+L", icon: "▦" },
  { id: "compact", label: "Pack (rearrange tightly; selected frame, else board)", hint: "Ctrl+Shift+L", icon: "▤" },
  { id: "arrange", label: "AI: arrange into sections", hint: "assistant", icon: "▦" },
  { id: "doc", label: "Board → document", hint: "PRD, docs, outline, summary…", icon: "📄" },
  { id: "help", label: "Help: how everything works", hint: "? or F1", icon: "?" },
  { id: "guide", label: "Open the Getting started board", hint: "hands-on guide", icon: "🧭" },
];

export function Palette() {
  const st = useStore.getState();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const list = COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
  const custom = q.trim().length > 0;
  const total = list.length + (custom ? 1 : 0);

  const run = (idx: number) => {
    if (idx >= list.length) return (st.setModal(null), void st.ask(q.trim()));
    const c = list[idx];
    st.setModal(null);
    if (c.id === "split" || c.id === "dump" || c.id === "doc" || c.id === "rewrite" || c.id === "expand" || c.id === "risks" || c.id === "gaps" || c.id === "connect" || c.id === "arrange" || c.id === "condense") st.setAskAction(c.id);
    else if (c.id === "space") st.organizeLayout("space");
    else if (c.id === "help") return st.setModal("help");
    else if (c.id === "guide") return void st.addGuideBoard();
    else if (c.id === "organize") st.organizeLayout();
    else if (c.id === "compact") st.compactLayout();
    else if (c.id === "group") st.groupSelection();
    else if (c.id === "aigroup") st.setAskAction("group");
    else if (c.id === "frame") st.addFrame({ x: 0, y: 0 });
  };

  return (
    <div className="overlay" onMouseDown={() => st.setModal(null)}>
      <div className="palette glass" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={ref}
          value={q}
          placeholder="Search commands, or tell the AI what to do…"
          onChange={(e) => (setQ(e.target.value), setI(0))}
          onKeyDown={(e) => {
            if (e.key === "Escape") st.setModal(null);
            if (e.key === "ArrowDown") (e.preventDefault(), setI((i + 1) % Math.max(total, 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setI((i - 1 + total) % Math.max(total, 1)));
            if (e.key === "Enter" && total) run(i);
          }}
        />
        <div className="cmds">
          {list.map((c, idx) => (
            <div key={c.id} className={`cmd${idx === i ? " on" : ""}`} onMouseEnter={() => setI(idx)} onClick={() => run(idx)}>
              <span className="ic">{c.icon}</span><span className="cl">{c.label}</span><span className="ch">{c.hint}</span>
            </div>
          ))}
          {custom && (
            <div className={`cmd${i === list.length ? " on" : ""}`} onMouseEnter={() => setI(list.length)} onClick={() => run(list.length)}>
              <span className="ic">✦</span><span className="cl">Ask AI: “{q.trim()}”</span><span className="ch">selection or whole board</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function DocView() {
  const doc = useStore((s) => s.doc);
  const name = useStore((s) => s.board.name);
  const close = useStore((s) => s.closeDoc);
  const [copied, setCopied] = useState(false);
  if (doc === null) return null;
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([doc], { type: "text/markdown" }));
    a.download = `${(name || "board").replace(/[^\w-]+/g, "_")}.md`;
    a.click();
  };
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="modal wide tall glass" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Document</h3>
        <textarea className="docarea" readOnly value={doc} />
        <div className="row">
          <div className="spacer" />
          <button onClick={() => (navigator.clipboard.writeText(doc), setCopied(true), setTimeout(() => setCopied(false), 1500))}>
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button onClick={download}>Save .md</button>
          <button className="primary" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Slider({ name, hint, val, min, max, step, set, fmt }: { name: string; hint?: string; val: number; min: number; max: number; step: number; set: (n: number) => void; fmt?: (n: number) => string }) {
  return (
    <div className="set-row">
      <div className="top"><span className="nm">{name}</span><span className="val">{fmt ? fmt(val) : `${Math.round(val * 100)}%`}</span></div>
      <input type="range" min={min} max={max} step={step} value={val} onChange={(e) => set(Number(e.target.value))} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function SettingsModal() {
  const { settings, saveSettings, setModal } = useStore();
  const S = useStore();
  const [tab, setTab] = useState<"ai" | "canvas" | "input" | "look">("ai");
  const [key, setKey] = useState("");
  const [model, setModel] = useState(settings.model);
  const [effort, setEffort] = useState(settings.effort);
  const [budget, setBudget] = useState(String(settings.budget));
  const TABS = [["ai", "sparkle", "AI & usage"], ["canvas", "canvas", "Canvas"], ["input", "hand", "Touchpad & mouse"], ["look", "type", "Appearance"]] as const;
  return (
    <div className="overlay" onMouseDown={() => setModal(null)}>
      <div className="modal set glass" onMouseDown={(e) => e.stopPropagation()}>
        <div className="set-nav">
          <h3>Settings</h3>
          {TABS.map(([id, ic, label]) => (
            <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}><Icon name={ic} size={18} />{label}</button>
          ))}
        </div>
        <div className="set-main">
          <div className="set-body">
            {tab === "ai" && (
              <>
                <h4>AI & usage</h4>
                <div className="set-row">
                  <div className="top"><span className="nm">Anthropic API key</span>{settings.hasKey && <span className="ok">● saved</span>}</div>
                  <input type="password" value={key} placeholder={settings.hasKey ? "Leave blank to keep the current key" : "sk-ant-…"} onChange={(e) => setKey(e.target.value)} />
                  <p className="hint">Stored only on this laptop (OS keyring when available). Used by the toolbar's AI actions; the Claude chat panel uses your own Claude login.</p>
                </div>
                <div className="set-row">
                  <span className="nm">Model</span>
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="claude-opus-5-5">Claude Opus 5.5 — best quality</option>
                    <option value="claude-sonnet-5-5">Claude Sonnet 5.5 — faster, cheaper</option>
                    <option value="claude-haiku-5-5">Claude Haiku 5.5 — fastest</option>
                  </select>
                </div>
                <div className="set-row">
                  <span className="nm">Thinking effort</span>
                  <select value={effort} onChange={(e) => setEffort(e.target.value)}>
                    <option value="low">Low — snappy</option>
                    <option value="medium">Medium — balanced</option>
                    <option value="high">High — deeper</option>
                    <option value="xhigh">Extra high — slow, thorough</option>
                  </select>
                </div>
                <div className="set-row">
                  <span className="nm">Assistant autonomy</span>
                  <select value={S.agentMode} onChange={(e) => S.setAgentMode(e.target.value as "review" | "auto" | "full")}>
                    <option value="review">Suggest — everything it changes waits for your OK</option>
                    <option value="auto">Apply — adds and edits happen right away, removals wait (recommended)</option>
                    <option value="full">Autopilot — everything happens right away, one-click undo</option>
                  </select>
                  <p className="hint">Also switchable from the assistant panel. Applied changes can always be undone with the turn's Undo button or Ctrl+Z.</p>
                </div>
                <div className="set-row">
                  <span className="nm">Credit budget ($)</span>
                  <input type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} />
                  <p className="hint">Drives the progress bar next to the usage counter.</p>
                </div>
              </>
            )}
            {tab === "canvas" && (
              <>
                <h4>Canvas</h4>
                <Slider name="Default card width" hint="For cards you haven't resized by hand. Re-organizes the board." val={S.cardDefault} min={300} max={900} step={20} set={S.setCardDefault} fmt={(n) => `${n}px`} />
                <Slider name="Line opacity" val={S.lineOpacity} min={0.1} max={1} step={0.05} set={S.setLineOpacity} />
                <Slider name="Dimmed line opacity" hint="Focus mode: lines that don't touch the selected or hovered card." val={S.dimOpacity} min={0} max={0.6} step={0.01} set={S.setDimOpacity} />
              </>
            )}
            {tab === "input" && (
              <>
                <h4>Touchpad & mouse</h4>
                <p className="set-sub">Pan by click-and-drag. Everything below zooms.</p>
                <Slider name="Two-finger scroll" val={S.panSpeed} min={0.1} max={4} step={0.05} set={S.setPanSpeed} />
                <Slider name="Pinch" val={S.pinchSpeed} min={0.2} max={4} step={0.1} set={S.setPinchSpeed} />
                <Slider name="Mouse wheel" val={S.zoomSpeed} min={0.15} max={3} step={0.05} set={S.setZoomSpeed} />
              </>
            )}
            {tab === "look" && (
              <>
                <h4>Appearance</h4>
                <div className="set-row">
                  <span className="nm">Font</span>
                  <div className="fontpick" style={{ alignSelf: "flex-start" }}>
                    {([["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"]] as const).map(([f, l]) => (
                      <button key={f} className={S.fontFamily === f ? "on" : ""} style={{ fontFamily: f === "sans" ? "Inter, sans-serif" : f === "serif" ? "Georgia, serif" : "ui-monospace, monospace", padding: "7px 18px" }} onClick={() => S.setFontFamily(f)}>{l}</button>
                    ))}
                  </div>
                </div>
                <Slider name="Text size" hint="Scales cards, outline and chat. Individual cards can still be adjusted." val={S.fontScale} min={0.7} max={1.8} step={0.1} set={S.setFontScale} />
                <div className="set-row">
                  <span className="nm">Theme</span>
                  <div className="themes set-themes">
                    {THEMES.map((t) => (
                      <button key={t} className={`sw${S.theme === t ? " on" : ""}`} style={{ background: SWATCH[t] }} title={t} onClick={() => S.setTheme(t)} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="set-foot">
            {!settings.hasKey && <span className="set-skip">No key? Everything except the AI works without one.</span>}
            <button onClick={() => setModal(null)}>{settings.hasKey ? "Close" : "Skip for now"}</button>
            <button className="primary" onClick={() => saveSettings({ apiKey: key, model, effort, budget: Number(budget) || 0 })}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ---- Help ----
const K = ({ k }: { k: string }) => <>{k.split("+").map((x, i) => <span key={i}>{i > 0 && "+"}<kbd>{x}</kbd></span>)}</>;
const HELP: { id: string; icon: string; label: string; body: ReactNode }[] = [
  { id: "basics", icon: "card", label: "Basics", body: (
    <>
      <h4>Basics</h4>
      <p>A board is an endless canvas. You put your thinking on <b>cards</b>, connect them with <b>links</b> and group them in <b>frames</b>.</p>
      <ul>
        <li><b>New card:</b> double-click empty canvas, or press <K k="N" />. Right-click the canvas for more.</li>
        <li><b>Child card:</b> select a card and press <K k="Tab" />. It is linked to its parent.</li>
        <li><b>Edit:</b> click a card's title or its notes. <K k="Esc" /> when done.</li>
        <li><b>Move around:</b> drag empty canvas to pan; scroll or pinch to zoom; <b>Fit</b> shows everything.</li>
        <li><b>Select several:</b> <K k="Shift" /> + drag on empty canvas (or double-click and drag).</li>
        <li><b>Delete:</b> select and press <K k="Delete" />. <K k="Ctrl+Z" /> brings it back.</li>
        <li><b>Boards:</b> the sidebar on the left. <K k="F2" /> renames the current board.</li>
      </ul>
    </>
  ) },
  { id: "notes", icon: "text", label: "Cards & notes", body: (
    <>
      <h4>Cards & notes</h4>
      <ul>
        <li>Notes are plain text: one point per line. <b>**bold**</b>, <i>*italic*</i> and <code>`code`</code> work, and web links become clickable.</li>
        <li><code>- [ ]</code> at the start of a line makes a checkbox; click it on the card to tick it.</li>
        <li><K k="Tab" /> / <K k="Shift+Tab" /> while writing nests or un-nests the current point (or every selected line).</li>
        <li><K k="Enter" /> continues a list; <K k="Enter" /> on an empty point ends it. <K k="Shift+Enter" /> is a plain new line.</li>
        <li><b>Card types:</b> idea, question, risk, task, note. Click the type chip on a card, or select cards and press <K k="1" />–<K k="5" />.</li>
        <li><b>Pin</b> (toolbar) keeps a card where it is when you use the layout tools.</li>
      </ul>
    </>
  ) },
  { id: "links", icon: "link", label: "Links & frames", body: (
    <>
      <h4>Links & frames</h4>
      <ul>
        <li><b>Link two cards:</b> hover a card, drag from one of the dots on its edge and drop anywhere on the other card.</li>
        <li><b>Label a link:</b> double-click it. Click a link to choose its type: leads to, part of, supports, contradicts, risk for.</li>
        <li><K k="Ctrl+H" /> hides lines; <b>View</b> in the toolbar has more line options.</li>
        <li><b>Frame:</b> select cards and press <K k="Ctrl+G" />, or click <b>Frame</b> for an empty one. Drag a frame by its title and everything inside moves with it.</li>
        <li>A card belongs to the frame its centre is in. Frames can be collapsed into a single block.</li>
      </ul>
    </>
  ) },
  { id: "layout", icon: "spread", label: "Tidying up", body: (
    <>
      <h4>Tidying up</h4>
      <p>Three layout tools, gentlest first. Frames always fit their cards afterwards, and pinned cards never move.</p>
      <ul>
        <li><b>Space out</b> <K k="Ctrl+E" />: only nudges apart things that overlap or sit too close.</li>
        <li><b>Line up</b> <K k="Ctrl+L" />: lines up linked cards as a flow and fixes overlaps; things stay roughly in place.</li>
        <li><b>Pack</b> <K k="Ctrl+Shift+L" />: rearranges everything tightly in reading order (or just the selected frame).</li>
        <li><b>Undo:</b> <K k="Ctrl+Z" />, redo <K k="Ctrl+Shift+Z" /> or <K k="Ctrl+Y" />. Each board keeps its own history while the app is open.</li>
      </ul>
    </>
  ) },
  { id: "ai", icon: "sparkle", label: "AI assistant", body: (
    <>
      <h4>AI assistant (optional)</h4>
      <p>Needs your own Anthropic API key (⚙ Settings → AI &amp; usage). Everything else works without it. You pay Anthropic only for what you use; the running cost shows in the top bar.</p>
      <ul>
        <li><b>Ask:</b> type in the box at the top right, or open the panel with <K k="Ctrl+J" />. Select cards first to focus it on them.</li>
        <li><b>Buttons</b> in the panel do common jobs: <b>Expand</b> (child cards), <b>Arrange</b> (frames in reading order), <b>Cluster</b>, <b>Split</b>, <b>Condense</b>, <b>Rewrite</b>, <b>Risks</b>, <b>Gaps</b>, <b>Links</b>, <b>From text</b> (paste notes, get cards) and <b>Doc</b> (write a document).</li>
        <li><b>Give instructions:</b> type in the box first, then click a button, e.g. Expand + "focus on costs, put them in a frame", or Arrange + "only the selected cards".</li>
        <li><b>Suggest / Apply / Auto</b> (bottom of the panel): Suggest shows changes dashed until you accept (<K k="Enter" />) or reject (<K k="Esc" />); Apply makes them right away (removals still ask); Auto does removals too.</li>
        <li><b>Undo this turn</b> under an answer reverts everything that answer did.</li>
        <li>Pasting a long text onto the canvas offers to turn it into cards.</li>
      </ul>
    </>
  ) },
  { id: "keys", icon: "type", label: "Shortcuts", body: (
    <>
      <h4>Shortcuts</h4>
      <table className="keys">
        <tbody>
          {([
            ["Double-click canvas / N", "New card"], ["Tab", "Child card of the selected card"], ["1–5", "Card type: idea, question, risk, task, note"],
            ["Delete", "Delete selection"], ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"], ["Ctrl+G", "Frame around the selection"],
            ["Ctrl+E", "Space out"], ["Ctrl+L", "Line up"], ["Ctrl+Shift+L", "Pack"], ["Ctrl+H", "Hide / show lines"],
            ["Ctrl+F", "Search"], ["Ctrl+K", "Command palette"], ["Ctrl+J", "Assistant"], ["Enter / Esc", "Accept / reject AI suggestions"],
            ["F2", "Rename board"], ["Ctrl + / − / 0", "Zoom the whole app"], ["? or F1", "This guide"],
          ] as const).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
        </tbody>
      </table>
      <p className="muted">On a Mac, use Cmd instead of Ctrl.</p>
    </>
  ) },
  { id: "data", icon: "folder", label: "Your data", body: (
    <>
      <h4>Your data</h4>
      <ul>
        <li>Boards are saved automatically, only on this computer. Nothing goes online unless you use the AI (then the relevant cards go to Anthropic).</li>
        <li>Older versions of each board are kept for about a day.</li>
        <li><b>Share</b> saves a read-only copy as a single web page you can send to anyone or open on your phone.</li>
        <li>Data folder: <code>%APPDATA%\better-notes</code> on Windows, <code>~/.config/better-notes</code> on Linux, <code>~/Library/Application Support/better-notes</code> on macOS.</li>
      </ul>
    </>
  ) },
];

export function HelpModal() {
  const setModal = useStore((s) => s.setModal);
  const addGuideBoard = useStore((s) => s.addGuideBoard);
  const [tab, setTab] = useState(HELP[0].id);
  const cur = HELP.find((h) => h.id === tab)!;
  return (
    <div className="overlay" onMouseDown={() => setModal(null)}>
      <div className="modal set help glass" onMouseDown={(e) => e.stopPropagation()}>
        <div className="set-nav">
          <h3>Guide</h3>
          {HELP.map((h) => (
            <button key={h.id} className={tab === h.id ? "on" : ""} onClick={() => setTab(h.id)}><Icon name={h.icon} size={18} />{h.label}</button>
          ))}
        </div>
        <div className="set-main">
          <div className="set-body help-body">{cur.body}</div>
          <div className="set-foot">
            <button onClick={() => addGuideBoard()} title="A board of cards that walks you through everything by doing it">Open the Getting started board</button>
            <button className="primary" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
