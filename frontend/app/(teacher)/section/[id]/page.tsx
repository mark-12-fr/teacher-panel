"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiDelete, apiGet, apiPost, apiPatch } from "@/lib/api";
import { usePageMeta } from "@/lib/page-meta";
import "./detail.css";

const normQ = (q: any) => (q ? String(q).replace(/[^1-4]/g, "") || "1" : "1");

export default function SectionDetailPage() {
  const params = useParams<{ id: string }>();
  const sectionId = params.id;

  const [section, setSection] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  usePageMeta("Class List");
  const [toast, setToast] = useState<{ show: boolean; msg: string; err: boolean }>({ show: false, msg: "", err: false });

  const [currentQuarter, setCurrentQuarter] = useState("1");
  const [viewQuarter, setViewQuarter] = useState("1");
  const [currentSemester, setCurrentSemester] = useState("1st Sem");
  const [viewSemester, setViewSemester] = useState("1st Sem");
  const [activatingQ, setActivatingQ] = useState(false);
  const [activatingS, setActivatingS] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  function showToast(msg: string, err = false) {
    setToast({ show: true, msg, err });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  }

  const loadDetails = useCallback(async () => {
    try {
      const r = await apiGet(`/api/sections/${sectionId}`);
      const sec = r.section;
      setSection(sec);
      const cs = sec.semester || "1st Sem";
      setCurrentSemester(cs);
      setViewSemester(cs);
      const cq = normQ(sec.quarter);
      setCurrentQuarter(cq);
      setViewQuarter(cq);
    } catch {
      showToast("Unauthorized or Section not found", true);
    }
  }, [sectionId]);

  const loadStudents = useCallback(async () => {
    try {
      const r = await apiGet(`/api/sections/${sectionId}/students`);
      setStudents(r.students || []);
    } catch {}
  }, [sectionId]);

  useEffect(() => {
    loadDetails();
    loadStudents();
  }, [loadDetails, loadStudents]);

  const quarterLocked = String(viewQuarter) !== String(currentQuarter);
  const semesterLocked = viewSemester !== currentSemester;

  async function activateQuarter() {
    if (quarterLocked && !window.confirm(`Switch active quarter to Q${viewQuarter}? Past records stay saved.`)) return;
    setActivatingQ(true);
    try {
      await apiPatch(`/api/sections/${sectionId}`, { quarter: viewQuarter });
      setCurrentQuarter(viewQuarter);
      showToast(`Section updated to Q${viewQuarter}!`);
    } catch {
      showToast("Failed to update quarter.", true);
    } finally {
      setActivatingQ(false);
    }
  }

  async function activateSemester() {
    const newQuarter = viewSemester === "1st Sem" ? "1" : "3";
    if (semesterLocked && !window.confirm(`Switch to ${viewSemester}? Quarter will reset to Q${newQuarter}. Past records stay saved.`)) return;
    setActivatingS(true);
    try {
      await apiPatch(`/api/sections/${sectionId}`, { semester: viewSemester, quarter: newQuarter });
      setCurrentSemester(viewSemester);
      setCurrentQuarter(newQuarter);
      setViewQuarter(newQuarter);
      showToast(`Section updated to ${viewSemester}!`);
    } catch {
      showToast("Failed to update semester.", true);
    } finally {
      setActivatingS(false);
    }
  }

  async function addStudent() {
    if (!addName.trim()) return showToast("Please fill in all fields!", true);
    try {
      await apiPost(`/api/sections/${sectionId}/students`, { full_name: addName.trim() });
      setAddName("");
      setAddOpen(false);
      showToast("Student added successfully!");
      loadStudents();
    } catch {
      showToast("Failed to add student", true);
    }
  }
  async function updateStudent() {
    if (!editId) return;
    if (!editName.trim()) return showToast("Please fill in all fields!", true);
    try {
      await apiPatch(`/api/students/${editId}`, { full_name: editName.trim() });
      setEditId(null);
      showToast("Student updated successfully!");
      loadStudents();
    } catch {
      showToast("Failed to update student", true);
    }
  }
  async function deleteStudent(id: string) {
    if (!window.confirm("Are you sure you want to remove this student?")) return;
    try {
      await apiDelete(`/api/students/${id}`);
      showToast("Student removed.");
      loadStudents();
    } catch {
      showToast("Failed to delete student", true);
    }
  }

  const filtered = students.filter((s) => String(s.full_name || "").toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="dashboard-wrapper">
        <div className="dash-wrap"><h3>SEMESTER</h3><h4>{currentSemester}</h4></div>
        <div className="dash-wrap"><h3>QUARTER</h3><h4 className="badge">Q{currentQuarter}</h4></div>
        <div className="dash-wrap"><h3>SUBJECT</h3><h4>{section?.subject || "--"}</h4></div>
        <div className="dash-wrap"><h3>TOTAL STUDENTS</h3><h4>{students.length}</h4></div>
        <div className="dash-wrap"><h3>SECTION</h3><h4 className="badge">{section?.title || "--"}</h4></div>
      </div>

      <div className="quarter-bar">
        <span className="quarter-bar-label">Quarter</span>
        {["1", "2", "3", "4"].map((q) => (
          <button
            key={q}
            className={`q-tab${q === viewQuarter ? " viewing" : ""}${q === currentQuarter ? " active-q" : ""}`}
            onClick={() => setViewQuarter(q)}
          >
            Q{q}
          </button>
        ))}
        {quarterLocked && (
          <>
            <span className="lock-banner" style={{ display: "inline-flex" }}>
              <i className="fa-solid fa-lock" /> Q{viewQuarter} is not yet active.
            </span>
            <button className="q-activate-btn" style={{ display: "inline-flex" }} disabled={activatingQ} onClick={activateQuarter}>
              {activatingQ ? "Saving..." : `Activate Q${viewQuarter}`}
            </button>
          </>
        )}
      </div>

      <div className="quarter-bar" style={{ marginBottom: 10 }}>
        <span className="quarter-bar-label">Semester</span>
        {["1st Sem", "2nd Sem"].map((sem) => (
          <button
            key={sem}
            className={`s-tab${sem === viewSemester ? " viewing-s" : ""}${sem === currentSemester ? " active-s" : ""}`}
            onClick={() => setViewSemester(sem)}
          >
            {sem}
          </button>
        ))}
        {semesterLocked && (
          <>
            <span className="lock-banner" style={{ display: "inline-flex" }}>
              <i className="fa-solid fa-lock" /> {viewSemester} is not yet active.
            </span>
            <button className="q-activate-btn" style={{ display: "inline-flex" }} disabled={activatingS} onClick={activateSemester}>
              {activatingS ? "Saving..." : `Activate ${viewSemester}`}
            </button>
          </>
        )}
      </div>

      <div className="class-list-box">
        <div className="search-container">
          <i className="fa-solid fa-magnifying-glass search-icon" />
          <input type="text" placeholder="Search student..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40, textAlign: "center" }}>#</th>
                <th>Student Name</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: 0 }}>
                    <div className="empty-state">
                      <div className="empty-state-icon"><i className="fa-solid fa-user-graduate" /></div>
                      <div className="empty-state-title">No students yet</div>
                      <div className="empty-state-msg">Click the + button to add your first student.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((s, i) => (
                  <tr key={s.id}>
                    <td style={{ textAlign: "center", fontWeight: 700, color: "var(--text-sub)", fontSize: "0.85rem" }}>{i + 1}</td>
                    <td>{s.full_name}</td>
                    <td>
                      <div className="action-btns">
                        <button className="icon-btn icon-btn-edit" data-tip="Edit" onClick={() => { setEditId(s.id); setEditName(s.full_name); }}>
                          <i className="fa-solid fa-pen" />
                        </button>
                        <button className="icon-btn icon-btn-delete" data-tip="Delete" onClick={() => deleteStudent(s.id)}>
                          <i className="fa-solid fa-trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <button id="openModal" title="Add New Student" onClick={() => setAddOpen(true)}>
        <i className="fa-solid fa-plus" />
      </button>

      {/* Add modal */}
      <div className="modal" style={{ display: addOpen ? "flex" : "none" }} onClick={(e) => e.target === e.currentTarget && setAddOpen(false)}>
        <div className="modal-content">
          <h3>Add New Student</h3>
          <input type="text" placeholder="Full Name" value={addName} onChange={(e) => setAddName(e.target.value)} />
          <div className="actionBtn">
            <button style={{ background: "var(--input-bg)", color: "var(--text-dark)" }} onClick={() => setAddOpen(false)}>Cancel</button>
            <button style={{ background: "#3b82f6", color: "white" }} onClick={addStudent}>Add Student</button>
          </div>
        </div>
      </div>

      {/* Edit modal */}
      <div className="modal" style={{ display: editId ? "flex" : "none" }} onClick={(e) => e.target === e.currentTarget && setEditId(null)}>
        <div className="modal-content">
          <span style={{ position: "absolute", right: 15, top: 10, cursor: "pointer", fontSize: 24, color: "var(--text-muted)" }} onClick={() => setEditId(null)}>×</span>
          <h3>Edit Student Info</h3>
          <input type="text" placeholder="Full Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
          <div className="actionBtn">
            <button style={{ background: "var(--input-bg)", color: "var(--text-dark)" }} onClick={() => setEditId(null)}>Cancel</button>
            <button style={{ background: "#3b82f6", color: "white" }} onClick={updateStudent}>Update</button>
          </div>
        </div>
      </div>

      <div className={`toast-notification ${toast.err ? "error" : ""} ${toast.show ? "show" : ""}`}>
        <i className={`fa-solid ${toast.err ? "fa-circle-xmark" : "fa-circle-check"}`} />
        <span>{toast.msg}</span>
      </div>
    </>
  );
}
