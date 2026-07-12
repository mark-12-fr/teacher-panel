"use client";
// Shared authenticated shell: sidebar (profile + menu + theme + logout) and a
// topbar with the mobile menu button + page title. Wraps every teacher page.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { apiGet, apiPatch } from "@/lib/api";
import { API_BASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { useRequireAuth, signOut, clearUserCache } from "@/hooks/useAuth";
import { applyTheme, pullTheme, toggleTheme } from "@/lib/theme";
import { usePageMetaValue } from "@/lib/page-meta";
import AIAssistant from "@/components/AIAssistant";
import "@/app/teacher-shell.css";

export type MenuKey =
  | "dashboard"
  | "section"
  | "class-record"
  | "attendance"
  | "performance"
  | "facilitators"
  | "grading-system"
  | "about"
  | "help";

const MENU: { key: MenuKey; href: string; icon: string; label: string }[] = [
  { key: "dashboard", href: "/dashboard", icon: "fa-table-columns", label: "Dashboard" },
  { key: "section", href: "/section", icon: "fa-layer-group", label: "Section" },
  { key: "class-record", href: "/class-record", icon: "fa-folder-open", label: "Class Record" },
  { key: "attendance", href: "/attendance", icon: "fa-calendar-check", label: "Attendance" },
  { key: "performance", href: "/performance", icon: "fa-arrow-trend-up", label: "Class Performance" },
  { key: "facilitators", href: "/facilitators", icon: "fa-users", label: "Facilitators" },
  { key: "grading-system", href: "/grading-system", icon: "fa-percent", label: "Grading System" },
  { key: "about", href: "/about", icon: "fa-circle-info", label: "About" },
  { key: "help", href: "/help", icon: "fa-circle-question", label: "Help" },
];

function activeFromPath(path: string): MenuKey {
  const seg = path.split("/")[1] || "dashboard";
  if (seg === "dashboard") return "dashboard";
  if (seg === "section") return "section";
  if (seg === "class-record") return "class-record";
  if (seg === "attendance") return "attendance";
  if (seg === "performance") return "performance";
  if (seg === "facilitators") return "facilitators";
  if (seg === "grading-system") return "grading-system";
  if (seg === "about") return "about";
  if (seg === "help") return "help";
  return "dashboard";
}

export default function TeacherShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = activeFromPath(pathname);
  const { title, subtitle, action } = usePageMetaValue();
  useRequireAuth();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(
    "https://ui-avatars.com/api/?name=Teacher&background=3b82f6&color=fff&size=128"
  );
  const [uploading, setUploading] = useState(false);
  const [schoolYear, setSchoolYear] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Read cache synchronously before first paint (hydration may strip SSR defaults)
  useLayoutEffect(() => {
    try {
      const t = localStorage.getItem("dashboard_theme");
      if (t === "dark" || t === "light") applyTheme(t);
    } catch {}
    try {
      const n = localStorage.getItem("cached_user_name");
      if (n) setName(n);
      const a = localStorage.getItem("cached_user_avatar");
      if (a) setAvatar(a);
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      let uid: string | null = null;
      let nameFromMeta = "";
      let pictureFromMeta = "";
      try {
        const { data } = await getSupabase().auth.getSession();
        const u = data.session?.user;
        uid = u?.id ?? null;
        if (u?.user_metadata) {
          nameFromMeta = u.user_metadata.full_name || u.user_metadata.name || "";
          pictureFromMeta = u.user_metadata.picture || u.user_metadata.avatar_url || "";
        }
      } catch {}
      if (cancelled) return;

      const cachedUid = localStorage.getItem("cached_user_id");
      if (uid && cachedUid === uid) {
        const cn = localStorage.getItem("cached_user_name");
        if (cn) setName(cn);
        const ca = localStorage.getItem("cached_user_avatar");
        if (ca) setAvatar(ca);
      } else {
        clearUserCache();
        // Save basic identity from session metadata (works even if /api/me fails)
        if (uid) {
          localStorage.setItem("cached_user_id", uid);
          if (nameFromMeta) {
            localStorage.setItem("cached_user_name", nameFromMeta);
            setName(nameFromMeta);
            if (pictureFromMeta) {
              localStorage.setItem("cached_user_avatar", pictureFromMeta);
              setAvatar(pictureFromMeta);
            } else {
              const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(nameFromMeta)}&background=3b82f6&color=fff&size=128`;
              localStorage.setItem("cached_user_avatar", fallback);
              setAvatar(fallback);
            }
          }
        }
      }

      // Only fetch profile from server if cache is empty (keep cached data stable)
      const hasCachedName = !!localStorage.getItem("cached_user_name");
      if (!hasCachedName) {
        try {
          const r = await apiGet("/api/me");
          if (cancelled) return;
          const p = r?.profile || {};
          if (uid) localStorage.setItem("cached_user_id", uid);
          if (p.full_name) {
            setName(p.full_name);
            localStorage.setItem("cached_user_name", p.full_name);
          }
          if (p.avatar_url) {
            setAvatar(p.avatar_url);
            localStorage.setItem("cached_user_avatar", p.avatar_url);
          } else if (p.full_name) {
            setAvatar(`https://ui-avatars.com/api/?name=${encodeURIComponent(p.full_name)}&background=3b82f6&color=fff&size=128`);
          }
        } catch {}
      }
      pullTheme();
    })();
    return () => { cancelled = true; };
  }, [ready]);

  // ── Server heartbeat + warmup ─────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const warmup = async () => {
      // Warm up Render server + cache initial data
      try { await apiGet("/api/ping") } catch {}
      try { await apiGet("/api/sections") } catch {}
      try { await apiGet("/api/subjects") } catch {}
      // Fetch active school year
      try { const r = await apiGet<any>("/api/active-school-year"); if (r?.school_year) setSchoolYear(r.school_year) } catch {}
    };
    warmup();
    // Heartbeat every 1 second — keeps Render server always warm
    let cancelled = false;
    (async function beat() {
      if (cancelled) return;
      try { await fetch(`${API_BASE}/api/ping`) } catch {}
      if (!cancelled) setTimeout(beat, 1000);
    })();
    return () => { cancelled = true; };
  }, [ready]);

  if (!ready) return <div className="teacher-page" />;

  function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const MAX = 150;
        let w = img.width;
        let h = img.height;
        if (w > h) {
          if (w > MAX) {
            h *= MAX / w;
            w = MAX;
          }
        } else if (h > MAX) {
          w *= MAX / h;
          h = MAX;
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
        const b64 = canvas.toDataURL("image/jpeg", 0.7);
        try {
          await apiPatch("/api/me", { avatar_url: b64 });
          setAvatar(b64);
          localStorage.setItem("cached_user_avatar", b64);
        } catch {}
        setUploading(false);
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="teacher-page">
      <div className={`sidebar-overlay${open ? " active" : ""}`} onClick={() => setOpen(false)} />

      <aside className={`sidebar${open ? " active" : ""}`}>
        <div className="sidebar-top">
          <div className="sidebar-profile">
            <div className="profile-container" onClick={() => fileRef.current?.click()} title="Change Profile Picture">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img id="userAvatar" src={avatar} alt="Profile Picture" style={{ opacity: uploading ? 0.5 : 1 }} />
              <div className="profile-overlay">
                <i className="fa-solid fa-camera" style={{ marginBottom: 3 }} /> Change
              </div>
              <input ref={fileRef} type="file" style={{ display: "none" }} accept="image/png, image/jpeg, image/jpg" onChange={uploadAvatar} />
            </div>
          </div>
          <h2>Teacher Panel</h2>
          <div className="sidebar-username">{name || " "}</div>
          <div className="sidebar-school-year">{schoolYear ? `SY ${schoolYear}` : ""}</div>
        </div>

        <nav className="sidebar-menu">
          {MENU.map((m) => (
            <a key={m.key} href={m.href} className={active === m.key ? "active" : ""} onClick={() => setOpen(false)}>
              <i className={`fa-solid ${m.icon}`} /> {m.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button onClick={toggleTheme} className="theme-btn" style={{ marginBottom: 5 }}>
            <i className="fa-solid fa-moon" id="themeIcon" /> <span id="themeText">Dark Mode</span>
          </button>
          <button onClick={signOut} className="logout-btn">
            <i className="fa-solid fa-right-from-bracket" /> Log out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="topbar" style={{ marginBottom: 25 }}>
          <div className="topbar-header">
            <button className="menu-toggle" onClick={() => setOpen(true)}>
              <i className="fa-solid fa-bars" />
            </button>
            <div className="topbar-title">
              <h1 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: 5 }}>{title}</h1>
              {subtitle && <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
        {children}
      </main>

      <AIAssistant />
    </div>
  );
}
