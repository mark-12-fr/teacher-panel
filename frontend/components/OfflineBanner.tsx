"use client";
import { useEffect, useState } from "react";

// Slim status pill shown while the browser is offline, so the teacher knows
// they're viewing saved data and that new edits will sync on reconnect.
// Fixed at the bottom so it never covers the topbar or navigation.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 18,
        transform: "translateX(-50%)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        gap: 9,
        background: "#1f2937",
        color: "#fff",
        padding: "10px 16px",
        borderRadius: 999,
        fontSize: "0.82rem",
        fontWeight: 500,
        lineHeight: 1.3,
        boxShadow: "0 10px 34px rgba(0,0,0,0.28)",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", flex: "0 0 auto" }}
      />
      <span>Offline — showing saved data. Edits will sync when you reconnect.</span>
    </div>
  );
}
