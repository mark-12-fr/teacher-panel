"use client";
// Shared authenticated shell: sidebar (profile + menu + theme + logout) and a
// topbar with the mobile menu button + page title. Wraps every teacher page.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { apiGet, apiPatch } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import { useRequireAuth, signOut, clearUserCache } from "@/hooks/useAuth";
import { pullTheme, toggleTheme } from "@/lib/theme";
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
  const { loading } = useRequireAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string>("");
  const [avatar, setAvatar] = useState<string>(
    "https://ui-avatars.com/api/?name=Teacher&background=3b82f6&color=fff&size=128"
  );
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Identify the current user BEFORE trusting any cached identity, so a
      // previous user's name/avatar is never shown after an account switch on
      // a shared browser (covers password login, Google OAuth, and session
      // restore alike).
      let uid: string | null = null;
      try {
        const { data } = await getSupabase().auth.getSession();
        uid = data.session?.user?.id ?? null;
      } catch {}
      if (cancelled) return;

      if (uid && localStorage.getItem("cached_user_id") === uid) {
        const cachedName = localStorage.getItem("cached_user_name");
        const cachedAvatar = localStorage.getItem("cached_user_avatar");
        if (cachedName) setName(cachedName);
        if (cachedAvatar) setAvatar(cachedAvatar);
      } else {
        // Unknown or mismatched owner → drop the stale identity (and chat) so
        // it can't be rendered for the wrong account while /api/me loads.
        clearUserCache();
      }

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
          setAvatar(
            `https://ui-avatars.com/api/?name=${encodeURIComponent(p.full_name)}&background=3b82f6&color=fff&size=128`
          );
        }
      } catch {}
      pullTheme();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (loading) {
    return (
      <div className="teacher-page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <i className="fa-solid fa-circle-notch fa-spin" style={{ fontSize: "2rem", color: "#3b82f6" }} />
      </div>
    );
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
          <div className="sidebar-school-year" />
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
