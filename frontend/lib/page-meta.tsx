"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface PageMeta {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

// Split into two contexts so that pages (which only need setMeta) do NOT
// re-render when `meta` changes. Previously a single context carried
// `{ meta, setMeta }` as a fresh object each render, so every setMeta call
// re-rendered every consumer — including pages. Pages that pass a freshly
// built `action` element (Class Record / Attendance / Class Performance
// detail pages) then produced a new element on that re-render, which changed
// the usePageMeta effect deps, which called setMeta again → "Maximum update
// depth exceeded" and the grid never rendered.
//
// Now only the TopBar (usePageMetaValue) subscribes to `meta`; pages subscribe
// only to the stable useState setter, so setMeta re-renders just the TopBar.
const PageMetaValueContext = createContext<PageMeta>({ title: "" });
const PageMetaSetContext = createContext<(m: PageMeta) => void>(() => {});

export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<PageMeta>({ title: "" });
  return (
    <PageMetaSetContext.Provider value={setMeta}>
      <PageMetaValueContext.Provider value={meta}>
        {children}
      </PageMetaValueContext.Provider>
    </PageMetaSetContext.Provider>
  );
}

export function usePageMeta(title: string, subtitle?: string, action?: ReactNode) {
  // useState's setter has a stable identity, so this context value never
  // changes and calling setMeta does not re-render the calling page.
  const setMeta = useContext(PageMetaSetContext);
  useEffect(() => {
    setMeta({ title, subtitle, action });
  }, [title, subtitle, action, setMeta]);
}

export function usePageMetaValue() {
  return useContext(PageMetaValueContext);
}
