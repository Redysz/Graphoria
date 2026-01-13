import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppSettings } from "./appSettingsStore";

type TooltipPlacement = "top" | "bottom";

type TooltipState = {
  text: string;
  anchorRect: DOMRect;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function findTooltipElement(start: Element | null): Element | null {
  let el: Element | null = start;
  while (el) {
    const t = el.getAttribute("title");
    const stored = el.getAttribute("data-graphoria-tooltip-title");
    if ((t && t.trim()) || (stored && stored.trim())) return el;
    el = el.parentElement;
  }
  return null;
}

function getTooltipText(el: Element): string | null {
  const t = el.getAttribute("title");
  if (t && t.trim()) return t.trim();
  const stored = el.getAttribute("data-graphoria-tooltip-title");
  if (stored && stored.trim()) return stored.trim();
  return null;
}

function suppressNativeTitle(el: Element) {
  const existingStored = el.getAttribute("data-graphoria-tooltip-title");
  if (existingStored && existingStored.trim()) {
    el.removeAttribute("title");
    return;
  }
  const t = el.getAttribute("title");
  if (t == null) return;
  el.setAttribute("data-graphoria-tooltip-title", t);
  el.removeAttribute("title");
}

function restoreNativeTitle(el: Element) {
  const stored = el.getAttribute("data-graphoria-tooltip-title");
  if (stored == null) return;
  el.setAttribute("title", stored);
}

export default function TooltipLayer() {
  const tooltipSettings = useAppSettings((s) => s.general.tooltips);

  const [state, setState] = useState<TooltipState | null>(null);
  const [layout, setLayout] = useState<{ top: number; left: number; placement: TooltipPlacement; ready: boolean }>({
    top: 0,
    left: 0,
    placement: "bottom",
    ready: false,
  });

  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const currentTargetRef = useRef<Element | null>(null);
  const pendingTextRef = useRef<string | null>(null);

  const showTimerRef = useRef<number | null>(null);
  const autoHideTimerRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (autoHideTimerRef.current) {
      window.clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  };

  const closeTooltip = (restoreTitle: boolean) => {
    clearTimers();
    pendingTextRef.current = null;

    const el = currentTargetRef.current;
    currentTargetRef.current = null;

    if (restoreTitle && el) {
      restoreNativeTitle(el);
    }

    setState(null);
    setLayout((p) => ({ ...p, ready: false }));
  };

  const renderTooltip = tooltipSettings.enabled && tooltipSettings.mode === "custom" && state;

  const autoHideMs = useMemo(() => {
    const n = Number(tooltipSettings.autoHideMs);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n);
  }, [tooltipSettings.autoHideMs]);

  useEffect(() => {
    const shouldAllowNative = tooltipSettings.enabled && tooltipSettings.mode === "native";
    if (shouldAllowNative) {
      const els = document.querySelectorAll("[data-graphoria-tooltip-title]");
      els.forEach((el) => restoreNativeTitle(el));
    }
    closeTooltip(shouldAllowNative);
  }, [tooltipSettings.enabled, tooltipSettings.mode, tooltipSettings.showDelayMs, tooltipSettings.autoHideMs]);

  useEffect(() => {
    if (!renderTooltip) {
      setLayout((p) => ({ ...p, ready: false }));
    }
  }, [renderTooltip, state?.text]);

  useEffect(() => {
    const shouldAllowNative = tooltipSettings.enabled && tooltipSettings.mode === "native";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTooltip(shouldAllowNative);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (tooltipRef.current) {
        const tipRect = tooltipRef.current.getBoundingClientRect();
        if (e.clientX >= tipRect.left && e.clientX <= tipRect.right && e.clientY >= tipRect.top && e.clientY <= tipRect.bottom) {
          return;
        }
      }

      const target = document.elementFromPoint(e.clientX, e.clientY);
      const el = findTooltipElement(target);

      if (!el) {
        closeTooltip(shouldAllowNative);
        return;
      }

      const text = getTooltipText(el);
      if (!text) {
        closeTooltip(shouldAllowNative);
        return;
      }

      if (!tooltipSettings.enabled) {
        suppressNativeTitle(el);
        closeTooltip(false);
        currentTargetRef.current = el;
        return;
      }

      if (tooltipSettings.mode !== "custom") {
        closeTooltip(true);
        return;
      }

      suppressNativeTitle(el);

      if (currentTargetRef.current === el && (state?.text === text || pendingTextRef.current === text)) return;

      closeTooltip(false);
      currentTargetRef.current = el;
      pendingTextRef.current = text;

      const delay = Math.max(0, Number(tooltipSettings.showDelayMs) || 0);
      showTimerRef.current = window.setTimeout(() => {
        const rect = el.getBoundingClientRect();
        pendingTextRef.current = null;
        setState({ text, anchorRect: rect });

        if (autoHideMs > 0) {
          autoHideTimerRef.current = window.setTimeout(() => {
            closeTooltip(false);
          }, autoHideMs);
        }
      }, delay);
    };

    const onPointerLeaveDoc = () => {
      closeTooltip(shouldAllowNative);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (tooltipRef.current && tooltipRef.current.contains(e.target)) return;
      closeTooltip(shouldAllowNative);
    };

    const onScroll = () => closeTooltip(shouldAllowNative);
    const onResize = () => closeTooltip(shouldAllowNative);

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerleave", onPointerLeaveDoc, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerleave", onPointerLeaveDoc, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      closeTooltip(shouldAllowNative);
    };
  }, [autoHideMs, tooltipSettings.enabled, tooltipSettings.mode, tooltipSettings.showDelayMs]);

  useLayoutEffect(() => {
    if (!renderTooltip) return;

    const tip = tooltipRef.current;
    if (!tip) return;

    const tipRect = tip.getBoundingClientRect();
    const margin = 10;
    const gap = 10;

    const preferredBelowTop = state.anchorRect.bottom + gap;
    const preferredAboveTop = state.anchorRect.top - gap - tipRect.height;

    const canPlaceBelow = preferredBelowTop + tipRect.height + margin <= window.innerHeight;
    const canPlaceAbove = preferredAboveTop >= margin;

    const placement: TooltipPlacement = canPlaceBelow ? "bottom" : canPlaceAbove ? "top" : "bottom";

    const rawTop = placement === "bottom" ? preferredBelowTop : preferredAboveTop;
    const top = clamp(rawTop, margin, window.innerHeight - margin - tipRect.height);

    const centerX = state.anchorRect.left + state.anchorRect.width / 2;
    const left = clamp(centerX, margin + tipRect.width / 2, window.innerWidth - margin - tipRect.width / 2);

    setLayout({ top, left, placement, ready: true });
  }, [renderTooltip, state]);

  if (!renderTooltip) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      className={layout.ready ? "graphoriaTooltip graphoriaTooltipVisible" : "graphoriaTooltip"}
      role="tooltip"
      style={{
        top: layout.ready ? layout.top : -10000,
        left: layout.ready ? layout.left : -10000,
        visibility: layout.ready ? "visible" : "hidden",
      }}
    >
      <div className="graphoriaTooltipText">{state.text}</div>
      {autoHideMs > 0 ? <div className="graphoriaTooltipProgress" style={{ animationDuration: `${autoHideMs}ms` }} /> : null}
    </div>,
    document.body,
  );
}
