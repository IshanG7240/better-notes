import type { ReactNode } from "react";

const P: Record<string, ReactNode> = {
  card: <><rect x="3" y="4" width="14" height="12" rx="2" /><path d="M6 8h8M6 11.5h5" /></>,
  frame: <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" strokeDasharray="3 2.5" />,
  group: <><rect x="2.5" y="3.5" width="15" height="13" rx="2.5" /><rect x="6" y="7" width="3.5" height="3" rx=".8" /><rect x="11" y="10" width="3.5" height="3" rx=".8" /></>,
  organize: <><rect x="3" y="3.5" width="5.5" height="5" rx="1" /><rect x="11.5" y="3.5" width="5.5" height="5" rx="1" /><rect x="3" y="11.5" width="5.5" height="5" rx="1" /><rect x="11.5" y="11.5" width="5.5" height="5" rx="1" /></>,
  fit: <path d="M3 7V3.5h3.5M17 7V3.5h-3.5M3 13v3.5h3.5M17 13v3.5h-3.5" />,
  pin: <><path d="M12.5 3.5l4 4-2.2.8-2.6 2.6.3 3.1-1 1-3-3-4.3 4.3M9 5.5l-1 1 .3 3.1" /><path d="M12.5 3.5L9 7" /></>,
  undo: <path d="M7 5L3.5 8.5 7 12M4 8.5h8a4 4 0 010 8H9" />,
  redo: <path d="M13 5l3.5 3.5L13 12M16 8.5H8a4 4 0 000 8h3" />,
  lines: <path d="M3 14c4 0 3-8 7-8s3 8 7 8" />,
  eye: <><path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10z" /><circle cx="10" cy="10" r="2.3" /></>,
  eyeoff: <><path d="M2.5 10S5.5 4.5 10 4.5 17.5 10 17.5 10 14.5 15.5 10 15.5 2.5 10 2.5 10z" /><circle cx="10" cy="10" r="2.3" /><path d="M3.5 16.5l13-13" /></>,
  text: <><path d="M4 5h12M4 9h12M4 13h7" /></>,
  expand: <path d="M10 4v12M4 10h12" />,
  rewrite: <path d="M4 16l1-3.5L13.5 4a1.6 1.6 0 012.3 2.3L7.5 14.8 4 16z" />,
  risk: <><path d="M10 3.5l7 12.5H3L10 3.5z" /><path d="M10 8.5v3M10 13.7v.1" /></>,
  gap: <><circle cx="10" cy="10" r="6.5" strokeDasharray="3 2.5" /><path d="M10 7v3.5M10 13v.1" /></>,
  link: <path d="M8.5 11.5l3-3M7 9L5.2 10.8a2.7 2.7 0 003.8 3.8L10.8 13M13 11l1.8-1.8A2.7 2.7 0 0011 5.4L9.2 7.2" />,
  doc: <><path d="M5 3h7l3 3v11H5V3z" /><path d="M12 3v3h3M7.5 10h5M7.5 13h5" /></>,
  map: <><rect x="3" y="4" width="14" height="12" rx="2" /><rect x="10" y="9" width="5" height="4.5" rx=".8" /></>,
  settings: <><path d="M3 6h14M3 14h14" /><circle cx="7" cy="6" r="2" fill="var(--bg, transparent)" /><circle cx="13" cy="14" r="2" fill="var(--bg, transparent)" /></>,
  sparkle: <path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6L10 3zM15.5 14.5l.6 1.5 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.5z" />,
  canvas: <><rect x="2.5" y="3.5" width="15" height="13" rx="2.5" /><path d="M2.5 8h15M8 8v8.5" /></>,
  hand: <path d="M7 10V5a1.2 1.2 0 012.4 0v4M9.4 8.5V4a1.2 1.2 0 012.4 0v4.5M11.8 8.5V5.5a1.2 1.2 0 012.4 0V12c0 3-2 5-4.7 5C7 17 6 15.5 5 13.5l-1.2-2.4a1.2 1.2 0 012-1.3L7 11" />,
  type: <path d="M4 5.5V4h12v1.5M10 4v12M7.5 16h5" />,
  chev: <path d="M6 8l4 4 4-4" />,
  send: <path d="M4 10l12-6-4 12-2.5-4.5L4 10z" />,
  stop: <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  terminal: <><rect x="2.5" y="4" width="15" height="12" rx="2" /><path d="M6 8.5l2.5 2L6 12.5M10.5 12.5H14" /></>,
  x: <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />,
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  chevR: <path d="M8 5.5l4.5 4.5L8 14.5" />,
  folder: <path d="M2.8 6.2c0-.9.7-1.6 1.6-1.6h3.2l1.7 2h6.4c.9 0 1.6.7 1.6 1.6v6c0 .9-.7 1.6-1.6 1.6H4.4c-.9 0-1.6-.7-1.6-1.6V6.2z" />,
  folderPlus: <><path d="M2.8 6.2c0-.9.7-1.6 1.6-1.6h3.2l1.7 2h6.4c.9 0 1.6.7 1.6 1.6v6c0 .9-.7 1.6-1.6 1.6H4.4c-.9 0-1.6-.7-1.6-1.6V6.2z" /><path d="M10 9.5v4M8 11.5h4" /></>,
  trash: <path d="M4.5 6h11M8 6V4.3c0-.4.3-.8.8-.8h2.4c.5 0 .8.4.8.8V6M6 6l.6 9.3c0 .5.4.7.8.7h5.2c.4 0 .8-.2.8-.7L14 6" />,
  menu: <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />,
  note: <><rect x="4" y="3.5" width="12" height="13" rx="2.2" /><path d="M7 8h6M7 11.5h4" /></>,
  merge: <><path d="M5 3.5v3c0 2.2 5 2.2 5 4.5v5.5M15 3.5v3c0 2.2-5 2.2-5 4.5" /><path d="M7.5 14l2.5 2.5 2.5-2.5" /></>,
  compact: <><rect x="3.5" y="3.5" width="5.5" height="13" rx="1.2" /><rect x="11" y="3.5" width="5.5" height="7" rx="1.2" /><path d="M11 13.5h5.5M11 16.5h5.5" /></>,
  spread: <><rect x="6.5" y="6" width="7" height="8" rx="1.4" /><path d="M4.5 10H1.5M3 8.5L1.5 10 3 11.5M15.5 10h3M17 8.5l1.5 1.5-1.5 1.5" /></>,
  chat: <path d="M4 5h12v8H9l-3.5 3v-3H4V5z" />,
};

export function Icon({ name, size = 16 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {P[name]}
    </svg>
  );
}
