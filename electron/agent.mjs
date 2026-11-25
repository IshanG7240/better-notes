import Anthropic from "@anthropic-ai/sdk";

/**
 * "Ask about the board" agent: answers in prose, looks things up with tools instead of guessing,
 * and can STAGE changes (new cards, links, edits) that the app shows as suggestions to accept or reject.
 * Nothing here touches the real board; the renderer applies the staged ops.
 */

const SYSTEM = `You are the assistant inside a personal thinking canvas (a graph of small note cards joined by labelled links, grouped into frames).
The user asks you about their board. Be a sharp, direct thinking partner.

How to work:
- ANSWER the question in plain prose first. Short, concrete, grounded in what is actually on the board. Refer to cards by their exact title in **bold**. No filler, no restating the question.
- Do not guess about the board's contents. The snapshot you get lists every card title and the groups; use search_cards / get_card to read details before you claim something about them.
- If the question needs judgement (risks, gaps, trade-offs, what to do next), give your actual opinion and the reasoning, not a menu of options.
- If the question cannot be answered from the board, say so plainly, then answer from general knowledge and mark that part as general knowledge.
- If the request is ambiguous in a way that changes the answer, ask ONE short clarifying question instead of guessing.
- Only change the board (propose_cards / propose_edit / propose_links / propose_delete / propose_unlink) when the user asks to add, change, expand, restructure or fix something, or when a concrete addition is clearly the point of the answer. In your answer, say in one line what you changed. Never claim a change you did not make with a tool. Use propose_delete / propose_unlink only when the user asks to remove, merge, dedupe or clean up something (or the task below says so), and give a one-line reason for each. When merging duplicates, propose_edit the card you keep and propose_delete the other.
- New cards: title max 8 words; 2-5 bullets, each a terse fragment (max 14 words); kind is idea | question | risk | task | note. Connect every new card to something with a 1-3 word label. Do not duplicate existing cards: search first.
- Earlier turns of this conversation are included as plain text; they were produced with the same tools. Do not second-guess or apologise for them unless you spot a concrete error.
- Call independent lookups (search_cards / get_card) together in a single step instead of one at a time.
- Do EVERY part of the request in this turn (cards, links, frames, edits). Never tell the user to do something one of your tools can do, and never say a tool cannot do something without trying it. Cards you stage this turn can be grouped and linked right away: use their refs (e.g. "c1") as ids in propose_group / propose_links.
- When the user adds guidance to a button (shown as "Extra guidance" / "Guidance"), it overrides the button's default task: follow it exactly (scope, number of cards, frames, focus).
- Format: markdown. Short paragraphs or tight bullet lists. No headings unless the answer has several distinct parts.`;

