import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import pty from "@lydell/node-pty";
import { runAgent } from "./agent.mjs";
import { runImport, runArrange, runCondense } from "./structure.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
app.setName("better-notes");
if (process.env.BN_DATA) app.setPath("userData", process.env.BN_DATA); // dev/testing aid

const dataDir = () => app.getPath("userData");
const boardsDir = () => path.join(dataDir(), "boards");
/** Small JSON file with a debounced, atomic write and a synchronous flush for quit. */
function jsonFile(file, fallback) {
  let data = null;
  let timer = null;
  const load = () => {
    if (data === null) {
      try { data = JSON.parse(fsSync.readFileSync(file, "utf8")); } catch { data = fallback(); }
    }
    return data;
  };
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (data === null) return;
    try {
      fsSync.mkdirSync(path.dirname(file), { recursive: true });
      fsSync.writeFileSync(file + ".tmp", JSON.stringify(data));
      fsSync.renameSync(file + ".tmp", file);
    } catch (err) { console.error("write failed", file, err.message); }
  };
  const touch = () => { if (!timer) timer = setTimeout(flush, 250); };
  return { load, flush, touch };
}
const flushers = new Set();
const prefsStore = () => (prefsStore.v ??= (() => { const j = jsonFile(path.join(dataDir(), "prefs.json"), () => ({})); flushers.add(j.flush); return j; })());
ipcMain.on("prefs:all", (e) => { e.returnValue = prefsStore().load(); });
ipcMain.on("prefs:set", (_e, k, v) => { prefsStore().load()[k] = v; prefsStore().touch(); });
const chatStores = new Map();
const chatStore = (id) => {
  const key = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!chatStores.has(key)) {
    const j = jsonFile(path.join(dataDir(), "chats", key + ".json"), () => ({}));
    flushers.add(j.flush);
    chatStores.set(key, j);
  }
  return chatStores.get(key);
};
ipcMain.on("chats:load", (e, id) => { e.returnValue = fsSync.existsSync(path.join(dataDir(), "chats", String(id).replace(/[^a-zA-Z0-9_-]/g, "") + ".json")) || chatStores.has(String(id).replace(/[^a-zA-Z0-9_-]/g, "")) ? chatStore(id).load() : null; });
ipcMain.on("chats:save", (_e, id, part, value) => { const j = chatStore(id); j.load()[part] = value; j.touch(); });
app.on("before-quit", () => flushers.forEach((f) => f()));

const settingsFile = () => path.join(dataDir(), "settings.json");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function readSettings() {
  const s = await readJson(settingsFile(), {});
  let apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (s.keyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(s.keyEnc, "base64"));
    } catch {}
  } else if (s.keyPlain) apiKey = s.keyPlain;
  return { apiKey, model: s.model || "claude-sonnet-5-5", effort: s.effort || "medium", budget: s.budget ?? 400 };
}

ipcMain.handle("settings:get", async () => {
  const s = await readSettings();
  return { hasKey: !!s.apiKey, model: s.model, effort: s.effort, budget: s.budget };
});

ipcMain.handle("settings:set", async (_e, patch) => {
  const cur = await readJson(settingsFile(), {});
  if (patch.model) cur.model = patch.model;
  if (patch.effort) cur.effort = patch.effort;
  if (typeof patch.budget === "number" && patch.budget >= 0) cur.budget = patch.budget;
  if (typeof patch.apiKey === "string" && patch.apiKey.trim()) {
    const key = patch.apiKey.trim();
    delete cur.keyEnc;
    delete cur.keyPlain;
    if (safeStorage.isEncryptionAvailable()) cur.keyEnc = safeStorage.encryptString(key).toString("base64");
    else cur.keyPlain = key;
  }
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(cur, null, 2), { mode: 0o600 });
  return true;
});

// ---- usage / cost tracking ----
// $ per 1M tokens (input, output). Output includes thinking tokens.
const PRICES = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};
const usageFile = () => path.join(dataDir(), "usage.json");
const emptyBucket = () => ({ input: 0, output: 0, cost: 0, calls: 0 });
const session = emptyBucket();

const add = (b, u) => {
  b.input += u.input;
  b.output += u.output;
  b.cost += u.cost;
  b.calls += 1;
};

