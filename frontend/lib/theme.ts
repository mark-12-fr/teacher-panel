"use client";
// Theme (light/dark) — port of the per-page toggleTheme + mjr-theme.js sync.
// Applies data-theme on <html> + localStorage['dashboard_theme'], and mirrors
// the choice to the teacher's profile (profiles.theme) through the API so it
// follows them across devices.

import { apiGet, apiPatch } from "./api";

const THEME_KEY = "dashboard_theme";

export type Theme = "light" | "dark";

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  syncToggleButton(theme);
}

function syncToggleButton(theme: Theme) {
  const icon = document.getElementById("themeIcon");
  const text = document.getElementById("themeText");
  const isDark = theme === "dark";
  if (icon) icon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  if (text) text.textContent = isDark ? "Light Mode" : "Dark Mode";
}

export function toggleTheme() {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  // best-effort cross-device push
  apiPatch("/api/me", { theme: next }).catch(() => {});
}

/** Sync theme across devices: local preference wins, else pull from profile. */
export async function pullTheme() {
  let local: Theme | null = null;
  try { const t = localStorage.getItem(THEME_KEY); if (t === "dark" || t === "light") local = t; } catch {}

  if (local) {
    applyTheme(local);
    // Best effort push local to profile for cross-device sync
    try {
      const r = await apiGet("/api/me");
      const profile = r?.profile?.theme;
      if (profile !== local) apiPatch("/api/me", { theme: local }).catch(() => {});
    } catch {}
  } else {
    // No local preference — pull from profile
    try {
      const r = await apiGet("/api/me");
      const t = r?.profile?.theme;
      if (t === "dark" || t === "light") applyTheme(t);
    } catch {}
  }
}

// The no-flash snippet injected in <head> (runs before paint).
export const NO_FLASH_THEME = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;