const TOOLS = [
  {
    name: "search_cards",
    description: "Find cards whose title or bullets mention the given words. Use this before making claims about a topic. Returns up to 12 matches.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Words to look for (any order, case-insensitive)." } }, required: ["query"] },
  },
  {
    name: "get_card",
    description: "Read one card in full: title, kind, bullets, group, and every link in or out.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "Exact card id." } }, required: ["id"] },
  },
  {
    name: "list_groups",
    description: "List the frames (groups) on the board with the titles of the cards inside each.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "propose_cards",
    description: "Stage NEW cards as suggestions. Add a link only for a real relationship (leads to, part of, supports, contradicts, risk for); most cards need none. When expanding a card, link each child to it with part_of.",
    input_schema: {
      type: "object",
      properties: {
        cards: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ref: { type: "string", description: "Temporary name for this new card, e.g. n1." },
              title: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
              kind: { type: "string", enum: ["idea", "question", "risk", "task", "note"] },
              links: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    to: { type: "string", description: "Existing card id, or ref of another new card." },
                    label: { type: "string", description: "1-3 words, or empty." },
                    type: { type: "string", enum: ["leads_to", "part_of", "supports", "contradicts", "risk_for", "relates"], description: "leads_to (this comes first/causes), part_of, supports, contradicts, risk_for, relates (rare)." },
                    direction: { type: "string", enum: ["out", "in"], description: "out = this card -> other (default), in = other -> this card." },
                  },
                  required: ["to"],
                },
              },
            },
            required: ["ref", "title", "bullets", "kind", "links"],
          },
        },
      },
      required: ["cards"],
    },
  },
  {
    name: "propose_edit",
    description: "Stage a rewrite of an EXISTING card (shown to the user as a suggestion beside the original). Give only the fields you change.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, title: { type: "string" }, bullets: { type: "array", items: { type: "string" } } },
      required: ["id"],
    },
  },
  {
    name: "propose_delete",
    description: "Suggest REMOVING existing cards (the user sees each as a suggestion and decides). Use sparingly, with a short reason for each. Links attached to a removed card go with it.",
    input_schema: {
      type: "object",
      properties: { cards: { type: "array", items: { type: "object", properties: { id: { type: "string" }, reason: { type: "string", description: "Why, in under 12 words." } }, required: ["id", "reason"] } } },
      required: ["cards"],
    },
  },
  {
    name: "propose_unlink",
    description: "Suggest removing existing links between cards (the user decides).",
    input_schema: {
      type: "object",
      properties: { links: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } } },
      required: ["links"],
    },
  },
  {
    name: "propose_group",
    description: "Put cards into labelled frames (groups). Members are existing card ids, or the refs of cards you staged with propose_cards in this turn, or a mix. Use it to cluster cards by theme, to frame new cards together with the card they expand, or to split an existing frame into finer sub-groups. Each card goes in at most one new group. 2-5 words per title.",
    input_schema: {
      type: "object",
      properties: { groups: { type: "array", items: { type: "object", properties: { title: { type: "string" }, members: { type: "array", items: { type: "string" }, description: "Exact card ids, or refs of cards staged this turn." } }, required: ["title", "members"] } } },
      required: ["groups"],
    },
  },
  {
    name: "propose_links",
    description: "Stage new links between cards: existing card ids, or refs of cards staged this turn.",
    input_schema: {
      type: "object",
      properties: {
        links: {
          type: "array",
          items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, type: { type: "string", enum: ["leads_to", "part_of", "supports", "contradicts", "risk_for", "relates"], description: "Read as: from TYPE to. leads_to = from comes first/causes to; part_of; supports; contradicts; risk_for; relates (rare)." }, label: { type: "string", description: "1-3 words, or empty." } }, required: ["from", "to"] },
        },
      },
      required: ["links"],
    },
  },
];

const AUTONOMY = {
  review: `HOW YOUR CHANGES LAND: everything you stage (cards, links, edits, removals) shows up on the board as a SUGGESTION the user accepts or rejects. Describe changes as proposals ("I suggest…", "I drafted…").`,
  auto: `HOW YOUR CHANGES LAND: new cards, links and edits are applied to the board IMMEDIATELY as you stage them (the user can undo). Removals still arrive as suggestions the user must confirm. Be decisive: when the user asks you to do something, do it with the tools instead of asking permission or offering to do it. Describe what you did in the past tense ("Added…", "Reworded…"). Do all parts of a multi-part request.`,
  full: `HOW YOUR CHANGES LAND: everything you stage, including removals, is applied to the board IMMEDIATELY (the user can undo the whole turn). Be decisive and act: do not ask permission or offer to do things you can just do with the tools. Describe what you did in the past tense. Do all parts of a multi-part request, and keep removals to what was asked or is clearly redundant.`,
};

