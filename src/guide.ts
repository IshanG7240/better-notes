import { CARD_W, FRAME_PAD } from "./layout";
import type { Board, CardNodeT, FrameNodeT, Kind } from "./types";

type C = [Kind, string, string[]];

/** The "Getting started" board: real cards that teach by doing. One frame per topic, read left to right. */
const SECTIONS: [string, C[]][] = [
  ["1 · Start here", [
    ["note", "Welcome to Better Notes", [
      "An endless canvas for thinking: cards, links and frames",
      "Go through the frames left to right and try each thing",
      "- [ ] Tick the boxes as you go (click them)",
      "Press **?** any time for the full guide; delete this board when you're done",
    ]],
    ["task", "Move around", [
      "- [ ] Drag empty canvas to pan",
      "- [ ] Scroll or pinch to zoom",
      "- [ ] Drag this card by its title to move it",
      "- [ ] Click **Fit** in the toolbar to see everything",
    ]],
    ["task", "Make a card", [
      "- [ ] Double-click empty canvas (or press N)",
      "- [ ] Type a title, then click below it to write notes",
      "- [ ] Select a card and press Tab: a linked child card",
      "- [ ] Select a card and press Delete to remove it",
    ]],
  ]],
  ["2 · Writing notes", [
    ["idea", "Notes are plain text with a little markdown", [
      "Click the notes of a card to edit them; Esc when done",
      "**bold**, *italic* and `code` work; web links become clickable",
      "- [ ] a line starting with \"- [ ]\" is a checkbox",
    ]],
    ["task", "Try nesting points", [
      "- [ ] Edit this card and add a new line under this one",
      "  Press Tab to nest a point under the one above",
      "  Shift+Tab un-nests it",
      "- [ ] Enter continues the list; Enter on an empty point ends it",
    ]],
    ["question", "What type is this card?", [
      "Every card has a type: idea, question, risk, task or note",
      "Click the type chip at the top of a card to change it",
      "Or select cards and press 1–5",
      "- [ ] Make this card a risk: select it and press 3",
    ]],
  ]],
  ["3 · Links and frames", [
    ["idea", "Link this card…", [
      "- [ ] Hover this card to see dots on its edges",
      "- [ ] Drag from a dot and drop anywhere on the card below",
      "Double-click a link to label it; click it to pick a type (leads to, part of, supports…)",
    ]],
    ["idea", "…to this one", [
      "Links show how ideas connect",
      "Ctrl+H hides lines when the board gets busy",
    ]],
    ["task", "Put cards in a frame", [
      "- [ ] Shift+drag on empty canvas to select several cards",
      "- [ ] Press Ctrl+G to put them in a frame",
      "Drag a frame by its title: everything inside moves with it; double-click the title to rename it",
      "Drag a card over a frame: it lights up where your pointer is; let go and the frame makes room for it",
      "Select a frame and drag its edges or corners to resize it; it keeps the size you give it",
      "For an empty frame: Alt+double-click the canvas, press F, or click **Frame** in the toolbar",
    ]],
  ]],
  ["4 · Tidying up", [
    ["note", "Three layout tools, gentlest first", [
      "**Space out** (Ctrl+E): only nudges apart things that overlap",
      "**Line up** (Ctrl+L): lines up linked cards and fixes overlaps",
      "**Pack** (Ctrl+Shift+L): rearranges everything tightly",
      "Frames always fit their cards afterwards",
    ]],
    ["task", "Pin what should stay put", [
      "- [ ] Select a card and click **Pin** in the toolbar",
      "Pinned cards never move with the layout tools",
    ]],
    ["note", "Undo anything", [
      "Ctrl+Z undo · Ctrl+Shift+Z or Ctrl+Y redo",
      "Each board keeps its own undo history while the app is open",
      "Older versions of each board are kept for about a day",
    ]],
  ]],
  ["5 · AI assistant (optional)", [
    ["note", "Turn on the AI", [
      "Needs your own Anthropic API key: ⚙ Settings → AI & usage",
      "Everything else works without it",
      "You pay Anthropic only for what you use; the cost shows in the top bar",
    ]],
    ["idea", "Ask about your board", [
      "Type in the box at the top right, or press Ctrl+J",
      "Answers use your cards; what it changed is listed under the answer",
      "**Undo this turn** reverts everything one answer did",
    ]],
    ["idea", "Buttons for common jobs", [
      "**Expand**: child cards for the selected cards",
      "**Arrange**: sort cards into frames in reading order",
      "**Cluster**, **Split**, **Condense**, **Rewrite**, **Risks**, **Gaps**, **Links**",
      "**From text**: paste messy notes and get cards",
      "**Doc**: write a document from the board",
    ]],
    ["task", "Tell the buttons what you want", [
      "Type instructions in the box, then click a button",
      "Expand: \"focus on costs, put them in a frame\"",
      "Arrange: \"only the selected cards\"",
    ]],
    ["note", "Suggest, Apply or Auto", [
      "**Suggest**: changes show dashed until you accept (Enter) or reject (Esc)",
      "**Apply**: changes land right away; removals still ask first",
      "**Auto**: removals too; you can always undo",
    ]],
  ]],
  ["6 · Good to know", [
    ["note", "Your notes stay on this computer", [
      "Boards save automatically",
      "**Share** saves a read-only web page you can send to anyone",
    ]],
    ["note", "Handy keys", [
      "Ctrl+F search · Ctrl+K command palette · F2 rename the board",
      "Ctrl + / − / 0 zoom the whole app",
      "**?** or F1 opens the guide",
    ]],
  ]],
];

/** rough height before the card is measured: wrapped lines at the card width */
const guessH = (kind: Kind, bullets: string[]) => {
  const perLine = Math.max(30, Math.floor((CARD_W - 40) / 7.3));
  const lines = bullets.reduce((t, b) => t + Math.max(1, Math.ceil(b.length / perLine)), 0);
  return 50 + (kind === "idea" || kind === "note" ? 0 : 26) + lines * 30; // tasks/questions/risks show a type chip
};

export function guideBoard(): Pick<Board, "nodes" | "edges"> {
  const frames: FrameNodeT[] = [];
  const cards: CardNodeT[] = [];
  const GAP = 24, COL = CARD_W + FRAME_PAD.x * 2 + 90;
  SECTIONS.forEach(([title, list], i) => {
    const fx = i * COL;
    let y = FRAME_PAD.top;
    list.forEach(([kind, t, bullets], j) => {
      cards.push({ id: `g${i}_${j}`, type: "card", position: { x: fx + FRAME_PAD.x, y }, data: { title: t, kind, bullets: bullets.join("\n") } });
      y += guessH(kind, bullets) + GAP;
    });
    frames.push({
      id: `gf${i}`, type: "frame", position: { x: fx, y: 0 }, width: CARD_W + FRAME_PAD.x * 2, height: y - GAP + FRAME_PAD.bottom,
      zIndex: -1, style: { pointerEvents: "none" }, dragHandle: ".frame-head", data: { title, color: i },
    });
  });
  return { nodes: [...frames, ...cards], edges: [] };
}

export const GUIDE_NAME = "Getting started";
