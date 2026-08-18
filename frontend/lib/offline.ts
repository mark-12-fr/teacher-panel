"use client";

// Small offline helpers shared across the teacher app. The service worker keeps
// the app SHELL available offline; these keep the app's own writes sane when
// there's no connection — mirroring the faci panel's offline utilities.

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// Run `task` as soon as connectivity returns. De-duplicated by `key`: arming the
// same key again replaces the pending task (latest wins) instead of stacking
// listeners, so repeated offline saves don't all fire N times on reconnect.
//
// Callers pass a closure that RE-RUNS the app's existing save path (which reads
// live state), so we never snapshot payloads here — reconnect just replays the
// already-tested, idempotent save. That keeps offline writes correct without a
// second, parallel write implementation to keep in sync.
const pending = new Map<string, () => void | Promise<void>>();
let listening = false;

function flushAll() {
  const tasks = Array.from(pending.values());
  pending.clear();
  for (const task of tasks) {
    try {
      Promise.resolve(task()).catch(() => {});
    } catch {
      /* a failing task must not block the others */
    }
  }
}

export function runWhenOnline(key: string, task: () => void | Promise<void>): void {
  if (typeof window === "undefined") return;
  // Already online (rare: the failure wasn't strictly offline) — run now.
  if (navigator.onLine) {
    try {
      Promise.resolve(task()).catch(() => {});
    } catch {
      /* ignore */
    }
    return;
  }
  pending.set(key, task);
  if (!listening) {
    listening = true;
    window.addEventListener("online", flushAll);
  }
}