async function recordUsage(model, raw, budget) {
  const [pi, po] = PRICES[model] ?? PRICES["claude-opus-5-5"];
  const input = (raw?.input_tokens ?? 0) + (raw?.cache_creation_input_tokens ?? 0) + (raw?.cache_read_input_tokens ?? 0);
  const output = raw?.output_tokens ?? 0;
  const last = { input, output, cost: (input * pi + output * po) / 1e6, model };
  const data = await readJson(usageFile(), { total: emptyBucket(), days: {} });
  const day = new Date().toLocaleDateString("en-CA");
  data.days[day] ??= emptyBucket();
  add(data.total, last);
  add(data.days[day], last);
  add(session, last);
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(usageFile(), JSON.stringify(data));
  return { last, session: { ...session }, today: data.days[day], total: data.total, budget };
}

async function usageSummary() {
  const data = await readJson(usageFile(), { total: emptyBucket(), days: {} });
  const day = new Date().toLocaleDateString("en-CA");
  const s = await readSettings();
  return { last: null, session: { ...session }, today: data.days[day] ?? emptyBucket(), total: data.total, budget: s.budget };
}
ipcMain.handle("usage:get", usageSummary);

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "");

/** Small index of board metadata so listing hundreds of boards does not parse every file. */
const indexFile = () => path.join(dataDir(), "index.json");
let boardIndex = null;
async function loadIndex() {
  await fs.mkdir(boardsDir(), { recursive: true });
  const ids = (await fs.readdir(boardsDir())).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  if (!boardIndex) boardIndex = await readJson(indexFile(), {});
  const stale = ids.length !== Object.keys(boardIndex).length || ids.some((id) => !boardIndex[id]);
  if (stale) {
    // rebuild from the board files (first run, or something changed outside the app)
    const next = {};
    for (const id of ids) {
      const b = await readJson(path.join(boardsDir(), id + ".json"), null);
      if (b) next[b.id ?? id] = { name: b.name, updatedAt: b.updatedAt };
    }
    boardIndex = next;
    await writeIndex();
  }
  return boardIndex;
}
async function writeIndex() {
  try { await atomicWrite(indexFile(), JSON.stringify(boardIndex)); } catch (err) { console.error("index write failed", err.message); }
}
async function atomicWrite(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}
/** Keep a few older versions of each board (at most one per 10 minutes, newest 12 kept). */
async function backupBoard(id) {
  const file = path.join(boardsDir(), id + ".json");
  const dir = path.join(boardsDir(), ".history", id);
  try {
    const old = await fs.readFile(file, "utf8");
    await fs.mkdir(dir, { recursive: true });
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort();
    const lastT = names.length ? Number(names[names.length - 1].slice(0, -5)) : 0;
    if (Date.now() - lastT < 10 * 60 * 1000) return;
    await fs.writeFile(path.join(dir, Date.now() + ".json"), old);
    for (const n of names.slice(0, Math.max(0, names.length + 1 - 12))) await fs.rm(path.join(dir, n), { force: true });
  } catch { /* no previous version yet */ }
}

/** Board groups: {boardId: groupName}. A board is in at most one group; the assistant may look across boards of the same group only. */
const groupsFile = () => path.join(dataDir(), "groups.json");
let boardGroups = null;
const loadGroups = async () => (boardGroups ??= await readJson(groupsFile(), {}));
ipcMain.handle("boards:setGroup", async (_e, id, name) => {
  const g = await loadGroups();
  const n = String(name ?? "").trim().slice(0, 40);
  if (n) g[safeId(id)] = n; else delete g[safeId(id)];
  await atomicWrite(groupsFile(), JSON.stringify(g));
  return true;
});
ipcMain.handle("boards:list", async () => {
  const idx = await loadIndex();
  const g = await loadGroups();
  return Object.entries(idx).map(([id, m]) => ({ id, name: m.name, updatedAt: m.updatedAt, group: g[id] || undefined })).sort((a, b) => b.updatedAt - a.updatedAt);
});
ipcMain.handle("boards:load", (_e, id) => readJson(path.join(boardsDir(), safeId(id) + ".json"), null));
ipcMain.handle("boards:save", async (_e, board) => {
  const id = safeId(board.id);
  await loadIndex();
  await backupBoard(id);
  await atomicWrite(path.join(boardsDir(), id + ".json"), JSON.stringify(board));
  boardIndex[id] = { name: board.name, updatedAt: board.updatedAt };
  await writeIndex();
  return true;
});
ipcMain.handle("boards:remove", async (_e, id) => {
  await fs.rm(path.join(dataDir(), "chats", safeId(id) + ".json"), { force: true });
  chatStores.delete(safeId(id));
  await fs.rm(path.join(boardsDir(), safeId(id) + ".json"), { force: true });
  await fs.rm(path.join(boardsDir(), ".history", safeId(id)), { recursive: true, force: true });
  await loadIndex();
  delete boardIndex[safeId(id)];
  await writeIndex();
  const g = await loadGroups();
  if (g[safeId(id)]) { delete g[safeId(id)]; await atomicWrite(groupsFile(), JSON.stringify(g)); }
  return true;
});

