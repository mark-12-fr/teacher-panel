"use client";
// TelegramLink — lets the teacher link their Telegram so attendance/score
// notifications also arrive as Telegram messages (even with all browsers
// closed). Click → opens t.me link → teacher sends /start → auto-detected.

import { useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";

interface Status {
  configured?: boolean;
  linked?: boolean;
  first_name?: string | null;
  bot_username?: string | null;
}

export default function TelegramLink() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    apiGet<Status>("/api/telegram/status")
      .then(setStatus)
      .catch(() => setStatus({ linked: false }));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function link() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ configured?: boolean; url?: string | null }>("/api/telegram/link");
      if (!res.configured) {
        alert("Telegram is not configured yet. The admin needs to add the bot token.");
        return;
      }
      if (!res.url) {
        alert("Could not start the Telegram link. Try again in a moment.");
        return;
      }
      window.open(res.url, "_blank");
      let tries = 0;
      pollRef.current = setInterval(async () => {
        tries += 1;
        try {
          const s = await apiGet<Status>("/api/telegram/status");
          setStatus(s);
          if (s.linked && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setBusy(false);
          }
        } catch {
          // keep polling
        }
        if (tries > 40 && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setBusy(false);
        }
      }, 2500);
    } catch {
      setBusy(false);
    }
  }

  async function unlink() {
    if (busy) return;
    setBusy(true);
    try {
      await apiDelete("/api/telegram/unlink");
      setStatus({ linked: false });
    } catch {
      // ignore
    }
    setBusy(false);
  }

  const linked = !!status?.linked;
  const label = linked
    ? status?.first_name
      ? `TG: ${status.first_name}`
      : "Telegram ✓"
    : "Telegram";

  return (
    <button
      onClick={linked ? unlink : link}
      title={
        linked
          ? `Linked to ${status?.first_name || "your Telegram"} — click to unlink`
          : "Link Telegram: get a message whenever facilitators submit attendance or scores, even with all browsers closed"
      }
      style={{
        width: 40,
        height: 40,
        borderRadius: "50%",
        border: "none",
        cursor: "pointer",
        background: linked ? "rgba(37,211,102,0.15)" : "var(--input-bg, #f1f5f9)",
        color: linked ? "#25d366" : "var(--text-muted, #64748b)",
        fontSize: 17,
        marginLeft: 8,
        flex: "none",
        position: "relative",
      }}
    >
      <i
        className={linked ? "fa-brands fa-telegram" : "fa-solid fa-paper-plane"}
        style={{ opacity: busy ? 0.4 : 1 }}
      />
      {busy && (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 15 }} />
        </span>
      )}
    </button>
  );
}
