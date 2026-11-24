import viewer from "./share-viewer.html?raw";
import { CARD_W, frameSize, parentMap } from "./layout";
import { FRAME_COLORS } from "./FrameNode";
import { useStore } from "./store";
import { isCard, isFrame } from "./types";

const VARS = ["--bg", "--bg-img", "--panel", "--panel2", "--card", "--line", "--text", "--muted", "--accent", "--accent-ink", "--shadow", "--ui-font", "--notefont", "--idea", "--question", "--risk", "--task", "--note"];

/** One self-contained HTML file: the board as it looks now, read-only, no network, works on a phone. */
export function buildShareHtml(): { name: string; html: string } {
  const { board } = useStore.getState();
  const cs = getComputedStyle(document.documentElement);
  const vars = VARS.map((v) => [v, cs.getPropertyValue(v).trim()]).filter(([, val]) => val).map(([v, val]) => `${v}:${val}`).join(";");
  const dark = (cs.colorScheme || "").includes("dark");
  const pm = parentMap(board.nodes);
  const nodes = board.nodes
    .filter((n) => !(isCard(n) && n.data.ghost))
    .map((n) => {
      if (isFrame(n)) {
        const { w, h } = frameSize(n);
        return { id: n.id, type: "frame", x: Math.round(n.position.x), y: Math.round(n.position.y), w: Math.round(w), h: Math.round(h), title: n.data.title, color: FRAME_COLORS[n.data.color % FRAME_COLORS.length] };
      }
      return { id: n.id, type: "card", x: Math.round(n.position.x), y: Math.round(n.position.y), w: Math.round(n.width ?? CARD_W), title: n.data.title, bullets: n.data.bullets, kind: n.data.kind, parent: pm.get(n.id) ?? "" };
    });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = board.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && !e.data?.ghost).map((e) => ({ s: e.source, t: e.target, label: typeof e.label === "string" ? e.label : "" }));
  const data = JSON.stringify({ name: board.name, nodes, edges }).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, " ");
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = viewer.replace("__TITLE__", esc(board.name || "Board")).replace("__VARS__", vars + (dark ? ";color-scheme:dark" : ";color-scheme:light")).replace("/*DATA*/null", () => data);
  return { name: board.name || "board", html };
}

export async function shareBoard() {
  const st = useStore.getState();
  const { name, html } = buildShareHtml();
  const res = await window.api.share.save(name, html);
  if (res.ok) useStore.setState({ note: `Saved a read-only copy. Open it in any browser, or send the file to your phone.` });
  else if (res.error) useStore.setState({ error: res.error });
  void st;
}