ipcMain.handle("share:save", async (e, name, html) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const base = String(name || "board").replace(/[^\w\- ]+/g, "_").trim() || "board";
  if (process.env.BN_SHARE_TO) { await fs.writeFile(process.env.BN_SHARE_TO, String(html)); return { ok: true, path: process.env.BN_SHARE_TO }; }
  const r = await dialog.showSaveDialog(win, { title: "Save a read-only copy", defaultPath: path.join(app.getPath("documents"), base + ".html"), filters: [{ name: "Web page", extensions: ["html"] }] });
  if (r.canceled || !r.filePath) return { ok: true, canceled: true };
  try {
    await fs.writeFile(r.filePath, String(html));
    shell.showItemInFolder(r.filePath);
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: "Could not save: " + (err?.message || err) };
  }
});

const wrap = (fn) => async (_e, req) => {
  try {
    const cfg = await readSettings();
    const r = await fn(req, cfg);
    return { ok: true, data: r.data, usage: await recordUsage(cfg.model, r.usage, cfg.budget) };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
};
let agentAbort = null;
ipcMain.handle("ai:agent", async (e, req) => {
  agentAbort?.abort();
  const ctl = (agentAbort = new AbortController());
  try {
    const cfg = await readSettings();
    const emit = (p) => { if (!e.sender.isDestroyed()) e.sender.send("ai:progress", p); };
    if (req.mode === "dump" || req.mode === "arrange" || req.mode === "condense") {
      const r = req.mode === "dump"
        ? await runImport({ text: req.text ?? "", detail: req.detail, boardTitles: (req.board?.nodes ?? []).map((n) => n.title) }, cfg, emit, ctl.signal)
        : req.mode === "condense" ? await runCondense(req.arrange, cfg, emit, ctl.signal)
        : await runArrange({ ...req.arrange, history: req.history ?? [] }, cfg, emit, ctl.signal);
      return { ok: true, data: r.data, usage: await recordUsage(cfg.model, r.usage, cfg.budget) };
    }
    // other boards in the same group (never all boards), slimmed down to cards + links
    const g = await loadGroups();
    const gname = req.boardId ? g[safeId(req.boardId)] : "";
    if (gname) {
      const sibs = [];
      for (const [id, n] of Object.entries(g)) {
        if (n !== gname || id === safeId(req.boardId)) continue;
        const b = await readJson(path.join(boardsDir(), id + ".json"), null);
        if (!b) continue;
        sibs.push({
          id, name: b.name || "Untitled",
          nodes: (b.nodes ?? []).filter((x) => x.type === "card" && !x.data?.ghost).map((x) => ({ id: x.id, title: x.data?.title ?? "", bullets: x.data?.bullets ?? "", kind: x.data?.kind ?? "idea" })),
          edges: (b.edges ?? []).filter((x) => !x.data?.ghost).map((x) => ({ from: x.source, to: x.target, label: typeof x.label === "string" ? x.label : "" })),
        });
      }
      req.siblings = sibs;
      req.groupName = gname;
    }
    const r = await runAgent(req, cfg, (p) => { if (!e.sender.isDestroyed()) e.sender.send("ai:progress", p); }, ctl.signal);
    return { ok: true, data: r.data, usage: await recordUsage(cfg.model, r.usage, cfg.budget) };
  } catch (err) {
    return { ok: false, error: ctl.signal.aborted ? "Stopped." : err?.message || String(err) };
  } finally {
    if (agentAbort === ctl) agentAbort = null;
  }
});
ipcMain.handle("ai:cancel", () => (agentAbort?.abort(), true));

// ---- finding the `claude` CLI on every platform ----
const isWin = process.platform === "win32";
/** Copy of the environment with ~/.local/bin (where Claude Code's native installer puts `claude`) on PATH. Windows env keys are case-insensitive ("Path"). */
function cliEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // make Claude Code use your own login (Pro plan), not the API key
  delete env.ELECTRON_RUN_AS_NODE;
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const extra = [path.join(os.homedir(), ".local", "bin")];
  if (isWin && env.APPDATA) extra.push(path.join(env.APPDATA, "npm"));
  env[key] = [...extra, env[key] ?? ""].join(path.delimiter);
  return env;
}
/** [command, leadingArgs] that start Claude Code without a shell (no quoting pitfalls). On Windows, npm installs a .cmd shim that can't be spawned directly, so run its script with node. */
function claudeCommand(env) {
  if (!isWin) return ["claude", []];
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const dirs = String(env[key] ?? "").split(path.delimiter).filter(Boolean);
  for (const d of dirs) if (fsSync.existsSync(path.join(d, "claude.exe"))) return [path.join(d, "claude.exe"), []];
  for (const d of dirs) {
    const cli = path.join(d, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    if (fsSync.existsSync(path.join(d, "claude.cmd")) && fsSync.existsSync(cli)) {
      const node = dirs.map((x) => path.join(x, "node.exe")).find((x) => fsSync.existsSync(x));
      if (node) return [node, [cli]];
    }
  }
  return ["claude.exe", []];
}
let tmuxOk = null;
/** tmux keeps terminal sessions alive between board switches. Not available on Windows (or if not installed): sessions then last while the panel is open. */
function hasTmux(env) {
  if (tmuxOk === null) {
    if (isWin) tmuxOk = false;
    else try { execFileSync("tmux", ["-V"], { env, stdio: "ignore" }); tmuxOk = true; } catch { tmuxOk = false; }
  }
  return tmuxOk;
}

// ---- Claude Code chat: tmux session (detached, persistent) shown through a pty ----
const workspaceRoot = () => path.join(dataDir(), "workspaces");
const workspaceDir = (id) => path.join(workspaceRoot(), safeId(id));
const sessionName = (id) => "bn-" + safeId(id);
let term = null;

function closePty() {
  if (term) {
    try {
      term.kill();
    } catch {}
    term = null;
  }
}

const CLAUDE_MD = `# Better Notes workspace

This folder holds the user's personal "Better Notes" thinking-canvas boards, one sub-folder per board.

- \`<boardId>/board.md\`  – that board as a nested outline (cards, bullets, links). Re-read it whenever the user refers to "the board", "my notes" or "this".
- \`<boardId>/board.json\` – the raw graph (nodes, edges, frames) if you need exact structure.

The session's system prompt says which board id is the current one. Files are snapshots refreshed automatically a moment after the user edits. Treat them as read-only context.
The user is brainstorming / planning / documenting. Be concise, concrete, and structured (bullets over paragraphs).
`;

ipcMain.handle("workspace:sync", async (_e, boardId, md, json) => {
  const dir = workspaceDir(boardId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "board.md"), md);
  await fs.writeFile(path.join(dir, "board.json"), json);
  return true;
});

