import type { NoteEdge } from "./types";

/**
 * Link types. Each has a fixed direction:
 *   leads_to   A → B   A comes first / causes / enables B
 *   part_of    A → B   A is a part, child or example of B
 *   supports   A → B   A is evidence or an argument for B
 *   contradicts A → B  A conflicts with B
 *   risk_for   A → B   A threatens B
 *   relates    A — B   loose reference, no order
 * Only leads_to and part_of carry order, so only they shape layouts.
 */
export type LinkType = "leads_to" | "part_of" | "supports" | "contradicts" | "risk_for" | "relates";
export const LINK_TYPES: { id: LinkType; label: string; tip: string }[] = [
  { id: "leads_to", label: "leads to", tip: "Comes before, causes or enables" },
  { id: "part_of", label: "part of", tip: "Is a part, child or example of" },
  { id: "supports", label: "supports", tip: "Evidence or argument for" },
  { id: "contradicts", label: "contradicts", tip: "Conflicts with" },
  { id: "risk_for", label: "risk for", tip: "Threatens" },
  { id: "relates", label: "related", tip: "Loose reference, no order" },
];
const IDS = new Set(LINK_TYPES.map((t) => t.id));
export const isLinkType = (x: unknown): x is LinkType => typeof x === "string" && IDS.has(x as LinkType);

/** Best guess from a free-text label (for older links and labels the user types). */
export function guessType(label?: unknown): LinkType {
  const l = typeof label === "string" ? label.toLowerCase() : "";
  if (!l) return "leads_to";
  if (/\b(part of|segment of|example|child|member|belongs|in |inside|sub|type of|kind of|one of|where)\b/.test(l)) return "part_of";
  if (/\b(risk|threat|endanger|blocks?|hurts?)\b/.test(l)) return "risk_for";
  if (/\b(contradict|conflict|challenge|versus|vs\.?|against|tension|but)\b/.test(l)) return "contradicts";
  if (/\b(support|evidence|proves?|backs?|because|why|reason|justif|explain|answer)/.test(l)) return "supports";
  if (/\b(relat|see|similar|same|like|also|ref|mention)/.test(l)) return "relates";
  return "leads_to"; // then, leads to, causes, enables, builds on, depends on, starts with…
}

export const typeOf = (e: NoteEdge): LinkType => {
  const t = (e.data as { type?: unknown } | undefined)?.type;
  return isLinkType(t) ? t : guessType(e.label);
};

/** Edges that express order, pointed "earlier → later" (parent before its parts). Everything else is ignored by layouts. */
export function flowEdges(edges: NoteEdge[]): NoteEdge[] {
  const out: NoteEdge[] = [];
  for (const e of edges) {
    const t = typeOf(e);
    if (t === "leads_to") out.push(e);
    else if (t === "part_of") out.push({ ...e, source: e.target, target: e.source });
  }
  return out;
}
