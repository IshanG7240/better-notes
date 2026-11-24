import type { AppNode, CardNodeT, NoteEdge } from "./types";
import { isCard, isFrame } from "./types";
import { frameChain, parentMap } from "./layout";

export interface TreeItem {
  node: CardNodeT;
  edgeLabel: string;
  frame?: string;
  children: TreeItem[];
}

const byPos = (a: CardNodeT, b: CardNodeT) => a.position.y - b.position.y || a.position.x - b.position.x;

export function buildTree(nodes: AppNode[], edges: NoteEdge[]): TreeItem[] {
  const cards = nodes.filter(isCard);
  const frames = nodes.filter(isFrame);
  const pm = parentMap(nodes);
  const fById = new Map(frames.map((f) => [f.id, f]));
  const frameOf = new Map<string, string>();
  for (const c of cards) {
    const chain = frameChain(c.id, pm, fById);
    if (chain.length) frameOf.set(c.id, chain.join(" › "));
  }

  const ids = new Set(cards.map((c) => c.id));
  const live = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && !e.data?.ghost);
  const incoming = new Set(live.map((e) => e.target));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const seen = new Set<string>();

  const build = (c: CardNodeT, label: string): TreeItem => {
    seen.add(c.id);
    const kids = live
      .filter((e) => e.source === c.id && !seen.has(e.target))
      .map((e) => ({ c: byId.get(e.target)!, label: typeof e.label === "string" ? e.label : "" }))
      .sort((a, b) => byPos(a.c, b.c));
    const children: TreeItem[] = [];
    for (const k of kids) if (!seen.has(k.c.id)) children.push(build(k.c, k.label));
    return { node: c, edgeLabel: label, frame: frameOf.get(c.id), children };
  };

  const roots: TreeItem[] = [];
  for (const c of cards.filter((c) => !incoming.has(c.id)).sort(byPos)) if (!seen.has(c.id)) roots.push(build(c, ""));
  for (const c of [...cards].sort(byPos)) if (!seen.has(c.id)) roots.push(build(c, "")); // cycles
  return roots;
}

export function toMarkdown(title: string, nodes: AppNode[], edges: NoteEdge[]): string {
  const out = [`# ${title || "Untitled"}`, ""];
  const walk = (it: TreeItem, d: number) => {
    const pad = "  ".repeat(d);
    const label = it.edgeLabel ? `*${it.edgeLabel}* → ` : "";
    const frame = it.frame ? ` \`${it.frame}\`` : "";
    out.push(`${pad}- ${label}**${it.node.data.title || "Untitled"}** _(${it.node.data.kind})_${frame}`);
    for (const l of it.node.data.bullets.split("\n")) {
      if (!l.trim()) continue;
      const indent = Math.floor((l.match(/^ */)?.[0].length ?? 0) / 2);
      out.push(`${pad}  ${"  ".repeat(indent)}- ${l.trim().replace(/^[-*+]\s+/, "")}`);
    }
    it.children.forEach((c) => walk(c, d + 1));
  };
  buildTree(nodes.filter((n) => !(isCard(n) && n.data.ghost)), edges).forEach((r) => walk(r, 0));
  return out.join("\n") + "\n";
}
