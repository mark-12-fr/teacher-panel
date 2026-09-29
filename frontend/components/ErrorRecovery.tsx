"use client";
// Shared crash screen for the Next.js error boundaries (app/error.tsx,
// app/(teacher)/error.tsx, app/global-error.tsx). Instead of a blank page the
// teacher gets a friendly card, and the page tries to heal ITSELF first:
//   • a stale tab after a deploy (missing JS chunk) → one automatic hard reload
//   • any other render crash                        → one automatic re-render
//   • crashed while offline                          → retries the moment the
//                                                      connection comes back
// Auto-recovery runs at most once per 30s per page, so a crash that keeps
// happening can never become a reload loop — the manual buttons take over.

import { useEffect, useRef, useState } from "react";

// A tab left open across a deploy asks for a JS chunk that no longer exists.
const CHUNK_RE =
  /ChunkLoadError|Loading chunk|Failed to load chunk|dynamically imported module|Importing a module script failed/i;
const AUTO_RECOVER_WINDOW_MS = 30000;

export default function ErrorRecovery({
  error,
  reset,
  variant = "page",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** "page" renders inside the app shell; "fullscreen" is for crashes outside it. */
  variant?: "page" | "fullscreen";
}) {
  const resetRef = useRef(reset);
  resetRef.current = reset;
  const [recovering, setRecovering] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[recovery] a screen crashed:", error);
    try {
      const isChunk = CHUNK_RE.test(`${error?.name || ""} ${error?.message || ""}`);
      const key = `auto_recover_${isChunk ? "chunk" : window.location.pathname}`;
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last > AUTO_RECOVER_WINDOW_MS) {
        sessionStorage.setItem(key, String(Date.now()));
        if (isChunk) {
          window.location.reload();
          return;
        }
        const timer = setTimeout(() => resetRef.current(), 1200);
        return () => clearTimeout(timer);
      }
    } catch {
      // sessionStorage unavailable — fall through to the manual buttons.
    }
    setRecovering(false);
  }, [error]);

  // Crashed while offline → retry by itself as soon as we're back online.
  useEffect(() => {
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    const onOnline = () => {
      setOffline(false);
      resetRef.current();
    };
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const title = recovering ? "Recovering…" : offline ? "You're offline" : "Something went wrong";
  const message = recovering
    ? "This page hit a problem — recovering it automatically."
    : offline
    ? "This page will retry by itself as soon as you're back online."
    : "This page hit a problem. Your saved data is safe — try again, or reload the page.";

  const button: React.CSSProperties = {
    border: "1px solid var(--border-color, #e2e8f0)",
    background: "var(--card-bg, #fff)",
    color: "var(--text-dark, #111827)",
    borderRadius: 10,
    padding: "9px 16px",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "none",
    display: "inline-block",
  };

  return (
    <div
      role="alert"
      style={{
        minHeight: variant === "fullscreen" ? "100vh" : "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: variant === "fullscreen" ? "var(--main-bg, #eef2ff)" : undefined,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          textAlign: "center",
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--border-color, #e2e8f0)",
          borderRadius: 16,
          padding: "32px 28px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
        }}
      >
        <svg
          width="44"
          height="44"
          viewBox="0 0 24 24"
          fill="none"
          stroke={recovering ? "#3b82f6" : "#d97706"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ marginBottom: 12 }}
        >
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
        <h2 style={{ margin: "0 0 6px", fontSize: "1.15rem", color: "var(--text-dark, #111827)" }}>{title}</h2>
        <p style={{ margin: "0 0 20px", fontSize: "0.9rem", lineHeight: 1.55, color: "var(--text-muted, #6b7280)" }}>{message}</p>
        {!recovering && (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => resetRef.current()}
              style={{ ...button, background: "var(--accent-blue, #3b82f6)", color: "#fff", borderColor: "transparent" }}
            >
              Try again
            </button>
            <button type="button" onClick={() => window.location.reload()} style={button}>
              Reload page
            </button>
            <a href="/dashboard" style={button}>
              Go to Dashboard
            </a>
          </div>
        )}
        {error?.digest && !recovering && (
          <p style={{ margin: "16px 0 0", fontSize: "0.7rem", color: "var(--text-muted, #9ca3af)" }}>Ref: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
