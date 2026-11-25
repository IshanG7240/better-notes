import { useEffect } from "react";

/**
 * Close a dropdown / menu when the user clicks or taps anywhere outside it, presses Escape, or leaves the window.
 * Listens in the capture phase: the canvas stops mouse events from bubbling (to pan and select), so a plain
 * window listener never hears a click on the board.
 * `inside(target)`: true when the target belongs to the menu (or to the button that opens it).
 */
export function useDismiss(open: boolean, inside: (t: Node) => boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: Event) => { if (!(e.target instanceof Node) || !inside(e.target)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