ipcMain.handle("chat:pickDir", async (e, start) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { title: "Folder for Claude to work in", defaultPath: start || os.homedir(), properties: ["openDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("chat:open", async (e, { boardId, cols, rows, dir: want }) => {
  closePty();
  // default: the notes workspace; otherwise any folder the user picked (a repo, say). The board files stay reachable via --add-dir.
  let custom = "";
  if (want) { try { if ((await fs.stat(want)).isDirectory()) custom = want; } catch { /* fall back to the workspace */ } }
  const dir = custom || workspaceRoot();
  await fs.mkdir(workspaceDir(boardId), { recursive: true });
  try {
    await fs.writeFile(path.join(dir, "CLAUDE.md"), CLAUDE_MD, { flag: "wx" });
  } catch {}
  const name = sessionName(boardId);
  const bd = workspaceDir(boardId);
  const sys = `The user is chatting from the Better Notes app. Their current board is in ${bd}/board.md (outline) and ${bd}/board.json (raw). Re-read board.md when they mention the board or their notes.${custom ? ` Your working folder is ${custom}; the user may want help with that project.` : ""} Be concise and structured.`.replace(/'/g, "");
  const env = { ...cliEnv(), TERM: "xterm-256color", COLORTERM: "truecolor" };
  const size = { name: "xterm-256color", cols: cols || 100, rows: rows || 30, cwd: dir, env };
  if (hasTmux(env)) {
    try {
      execFileSync("tmux", ["-L", "better-notes", "has-session", "-t", name], { env, stdio: "ignore" });
    } catch {
      execFileSync(
        "tmux",
        ["-L", "better-notes", "new-session", "-d", "-s", name, "-c", dir, "-x", String(cols || 100), "-y", String(rows || 30), `claude ${custom ? `--add-dir '${workspaceRoot()}' ` : ""}--append-system-prompt '${sys}'; exec "\${SHELL:-bash}"`],
        { env },
      );
      execFileSync("tmux", ["-L", "better-notes", "set-option", "-t", name, "status", "off"], { env });
      execFileSync("tmux", ["-L", "better-notes", "set-option", "-t", name, "mouse", "on"], { env });
    }
    term = pty.spawn("tmux", ["-L", "better-notes", "attach-session", "-t", name], size);
  } else {
    // no tmux (Windows, or not installed): run Claude Code straight in the pty, then drop to a shell when it exits
    const [cmd, pre] = claudeCommand(env);
    const args = [...pre, ...(custom ? ["--add-dir", workspaceRoot()] : []), "--append-system-prompt", sys];
    try {
      term = pty.spawn(cmd, args, size);
    } catch (err) {
      if (!e.sender.isDestroyed()) e.sender.send("chat:data", `\r\nCouldn't start Claude Code (${err?.message || err}).\r\nInstall it from https://claude.com/claude-code and make sure \`claude\` works in a terminal.\r\n`);
      return false;
    }
  }
  const mine = term;
  term.onData((d) => !e.sender.isDestroyed() && e.sender.send("chat:data", d));
  term.onExit(() => {
    if (term !== mine) return; // replaced or closed on purpose (board switch, panel closed): not a lost session
    term = null;
    if (!e.sender.isDestroyed()) e.sender.send("chat:exit");
  });
  return true;
});
// ---- conversational mode: `claude -p` (stream-json), one process per message, session kept via --session-id/--resume ----
let chatProc = null;
ipcMain.handle("chatcli:send", async (e, { boardId, boardName, text, sessionId, resume, selection }) => {
  if (chatProc) return false;
  const dir = workspaceRoot();
  await fs.mkdir(workspaceDir(boardId), { recursive: true });
  try {
    await fs.writeFile(path.join(dir, "CLAUDE.md"), CLAUDE_MD, { flag: "wx" });
  } catch {}
  const sys =
    `You are the assistant inside the Better Notes app (a canvas of cards and connections). The user's current board is "${boardName}". ` +
    `Its contents are in ./${safeId(boardId)}/board.md (outline) and ./${safeId(boardId)}/board.json (raw). Read board.md whenever the question concerns the board. ` +
    (selection?.length ? `The user currently has these cards selected: ${selection.join("; ")}. ` : "") +
    `You can read files but cannot edit the board: propose changes as text. Be concise; use Markdown.`;
  const env = cliEnv(); // uses the user's own Claude login, not the API key
  const [cmd, pre] = claudeCommand(env);
  const args = [
    ...pre,
    "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    resume ? "--resume" : "--session-id", sessionId,
    "--append-system-prompt", sys,
    "--allowedTools", "Read", "Glob", "Grep",
  ];
  const send = (ev) => !e.sender.isDestroyed() && e.sender.send("chatcli:event", ev);
  const proc = spawn(cmd, args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  chatProc = proc;
  proc.stdin.end(text);
  let buf = "";
  let streamed = false;
  let err = "";
  let finished = false;
  const handle = (line) => {
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      return;
    }
    if (j.type === "stream_event") {
      const ev = j.event;
      if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        streamed = true;
        send({ kind: "delta", text: ev.delta.text });
      }
    } else if (j.type === "assistant") {
      for (const b of j.message?.content ?? []) {
        if (b.type === "tool_use") {
          const arg = b.input?.file_path ?? b.input?.pattern ?? b.input?.path ?? "";
          send({ kind: "tool", text: `${b.name} ${String(arg).split("/").slice(-2).join("/")}`.trim() });
        }
      }
    } else if (j.type === "result") {
      finished = true;
      if (j.is_error) send({ kind: "error", text: j.result || "Claude reported an error." });
      else send({ kind: "done", text: streamed ? "" : j.result || "" });
    }
  };
  proc.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  proc.stderr.on("data", (d) => (err += d));
  proc.on("error", (x) => {
    chatProc = null;
    send({ kind: "error", text: x.code === "ENOENT" ? "Couldn't find the `claude` command. Is Claude Code installed and on your PATH?" : String(x) });
  });
  proc.on("close", (code) => {
    if (chatProc === proc) chatProc = null;
    if (buf.trim()) handle(buf);
    if (!finished) send(code === 0 ? { kind: "done", text: "" } : { kind: "error", text: (err.trim() || `claude exited with code ${code}`).slice(-600) });
  });
  return true;
});
ipcMain.handle("chatcli:stop", () => {
  try {
    chatProc?.kill("SIGTERM");
  } catch {}
  return true;
});
ipcMain.on("chat:write", (_e, d) => term?.write(d));
ipcMain.on("chat:resize", (_e, c, r) => {
  try {
    term?.resize(Math.max(2, c), Math.max(2, r));
  } catch {}
});
ipcMain.handle("chat:close", () => (closePty(), true));
ipcMain.handle("chat:kill", (_e, boardId) => {
  closePty();
  if (isWin) return true;
  try {
    execFileSync("tmux", ["-L", "better-notes", "kill-session", "-t", sessionName(boardId)], { stdio: "ignore" });
  } catch {}
  return true;
});
app.on("before-quit", closePty); // detaches only; the tmux session keeps running

function createWindow() {
  const win = new BrowserWindow({
    ...(process.env.BN_HIDDEN ? { show: false, paintWhenInitiallyHidden: true } : {}),
    width: Number(process.env.BN_SIZE?.split("x")[0]) || 1400,
    height: Number(process.env.BN_SIZE?.split("x")[1]) || 900,
    backgroundColor: "#0f1115",
    title: "Better Notes",
    icon: path.join(here, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      ...(process.env.BN_HIDDEN ? { backgroundThrottling: false } : {}),
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // save the open board before the window goes away (autosave is debounced, so the last edit could still be pending)
  let closing = false;
  win.on("close", (e) => {
    if (closing || win.webContents.isDestroyed()) return;
    e.preventDefault();
    closing = true;
    const done = () => { flushers.forEach((f) => f()); if (!win.isDestroyed()) win.close(); };
    ipcMain.once("app:flushed", done);
    win.webContents.send("app:flush");
    setTimeout(done, 2500); // never hang the close if the page doesn't answer
  });
  // Ctrl +/- /0 zoom the whole UI (remembered between launches)
  const wc = win.webContents;
  const setZoom = async (lvl) => {
    lvl = Math.max(-3, Math.min(4, lvl));
    wc.setZoomLevel(lvl);
    const cur = await readJson(settingsFile(), {});
    cur.zoom = lvl;
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(settingsFile(), JSON.stringify(cur, null, 2), { mode: 0o600 });
  };
  wc.on("before-input-event", (ev, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta) || input.alt) return;
    if (input.key === "=" || input.key === "+") (ev.preventDefault(), setZoom(wc.getZoomLevel() + 0.5));
    else if (input.key === "-" || input.key === "_") (ev.preventDefault(), setZoom(wc.getZoomLevel() - 0.5));
    else if (input.key === "0") (ev.preventDefault(), setZoom(0));
  });
  wc.on("did-finish-load", async () => wc.setZoomLevel((await readJson(settingsFile(), {})).zoom ?? 0));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.BN_SHOT) {
    // dev aid: run an optional script in the page, then save a screenshot and quit
    wc.on("console-message", (_e, _l, msg) => console.log("[renderer]", msg));
    wc.once("did-finish-load", async () => {
      await new Promise((r) => setTimeout(r, 2500));
      if (process.env.BN_INPUT) {
        // dev aid: trusted input events. Steps: {click:"css"|[x,y]}, {dbl:"css"}, {drag:[x1,y1,x2,y2]}, {type:"text"}, {key:"Enter"}, {wait:ms}, {js:"expr"}
        const steps = JSON.parse(await fs.readFile(process.env.BN_INPUT, "utf8"));
        const at = async (t) => (Array.isArray(t) ? t : await wc.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(t)})?.getBoundingClientRect();return r?[Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]:null})()`));
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const press = async ([x, y], n = 1) => {
          wc.sendInputEvent({ type: "mouseMove", x, y });
          for (let i = 1; i <= n; i++) {
            wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: i });
            await sleep(30);
            wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: i });
            await sleep(60);
          }
        };
        for (const st of steps) {
          if (st.click) { const p = await at(st.click); console.log("[in] click", st.click, p); if (p) await press(p); }
          else if (st.move) { wc.sendInputEvent({ type: "mouseMove", x: st.move[0], y: st.move[1] }); }
          else if (st.dbl) { const p = await at(st.dbl); if (p) await press(p, 2); }
          else if (st.drag) {
            const [a, b, c, d] = st.drag;
            wc.sendInputEvent({ type: "mouseMove", x: a, y: b });
            wc.sendInputEvent({ type: "mouseDown", x: a, y: b, button: "left", clickCount: 1 });
            for (let i = 1; i <= 12; i++) { wc.sendInputEvent({ type: "mouseMove", x: a + ((c - a) * i) / 12, y: b + ((d - b) * i) / 12, button: "left", modifiers: ["leftButtonDown"] }); await sleep(16); }
            wc.sendInputEvent({ type: "mouseUp", x: c, y: d, button: "left", clickCount: 1 });
          } else if (st.modMove) {
            const [a, b, c, d] = st.modMove;
            const m = st.mods ?? ["control"];
            wc.sendInputEvent({ type: "mouseMove", x: a, y: b, modifiers: m });
            for (let i = 1; i <= 10; i++) { wc.sendInputEvent({ type: "mouseMove", x: a + ((c - a) * i) / 10, y: b + ((d - b) * i) / 10, modifiers: m }); await sleep(12); }
          } else if (st.ctrlDrag) {
            const [a, b, c, d] = st.ctrlDrag;
            const m = st.mods ?? ["control"];
            wc.sendInputEvent({ type: "mouseMove", x: a, y: b, modifiers: m });
            wc.sendInputEvent({ type: "mouseDown", x: a, y: b, button: "left", clickCount: 1, modifiers: m });
            for (let i = 1; i <= 12; i++) { wc.sendInputEvent({ type: "mouseMove", x: a + ((c - a) * i) / 12, y: b + ((d - b) * i) / 12, button: "left", modifiers: ["leftButtonDown", ...m] }); await sleep(12); }
            wc.sendInputEvent({ type: "mouseUp", x: c, y: d, button: "left", clickCount: 1, modifiers: m });
          } else if (st.dragSel) {
            const p = await at(st.dragSel);
            if (p) {
              wc.sendInputEvent({ type: "mouseMove", x: p[0], y: p[1] });
              wc.sendInputEvent({ type: "mouseDown", x: p[0], y: p[1], button: "left", clickCount: 1 });
              for (let i = 1; i <= 10; i++) { wc.sendInputEvent({ type: "mouseMove", x: p[0] + (st.dx * i) / 10, y: p[1] + ((st.dy ?? 0) * i) / 10, button: "left", modifiers: ["leftButtonDown"] }); await sleep(16); }
              wc.sendInputEvent({ type: "mouseUp", x: p[0] + st.dx, y: p[1] + (st.dy ?? 0), button: "left", clickCount: 1 });
            }
          } else if (st.type) { for (const ch of st.type) { wc.sendInputEvent({ type: "char", keyCode: ch }); await sleep(15); } }
          else if (st.key) { wc.sendInputEvent({ type: "keyDown", keyCode: st.key }); wc.sendInputEvent({ type: "keyUp", keyCode: st.key }); }
          else if (st.js) console.log("[in] js", await wc.executeJavaScript(st.js));
          else if (st.wait) await sleep(st.wait);
          await sleep(120);
        }
      }
      if (process.env.BN_JS) {
        const code = await fs.readFile(process.env.BN_JS, "utf8");
        try {
          console.log("[js]", await wc.executeJavaScript(code));
        } catch (err) {
          console.log("[js error]", err.message);
        }
        if (process.env.BN_CLOSE) { win.close(); return; } // dev aid: exercise the close-and-save path
        await new Promise((r) => setTimeout(r, 1500));
      }
      const img = await wc.capturePage();
      await fs.writeFile(process.env.BN_SHOT, img.toPNG());
      app.quit();
    });
  }
  if (process.env.BN_LOADFILE) win.loadFile(process.env.BN_LOADFILE); // dev aid: render a standalone html (e.g. an exported share page)
  else if (process.env.VITE_DEV_URL) win.loadURL(process.env.VITE_DEV_URL);
  else win.loadFile(path.join(here, "..", "dist", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
