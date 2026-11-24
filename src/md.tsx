import { Fragment, memo, type ReactNode } from "react";

const TOKEN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(https?:\/\/[^\s)]+)|(\*[^*\s][^*\n]*\*)|(\b_[^_\s][^_\n]*_\b)/g;

const SERVICES: [RegExp, string][] = [
  [/^docs\.google\.com\/spreadsheets/, "Google Sheet"],
  [/^docs\.google\.com\/document/, "Google Doc"],
  [/^docs\.google\.com\/presentation/, "Google Slides"],
  [/^docs\.google\.com\/forms|^forms\.gle/, "Google Form"],
  [/^drive\.google\.com/, "Google Drive"],
  [/^meet\.google\.com/, "Google Meet"],
  [/^(www\.)?figma\.com/, "Figma"],
  [/^(www\.)?(youtube\.com|youtu\.be)/, "YouTube"],
  [/^(www\.)?notion\.(so|site)/, "Notion"],
  [/^(www\.)?loom\.com/, "Loom"],
  [/^(www\.)?miro\.com/, "Miro"],
  [/^[\w-]+\.slack\.com/, "Slack"],
  [/^(www\.)?canva\.com/, "Canva"],
];

/** Readable name for a pasted URL: known services by name, GitHub as owner/repo, else the domain + last path bit. */
export function shortLink(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  const host = u.hostname.replace(/^www\./, "");
  for (const [re, name] of SERVICES) if (re.test(host + u.pathname)) return name;
  const segs = u.pathname.split("/").filter(Boolean);
  if (host === "github.com" && segs.length >= 2) return `GitHub · ${segs[0]}/${segs[1]}`;
  let last = segs.length ? decodeURIComponent(segs[segs.length - 1]).replace(/[-_]+/g, " ") : "";
  if (last.length > 28) last = last.slice(0, 27) + "…";
  return last && !/^\d+$/.test(last) ? `${host} · ${last}` : host;
}

export function Inline({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index!;
    if (i > last) out.push(text.slice(last, i));
    const t = m[0];
    if (m[1]) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}><Inline text={t.slice(2, -2)} /></strong>);
    else if (m[3]) out.push(<s key={k++}><Inline text={t.slice(2, -2)} /></s>);
    else if (m[4]) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      out.push(<a key={k++} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>);
    } else if (m[5]) out.push(<a key={k++} className="linkchip" href={t} title={t} target="_blank" rel="noreferrer">{shortLink(t)}</a>);
    else out.push(<em key={k++}><Inline text={t.slice(1, -1)} /></em>);
    last = i + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/** Nesting depth of a note line: every 2 leading spaces (a tab counts as 2) is one level. */
export const depthOf = (raw: string) => Math.floor((raw.match(/^[ \t]*/)?.[0] ?? "").replace(/\t/g, "  ").length / 2);

/** Renders note text: every line is a bullet unless it is a heading/quote/checkbox. Indented lines nest. */
function MdLinesImpl({ value, onToggle }: { value: string; onToggle?: (line: number) => void }) {
  const lines = value.split("\n");
  return (
    <ul className="md">
      {lines.map((raw, i) => {
        if (!raw.trim()) return null;
        const indent = depthOf(raw);
        const t = raw.trim();
        const style = { marginLeft: `${indent * 1.15}em`, ["--d" as string]: indent };
        const prev = lines.slice(0, i).reverse().find((l) => l.trim());
        const sub = prev !== undefined && indent > depthOf(prev); // first sub-point right under its parent: sits close to it
        let m: RegExpExecArray | null;
        if ((m = /^(#{1,3})\s+(.*)$/.exec(t))) return <li key={i} className={`h h${m[1].length}`} style={style} data-d={Math.min(indent, 2)} data-sub={sub || undefined}><Inline text={m[2]} /></li>;
        if ((m = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(t))) {
          const done = m[1] !== " ";
          return (
            <li key={i} className={`task${done ? " done" : ""}`} style={style} data-d={Math.min(indent, 2)} data-sub={sub || undefined}>
              <input type="checkbox" checked={done} onClick={(e) => e.stopPropagation()} onChange={() => onToggle?.(i)} />
              <span><Inline text={m[2]} /></span>
            </li>
          );
        }
        if ((m = /^>\s?(.*)$/.exec(t))) return <li key={i} className="quote" style={style} data-d={Math.min(indent, 2)} data-sub={sub || undefined}><Inline text={m[1]} /></li>;
        if ((m = /^(\d+)[.)]\s+(.*)$/.exec(t))) return <li key={i} className="num" data-n={m[1]} style={style} data-d={Math.min(indent, 2)} data-sub={sub || undefined}><Inline text={m[2]} /></li>;
        const body = t.replace(/^[-*+]\s+/, "");
        return <li key={i} style={style} data-d={Math.min(indent, 2)} data-sub={sub || undefined}><Inline text={body} /></li>;
      })}
    </ul>
  );
}

/** Memoised on the text: parsing markdown with regexes on every card re-render was wasted work.
 *  (onToggle is always an inline closure over the same value, so only its presence matters.) */
export const MdLines = memo(MdLinesImpl, (a, b) => a.value === b.value && !a.onToggle === !b.onToggle);

export const toggleLine = (value: string, line: number) =>
  value
    .split("\n")
    .map((l, i) => (i === line ? (/\[ \]/.test(l) ? l.replace("[ ]", "[x]") : l.replace(/\[[xX]\]/, "[ ]")) : l))
    .join("\n");

export { Fragment };
