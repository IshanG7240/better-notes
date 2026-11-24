import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useStore } from "./store";
import { Icon } from "./icons";
import { Inline } from "./md";

const termTheme = () => {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { background: v("--term-bg", "#0f1115"), foreground: v("--term-fg", "#e6e9ef"), cursor: v("--accent", "#7c9cff"), selectionBackground: v("--term-sel", "#3b4468") };
};

function TerminalView() {
  const boardId = useStore((s) => s.board.id);
  const theme = useStore((s) => s.theme);
  const fontScale = useStore((s) => s.fontScale);
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [ended, setEnded] = useState(false);
  const [nonce, setNonce] = useState(0);
  const dirs = () => ((window.api.prefs.all().chatDirs as Record<string, string> | undefined) ?? {});
  const [dir, setDirState] = useState<string>(() => dirs()[boardId] ?? "");
  useEffect(() => setDirState(dirs()[boardId] ?? ""), [boardId]);
  const setDir = (d: string) => {
    const all = { ...dirs() };
    if (d) all[boardId] = d; else delete all[boardId];
    window.api.prefs.all().chatDirs = all;
    window.api.prefs.set("chatDirs", all);
    setDirState(d);
  };
  const pick = async () => {
    const d = await window.api.chat.pickDir(dir || undefined);
    if (!d || d === dir) return;
    await window.api.chat.kill(boardId); // a session keeps the folder it started in, so start a fresh one there
    setDir(d);
    setNonce((n) => n + 1);
  };
  const clearDir = async () => {
    await window.api.chat.kill(boardId);
    setDir("");
    setNonce((n) => n + 1);
  };

  useEffect(() => {
    const t = new Terminal({
      fontFamily: '"JetBrains Mono", "DejaVu Sans Mono", ui-monospace, monospace',
      fontSize: Math.round(13 * useStore.getState().fontScale),
      lineHeight: 1.18,
      fontWeight: "400",
      fontWeightBold: "600",
      minimumContrastRatio: 4,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: termTheme(),
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current!);
    term.current = t;
    fit.current = f;
    f.fit();
    const offData = window.api.chat.onData((d) => t.write(d));
    const offExit = window.api.chat.onExit(() => setEnded(true));
    t.onData((d) => window.api.chat.write(d));
    const ro = new ResizeObserver(() => {
      try {
        f.fit();
        window.api.chat.resize(t.cols, t.rows);
      } catch {}
    });
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      offData();
      offExit();
      window.api.chat.close();
      t.dispose();
    };
  }, []);

  useEffect(() => {
    const t = term.current;
    if (!t) return;
    setEnded(false);
    t.reset();
    fit.current?.fit();
    window.api.chat.open({ boardId, cols: t.cols, rows: t.rows, dir: dir || undefined });
  }, [boardId, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (term.current) term.current.options.theme = termTheme();
  }, [theme]);

  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.fontSize = Math.round(13 * fontScale);
    try {
      fit.current?.fit();
      window.api.chat.resize(t.cols, t.rows);
    } catch {}
  }, [fontScale]);

  return (
    <div className="chat-body" onMouseDown={() => term.current?.focus()}>
      <div className="chat-bar">
        <button className={`folder-btn${dir ? " has-dir" : ""}`} title={dir ? `Working in ${dir}. Click to pick another folder (starts a fresh session).` : "Pick a folder or repo for Claude to work in (starts a fresh session)"} onClick={pick}>
          <Icon name="frame" size={13} />
          <span>{dir ? dir.split("/").filter(Boolean).slice(-2).join("/") : "Choose folder…"}</span>
        </button>
        {dir && <button className="quiet" title="Back to the notes workspace" onClick={clearDir}><Icon name="x" size={13} /></button>}
        <div className="spacer" />
        <button
          className="quiet"
          title="Kill this board's Claude session and start a fresh one"
          onClick={async () => {
            await window.api.chat.kill(boardId);
            setNonce((n) => n + 1);
          }}
        >
          New session
        </button>
      </div>
      <div className="chat-term" ref={host} />
      {ended && (
        <div className="chat-ended">
          <span>Session ended</span>
          <button className="primary" onClick={() => setNonce((n) => n + 1)}>Reconnect</button>
          <button className="quiet" title="Dismiss" onClick={() => setEnded(false)}><Icon name="x" size={13} /></button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- conversational mode
type Msg = { role: "user" | "assistant" | "tool" | "error"; text: string };
type Conv = { sessionId: string; started: boolean; msgs: Msg[] };
const key = (id: string) => `bn.chat.${id}`;
const loadConv = (id: string): Conv => {
  try {
    const v = (window.api.chats.load(id)?.claude as Conv | undefined) ?? JSON.parse(localStorage.getItem(key(id)) ?? "");
    if (v?.sessionId) return v;
  } catch {}
  return { sessionId: crypto.randomUUID(), started: false, msgs: [] };
};
const saveConv = (id: string, c: Conv) => {
  try {
    window.api.chats.save(id, "claude", c);
  } catch {}
};

export function Rich({ text }: { text: string }) {
  const parts = text.split(/```/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <pre key={i}>{p.replace(/^[\w-]*\n/, "").replace(/\n$/, "")}</pre>
        ) : (
          p
            .split(/\n{2,}/)
            .filter((b) => b.trim())
            .map((b, j) => {
              const lines = b.split("\n");
              if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l)))
                return (
                  <ul key={`${i}-${j}`}>
                    {lines.map((l, k) => (
                      <li key={k}><Inline text={l.replace(/^\s*([-*]|\d+\.)\s+/, "")} /></li>
                    ))}
                  </ul>
                );
              const h = /^(#{1,4})\s+(.*)$/.exec(lines[0]);
              if (h && lines.length === 1) return <div key={`${i}-${j}`} className="rh"><Inline text={h[2]} /></div>;
              return (
                <p key={`${i}-${j}`}>
                  {lines.map((l, k) => (
                    <span key={k}>{k > 0 && <br />}<Inline text={l} /></span>
                  ))}
                </p>
              );
            })
        ),
      )}
    </>
  );
}

const SUGGEST = ["Summarize this board", "What's missing or risky here?", "Suggest a better structure", "Draft a doc outline from this"];

function ChatView() {
  const boardId = useStore((s) => s.board.id);
  const boardName = useStore((s) => s.board.name);
  const selection = useStore((s) => s.board.nodes.filter((n) => n.selected && n.type === "card").length);
  const [conv, setConv] = useState<Conv>(() => loadConv(boardId));
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const convRef = useRef(conv);
  const list = useRef<HTMLDivElement>(null);
  const boardRef = useRef(boardId);
  convRef.current = conv;

  useEffect(() => {
    boardRef.current = boardId;
    setConv(loadConv(boardId));
    setRunning(false);
  }, [boardId]);

  const update = (fn: (c: Conv) => Conv) => {
    setConv((c) => {
      const n = fn(c);
      saveConv(boardRef.current, n);
      return n;
    });
  };

  useEffect(
    () =>
      window.api.chatcli.onEvent((e) => {
        if (e.kind === "delta") {
          update((c) => {
            const m = [...c.msgs];
            const last = m[m.length - 1];
            if (last?.role === "assistant") m[m.length - 1] = { ...last, text: last.text + e.text };
            else m.push({ role: "assistant", text: e.text });
            return { ...c, started: true, msgs: m };
          });
        } else if (e.kind === "tool") {
          update((c) => ({ ...c, msgs: [...c.msgs, { role: "tool", text: e.text }] }));
        } else if (e.kind === "done") {
          update((c) => ({ ...c, started: true, msgs: e.text ? [...c.msgs, { role: "assistant", text: e.text }] : c.msgs }));
          setRunning(false);
        } else {
          update((c) => ({ ...c, msgs: [...c.msgs, { role: "error", text: e.text }] }));
          setRunning(false);
        }
      }),
    [],
  );

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [conv.msgs]);

  const send = async (t: string) => {
    t = t.trim();
    if (!t || running) return;
    const st = useStore.getState();
    await st.saveNow(); // makes sure board.md is current
    const sel = st.board.nodes.filter((n) => n.selected && n.type === "card").map((n) => (n.data as { title: string }).title).filter(Boolean).slice(0, 12);
    const c = convRef.current;
    update((x) => ({ ...x, msgs: [...x.msgs, { role: "user", text: t }] }));
    setText("");
    setRunning(true);
    const ok = await window.api.chatcli.send({ boardId, boardName, text: t, sessionId: c.sessionId, resume: c.started, selection: sel });
    if (!ok) setRunning(false);
  };

  return (
    <div className="chat-body">
      <div className="chat-bar">
        <span className="chat-hint">Uses your Claude login · can read this board</span>
        <button
          disabled={running}
          title="Forget this conversation and start fresh"
          onClick={() => {
            const n = { sessionId: crypto.randomUUID(), started: false, msgs: [] };
            setConv(n);
            saveConv(boardId, n);
          }}
        >
          New chat
        </button>
      </div>
      <div className="msgs" ref={list}>
        {conv.msgs.length === 0 && (
          <div className="msgs-empty">
            <p>Ask anything about <b>{boardName || "this board"}</b>.</p>
            <div className="suggest">
              {SUGGEST.map((q) => (
                <button key={q} onClick={() => send(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {conv.msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg user">{m.text}</div>
          ) : m.role === "tool" ? (
            <div key={i} className="msg tool">{m.text}</div>
          ) : m.role === "error" ? (
            <div key={i} className="msg err">{m.text}</div>
          ) : (
            <div key={i} className="msg bot"><Rich text={m.text} /></div>
          ),
        )}
        {running && <div className="msg tool">Thinking…</div>}
      </div>
      <div className="composer">
        {selection > 0 && <div className="ctx-chip">{selection} selected card{selection > 1 ? "s" : ""} shared as context</div>}
        <div className="composer-row">
          <textarea
            rows={2}
            value={text}
            placeholder="Message Claude…  (Enter to send, Shift+Enter for a new line)"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
          />
          {running ? (
            <button className="send" title="Stop" onClick={() => window.api.chatcli.stop()}><Icon name="stop" /></button>
          ) : (
            <button className="send primary" disabled={!text.trim()} title="Send" onClick={() => send(text)}><Icon name="send" /></button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const boardName = useStore((s) => s.board.name);
  const mode = useStore((s) => s.chatMode);
  const setMode = useStore((s) => s.setChatMode);
  const setPanel = useStore((s) => s.setPanel);
  return (
    <div className="chat">
      <div className="chat-head">
        <span className="chat-title">Claude</span>
        <span className="chat-sub">{boardName || "Untitled"}</span>
        <div className="spacer" />
        <span className="seg mini">
          <button className={mode === "chat" ? "on" : ""} title="Conversational chat" onClick={() => setMode("chat")}>Chat</button>
          <button className={mode === "terminal" ? "on" : ""} title="Full Claude Code terminal" onClick={() => setMode("terminal")}>Terminal</button>
        </span>
        <button title="Close panel" onClick={() => setPanel({ chatOpen: false })}><Icon name="x" size={15} /></button>
      </div>
      {mode === "chat" ? <ChatView /> : <TerminalView />}
    </div>
  );
}
