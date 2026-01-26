import "@testing-library/jest-dom/vitest";

import { vi } from "vitest";

if (!("ResizeObserver" in globalThis)) {
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {
    }
    unobserve() {
    }
    disconnect() {
    }
  };
}

if (!document.elementFromPoint) {
  (document as any).elementFromPoint = () => null;
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
  };
}

if (!(HTMLElement.prototype as any).animate) {
  (HTMLElement.prototype as any).animate = function animate() {
    return { cancel() {} };
  };
}

vi.mock("@tauri-apps/api/core", () => {
  return { invoke: vi.fn() };
});

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn(async () => {
      return () => undefined;
    }),
  };
});

vi.mock("@tauri-apps/plugin-dialog", () => {
  return {
    open: vi.fn(async () => null),
  };
});

vi.mock("../hooks/useGlobalShortcuts", () => {
  return { useGlobalShortcuts: () => undefined };
});

vi.mock("../features/graph/useCyGraph", () => {
  return {
    useCyGraph: () => {
      return {
        graphRef: { current: null },
        zoomPct: 100,
        requestAutoCenter: () => undefined,
        focusOnHash: () => undefined,
        focusOnHead: () => undefined,
        zoomBy: () => undefined,
      };
    },
  };
});

vi.mock("../features/repo/useRepoIndicators", () => {
  return {
    useRepoIndicators: () => {
      return { refreshIndicators: async () => undefined };
    },
  };
});
