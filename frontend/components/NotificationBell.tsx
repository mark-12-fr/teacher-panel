"use client";

// NotificationBell — the bell in the topbar, beside the page title.
//
// Shows a badge with the number of unread notifications and, when opened, a
// panel of what the facilitators recently submitted (attendance marks and
// class-record scores). The rows come from /api/notifications, which the push
// webhook writes one entry per coalesced submission — so a whole class's
// scores read as a single line, not one per student.
//
// The feed is polled rather than pushed: the badge only has to be seconds
// fresh, and polling keeps working when the browser has denied Web Push
// permission (which is exactly when the bell matters most). Polling pauses
// while the tab is hidden and refreshes immediately when it comes back, so a
// backgrounded tab doesn't keep hitting the API.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { isOffline } from "@/lib/offline";

type Item = {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  section_label: string | null;
  read: boolean;
  created_at: string | null;
};

const POLL_MS = 45000;

/** "just now" / "5m ago" / "3h ago" / "Aug 27" — compact enough for the row. */
function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const iconFor = (kind: string) =>
  kind === "attendance" ? "fa-solid fa-user-check" : "fa-solid fa-pen-to-square";

export default function NotificationBell() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  // Guards the poll against overlapping requests when a fetch runs long.
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current || isOffline()) return;
    inFlight.current = true;
    try {
      const r = await apiGet<{ items: Item[]; unread: number }>("/api/notifications?limit=20");
      setItems(r.items || []);
      setUnread(r.unread || 0);
    } catch {
      // A failed poll is not worth a toast — the next tick retries.
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Poll while the tab is visible; refresh straight away when it becomes
  // visible again so a teacher returning to the tab sees the badge at once.
  useEffect(() => {
    load();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(load, POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        load();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", load);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setLoading(true);
    await load();
    setLoading(false);
    // Opening the panel is the teacher seeing them, so clear the badge. The
    // rows stay in the list (greyed) rather than disappearing under the cursor.
    if (unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
      apiPost("/api/notifications/read-all").catch(() => {});
    }
  }

  function openItem(item: Item) {
    setOpen(false);
    if (item.url) router.push(item.url);
  }

  async function clearAll() {
    setItems([]);
    setUnread(0);
    try {
      await apiDelete("/api/notifications");
    } catch {
      load(); // put the list back if the server rejected it
    }
  }

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <div className="topbar-bell">
      <button
        ref={btnRef}
        type="button"
        className="topbar-bell-btn"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications — ${unread} unread` : "Notifications"}
        aria-expanded={open}
        title="Notifications"
      >
        <i className={unread > 0 ? "fa-solid fa-bell" : "fa-regular fa-bell"} />
        {unread > 0 && <span className="topbar-bell-badge">{badge}</span>}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          className="topbar-bell-panel"
        >
          <div className="topbar-bell-head">
            <strong style={{ fontSize: "0.95rem", color: "var(--text-dark)" }}>Notifications</strong>
            {items.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                style={{
                  border: "none",
                  background: "none",
                  color: "var(--text-muted)",
                  fontSize: "0.78rem",
                  cursor: "pointer",
                }}
              >
                Clear all
              </button>
            )}
          </div>

          {loading && items.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: "0.86rem" }}>
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: "28px 20px", textAlign: "center", color: "var(--text-muted)" }}>
              <i className="fa-regular fa-bell-slash" style={{ fontSize: "1.6rem", opacity: 0.5 }} />
              <p style={{ marginTop: 10, fontSize: "0.86rem" }}>No notifications yet.</p>
              <p style={{ marginTop: 4, fontSize: "0.78rem" }}>
                You&apos;ll see facilitator attendance and score submissions here.
              </p>
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`topbar-bell-row${item.read ? "" : " is-unread"}`}
                onClick={() => openItem(item)}
                style={{ cursor: item.url ? "pointer" : "default" }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    background: item.kind === "attendance" ? "rgba(16,185,129,0.15)" : "rgba(99,102,241,0.15)",
                    color: item.kind === "attendance" ? "#059669" : "#6366f1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.8rem",
                  }}
                >
                  <i className={iconFor(item.kind)} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: "block",
                      fontWeight: item.read ? 500 : 700,
                      fontSize: "0.84rem",
                      color: "var(--text-dark)",
                    }}
                  >
                    {item.title}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: "0.78rem",
                      color: "var(--text-muted)",
                      marginTop: 2,
                    }}
                  >
                    {item.body}
                  </span>
                  <span style={{ display: "block", fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 3 }}>
                    {timeAgo(item.created_at)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
