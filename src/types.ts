import type { Node, Edge } from "@xyflow/react";

export type Kind = "idea" | "question" | "risk" | "task" | "note";
export const KINDS: Kind[] = ["idea", "question", "risk", "task", "note"];

export type CardData = {
  title: string;
  /** one bullet per line; leading double-spaces indent */
  bullets: string;
  kind: Kind;
  ghost?: boolean;
  focus?: boolean;
  /** AI rewrite suggestion awaiting accept/reject */
  proposal?: { title: string; bullets: string };
  /** AI suggests removing this card (value = reason); awaiting accept/reject */
  del?: string;
  /** per-card text size multiplier (default 1) */
  fs?: number;
  /** pinned cards keep their place when you Organize */
  pinned?: boolean;
};
export type CardNodeT = Node<CardData, "card">;

export type FrameData = {
  title: string;
  color: number;
  focus?: boolean;
  fs?: number;
  /** collapsed into a single block; `members` are the (hidden) nodes inside, `box` the size to restore */
  collapsed?: boolean;
  /** made by the assistant in Suggest mode, awaiting accept/reject */
  ghost?: boolean;
  members?: string[];
  box?: { w: number; h: number };
};
export type FrameNodeT = Node<FrameData, "frame">;
export type AppNode = CardNodeT | FrameNodeT;
export const isCard = (n: AppNode): n is CardNodeT => n.type === "card";
export const isFrame = (n: AppNode): n is FrameNodeT => n.type === "frame";

export type NoteEdge = Edge;
export type Theme = "dark" | "light" | "paper" | "dusk" | "glass";
export const THEMES: Theme[] = ["dark", "light", "paper", "dusk", "glass"];
export type View = "canvas" | "outline";
export type LineMode = "all" | "focus" | "selected" | "off";
export type EdgeStyle = "curve" | "step" | "line";

export interface Board {
  id: string;
  name: string;
  nodes: AppNode[];
  edges: NoteEdge[];
  updatedAt: number;
}
export interface BoardMeta {
  id: string;
  name: string;
  updatedAt: number;
  group?: string;
}

export interface AgentResult {
  answer: string;
  ops: GraphOps;
  edits: { id: string; title: string; bullets: string[] }[];
  deletes: { id: string; reason: string }[];
  unlinks: { from: string; to: string }[];
  groups?: { title: string; members: string[] }[];
  structure?: StructureResult;
  steps: number;
}
export type ImportCard = { title: string; bullets: string[]; kind: Kind };
export type StructureResult =
  | { kind: "import"; title: string; summary: string; sections: { title: string; cards: ImportCard[] }[]; links: { from: string; to: string; label: string; type?: string }[] }
  | { kind: "arrange"; sections: { title: string; ids: string[] }[]; loose: string[]; renames: { id: string; title: string }[] }
  | { kind: "condense"; merges: { from: string[]; title: string; bullets: string[]; kind: Kind }[] };
export type ImportDetail = "compact" | "normal" | "detailed";
export interface AskEntry { id: string; q: string; a: string; t: number; added: number; edited: number; links: number; removed?: number; unlinked?: number; grouped?: number; changes?: string; steps: number; error?: boolean }
export interface GraphOps {
  summary: string;
  nodes: { id: string; title: string; bullets: string[]; kind: Kind }[];
  edges: { from: string; to: string; label: string; type?: string }[];
}

export interface RewriteOps {
  summary: string;
  cards: { id: string; title: string; bullets: string[] }[];
}

export type AskAction = "ask" | "group" | "split" | "expand" | "rewrite" | "risks" | "gaps" | "connect" | "dump" | "arrange" | "condense" | "doc";

export interface Settings {
  hasKey: boolean;
  model: string;
  effort: string;
  budget: number;
}

export interface Bucket {
  input: number;
  output: number;
  cost: number;
  calls: number;
}
export interface UsageSummary {
  last: { input: number; output: number; cost: number; model: string } | null;
  session: Bucket;
  today: Bucket;
  total: Bucket;
  budget: number;
}

type Res<T> = { ok: true; data: T; usage: UsageSummary } | { ok: false; error: string };
declare global {
  interface Window {
    api: {
      share: { save(name: string, html: string): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> };
      prefs: { all(): Record<string, unknown>; set(k: string, v: unknown): void };
      chats: { load(id: string): { ask?: AskEntry[]; claude?: unknown } | null; save(id: string, part: "ask" | "claude", v: unknown): void };
      lifecycle: { onFlush(cb: () => void): void; flushed(): void };
      boards: {
        list(): Promise<BoardMeta[]>;
        load(id: string): Promise<Board | null>;
        save(b: Board): Promise<boolean>;
        remove(id: string): Promise<boolean>;
        setGroup(id: string, name: string): Promise<boolean>;
      };
      settings: {
        get(): Promise<Settings>;
        set(p: { apiKey?: string; model?: string; effort?: string; budget?: number }): Promise<boolean>;
      };
      usage: { get(): Promise<UsageSummary> };
      chatcli: {
        send(a: { boardId: string; boardName: string; text: string; sessionId: string; resume: boolean; selection: string[] }): Promise<boolean>;
        stop(): Promise<boolean>;
        onEvent(cb: (e: { kind: "delta" | "tool" | "done" | "error"; text: string }) => void): () => void;
      };
      chat: {
        open(a: { boardId: string; cols: number; rows: number; dir?: string }): Promise<boolean>;
        pickDir(start?: string): Promise<string | null>;
        write(d: string): void;
        resize(cols: number, rows: number): void;
        close(): Promise<boolean>;
        kill(boardId: string): Promise<boolean>;
        onData(cb: (d: string) => void): () => void;
        onExit(cb: () => void): () => void;
      };
      workspace: { sync(boardId: string, md: string, json: string): Promise<boolean> };
      ai: {
        agent(req: unknown): Promise<Res<AgentResult>>;
        cancel(): Promise<boolean>;
        onProgress(cb: (p: { text?: string; stream?: string; live?: boolean; apply?: Partial<AgentResult> & { nodes?: GraphOps["nodes"]; edges?: GraphOps["edges"] } }) => void): void;
      };
    };
  }
}
