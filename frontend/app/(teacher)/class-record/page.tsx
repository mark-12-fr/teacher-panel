"use client";

// Class Record section-picker (ported from class-record.html). Same section
// cards as the Section page — search, add/edit/delete — but "View" opens the
// per-section grade grid at /class-record/[id].
import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPatch } from "@/lib/api";
import { usePageMeta } from "@/lib/page-meta";
import "../section/section.css";

const EMPTY = { title: "", subject: "", room: "", semester: "", quarter: "", school_year: "" };

export default function ClassRecordPickerPage() {
  usePageMeta("Class Record");
  const [sections, setSections] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
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

  const load = useCallback(async () => {
    try {
      const [secResp, subjResp] = await Promise.all([apiGet("/api/sections"), apiGet("/api/subjects")]);
      const secs = secResp.sections || [];
      setSections(secs);
      setSubjects((subjResp.subjects || []).map((s: any) => s.name).sort((a: string, b: string) => a.localeCompare(b)));
      const pairs = await Promise.all(
        secs.map(async (s: any) => {
          try {
            const r = await apiGet(`/api/sections/${s.id}/students`);
            return [s.id, (r.students || []).length] as const;
          } catch {
            return [s.id, 0] as const;
          }
        })
      );
      setCounts(Object.fromEntries(pairs));
    } catch {
      showToast("Failed to load sections", true);
    }
  }, []);

  useEffect(() => {
    load();
    const close = () => setOpenMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [load]);

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY });
    setModal(true);
  }
  function openEdit(s: any) {
    setEditingId(s.id);
    setForm({
      title: s.title || "",
      subject: s.subject || "",
      room: s.room || "",
      semester: s.semester || "1st Sem",
      quarter: s.quarter ? String(s.quarter) : "",
      school_year: s.school_year || "",
    });
    setModal(true);
  }

  async function save() {
    const { title, subject, room, semester, quarter, school_year } = form;
    if (!title.trim() || !subject || !room.trim() || !semester || !quarter || !school_year) {
      showToast("Please fill in all fields including Semester and Quarter!", true);
      return;
    }
    const payload = { title: title.trim(), subject, room: room.trim(), semester, quarter, school_year };
    try {
      if (editingId) {
        await apiPatch(`/api/sections/${editingId}`, payload);
        showToast("Record updated successfully!");
      } else {
        await apiPost("/api/sections", payload);
        showToast("Record saved successfully!");
      }
      setModal(false);
      setSearch("");
      await load();
    } catch {
      showToast("Error saving record.", true);
    }
  }

  async function del(id: string) {
    if (!window.confirm("Delete this section and ALL of its data? This permanently removes its students, class records, and attendance too — this cannot be undone.")) return;
    try {
      await apiDelete(`/api/sections/${id}`);
      showToast("Section and all its data deleted.");
      setSearch("");
      await load();
    } catch {
      showToast("Error deleting the section.", true);
    }
  }

  const filtered = sections.filter((s) => {
    const t = search.toLowerCase();
    return String(s.title || "").toLowerCase().includes(t) || String(s.subject || "").toLowerCase().includes(t);
  });

  const subjectSelect = subjects.includes(form.subject) || !form.subject ? subjects : [form.subject, ...subjects];

  return (
    <>
      <div className="search-container">
        <i className="fa-solid fa-magnifying-glass search-icon" />
        <input type="text" placeholder="Search sections..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

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
                  <span className="tag tag-students"><i className="fa-solid fa-user" /> {counts[sec.id] ?? 0} Students</span>
                  <span className="tag tag-room"><i className="fa-solid fa-building" /> {sec.room}</span>
                  <span className="tag tag-sem"><i className="fa-solid fa-calendar" /> {sec.semester || "1st Sem"}</span>
                  <span className="tag tag-quarter"><i className="fa-solid fa-bookmark" /> {sec.quarter ? `Q${sec.quarter}` : "Q1"}</span>
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
                  >
                    <i className="fa-solid fa-ellipsis-vertical" />
                  </button>
                  <div className={`dropdown-menu${openMenu === sec.id ? " show" : ""}`}>
                    <button className="dropdown-item" onClick={() => openEdit(sec)}><i className="fa-solid fa-pen" /> Edit</button>
                    <button className="dropdown-item delete" onClick={() => del(sec.id)}><i className="fa-solid fa-trash" /> Delete</button>
                  </div>
                </div>
                <button className="view-btn" onClick={() => (window.location.href = `/class-record/${sec.id}`)}>View</button>
              </div>
            </div>
          ))
        )}
      </div>

      {sections.length > 0 && filtered.length === 0 && (
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
            <select className="modal-input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
              <option value="" disabled>Select Subject</option>
              {subjectSelect.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <input type="text" className="modal-input" placeholder="Room (e.g. BLANCO-200)" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} />
            <select className="modal-input" value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })}>
              <option value="" disabled>Select Semester</option>
              <option value="1st Sem">1st Semester</option>
              <option value="2nd Sem">2nd Semester</option>
            </select>
            <select className="modal-input" value={form.quarter} onChange={(e) => setForm({ ...form, quarter: e.target.value })}>
              <option value="" disabled>Select Quarter</option>
              <option value="1">Q1 - First Quarter</option>
              <option value="2">Q2 - Second Quarter</option>
              <option value="3">Q3 - Third Quarter</option>
              <option value="4">Q4 - Fourth Quarter</option>
            </select>
            <select className="modal-input" value={form.school_year} onChange={(e) => setForm({ ...form, school_year: e.target.value })}>
              <option value="" disabled>Select School Year</option>
              <option value="2023-2024">2023-2024</option>
              <option value="2024-2025">2024-2025</option>
              <option value="2025-2026">2025-2026</option>
              <option value="2026-2027">2026-2027</option>
            </select>
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
