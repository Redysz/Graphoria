import { useLayoutEffect, type RefObject } from "react";

const MARGIN = 8;

/**
 * After every render, measures the context-menu element and
 * – shifts it so it stays inside the viewport
 * – adds the `.menuCompact` class when the menu is taller than the viewport
 *
 * The inline `style` set by React (top/left) is overwritten synchronously
 * in useLayoutEffect before the browser paints, so there is no flash.
 */
export function useContextMenuFit(
  ref: RefObject<HTMLDivElement | null>,
  menu: { x: number; y: number } | null,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !menu) return;

    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // Reset compact so we measure natural height first
    el.classList.remove("menuCompact");

    let height = el.offsetHeight;
    let width = el.offsetWidth;

    // If the menu is taller than the viewport, switch to compact mode
    if (height > vh - MARGIN * 2) {
      el.classList.add("menuCompact");
      height = el.offsetHeight;
      width = el.offsetWidth;
    }

    // Adjust top so the menu doesn't overflow the bottom
    let top = menu.y;
    if (top + height > vh - MARGIN) {
      top = Math.max(MARGIN, vh - MARGIN - height);
    }

    // Adjust left so the menu doesn't overflow the right edge
    let left = menu.x;
    if (left + width > vw - MARGIN) {
      left = Math.max(MARGIN, vw - MARGIN - width);
    }

    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  });
}
