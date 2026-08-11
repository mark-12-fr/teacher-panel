"use client";
// NotificationBell — enables Web Push for the teacher's laptop browser.
// One click subscribes the browser (VAPID) via the backend; from then on every
// facilitator submission (attendance / class record) triggers a notification
// even when the teacher panel tab is closed (browser just needs to be running).

import { useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function NotificationBell() {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem("mjr_push_enabled") === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    if (on) {
      try {
        localStorage.setItem("mjr_push_enabled", "0");
      } catch {}
      setOn(false);
      return;
    }
    setBusy(true);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        alert("This browser does not support push notifications.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      let permission = Notification.permission;
      if (permission !== "granted") {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") {
        return;
      }

      const { key } = await apiGet<{ key: string }>("/api/push/vapid-public-key");
      if (!key) {
        alert("Notifications are not configured yet. Try again later.");
        return;
      }

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
      }

      await apiPost("/api/push/subscribe", {
        endpoint: sub.endpoint,
        subscription: JSON.parse(JSON.stringify(sub)),
      });

      try {
        localStorage.setItem("mjr_push_enabled", "1");
      } catch {}
      setOn(true);
    } catch (err) {
      console.error("Push subscription failed:", err);
      alert("Failed to enable notifications. Check that notifications are allowed for this site in your browser settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      title={on ? "Notifications ON — click to turn off" : "Get notified when facilitators submit attendance or scores"}
      style={{
        width: 40,
        height: 40,
        borderRadius: "50%",
        border: "none",
        cursor: "pointer",
        background: on ? "rgba(34,197,94,0.15)" : "var(--input-bg, #f1f5f9)",
        color: on ? "#16a34a" : "var(--text-muted, #64748b)",
        fontSize: 17,
        marginLeft: 8,
        flex: "none",
        position: "relative",
      }}
    >
      <i className={`fa-solid ${on ? "fa-bell" : "fa-bell-slash"}`} style={{ opacity: busy ? 0.4 : 1 }} />
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
