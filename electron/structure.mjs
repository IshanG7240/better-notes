import Anthropic from "@anthropic-ai/sdk";

/**
 * Structure pipeline for "From text" and "Arrange with AI". Layered, but only where the job changes:
 *   0. parse  (code)      find the author's own structure (headings, lists) and split long text
 *   1. outline (1 call)   sections -> cards in reading order, duplicates merged  [arrange: sections -> existing card ids]
 *   2. connect (1 call)   a few strong links between the finished cards (import only)
 *   3. check  (code)      caps, dedupe, prefix stripping; the renderer then builds frames and lays them out
 * No tool loop: each AI step is one structured-output call.
 */

const KINDS = ["idea", "question", "risk", "task", "note"];
const WORDS_PER_CHUNK = 2600;

const DETAIL = {
  compact: "COMPACT: exactly ONE card per section. Put each distinct point of the section in it as a bullet (max ~8 bullets); use an indented sub-bullet (two leading spaces) for a supporting detail.",
  normal: "NORMAL: prefer fewer, denser cards. A point gets its own card only if it has 2+ bullets of substance; one-line points of a section go together as bullets of ONE shared card. Usually 1-4 cards per section. Merge points that say the same thing.",
  detailed: "DETAILED: keep finer detail; up to 8 cards per section, still one idea per card.",
};

const IMPORT_SYSTEM = `You turn text into a board of note cards grouped into sections (frames). Output JSON only, matching the schema.

Rules:
- Sections: if the text has headings, use them as the sections IN THE SAME ORDER, with the author's names (shorten if long). Without headings, find 2-7 real themes and order them the way the text flows (context/problem first, then solution, details, then open questions/next steps).
- A one-line summary, tagline or lead sentence goes into "summary", not into a section. Skip meta lines (drafts notices, "see file x" pointers, dates of edits) unless they carry content.
- Cards: one card = one idea. Title max 8 words, plain, specific. NEVER start a title with the section's name or a shared prefix like "Differentiator:" or "Segment:"; the section already says that.
- Bullets: terse fragments (max ~16 words), keep the author's wording and facts, keep concrete examples and numbers. Do not invent anything.
- Kinds: "question" for open questions/unknowns, "risk" for risks/unproven assumptions, "task" for concrete to-dos, "note" for facts/context, otherwise "idea".
- Every card belongs to exactly one section; keep the order of the text inside each section.`;

const ARRANGE_SYSTEM = `You reorganize the user's existing note cards into sections (frames) so the board reads like a well-structured document. Output JSON only, matching the schema.

Rules:
- Use 2-8 sections with short, specific titles (2-5 words). Order sections the way a reader should go through them (context/problem first, then solution and details, then open questions/next steps).
- Inside each section, order the card ids in reading order.
- Use every card id exactly once. Put a card in "loose" only if it truly fits nowhere (rare).
- If the cards already sit in sensible sections (shown as "current frame"), keep those sections and their names unless they are clearly wrong.
- Do not rewrite cards; you only choose sections and order.

The user's guidance (if any) comes first and overrides the rules above:
- If it limits the arrange to some cards ("only the new cards", "those 8 cards", "just the SYSPRO ones"), put ONLY those cards in sections and list every other id in "untouched". Untouched cards stay exactly where they are, in their current frames. Use the recent conversation to work out which cards the user means: it lists the ids of cards added or changed in earlier turns.
- If it asks to put cards into an existing frame, use that frame's exact title (from "Current frames") as the section title; the cards are added to that frame.
- Otherwise "untouched" is empty.`;

const LINK_SYSTEM = `You add the few links that matter between note cards on a board. Output JSON only, matching the schema.
- Only strong, explicit relationships. Do NOT link cards just because they are in the same section; sections already group them.
- At most one link per 3 cards; zero links is fine.
- Pick a type, and point the link the way the type reads ("from" TYPE "to"):
  leads_to (from comes first / causes / enables to), part_of (from is a part or example of to), supports (from is evidence for to),
  contradicts (from conflicts with to), risk_for (from threatens to), relates (loose reference; use rarely).
- Label: 1-3 words that say the specific relation ("causes", "answers", "blocks launch"), or empty if the type says it all.
- Never link two cards that say the same thing; that is a duplicate, not a link.`;

