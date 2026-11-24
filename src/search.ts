import type { AppNode } from "./types";

/** All words must appear (any order, case-insensitive) in the title or bullets. */
export const matcher = (q: string) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return (n: AppNode): boolean => {
    if (!words.length) return false;
    const hay = (n.type === "card" ? `${n.data.title}\n${n.data.bullets}` : n.data.title ?? "").toLowerCase();
    return words.every((w) => hay.includes(w));
  };
};
