import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { repoNameFromPath } from "../utils/text";

export function RepoTabs(props: {
  repos: string[];
  activeRepoPath: string;
  tabDragPath: string;
  setActiveRepoPath: (next: string) => void;
  setSelectedHash: (next: string) => void;
  setTabDragPath: (next: string) => void;
  closeRepository: (repoPath: string) => void | Promise<void>;
  setRepos: Dispatch<SetStateAction<string[]>>;
  captureTabRects: () => void;
  tabsRef: RefObject<HTMLDivElement | null>;
  tabSuppressClickRef: MutableRefObject<boolean>;
}) {
  const {
    repos,
    activeRepoPath,
    tabDragPath,
    setActiveRepoPath,
    setSelectedHash,
    setTabDragPath,
    closeRepository,
    setRepos,
    captureTabRects,
    tabsRef,
    tabSuppressClickRef,
  } = props;

  return (
    <div className="tabs" ref={tabsRef}>
      {repos.length === 0 ? <div style={{ opacity: 0.7, padding: "8px 4px" }}>No repository opened</div> : null}
      {repos.map((p) => (
        <div
          key={p}
          data-repo-path={p}
          className={`tab ${p === activeRepoPath ? "tabActive" : ""}${tabDragPath === p ? " tabDragging" : ""}`}
          onClick={() => {
            if (tabSuppressClickRef.current) {
              tabSuppressClickRef.current = false;
              return;
            }
            setActiveRepoPath(p);
            setSelectedHash("");
          }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const target = e.target;
            const el = target instanceof HTMLElement ? target : null;
            if (el?.closest?.(".tabClose")) return;

            const from = p;
            const startX = e.clientX;
            const startY = e.clientY;
            const prevUserSelect = document.body.style.userSelect;
            let dragging = false;

            tabSuppressClickRef.current = false;

            const getInsertIndexFromPointer = (clientX: number) => {
              const tabsEl = tabsRef.current;
              if (!tabsEl) return -1;
              const nodes = Array.from(tabsEl.querySelectorAll<HTMLElement>(".tab"));
              if (nodes.length === 0) return 0;
              for (let i = 0; i < nodes.length; i++) {
                const r = nodes[i].getBoundingClientRect();
                const mid = r.left + r.width / 2;
                if (clientX < mid) return i;
              }
              return nodes.length;
            };

            const onMove = (ev: MouseEvent) => {
              const dx = ev.clientX - startX;
              const dy = ev.clientY - startY;
              if (!dragging) {
                if (Math.hypot(dx, dy) < 4) return;
                dragging = true;
                tabSuppressClickRef.current = true;
                document.body.style.userSelect = "none";
                setTabDragPath(from);
              }

              const rawInsert = getInsertIndexFromPointer(ev.clientX);
              if (rawInsert < 0) return;

              captureTabRects();
              setRepos((prev) => {
                const curFromIdx = prev.indexOf(from);
                if (curFromIdx < 0) return prev;

                let insertAt = rawInsert;
                if (rawInsert > curFromIdx) insertAt -= 1;

                const next = prev.slice();
                next.splice(curFromIdx, 1);
                insertAt = Math.max(0, Math.min(next.length, insertAt));
                if (insertAt === curFromIdx) return prev;
                next.splice(insertAt, 0, from);
                return next;
              });
            };

            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
              document.body.style.userSelect = prevUserSelect;

              if (!dragging) return;

              setTabDragPath("");
            };

            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
        >
          <div style={{ fontWeight: 900 }}>{repoNameFromPath(p)}</div>
          <button
            type="button"
            className="tabClose"
            onClick={(e) => {
              e.stopPropagation();
              void closeRepository(p);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