const CONDENSE_SYSTEM = `You condense a board of note cards into FEWER, denser cards without losing information. Output JSON only, matching the schema.
Rules:
- Merge cards that cover the same topic, repeat each other, or are one-line fragments of one idea. The target count is a ceiling to aim under, not a quota: never merge unrelated ideas to hit it; ending above it is fine.
- Test for each merge: its title must name ONE topic without "and", ";" or a list. If you need "X and Y" or "X; Y", do not merge.
- Only merge cards from the SAME current section (shown as "section"). Cards with no section merge only with each other.
- A merged card: a specific title (max 8 words), bullets that keep every distinct fact, number and example from its sources (dedupe repeats; max 10 bullets, terse fragments), and the most fitting kind.
- "from" lists the ids of the source cards it replaces, in reading order. Every input id appears in exactly one output card. A card that merges with nothing is output with just its own id and its text unchanged.
- Do not invent anything.`;

const OUTLINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          cards: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
                kind: { type: "string", enum: KINDS },
              },
              required: ["title", "bullets", "kind"],
            },
          },
        },
        required: ["title", "cards"],
      },
    },
  },
  required: ["title", "summary", "sections"],
};

const ARRANGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" }, ids: { type: "array", items: { type: "string" } } },
        required: ["title", "ids"],
      },
    },
    loose: { type: "array", items: { type: "string" } },
    untouched: { type: "array", items: { type: "string" } },
  },
  required: ["sections", "loose", "untouched"],
};

const LINK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    links: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { from: { type: "string" }, to: { type: "string" }, type: { type: "string", enum: ["leads_to", "part_of", "supports", "contradicts", "risk_for", "relates"] }, label: { type: "string" } },
        required: ["from", "to", "type", "label"],
      },
    },
  },
  required: ["links"],
};

const CONDENSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          from: { type: "array", items: { type: "string" } },
          title: { type: "string" },
          bullets: { type: "array", items: { type: "string" } },
          kind: { type: "string", enum: KINDS },
        },
        required: ["from", "title", "bullets", "kind"],
      },
    },
  },
  required: ["cards"],
};

