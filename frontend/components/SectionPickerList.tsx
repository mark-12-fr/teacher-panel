"use client";

// Shared "section picker" list — the search + card-grid + add/edit/delete UI
// that the Section, Class Record, Attendance, and Class Performance pages all
// show identically (only the page title, cache key, and the card's "View"
// destination differ). Consolidated here so the loading/caching/realtime
// behavior only has to be implemented — and kept correct — once.
import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPatch } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import { usePageMeta } from "@/lib/page-meta";
import { useCachedData } from "@/hooks/use-cached-data";
import { SkeletonSectionCards } from "@/components/Skeleton";
import SmoothSelect from "@/components/SmoothSelect";
import "@/app/(teacher)/section/section.css";

const EMPTY = { title: "", subject: "", room: "", semester: "", quarter: "", school_year: "", school_level: "" };

interface SectionPickerListProps {
  pageTitle: string;
  cacheKey: string;
  viewPath: string;
}

export default function SectionPickerList({ pageTitle, cacheKey, viewPath }: SectionPickerListProps) {
  usePageMeta(pageTitle);
  const [sections, setSections] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ show: boolean; msg: string; err: boolean }>({ show: false, msg: "", err: false });

  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  function showToast(msg: string, err = false) {
    setToast({ show: true, msg, err });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  }

  const fetchSections = useCallback(async () => {
    // /api/sections now includes student_count directly (single JOIN+COUNT on
    // the backend) — no more one follow-up request per section.
    const [secResp, subjResp] = await Promise.all([apiGet("/api/sections"), apiGet("/api/subjects")]);
    const secs = secResp.sections || [];
    const sortedSubjects = (subjResp.subjects || []).map((s: any) => s.name).sort((a: string, b: string) => a.localeCompare(b));
    return { sections: secs, subjects: sortedSubjects };
  }, []);

  const sectionCache = useCachedData(cacheKey, fetchSections, { ttl: 60000 });

  useEffect(() => {
    if (!sectionCache.data) return;
    setSections(sectionCache.data.sections);
    setSubjects(sectionCache.data.subjects);
  }, [sectionCache.data]);

  useEffect(() => {
    if (sectionCache.error) showToast("Failed to load sections", true);
  }, [sectionCache.error]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (target && (target as Element)?.closest?.(".menu-container")) return;
      setOpenMenu(null);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  // Live updates: a section added/edited/deleted elsewhere (another tab, or
  // after a facilitator changes a roster) refreshes this list with no manual
  // reload. No-op if realtime isn't enabled on the DB.
  useEffect(() => {
    let channel: any;
    let cancelled = false;
    (async () => {
      let uid: string | null = null;
      try {
        const { data } = await getSupabase().auth.getSession();
        uid = data.session?.user?.id ?? null;
      } catch {}
      if (cancelled || !uid) return;
      try {
        channel = getSupabase()
          .channel(`teacher-sections-${cacheKey}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "sections" }, (payload: any) => {
            const row = payload.new || payload.old;
            if (String(row?.teacher_id) !== String(uid)) return;
            sectionCache.refresh();
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "students" }, () => {
            // Student adds/removes change the per-card count; cheap to refresh.
            sectionCache.refresh();
          })
          .subscribe();
      } catch {}
    })();
    return () => {
      cancelled = true;
      try {
        if (channel) getSupabase().removeChannel(channel);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

const QUARTER_OPTS =
  form.school_level === "College"
    ? [
        { value: "Prelim", label: "Prelim" },
        { value: "Midterm", label: "Midterm" },
        { value: "Final", label: "Final" },
      ]
    : [
        { value: "1", label: "Q1 - First Quarter" },
        { value: "2", label: "Q2 - Second Quarter" },
        { value: "3", label: "Q3 - Third Quarter" },
        { value: "4", label: "Q4 - Fourth Quarter" },
      ];

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY });
    setModal(true);
  }

  // Quick-add deep link (?add=1 from the global QuickAddFab): auto-open the
  // Add Section modal on arrival. Only on the Sections page — this component
  // also backs the Class Record / Attendance / Performance pickers, where an
  // unexpected modal would be confusing. The param is consumed so refreshing
  // doesn't re-open the modal.
  useEffect(() => {
    if (viewPath !== "/section" || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("add") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
      openAdd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function openEdit(s: any) {
    setEditingId(s.id);
    setForm({
      title: s.title || "",
      subject: s.subject || "",
      room: s.room || "",
      semester: s.semester || "1st Sem",
      quarter: s.quarter ? String(s.quarter) : "",
      school_year: s.school_year || "",
      school_level: s.school_level || "",
    });
    setModal(true);
  }

  async function save() {
    const { title, subject, room, semester, quarter, school_year, school_level } = form;
    if (!title.trim() || !subject || !room.trim() || !semester || !quarter || !school_year) {
      showToast("Please fill in all fields including Semester and Quarter!", true);
      return;
    }
    const payload = { title: title.trim(), subject, room: room.trim(), semester, quarter, school_year, school_level };
    const prevSections = sections;
    // Kill any in-flight refresh (mount/TTL/realtime) so it can't roll this
    // list back to a pre-mutation snapshot when it lands mid-save.
    sectionCache.abortInFlight();
    setModal(false);
    setSearch("");
    if (editingId) {
      setSections((prev) => prev.map((s) => (s.id === editingId ? { ...s, ...payload } : s)));
      showToast("Record updated successfully!");
      try {
        await apiPatch(`/api/sections/${editingId}`, payload);
        sectionCache.refresh();
      } catch {
        showToast("Error saving record.", true);
        setSections(prevSections);
      }
    } else {
      // Optimistic: add a temp section, replace on API success
      const tempId = "temp_" + Date.now();
      const tempSection = { id: tempId, student_count: 0, ...payload };
      setSections((prev) => [tempSection, ...prev]);
      showToast("Record saved successfully!");
      try {
        const resp = await apiPost("/api/sections", payload);
        const created = resp.section;
        setSections((prev) => prev.map((s) => (s.id === tempId ? created : s)));
        sectionCache.refresh();
      } catch {
        showToast("Error saving record.", true);
        setSections((prev) => prev.filter((s) => s.id !== tempId));
      }
    }
  }

  async function del(id: string) {
    if (!window.confirm("Delete this section and ALL of its data? This permanently removes its students, class records, and attendance too — this cannot be undone.")) return;
    const deleted = sections.find((s) => s.id === id);
    sectionCache.abortInFlight();
    setSections((prev) => prev.filter((s) => s.id !== id));
    showToast("Section and all its data deleted.");
    setSearch("");
    try {
      await apiDelete(`/api/sections/${id}`); // backend cascades records/students/attendance
      sectionCache.refresh();
    } catch {
      showToast("Error deleting the section.", true);
      if (deleted) setSections((prev) => [deleted, ...prev]);
      sectionCache.refresh();
    }
  }

  const filtered = sections.filter((s) => {
    const t = search.toLowerCase();
    return String(s.title || "").toLowerCase().includes(t) || String(s.subject || "").toLowerCase().includes(t);
  });

  const subjectSelect = subjects.includes(form.subject) || !form.subject ? subjects : [form.subject, ...subjects];
  const firstLoad = sectionCache.loading && !sectionCache.data;

  return (
    <>
      <div className="search-container">
        <i className="fa-solid fa-magnifying-glass search-icon" />
        <input type="text" placeholder="Search sections..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {firstLoad ? (
        <SkeletonSectionCards />
      ) : (
        <div className="sections-wrapper">
          {sections.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", gridColumn: "1 / -1", textAlign: "center", marginTop: 20 }}>
              No sections added yet. Click the + button to add one.
            </p>
          ) : (
            filtered.map((sec) => (
              <div className="section-card" key={sec.id}>
                <div>
                  <h2 className="section-title">{sec.title}</h2>
                  <p className="section-subtitle">{sec.subject}</p>
                  <div className="tags-wrapper">
                    <span className="tag tag-students"><i className="fa-solid fa-user" /> {sec.student_count ?? 0} Students</span>
                    <span className="tag tag-room"><i className="fa-solid fa-building" /> {sec.room}</span>
                    <span className="tag tag-sem"><i className="fa-solid fa-calendar" /> {sec.semester || "1st Sem"}</span>
                    {sec.school_level && <span className="tag tag-sem"><i className="fa-solid fa-school" /> {sec.school_level}</span>}
                    <span className="tag tag-quarter"><i className="fa-solid fa-bookmark" /> {sec.school_level === "College" ? sec.quarter || "Prelim" : `Q${sec.quarter || "1"}`}</span>
                    <span className="tag tag-year"><i className="fa-solid fa-graduation-cap" /> {sec.school_year || "N/A"}</span>
                  </div>
                </div>
                <div className="card-actions">
                  <div className="menu-container">
                    <button
                      className="three-dots-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenu(openMenu === sec.id ? null : sec.id);
                      }}
                      onTouchStart={(e) => e.stopPropagation()}
                    >
                      <i className="fa-solid fa-ellipsis-vertical" />
                    </button>
                    <div className={`dropdown-menu${openMenu === sec.id ? " show" : ""}`}>
                      <button className="dropdown-item" onClick={() => openEdit(sec)}><i className="fa-solid fa-pen" /> Edit</button>
                      <button className="dropdown-item delete" onClick={() => del(sec.id)}><i className="fa-solid fa-trash" /> Delete</button>
                    </div>
                  </div>
                  <button className="view-btn" onClick={() => (window.location.href = `${viewPath}/${sec.id}`)}>View</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {!firstLoad && sections.length > 0 && filtered.length === 0 && (
        <div className="no-match-message" style={{ display: "flex" }}>
          <i className="fa-solid fa-magnifying-glass-minus" />
          <h3 style={{ color: "var(--text-dark)", marginBottom: 5 }}>No match found</h3>
          <p>We couldn&apos;t find any section matching your search.</p>
        </div>
      )}

      <button className="fab-add-btn" title="Add New Section" onClick={openAdd}>
        <i className="fa-solid fa-plus" style={{ fontSize: 22 }} />
      </button>

      {modal && (
        <div className="modal-overlay" style={{ display: "flex" }}>
          <div className="modal-content">
            <h4 style={{ marginBottom: 20, color: "var(--text-dark)" }}>{editingId ? "Edit Section" : "Add New Section"}</h4>
            <input type="text" className="modal-input" placeholder="Section Name (e.g. STEM12-1)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <SmoothSelect
              value={form.subject}
              onChange={(v) => setForm({ ...form, subject: v })}
              options={subjectSelect.map((n) => ({ value: n, label: n }))}
              placeholder="Select Subject"
            />
            <input type="text" className="modal-input" placeholder="Room (e.g. BLANCO-200)" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
            <SmoothSelect
              value={form.school_level}
              onChange={(v) => setForm({ ...form, school_level: v })}
              options={[
                { value: "JHS", label: "JHS - Junior High School" },
                { value: "SHS", label: "SHS - Senior High School" },
                { value: "College", label: "College" },
              ]}
              placeholder="Select School Level"
            />
            <SmoothSelect
              value={form.semester}
              onChange={(v) => setForm({ ...form, semester: v })}
              options={[
                { value: "1st Sem", label: "1st Semester" },
                { value: "2nd Sem", label: "2nd Semester" },
              ]}
              placeholder="Select Semester"
            />
            <SmoothSelect
              value={form.quarter}
              onChange={(v) => setForm({ ...form, quarter: v })}
              options={QUARTER_OPTS}
              placeholder={form.school_level === "College" ? "Select Term" : "Select Quarter"}
            />
            <SmoothSelect
              value={form.school_year}
              onChange={(v) => setForm({ ...form, school_year: v })}
              options={[
                { value: "2023-2024", label: "2023-2024" },
                { value: "2024-2025", label: "2024-2025" },
                { value: "2025-2026", label: "2025-2026" },
                { value: "2026-2027", label: "2026-2027" },
              ]}
              placeholder="Select School Year"
            />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button onClick={() => setModal(false)} style={{ flex: 1, padding: 12, borderRadius: 8, border: "none", cursor: "pointer", background: "var(--input-bg)", color: "var(--text-dark)", fontWeight: 500 }}>Cancel</button>
              <button onClick={save} style={{ flex: 2, background: "#3b82f6", color: "white", padding: 12, borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600 }}>Save</button>
            </div>
          </div>
        </div>
      )}

      <div className={`toast-notification ${toast.err ? "error" : ""} ${toast.show ? "show" : ""}`}>
        <i className={`fa-solid ${toast.err ? "fa-circle-xmark" : "fa-circle-check"}`} />
        <span>{toast.msg}</span>
      </div>
    </>
  );
}
