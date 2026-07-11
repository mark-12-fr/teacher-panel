"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPatch } from "@/lib/api";
import TeacherShell from "@/components/TeacherShell";
import "./grading.css";

const num = (v: any) => Number(v) || 0;

function PctBadge({ v, color }: { v: any; color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 9px",
        borderRadius: 8,
        fontWeight: 700,
        fontSize: "0.82rem",
        color,
        background: `${color}1f`,
      }}
    >
      {num(v)}%
    </span>
  );
}

const EMPTY = { name: "", ww: 30, pt: 50, exam: 20, att: 0, passing: 75 };

export default function GradingSystemPage() {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ show: boolean; msg: string; err: boolean }>({ show: false, msg: "", err: false });

  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  function showToast(msg: string, err = false) {
    setToast({ show: true, msg, err });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  }

  const load = useCallback(async () => {
    try {
      const [s, sec] = await Promise.all([apiGet("/api/subjects"), apiGet("/api/sections")]);
      setSubjects(s.subjects || []);
      setSections(sec.sections || []);
    } catch {
      showToast("Failed to load subjects.", true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const linkedCount = useMemo(() => {
    const names = new Set(subjects.map((x) => String(x.name || "").trim().toLowerCase()));
    return sections.filter((x) => names.has(String(x.subject || "").trim().toLowerCase())).length;
  }, [subjects, sections]);

  const total = form.ww + form.pt + form.exam + form.att;
  const totalOk = total === 100;

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY });
    setModal(true);
  }
  function openEdit(s: any) {
    setEditingId(s.id);
    setForm({
      name: s.name || "",
      ww: num(s.ww_percent),
      pt: num(s.pt_percent),
      exam: num(s.exam_percent),
      att: num(s.attendance_percent),
      passing: num(s.passing_grade || 75),
    });
    setModal(true);
  }

  async function save() {
    const name = form.name.trim();
    if (!name) return showToast("Please enter a subject name.", true);
    if (form.ww + form.pt + form.exam + form.att !== 100)
      return showToast("Written Work + Performance Tasks + Exam + Attendance must total 100%.", true);
    // The DB has no unique (teacher, name) constraint, so guard duplicates here
    // (matches the legacy "already have a subject with that name" behaviour).
    if (!editingId && subjects.some((x) => String(x.name || "").trim().toLowerCase() === name.toLowerCase()))
      return showToast("You already have a subject with that name.", true);

    setSaving(true);
    const payload = {
      name,
      ww_percent: form.ww,
      pt_percent: form.pt,
      exam_percent: form.exam,
      attendance_percent: form.att,
      passing_grade: form.passing,
    };
    try {
      if (editingId) await apiPatch(`/api/subjects/${editingId}`, payload);
      else await apiPost("/api/subjects", payload);
      setModal(false);
      await load();
      showToast(editingId ? "Subject updated!" : "Subject added!");
    } catch {
      showToast("Error saving subject.", true);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await apiDelete(`/api/subjects/${id}`);
      await load();
      showToast("Subject deleted.");
    } catch {
      showToast("Failed to delete subject.", true);
    }
  }

  const filtered = subjects.filter((s) => String(s.name || "").toUpperCase().includes(search.toUpperCase()));

  return (
    <TeacherShell active="grading-system" title="Grading System">
      <div className="top-info-card">
        <div className="info-col">
          <h3>TOTAL SUBJECTS</h3>
          <h4>{subjects.length}</h4>
        </div>
        <div className="info-col">
          <h3>LINKED SECTIONS</h3>
          <h4>{linkedCount}</h4>
        </div>
      </div>

      <div className="search-container">
        <i className="fa-solid fa-magnifying-glass search-icon" />
        <input type="text" placeholder="Search subject name..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              <th>Written Work</th>
              <th>Performance Tasks</th>
              <th>Exam</th>
              <th>Attendance</th>
              <th>Passing</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 34, color: "var(--text-muted)" }}>
                  No subjects yet. Click the + button to add a subject and set its grading percentages.
                </td>
              </tr>
            ) : (
              filtered.map((s) => (
                <tr key={s.id}>
                  <td><div style={{ fontWeight: 600, color: "var(--text-dark)" }}>{s.name}</div></td>
                  <td><PctBadge v={s.ww_percent} color="#3b82f6" /></td>
                  <td><PctBadge v={s.pt_percent} color="#8b5cf6" /></td>
                  <td><PctBadge v={s.exam_percent} color="#f59e0b" /></td>
                  <td><PctBadge v={s.attendance_percent} color="#10b981" /></td>
                  <td><span style={{ fontWeight: 700, color: "var(--text-dark)" }}>{num(s.passing_grade || 75)}%</span></td>
                  <td>
                    <div className="action-btns">
                      <button className="action-btn edit" onClick={() => openEdit(s)}>Edit</button>
                      <button className="action-btn delete" onClick={() => setDeleteTarget({ id: s.id, name: s.name })}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <button className="fab-add-btn" title="Add New Subject" onClick={openAdd}>
        <i className="fa-solid fa-plus" style={{ fontSize: 22 }} />
      </button>

      {/* Add/Edit modal */}
      {modal && (
        <div className="modal-overlay" style={{ display: "flex" }}>
          <div className="modal-content">
            <h4 style={{ marginBottom: 16, color: "var(--text-dark)" }}>{editingId ? "Edit Subject" : "Add Subject"}</h4>
            <input type="text" className="modal-input" placeholder="Subject Name (e.g. APP 006: Practical Research 2)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <p style={{ margin: "4px 2px 10px", fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
              Set the weight (%) of each grading component. Written Work, Performance Tasks, Exam and Attendance must total 100%.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {([
                ["Written Work", "ww"],
                ["Performance Tasks", "pt"],
                ["Exam", "exam"],
                ["Attendance", "att"],
              ] as const).map(([label, key]) => (
                <div key={key}>
                  <label style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{label}</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type="number"
                      className="modal-input"
                      min={0}
                      max={100}
                      step={1}
                      value={(form as any)[key]}
                      onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) || 0 })}
                      style={{ margin: 0, paddingRight: 28 }}
                    />
                    <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontWeight: 600 }}>%</span>
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                margin: "12px 0",
                padding: "9px 12px",
                borderRadius: 8,
                fontSize: "0.84rem",
                fontWeight: 600,
                textAlign: "center",
                background: totalOk ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                color: totalOk ? "#059669" : "#dc2626",
              }}
            >
              <i className={`fa-solid ${totalOk ? "fa-circle-check" : "fa-triangle-exclamation"}`} /> Components total: {total}%
              {totalOk ? " — looks good" : " — must equal 100%"}
            </div>
            <label style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Passing Grade</label>
            <div style={{ position: "relative" }}>
              <input type="number" className="modal-input" min={0} max={100} step={1} value={form.passing} onChange={(e) => setForm({ ...form, passing: Number(e.target.value) || 0 })} style={{ paddingRight: 28 }} />
              <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", fontWeight: 600 }}>%</span>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button onClick={() => setModal(false)} style={{ flex: 1, padding: 12, borderRadius: 8, border: "none", cursor: "pointer", background: "var(--input-bg)", color: "var(--text-dark)", fontWeight: 500 }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ flex: 2, background: "#3b82f6", color: "white", padding: 12, borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600 }}>
                {saving ? "Saving..." : editingId ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="modal-overlay" style={{ display: "flex" }}>
          <div className="modal-content" style={{ maxWidth: 360, textAlign: "center" }}>
            <div style={{ width: 54, height: 54, borderRadius: "50%", background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 15px" }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ color: "#ef4444", fontSize: "1.4rem" }} />
            </div>
            <h4 style={{ marginBottom: 8, color: "var(--text-dark)" }}>Remove Subject?</h4>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 22, lineHeight: 1.5 }}>
              <strong style={{ color: "var(--text-dark)" }}>{deleteTarget.name}</strong> will be permanently deleted.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setDeleteTarget(null)} style={{ flex: 1, padding: 11, borderRadius: 8, border: "none", cursor: "pointer", background: "var(--input-bg)", color: "var(--text-dark)", fontWeight: 500, fontSize: "0.9rem" }}>Cancel</button>
              <button onClick={confirmDelete} style={{ flex: 1, padding: 11, borderRadius: 8, border: "none", cursor: "pointer", background: "#ef4444", color: "white", fontWeight: 600, fontSize: "0.9rem" }}>Remove</button>
            </div>
          </div>
        </div>
      )}

      <div className={`toast-notification ${toast.err ? "error" : ""} ${toast.show ? "show" : ""}`}>
        <i className={`fa-solid ${toast.err ? "fa-circle-xmark" : "fa-circle-check"}`} />
        <span>{toast.msg}</span>
      </div>
    </TeacherShell>
  );
}