// ---------------------------------------------------------------- layer 0: parse
/** The author's own structure: markdown headings (and how many list items), used to steer and to split long text. */
export function parseStructure(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const heads = [];
  let listItems = 0;
  lines.forEach((l, i) => {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) heads.push({ level: m[1].length, title: m[2].replace(/[*_`]/g, "").trim(), line: i });
    else if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) listItems++;
  });
  // the section level is the shallowest heading level that appears more than once
  const levels = [...new Set(heads.map((h) => h.level))].sort();
  const secLevel = levels.find((lv) => heads.filter((h) => h.level === lv).length > 1) ?? levels[0];
  const docTitle = heads.length && heads[0].level < (secLevel ?? 9) ? heads[0].title : "";
  const sections = heads.filter((h) => h.level === secLevel);
  // words under each section heading (up to the next heading of the same or higher level)
  sections.forEach((h) => {
    let end = lines.length;
    const next = heads.find((x) => x.line > h.line && x.level <= h.level);
    if (next) end = next.line;
    h.words = lines.slice(h.line + 1, end).join(" ").split(/\s+/).filter(Boolean).length;
  });
  return { lines, sections, docTitle, listItems, words: text.split(/\s+/).filter(Boolean).length };
}

/** Split long text at section headings into chunks of roughly WORDS_PER_CHUNK words (never mid-section if avoidable). */
function chunk(text, parsed) {
  if (parsed.words <= WORDS_PER_CHUNK * 1.3) return [text];
  const cuts = parsed.sections.length > 1 ? parsed.sections.map((s) => s.line) : [];
  const blocks = [];
  if (cuts.length) {
    const starts = [0, ...cuts.filter((c) => c > 0)];
    for (let i = 0; i < starts.length; i++) blocks.push(parsed.lines.slice(starts[i], starts[i + 1] ?? parsed.lines.length).join("\n"));
  } else {
    blocks.push(...text.split(/\n\s*\n/)); // paragraphs
  }
  const out = [];
  let cur = "";
  const wc = (s) => s.split(/\s+/).filter(Boolean).length;
  for (const b of blocks) {
    if (cur && wc(cur) + wc(b) > WORDS_PER_CHUNK) { out.push(cur); cur = ""; }
    cur += (cur ? "\n\n" : "") + b;
  }
  if (cur) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- calls
async function callJson(client, cfg, { system, user, schema, effort, maxTokens = 16000 }, signal, usage) {
  const stream = client.messages.stream({
    model: cfg.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    ...(cfg.model.includes("haiku") ? {} : { thinking: { type: "adaptive" } }),
    output_config: { effort, format: { type: "json_schema", schema } },
  }, { signal });
  const res = await stream.finalMessage();
  for (const k of Object.keys(usage)) usage[k] += res.usage?.[k] ?? 0;
  if (process.env.BN_DEBUG) console.log("[structure]", JSON.stringify({ in: res.usage?.input_tokens, out: res.usage?.output_tokens, stop: res.stop_reason, effort }));
  if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (res.stop_reason === "max_tokens") throw new Error("The text is too long to structure in one go. Paste a shorter part.");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The model returned malformed output. Try again.");
  }
}

const capEffort = (want, user) => {
  const order = ["low", "medium", "high", "xhigh", "max"];
  return order[Math.min(order.indexOf(want), Math.max(0, order.indexOf(user || "medium")))];
};

// ---------------------------------------------------------------- layer 3: check
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Drop "Prefix: " when the prefix repeats the section name or is shared by several cards in the section. */
export function stripPrefixes(sectionTitle, titles) {
  const pre = (t) => { const m = /^([^:]{2,32}):\s+(.{3,})$/.exec(t); return m ? { p: norm(m[1]), rest: m[2] } : null; };
  const counts = new Map();
  for (const t of titles) { const x = pre(t); if (x) counts.set(x.p, (counts.get(x.p) ?? 0) + 1); }
  const stem = (w) => w.slice(0, 5);
  const secWords = new Set(norm(sectionTitle).split(" ").filter((w) => w.length > 3).map(stem));
  return titles.map((t) => {
    const x = pre(t);
    if (!x || x.p.split(" ").length > 3) return t;
    const echoes = x.p.split(" ").some((w) => w.length > 3 && secWords.has(stem(w)));
    if (echoes || (counts.get(x.p) ?? 0) >= 2) return x.rest.charAt(0).toUpperCase() + x.rest.slice(1);
    return t;
  });
}

function checkOutline(o) {
  const seen = new Set();
  const sections = [];
  for (const s of o.sections ?? []) {
    const raw = (s.cards ?? []).filter((c) => String(c.title ?? "").trim() || (c.bullets ?? []).some((b) => String(b).trim()));
    const titles = stripPrefixes(s.title, raw.map((c) => String(c.title ?? "").trim() || "Untitled"));
    const cards = [];
    raw.forEach((c, i) => {
      const key = norm(titles[i]);
      if (key && seen.has(key)) return; // exact duplicate title elsewhere: keep the first
      seen.add(key);
      cards.push({
        title: titles[i].slice(0, 90),
        bullets: (c.bullets ?? []).map((b) => String(b).replace(/^\s*[-*•]\s+/, "").replace(/\s+$/, "")).filter((b) => b.trim()).slice(0, 12),
        kind: KINDS.includes(c.kind) ? c.kind : "idea",
      });
    });
    if (cards.length) sections.push({ title: String(s.title ?? "").trim().slice(0, 60) || "Notes", cards });
  }
  return { title: String(o.title ?? "").trim().slice(0, 80), summary: String(o.summary ?? "").trim(), sections };
}

// ---------------------------------------------------------------- entry points
export async function runImport({ text, detail = "normal", boardTitles = [] }, cfg, emit, signal) {
  if (!cfg.apiKey) throw new Error("No API key set. Open Settings and paste your Anthropic API key.");
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const parsed = parseStructure(text);
  const parts = chunk(text, parsed);
  // a short opening section (or one called "one line", "summary", "tl;dr"…) is the tagline, not a section
  const isLead = (sec, i) => /^(one[- ]?line|tl;?dr|summary|tagline|overview|in short)\b/i.test(sec.title) || (i === 0 && sec.words < 30);
  const lead = parsed.sections.filter(isLead).slice(0, 1);
  const keep = parsed.sections.filter((sec) => !lead.includes(sec));
  const hint = parsed.sections.length >= 2
    ? `The text has its own structure. Its sections, in order: ${keep.map((s) => `"${s.title}"`).join(", ")}${parsed.docTitle ? ` (document title: "${parsed.docTitle}")` : ""}. Keep them as the sections.${lead.length ? ` "${lead[0].title}" is a tagline, not a section: put it in "summary".` : ""}`
    : "The text has no headings: find the sections yourself.";
  emit({ text: parsed.sections.length >= 2 ? `Found ${parsed.sections.length} sections in your text` : "Reading your text" });

  // layer 1: outline (one call per chunk for long text)
  const outlines = [];
  for (let i = 0; i < parts.length; i++) {
    if (signal?.aborted) throw new Error("Stopped.");
    emit({ text: parts.length > 1 ? `Outlining part ${i + 1} of ${parts.length}…` : "Writing the outline…", live: true });
    outlines.push(checkOutline(await callJson(client, cfg, {
      system: IMPORT_SYSTEM,
      user: `${DETAIL[detail] ?? DETAIL.normal}\n${hint}${parts.length > 1 ? `\nThis is part ${i + 1} of ${parts.length} of a longer text; outline only this part.` : ""}${boardTitles.length ? `\nThe board already has cards titled: ${boardTitles.slice(0, 60).map((t) => `"${t}"`).join(", ")}. Do not repeat them.` : ""}\n\nTEXT:\n"""\n${parts[i]}\n"""`,
      schema: OUTLINE_SCHEMA,
      effort: capEffort("medium", cfg.effort),
    }, signal, usage)));
  }
  // merge chunk outlines: same-named sections join
  const merged = { title: outlines[0]?.title || parsed.docTitle, summary: outlines[0]?.summary ?? "", sections: [] };
  for (const o of outlines) for (const s of o.sections) {
    const same = merged.sections.find((x) => norm(x.title) === norm(s.title));
    if (same) same.cards.push(...s.cards); else merged.sections.push({ ...s, cards: [...s.cards] });
  }
  if (!merged.sections.length) throw new Error("Nothing to turn into cards in that text.");
  const n = merged.sections.reduce((t, s) => t + s.cards.length, 0);
  emit({ text: `Outlined ${merged.sections.length} sections, ${n} cards` });

  // layer 2: links between the finished cards (skipped for tiny outlines)
  let links = [];
  if (n >= 4) {
    if (signal?.aborted) throw new Error("Stopped.");
    emit({ text: "Finding the links that matter…", live: true });
    const refs = [];
    merged.sections.forEach((s, si) => s.cards.forEach((c, ci) => refs.push({ ref: `c${si}_${ci}`, s: s.title, c })));
    const list = refs.map((r) => `[${r.ref}] ${r.s} › ${r.c.title} — ${r.c.bullets[0] ?? ""}`).join("\n");
    try {
      const out = await callJson(client, cfg, { system: LINK_SYSTEM, user: `Cards:\n${list}`, schema: LINK_SCHEMA, effort: "low", maxTokens: 4000 }, signal, usage);
      const ok = new Set(refs.map((r) => r.ref));
      const seen = new Set();
      links = (out.links ?? [])
        .filter((l) => ok.has(l.from) && ok.has(l.to) && l.from !== l.to && !seen.has(l.from + ">" + l.to) && seen.add(l.from + ">" + l.to))
        .slice(0, Math.max(1, Math.ceil(n / 3)))
        .map((l) => ({ from: l.from, to: l.to, label: String(l.label ?? "").slice(0, 24) }));
      if (links.length) emit({ text: `Added ${links.length} link${links.length === 1 ? "" : "s"}` });
    } catch (err) {
      if (signal?.aborted) throw err;
      emit({ text: "Skipped links (the link step failed)" });
    }
  }
  const answer = `Made ${merged.sections.length} section${merged.sections.length === 1 ? "" : "s"} with ${n} card${n === 1 ? "" : "s"}${links.length ? ` and ${links.length} link${links.length === 1 ? "" : "s"}` : ""}, in the order of your text.`;
  return { data: { answer, structure: { kind: "import", ...merged, links }, ops: { summary: "", nodes: [], edges: [] }, steps: parts.length + (n >= 4 ? 1 : 0) }, usage };
}

/** The last few assistant turns as plain text, so follow-ups like "those 8 cards" can be resolved. */
const recentTurns = (history = []) =>
  history.slice(-3).map((h) => `- User: ${String(h.q).slice(0, 600)}\n  Assistant: ${String(h.a ?? "").slice(0, 400)}${h.changes ? `\n  Changes made: ${String(h.changes).slice(0, 1500)}` : ""}`).join("\n");

export async function runArrange({ cards, frames = [], guidance = "", history = [] }, cfg, emit, signal) {
  if (!cfg.apiKey) throw new Error("No API key set. Open Settings and paste your Anthropic API key.");
  if (cards.length < 3) throw new Error("Arrange needs at least 3 cards.");
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  emit({ text: `Reading ${cards.length} cards…`, live: true });
  const list = cards.map((c) => `[${c.id}] (${c.kind}) ${c.title || "(untitled)"}${c.frame ? `  — current frame "${c.frame}"` : ""}\n   ${c.bullets.split("\n").filter(Boolean).slice(0, 3).join(" · ").slice(0, 200)}`).join("\n");
  const out = await callJson(client, cfg, {
    system: ARRANGE_SYSTEM,
    user: `${guidance ? `USER GUIDANCE (follow it): ${guidance}\n\n` : ""}${history.length ? `Recent conversation:\n${recentTurns(history)}\n\n` : ""}${frames.length ? `Current frames: ${frames.map((f) => `"${f}"`).join(", ")}\n` : ""}Cards in their current reading order:\n${list}`,
    schema: ARRANGE_SCHEMA,
    effort: capEffort("medium", cfg.effort),
  }, signal, usage);
  // layer 3: every card exactly once; anything missed goes to loose
  const valid = new Set(cards.map((c) => c.id));
  const used = new Set();
  // cards the guidance leaves out stay where they are (only if something is still being arranged)
  const keep = new Set((out.untouched ?? []).filter((id) => valid.has(id)));
  for (const s of out.sections ?? []) for (const id of s.ids ?? []) keep.delete(id);
  if (keep.size >= cards.length) keep.clear();
  const sections = [];
  for (const s of out.sections ?? []) {
    const ids = (s.ids ?? []).filter((id) => valid.has(id) && !used.has(id) && used.add(id));
    if (ids.length) sections.push({ title: String(s.title ?? "").trim().slice(0, 60) || "Notes", ids });
  }
  const loose = cards.map((c) => c.id).filter((id) => !used.has(id) && !keep.has(id));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const renames = [];
  for (const s of sections) {
    const titles = s.ids.map((id) => byId.get(id).title);
    stripPrefixes(s.title, titles).forEach((t, i) => { if (t !== titles[i]) renames.push({ id: s.ids[i], title: t }); });
  }
  emit({ text: `Arranged into ${sections.length} sections` });
  const n = cards.length - loose.length - keep.size;
  const answer = `Arranged ${n} card${n === 1 ? "" : "s"} into ${sections.length} section${sections.length === 1 ? "" : "s"}${sections.length ? ` (${sections.map((s) => `“${s.title}”`).join(", ")})` : ""}${loose.length ? `, ${loose.length} left loose` : ""}${keep.size ? `. Left the other ${keep.size} card${keep.size === 1 ? "" : "s"} where they were` : ""}.`;
  return { data: { answer, structure: { kind: "arrange", sections, loose, renames }, ops: { summary: "", nodes: [], edges: [] }, steps: 1 }, usage };
}

/**
 * Condense: merge overlapping / fragment cards into fewer, denser ones.
 * Returns merges only (2+ sources); untouched cards are not echoed back. Validation: each id used once, sources share a section.
 */
export async function runCondense({ cards, guidance = "" }, cfg, emit, signal) {
  if (!cfg.apiKey) throw new Error("No API key set. Open Settings and paste your Anthropic API key.");
  if (cards.length < 2) throw new Error("Condense needs at least 2 cards.");
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  emit({ text: `Reading ${cards.length} cards…`, live: true });
  const target = Math.max(1, Math.round(cards.length * 0.6));
  const list = cards.map((c) => `[${c.id}] (${c.kind})${c.frame ? ` section "${c.frame}"` : ""} ${c.title || "(untitled)"}\n${c.bullets.split("\n").filter(Boolean).map((b) => "   - " + b.replace(/^[-•*]\s*/, "")).join("\n")}`).join("\n");
  const out = await callJson(client, cfg, {
    system: CONDENSE_SYSTEM,
    user: `${cards.length} cards, target about ${target}.${guidance ? ` Guidance: ${guidance}` : ""}\n\n${list}`,
    schema: CONDENSE_SCHEMA,
    effort: capEffort("medium", cfg.effort),
  }, signal, usage);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const used = new Set();
  const merges = [];
  for (const m of out.cards ?? []) {
    const from = (m.from ?? []).filter((id) => byId.has(id) && !used.has(id));
    if (from.length < 2) continue;
    if (new Set(from.map((id) => byId.get(id).frame ?? "")).size > 1) continue; // never merge across sections
    from.forEach((id) => used.add(id));
    const bullets = [...new Set((m.bullets ?? []).map((b) => String(b).replace(/^[-•*]\s*/, "").trim()).filter(Boolean))].slice(0, 12);
    merges.push({ from, title: String(m.title ?? "").trim().slice(0, 90) || byId.get(from[0]).title, bullets, kind: KINDS.includes(m.kind) ? m.kind : "idea" });
  }
  const gone = merges.reduce((n, m) => n + m.from.length - 1, 0);
  emit({ text: merges.length ? `Merging ${used.size} cards into ${merges.length}` : "Nothing worth merging" });
  const answer = merges.length
    ? `Condensed ${cards.length} cards to ${cards.length - gone}: ${merges.length} merged card${merges.length === 1 ? "" : "s"} replace ${used.size} originals. Links were moved onto the merged cards. Undo puts everything back.`
    : "These cards are already distinct; nothing worth merging.";
  return { data: { answer, structure: { kind: "condense", merges }, ops: { summary: "", nodes: [], edges: [] }, steps: 1 }, usage };
}
