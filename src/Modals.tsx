import { useEffect, useRef, useState } from "react";
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

const COMMANDS: { id: AskAction | "space" | "organize" | "compact" | "frame" | "aigroup"; label: string; hint: string; icon: string }[] = [
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
    <div className="overlay" onMouseDown={() => settings.hasKey && setModal(null)}>
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
            {settings.hasKey && <button onClick={() => setModal(null)}>Close</button>}
            <button className="primary" onClick={() => saveSettings({ apiKey: key, model, effort, budget: Number(budget) || 0 })}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