const MODES = {
  group: `TASK (button "Group"): Cluster the SELECTED cards (the whole board if none are selected) into meaningful themed groups with propose_group. Read the cards first (get_card on the unclear ones). Aim for 2-6 groups of 2+ cards each, titled in 2-5 words; leave a card ungrouped if it does not fit anywhere. If the selection is already one frame, split it into finer sub-groups. Do not change card text.`,
  split: `TASK (button "Split"): Split each SELECTED card that mixes several distinct ideas into smaller, single-idea cards. For each such card: propose_edit it so it keeps only its first/main idea (and a tighter title), then propose_cards for the other ideas, each linked back to the original card with a short label like "part of" or "from". Leave cards that are already focused alone, and say which. Keep every fact; do not invent content. Do NOT delete the original.`,
  expand: `TASK (button "Expand"): For each SELECTED card, stage 2-6 child cards with propose_cards that deepen it: sub-points, concrete steps, examples, options or sub-components, whichever fits. Link each child from its parent. Search first so you do not repeat what is already on the board. If the user gave extra guidance (a focus, how many cards, put them in a frame, and so on), follow it over these defaults; to frame the new cards, call propose_group with their refs (and the parent card's id if it belongs in the frame). Then reply with 1-2 sentences saying what you added. If nothing is selected, say so and stage nothing.`,
  risks: `TASK (button "Risks"): Act as a sharp devil's advocate on the SELECTED cards (the whole board if nothing is selected). Stage "risk" cards (propose_cards) for what could fail, hidden assumptions and edge cases. Each risk names the failure and has one bullet with a mitigation. Link each to the card it threatens with a label like "threatens". Then reply with 2-3 sentences: which risk worries you most and why.`,
  gaps: `TASK (button "Gaps"): Find what is MISSING from the SELECTED cards (the whole board if nothing is selected): unanswered questions, undefined decisions, missing steps, unclear owners or metrics. Stage them with propose_cards as "question" cards (or "task" when the next action is obvious), linked to the relevant cards. Then reply with 2-3 sentences naming the most important gap.`,
  connect: `TASK (button "Links"): Look ONLY for missing relationships between EXISTING cards. Read the cards that look related (get_card) and stage links with propose_links where a genuine dependency, contradiction, sequence or shared theme exists and no link is there yet. Label each link with its reason in 1-3 words. Be selective: only strong, non-obvious links. Do not create cards. Reply with 1-2 sentences.`,
  dump: `TASK (button "From text"): The user pasted messy text (below). Turn it into cards. Find the real themes, make one card per distinct point or cluster, and link them with meaningful relationships (cause, dependency, sequence, part-of). Aim for 6-25 cards depending on size; you may call propose_cards several times. Preserve the user's own wording and facts; do not invent content. Open questions become "question" cards, concrete to-dos become "task" cards. Link to existing board cards where the text clearly relates. Then reply with 1-2 sentences.`,
  rewrite: `TASK (button "Rewrite"): Rewrite ONLY the SELECTED cards according to the instruction, using propose_edit once per card (exact id). Keep the meaning and every fact unless the instruction says otherwise; do not invent facts. Title max 8 words; bullets stay terse fragments unless the instruction asks for more detail. Light markdown (**bold**, \`code\`, '- [ ]' task prefix) is fine. Do not add or remove cards. Reply with one sentence.`,
  doc: `TASK (button "Doc"): Write a clean, well-structured Markdown document from the board (only the SELECTED cards and what they directly connect to, if any are selected). Cards are the content; links give the structure (order, dependency, hierarchy). Group related cards under headings, use bullets and short paragraphs, keep the user's wording and facts, put open questions and risks in their own sections, and do not invent facts. Read cards with get_card as needed. Do NOT stage any changes. Your final message must be ONLY the Markdown document, with no preamble.`,
};

const RANK = ["low", "medium", "high", "xhigh", "max"];
const MODE_EFFORT = { rewrite: "low", split: "low", group: "low", expand: "low", connect: "medium", dump: "medium" };
/** Cheap, mechanical actions don't need the user's full effort setting; never exceed it. */
function effortFor(mode, user, guided = false) {
  const want = guided ? null : MODE_EFFORT[mode]; // the user's own instructions get the full effort setting
  if (!want || RANK.indexOf(user) < 0) return user;
  return RANK[Math.min(RANK.indexOf(want), RANK.indexOf(user))];
}
/** One moving cache breakpoint on the newest user turn so each loop step reuses the previous steps. */
function markCache(messages) {
  for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.cache_control) delete b.cache_control;
  const m = messages[messages.length - 1];
  if (m.role !== "user") return;
  if (typeof m.content === "string") m.content = [{ type: "text", text: m.content }];
  m.content[m.content.length - 1].cache_control = { type: "ephemeral" };
}

