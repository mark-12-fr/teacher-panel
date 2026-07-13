"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

// Global "+" quick-add FAB, rendered by TeacherShell on every page so the
// button never disappears when navigating (it sits just above the AI button,
// same spot the per-page FABs use).
//
// Pages that already render their OWN "+" FAB keep it — the global one hides
// there so exactly one + is on screen at all times:
//   /section, /class-record, /attendance, /performance  → SectionPickerList's
//   "Add New Section" FAB
//   /section/[id]      → "Add New Student" FAB
//   /facilitators      → "Assign New Facilitator" FAB
//   /grading-system    → "Add New Subject" FAB
// Everywhere else (dashboard, about, help, and the class-record / attendance /
// performance detail pages) this FAB opens a quick-add menu. Targets carry
// ?add=1 so the destination page auto-opens its add modal on arrival.
const NATIVE_FAB_ROUTES = [
  /^\/section(\/|$)/,
  /^\/facilitators\/?$/,
  /^\/grading-system\/?$/,
  /^\/class-record\/?$/,
  /^\/attendance\/?$/,
  /^\/performance\/?$/,
];

export default function QuickAddFab() {
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);

  if (NATIVE_FAB_ROUTES.some((re) => re.test(pathname))) return null;

  // On a class detail page the most likely intent is adding a student to THIS
  // class — surface that first, wired to the same section id.
  const detail = pathname.match(/^\/(class-record|attendance|performance)\/([^/]+)\/?$/);

  const go = (href: string) => {
    setOpen(false);
    window.location.href = href; // full reload, same as the sidebar links
  };

  return (
    <>
      {open && <div className="quick-add-backdrop" onClick={() => setOpen(false)} />}
      <div className={`quick-add-menu${open ? " show" : ""}`}>
        {detail && (
          <button onClick={() => go(`/section/${detail[2]}?add=1`)}>
            <i className="fa-solid fa-user-plus" /> Add Student (this class)
          </button>
        )}
        {!detail && (
          <button onClick={() => go("/section")}>
            <i className="fa-solid fa-user-plus" /> Add Student
          </button>
        )}
        <button onClick={() => go("/section?add=1")}>
          <i className="fa-solid fa-layer-group" /> New Section
        </button>
        <button onClick={() => go("/facilitators?add=1")}>
          <i className="fa-solid fa-users" /> Assign Facilitator
        </button>
        <button onClick={() => go("/grading-system?add=1")}>
          <i className="fa-solid fa-percent" /> New Subject
        </button>
      </div>
      <button
        className={`quick-add-fab${open ? " open" : ""}`}
        title="Quick add"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i className="fa-solid fa-plus" />
      </button>
    </>
  );
}
