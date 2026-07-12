"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface PageMeta {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

interface PageMetaContextType {
  meta: PageMeta;
  setMeta: (m: PageMeta) => void;
}

const PageMetaContext = createContext<PageMetaContextType>({
  meta: { title: "", subtitle: "" },
  setMeta: () => {},
});

export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<PageMeta>({ title: "" });
  return (
    <PageMetaContext.Provider value={{ meta, setMeta }}>
      {children}
    </PageMetaContext.Provider>
  );
}

export function usePageMeta(title: string, subtitle?: string, action?: ReactNode) {
  const { setMeta } = useContext(PageMetaContext);
  useEffect(() => {
    setMeta({ title, subtitle, action });
  }, [title, subtitle, action, setMeta]);
}

export function usePageMetaValue() {
  return useContext(PageMetaContext).meta;
}