const GROUP_TOOLS = [
  {
    name: "search_group",
    description: "Search the cards of the OTHER boards in this board's group (read-only). Returns up to 12 matches as {boardId/cardId} with the board name.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Words to look for." } }, required: ["query"] },
  },
  {
    name: "read_group_card",
    description: "Read one card from another board in the group, with its links.",
    input_schema: { type: "object", properties: { board: { type: "string", description: "boardId from search_group." }, id: { type: "string", description: "cardId from search_group." } }, required: ["board", "id"] },
  },
];
const KINDS = new Set(["idea", "question", "risk", "task", "note"]);
const short = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export async function runAgent(req, cfg, emit = () => {}, signal) {
  if (!cfg.apiKey) throw new Error("No API key set. Open Settings and paste your Anthropic API key.");
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const { question, board, selectedIds = [], history = [], mode = "ask", autonomy = "auto", siblings = [], groupName = "", guided = false } = req;
  const sel = new Set(selectedIds);
  const byId = new Map(board.nodes.map((n) => [n.id, n]));
  const groupOf = new Map();
  for (const g of board.groups ?? []) for (const m of g.members) groupOf.set(m, g.title || "Group");

  const staged = { nodes: [], edges: [], edits: [], deletes: [], unlinks: [], groups: [] };
  const trace = [];
  const refs = new Set();

  const card = (id) => byId.get(id);
  const line = (n) => `[${n.id}] (${n.kind}) ${n.title || "(untitled)"}${groupOf.has(n.id) ? `  — in "${groupOf.get(n.id)}"` : ""}`;

  const BIG = board.nodes.length > 60;
  const neighbours = new Set();
  if (BIG) for (const e of board.edges) { if (sel.has(e.from)) neighbours.add(e.to); if (sel.has(e.to)) neighbours.add(e.from); }
  let listed = board.nodes;
  let trimNote = "";
  if (BIG) {
    const per = new Map();
    listed = board.nodes.filter((n) => {
      if (sel.has(n.id) || neighbours.has(n.id)) return true;
      const g = groupOf.get(n.id) ?? "";
      const c = (per.get(g) ?? 0) + 1;
      per.set(g, c);
      return c <= (g ? 8 : 15);
    });
    trimNote = `\n(Large board: ${board.nodes.length - listed.length} cards are not listed. Use search_cards to find them.)`;
  }
  const snapshot =
    `BOARD SNAPSHOT: ${board.nodes.length} cards, ${board.edges.length} links, ${(board.groups ?? []).length} groups.\n` +
    (board.groups?.length ? `Groups:\n${board.groups.map((g) => `- "${g.title || "Group"}": ${g.members.length} cards`).join("\n")}\n\n` : "\n") +
    `Cards (titles only; use get_card for details):\n${listed.map(line).join("\n") || "(empty board)"}${trimNote}`;
  const selText = sel.size ? `The user has ${sel.size} card(s) selected: ${[...sel].slice(0, 40).map((id) => `[${id}] ${short(byId.get(id)?.title || "(untitled)", 40)}`).join("; ")}. "this" / "these" probably refers to them.\n\n` : "";

  // other boards in this board's group (read-only)
  const sibs = new Map(siblings.map((b) => [b.id, b]));
  const sibNote = siblings.length
    ? `\n\nBOARD GROUP "${groupName}": this board belongs to a group with ${siblings.length} other board(s), read-only to you: ${siblings.map((b) => `"${b.name}" (${b.nodes.length} cards)`).join("; ")}. Use search_group / read_group_card when the question could draw on them (related notes, prior decisions, overlap). Cite the board name and the card title (in bold) when you use something from it; never show raw ids to the user. Never propose changes to them; to reuse an idea, propose a NEW card on the current board that says where it came from.`
    : "";
  const tools = {
    search_group({ query }) {
      const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
      const hits = [];
      for (const b of siblings) for (const n of b.nodes) {
        const hay = `${n.title}\n${n.bullets}`.toLowerCase();
        const score = words.reduce((t, w) => t + (n.title.toLowerCase().includes(w) ? 3 : 0) + (hay.includes(w) ? 1 : 0), 0);
        if (score > 0) hits.push({ b, n, score });
      }
      hits.sort((a, b) => b.score - a.score);
      const top = hits.slice(0, 12);
      emit({ text: `Searched the group for “${short(query, 40)}” — ${top.length} match${top.length === 1 ? "" : "es"}` });
      if (!top.length) return "No cards in the other boards of this group match.";
      return top.map(({ b, n }) => `{${b.id}/${n.id}} "${b.name}" › (${n.kind}) ${n.title || "(untitled)"}\n   ${short(n.bullets.replace(/\n+/g, " · "), 160)}`).join("\n");
    },
    read_group_card({ board: bid, id }) {
      const b = sibs.get(bid);
      const n = b?.nodes.find((x) => x.id === id);
      if (!n) return { error: `No card ${id} in board ${bid}. Use the ids from search_group, written as {boardId/cardId}.` };
      emit({ text: `Read “${short(n.title || "Untitled", 40)}” from “${short(b.name, 30)}”` });
      const t = (x) => b.nodes.find((c) => c.id === x)?.title ?? x;
      const out = b.edges.filter((e) => e.from === id).map((e) => `  → ${t(e.to)}${e.label ? ` (${e.label})` : ""}`);
      const inn = b.edges.filter((e) => e.to === id).map((e) => `  ← ${t(e.from)}${e.label ? ` (${e.label})` : ""}`);
      return `"${b.name}" › (${n.kind}) ${n.title}\n${n.bullets || "(no bullets)"}\nLinks out:\n${out.join("\n") || "  none"}\nLinks in:\n${inn.join("\n") || "  none"}`;
    },
    search_cards({ query }) {
      const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
      const hits = board.nodes
        .map((n) => {
          const hay = `${n.title}\n${n.bullets}`.toLowerCase();
          const score = words.reduce((t, w) => t + (n.title.toLowerCase().includes(w) ? 3 : 0) + (hay.includes(w) ? 1 : 0), 0);
          return { n, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);
      emit({ text: `Searched “${short(query, 40)}” — ${hits.length} match${hits.length === 1 ? "" : "es"}` });
      if (!hits.length) return "No cards match.";
      return hits.map(({ n }) => `${line(n)}\n   ${short(n.bullets.replace(/\n+/g, " · "), 160)}`).join("\n");
    },
    get_card({ id }) {
      const n = card(id);
      if (!n) return { error: `No card with id ${id}.` };
      emit({ text: `Read “${short(n.title || "Untitled", 40)}”` });
      const out = board.edges.filter((e) => e.from === id).map((e) => `  → ${card(e.to)?.title ?? e.to}${e.label ? ` (${e.label})` : ""} [${e.to}]`);
      const inn = board.edges.filter((e) => e.to === id).map((e) => `  ← ${card(e.from)?.title ?? e.from}${e.label ? ` (${e.label})` : ""} [${e.from}]`);
      return `${line(n)}\n${n.bullets || "(no bullets)"}\nLinks out:\n${out.join("\n") || "  none"}\nLinks in:\n${inn.join("\n") || "  none"}`;
    },
    list_groups() {
      emit({ text: "Looked at the groups" });
      if (!board.groups?.length) return "There are no groups (frames) on this board.";
      return board.groups.map((g) => `"${g.title || "Group"}": ${g.members.map((m) => card(m)?.title || m).join("; ")}`).join("\n");
    },
    propose_cards({ cards }) {
      const errors = [];
      const batch = new Set();
      const mark = { nodes: staged.nodes.length, edges: staged.edges.length };
      for (const c of cards ?? []) batch.add(c.ref);
      for (const c of cards ?? []) {
        if (!c.title?.trim()) { errors.push(`card ${c.ref}: empty title`); continue; }
        if (mode === "expand" && !(c.links ?? []).some((l) => byId.has(l.to) || refs.has(l.to) || batch.has(l.to))) {
          errors.push(`card ${c.ref}: must link to an existing card id or another new card`);
          continue;
        }
        const bad = (c.links ?? []).filter((l) => !(byId.has(l.to) || refs.has(l.to) || batch.has(l.to)));
        if (bad.length) { errors.push(`card ${c.ref}: unknown link target(s) ${bad.map((b) => b.to).join(", ")}`); continue; }
        refs.add(c.ref);
        staged.nodes.push({ id: c.ref, title: c.title.trim(), bullets: (c.bullets ?? []).map((b) => String(b).trim()).filter(Boolean), kind: KINDS.has(c.kind) ? c.kind : "idea" });
        for (const l of c.links ?? []) staged.edges.push(l.direction === "in" ? { from: l.to, to: c.ref, label: l.label ?? "", type: l.type } : { from: c.ref, to: l.to, label: l.label ?? "", type: l.type });
      }
      const ok = (cards ?? []).length - errors.length;
      if (ok > 0) emit({ text: `Drafted ${ok} new card${ok === 1 ? "" : "s"}`, apply: { nodes: staged.nodes.slice(mark.nodes), edges: staged.edges.slice(mark.edges) } });
      const made = staged.nodes.slice(mark.nodes).map((n) => `${n.id} "${n.title}"`).join(", ");
      const tail = ok ? ` Refs you can use in propose_group / propose_links this turn: ${made}.` : "";
      return errors.length ? { error: `Some cards were rejected: ${errors.join("; ")}. Fix and call again for just those.${tail}`, accepted: ok } : `Staged ${ok} card(s).${tail}`;
    },
    propose_edit({ id, title, bullets }) {
      const n = card(id);
      if (!n) return { error: `No card with id ${id}.` };
      staged.edits = staged.edits.filter((e) => e.id !== id);
      staged.edits.push({ id, title: title?.trim() || n.title, bullets: (bullets ?? n.bullets.split("\n")).map((b) => String(b).trim()).filter(Boolean) });
      emit({ text: `Editing “${short(n.title || "Untitled", 40)}”`, apply: { edits: [staged.edits[staged.edits.length - 1]] } });
      return `Staged an edit to ${id}.`;
    },
    propose_delete({ cards }) {
      let ok = 0;
      const errors = [];
      for (const c of cards ?? []) {
        if (!byId.has(c.id)) { errors.push(c.id); continue; }
        if (staged.deletes.some((d) => d.id === c.id)) continue;
        staged.deletes.push({ id: c.id, reason: String(c.reason ?? "").slice(0, 120) });
        ok++;
      }
      if (ok) emit({ text: `Removing ${ok} card${ok === 1 ? "" : "s"}`, apply: { deletes: staged.deletes.slice(-ok) } });
      return errors.length ? { error: `Unknown card id(s): ${errors.join(", ")}`, accepted: ok } : `Staged ${ok} removal(s).`;
    },
    propose_unlink({ links }) {
      let ok = 0;
      const errors = [];
      for (const l of links ?? []) {
        if (!board.edges.some((e) => e.from === l.from && e.to === l.to)) { errors.push(`${l.from}->${l.to}`); continue; }
        staged.unlinks.push({ from: l.from, to: l.to });
        ok++;
      }
      if (ok) emit({ text: `Removing ${ok} link${ok === 1 ? "" : "s"}`, apply: { unlinks: staged.unlinks.slice(-ok) } });
      return errors.length ? { error: `No such link(s): ${errors.join(", ")}`, accepted: ok } : `Staged ${ok} link removal(s).`;
    },
    propose_group({ groups }) {
      const used = new Set(staged.groups.flatMap((g) => g.members));
      const errors = [];
      const made = [];
      for (const g of groups ?? []) {
        const members = [...new Set(g.members ?? [])].filter((m) => (byId.has(m) || refs.has(m)) && !used.has(m));
        if (members.length < 2) { errors.push(`"${g.title}": needs at least 2 valid, not-yet-grouped cards`); continue; }
        members.forEach((m) => used.add(m));
        made.push({ title: String(g.title ?? "").trim().slice(0, 40), members });
      }
      staged.groups.push(...made);
      if (made.length) emit({ text: `Grouping into ${made.length} frame${made.length === 1 ? "" : "s"}`, apply: { groups: made } });
      return errors.length ? { error: errors.join("; "), accepted: made.length } : `Grouped ${made.length} frame(s).`;
    },
    propose_links({ links }) {
      let ok = 0;
      const errors = [];
      for (const l of links ?? []) {
        const known = (id) => byId.has(id) || refs.has(id);
        if (!known(l.from) || !known(l.to) || l.from === l.to) { errors.push(`${l.from}->${l.to}`); continue; }
        staged.edges.push({ from: l.from, to: l.to, label: l.label ?? "", type: l.type });
        ok++;
      }
      if (ok) emit({ text: `Linking ${ok} pair${ok === 1 ? "" : "s"} of cards`, apply: { edges: staged.edges.slice(-ok) } });
      return errors.length ? { error: `Unknown or invalid: ${errors.join(", ")}`, accepted: ok } : `Staged ${ok} link(s).`;
    },
  };

  const messages = [
    ...history.slice(-8).flatMap((h) => [
      { role: "user", content: h.q },
      { role: "assistant", content: (h.a || "(no text answer)") + (h.changes ? `\n\n[Board changes I made in that turn: ${h.changes}]` : "") },
    ]),
    { role: "user", content: `${selText}${mode === "ask" ? "QUESTION" : "REQUEST"}: ${question}` },
  ];

  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let answer = "";
  for (let step = 0; step < 10; step++) {
    emit({ text: "Thinking…", live: true });
    if (signal?.aborted) throw new Error("Stopped.");
    markCache(messages);
    const stream = client.messages.stream({
      model: cfg.model,
      max_tokens: 16000,
      system: [
        { type: "text", text: SYSTEM },
        { type: "text", text: snapshot + sibNote, cache_control: { type: "ephemeral" } },
        { type: "text", text: [AUTONOMY[autonomy] ?? AUTONOMY.auto, MODES[mode]].filter(Boolean).join("\n\n") },
      ],
      tools: siblings.length ? [...TOOLS, ...GROUP_TOOLS] : TOOLS,
      messages,
      ...(cfg.model.includes("haiku") ? {} : { thinking: { type: "adaptive" } }),
      output_config: { effort: effortFor(mode, cfg.effort, guided) },
    }, { signal });
    let acc = "";
    let last = 0;
    emit({ stream: "" });
    stream.on("text", (d) => {
      acc += d;
      const now = Date.now();
      if (now - last > 60) { last = now; emit({ stream: acc }); }
    });
    const res = await stream.finalMessage();
    if (acc) emit({ stream: acc });
    for (const k of Object.keys(usage)) usage[k] += res.usage?.[k] ?? 0;
    if (process.env.BN_DEBUG) console.log("[agent]", mode, "step", step, JSON.stringify({ in: res.usage?.input_tokens, out: res.usage?.output_tokens, cw: res.usage?.cache_creation_input_tokens, cr: res.usage?.cache_read_input_tokens, effort: effortFor(mode, cfg.effort, guided) }));
    if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
    messages.push({ role: "assistant", content: res.content });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) answer = text;
    if (res.stop_reason !== "tool_use") {
      if (res.stop_reason === "max_tokens") answer = (answer ? answer + "\n\n" : "") + "_(The answer was cut off — ask me to continue.)_";
      break;
    }
    const results = [];
    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      let out;
      try {
        out = tools[b.name] ? tools[b.name](b.input ?? {}) : { error: `Unknown tool ${b.name}` };
      } catch (err) {
        out = { error: String(err?.message || err) };
      }
      const isErr = typeof out === "object" && out && "error" in out;
      trace.push(`${b.name}${isErr ? ` ✗ ${String(out.error).slice(0, 160)}` : " ✓"}`);
      results.push({ type: "tool_result", tool_use_id: b.id, content: typeof out === "string" ? out : JSON.stringify(out), ...(isErr ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
    if (step === 9) answer = answer || "I ran out of steps before finishing. Try a narrower question.";
  }

  return { data: { answer: answer || "(No answer.)", ops: { summary: "", nodes: staged.nodes, edges: staged.edges }, edits: staged.edits, deletes: staged.deletes, unlinks: staged.unlinks, groups: staged.groups, steps: trace.length, trace }, usage };
}
