"use client";

// Per-section class record — the grade spreadsheet (ported from
// class-record(2).html). Columns: 25 Modules + 10 Activities (Written Work),
// AT, PT 1, PT 2, QE. Each cell is a contentEditable that saves on blur to
// POST /api/sections/{id}/class-records (upsert by record id). A Quarter /
// Semester bar mirrors the Section detail page: viewing a non-active quarter
// shows a read-only history; only the active quarter is editable. Includes
// per-student search, live facilitator updates (Supabase realtime), and Excel
// export. There is no computed-grade column here — grades live on Performance.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import TeacherShell from "@/components/TeacherShell";
import { writeStyledSheet } from "@/lib/export";
import "./detail.css";

type Rec = any;

const MODULES = Array.from({ length: 25 }, (_, i) => `module_${i + 1}`);
const ACTIVITIES = Array.from({ length: 10 }, (_, i) => `activity_${i + 1}`);
const TAIL = ["at", "pt_1", "pt_2", "qe"];
const normQ = (q: any) => (q ? String(q).replace(/[^1-4]/g, "") || "1" : "1");
const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

export default function ClassRecordGridPage() {
  const params = useParams<{ id: string }>();
  const sectionId = params.id;

  const [section, setSection] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [records, setRecords] = useState<Rec[]>([]);
  const recordsRef = useRef<Rec[]>([]);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ show: boolean; msg: string; err: boolean }>({ show: false, msg: "", err: false });

  // Bumps only on (re)load and quarter/semester view change → forces the
  // uncontrolled cells to remount with fresh values. Per-cell saves never bump
  // it, so they can't clobber an in-progress edit elsewhere in the grid.
  const [dataVersion, setDataVersion] = useState(0);

  const [currentQuarter, setCurrentQuarter] = useState("1");
  const [viewQuarter, setViewQuarter] = useState("1");
  const [currentSemester, setCurrentSemester] = useState("1st Sem");
  const [viewSemester, setViewSemester] = useState("1st Sem");
  const [activatingQ, setActivatingQ] = useState(false);
  const [activatingS, setActivatingS] = useState(false);

  const lastLocalSave = useRef(0);

  function showToast(msg: string, err = false) {
    setToast({ show: true, msg, err });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 4000);
  }

  const commitRecords = useCallback((next: Rec[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

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
      setTimeout(() => (window.location.href = "/class-record"), 1500);
    }
  }, [sectionId]);

  const loadStudents = useCallback(async () => {
    try {
      const r = await apiGet(`/api/sections/${sectionId}/students`);
      setStudents(r.students || []);
    } catch {}
  }, [sectionId]);

  const loadRecords = useCallback(async () => {
    try {
      const r = await apiGet(`/api/sections/${sectionId}/class-records`);
      commitRecords(r.records || []);
      setDataVersion((v) => v + 1);
    } catch {}
  }, [sectionId, commitRecords]);

  useEffect(() => {
    loadDetails();
    loadStudents();
    loadRecords();
  }, [loadDetails, loadStudents, loadRecords]);

  // Live facilitator updates: reload when this section's records change
  // elsewhere. Skipped briefly after our own writes to avoid a self-triggered
  // reload that would remount cells mid-edit. No-op if realtime isn't enabled.
  useEffect(() => {
    let channel: any;
    try {
      channel = getSupabase()
        .channel("teacher-class-records-" + sectionId)
        .on("postgres_changes", { event: "*", schema: "public", table: "class_records" }, (payload: any) => {
          const rec = payload.new || payload.old;
          const sid = rec?.section_id;
          if (String(sid) !== String(sectionId)) return;
          if (Date.now() - lastLocalSave.current < 2000) return;
          loadRecords();
          showToast("Records have been updated by a Facilitator!");
        })
        .subscribe();
    } catch {}
    return () => {
      try {
        if (channel) getSupabase().removeChannel(channel);
      } catch {}
    };
  }, [sectionId, loadRecords]);

  const quarterLocked = String(viewQuarter) !== String(currentQuarter);
  const semesterLocked = viewSemester !== currentSemester;

  // Record shown for a student in the viewed quarter (falls back to a legacy
  // quarter-less row), matching the original createRow() lookup.
  const recForView = useCallback(
    (sid: string) =>
      records.find((r) => r.student_id === sid && String(r.quarter) === String(viewQuarter)) ||
      records.find((r) => r.student_id === sid && (r.quarter === null || r.quarter === undefined)) ||
      null,
    [records, viewQuarter]
  );

  function setViewQuarterAndReload(q: string) {
    setViewQuarter(q);
    setDataVersion((v) => v + 1);
  }
  function setViewSemesterOnly(sem: string) {
    setViewSemester(sem);
  }

  async function activateQuarter() {
    if (quarterLocked && !window.confirm(`Switch active quarter to Q${viewQuarter}? Past records stay saved.`)) return;
    setActivatingQ(true);
    try {
      await apiPatch(`/api/sections/${sectionId}`, { quarter: viewQuarter });
      setCurrentQuarter(viewQuarter);
      setDataVersion((v) => v + 1);
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
      setDataVersion((v) => v + 1);
      showToast(`Section updated to ${viewSemester}!`);
    } catch {
      showToast("Failed to update semester.", true);
    } finally {
      setActivatingS(false);
    }
  }

  async function saveScore(sid: string, field: string, cell: HTMLTableCellElement) {
    const newValue = cell.innerText.trim();
    const oldVal = cell.dataset.oldVal ?? "";
    if (newValue === oldVal) return;
    if (quarterLocked) return; // never write to a non-active quarter
    if (newValue !== "" && isNaN(Number(newValue))) {
      cell.innerText = oldVal;
      showToast("Please enter numbers only.", true);
      return;
    }

    const activeQ = currentQuarter;
    const existing =
      recordsRef.current.find((r) => r.student_id === sid && String(r.quarter) === String(activeQ)) ||
      recordsRef.current.find((r) => r.student_id === sid && (r.quarter === null || r.quarter === undefined));
    const val: any = newValue === "" ? null : newValue;
    const id = existing?.id || newId();
    const quarterToSave = existing && existing.quarter != null ? existing.quarter : activeQ;

    lastLocalSave.current = Date.now();
    cell.style.opacity = "0.5";
    try {
      await apiPost(`/api/sections/${sectionId}/class-records`, [
        { id, student_id: sid, quarter: quarterToSave, scores: { [field]: val } },
      ]);
      // Reconcile local records (both ref + state) without bumping dataVersion.
      const arr = recordsRef.current.slice();
      const idx = arr.findIndex((r) => r.id === id) >= 0
        ? arr.findIndex((r) => r.id === id)
        : arr.findIndex((r) => r.student_id === sid && String(r.quarter) === String(quarterToSave));
      if (idx >= 0) arr[idx] = { ...arr[idx], id, [field]: val, quarter: quarterToSave };
      else arr.push({ id, student_id: sid, section_id: sectionId, quarter: quarterToSave, [field]: val });
      commitRecords(arr);
      cell.dataset.oldVal = newValue;
      cell.style.backgroundColor = "rgba(16, 185, 129, 0.2)";
      setTimeout(() => (cell.style.backgroundColor = "transparent"), 1000);
    } catch {
      cell.innerText = oldVal;
      cell.style.backgroundColor = "rgba(239, 68, 68, 0.2)";
      setTimeout(() => (cell.style.backgroundColor = "transparent"), 1000);
      showToast("Failed to save score. Check your connection.", true);
    } finally {
      cell.style.opacity = "1";
    }
  }

  async function exportExcel() {
    try {
      showToast("Generating Excel...");
      const sectionName = section?.title || "Section";
      const subjectName = section?.subject || "";
      const rows: any[][] = [];
      rows.push([`Class Record — ${sectionName}${subjectName ? " — " + subjectName : ""}`]);
      rows.push([`Q${currentQuarter}  |  Generated: ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`]);
      rows.push([]);
      const headers: any[] = ["#", "Student Name"];
      for (let m = 1; m <= 25; m++) headers.push("M" + m);
      for (let a = 1; a <= 10; a++) headers.push("A" + a);
      headers.push("AT", "PT 1", "PT 2", "QE");
      rows.push(headers);

      students.forEach((s, idx) => {
        const rec = recForView(s.id);
        const row: any[] = [idx + 1, s.full_name];
        [...MODULES, ...ACTIVITIES, ...TAIL].forEach((f) => {
          const v = rec ? rec[f] : null;
          row.push(v === null || v === undefined || v === "" ? "" : v);
        });
        rows.push(row);
      });

      await writeStyledSheet(rows, {
        sheetName: "Class Record",
        headerRow: 3,
        fileName: `Class_Record_${sectionName.replace(/\s+/g, "_")}.xlsx`,
      });
      showToast("Class Record exported successfully!");
    } catch (e: any) {
      showToast("Export failed: " + (e?.message || e), true);
    }
  }

  const exportBtn = (
    <button className="export-btn" onClick={exportExcel}>
      <i className="fa-solid fa-file-excel" /> Export Excel
    </button>
  );

  const searchLower = search.toLowerCase();

  function ScoreCell({ sid, field, divider }: { sid: string; field: string; divider?: boolean }) {
    const rec = recForView(sid);
    const v = rec ? rec[field] : null;
    const display = v === null || v === undefined || v === "" ? "" : String(v);
    const cls = "editable-score" + (divider ? " group-divider" : "") + (quarterLocked ? " locked" : "");
    return (
      <td
        key={`${sid}-${field}-${dataVersion}`}
        className={cls}
        data-field={field}
        contentEditable={!quarterLocked}
        suppressContentEditableWarning
        onFocus={quarterLocked ? undefined : (e) => (e.currentTarget.dataset.oldVal = e.currentTarget.innerText.trim())}
        onBlur={quarterLocked ? undefined : (e) => saveScore(sid, field, e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
          }
        }}
      >
        {display}
      </td>
    );
  }

  return (
    <TeacherShell active="class-record" title="Class Record" action={exportBtn}>
      <div className="dashboard-wrapper">
        <div className="dash-wrap"><h3>SEMESTER</h3><h4>{currentSemester}</h4></div>
        <div className="dash-wrap"><h3>QUARTER</h3><h4 className="badge">Q{currentQuarter}</h4></div>
        <div className="dash-wrap"><h3>SUBJECT</h3><h4>{section?.subject || "--"}</h4></div>
        <div className="dash-wrap"><h3>TOTAL STUDENTS</h3><h4>{students.length}</h4></div>
        <div className="dash-wrap"><h3>SECTION</h3><h4 className="badge">{section?.title || "--"}</h4></div>
      </div>

      <div className="class-record-container">
        <div className="search-container">
          <i className="fa-solid fa-magnifying-glass search-icon" />
          <input type="text" placeholder="Search student name..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="quarter-bar">
          <span className="quarter-bar-label">Quarter</span>
          {["1", "2", "3", "4"].map((q) => (
            <button
              key={q}
              className={`q-tab${q === viewQuarter ? " viewing" : ""}${q === currentQuarter ? " active-q" : ""}`}
              onClick={() => setViewQuarterAndReload(q)}
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
              onClick={() => setViewSemesterOnly(sem)}
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

        <div className="table-responsive">
          <table id="recordTable">
            <thead>
              <tr>
                <th rowSpan={2} className="sticky-col">#</th>
                <th rowSpan={2} className="sticky-col text-left group-divider">Student Name</th>
                <th colSpan={25} className="header-group group-divider header-modules">MODULES</th>
                <th colSpan={10} className="header-group group-divider header-activities">ACTIVITIES</th>
                <th className="header-group header-at">AT</th>
                <th className="header-group header-pt">PT 1</th>
                <th className="header-group header-pt">PT 2</th>
                <th className="header-group header-qe">QE</th>
              </tr>
              <tr>
                {Array.from({ length: 25 }, (_, i) => i + 1).map((n) => (
                  <th key={`m${n}`} className={n === 25 ? "group-divider" : undefined}>{n}</th>
                ))}
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <th key={`a${n}`} className={n === 10 ? "group-divider" : undefined}>{n}</th>
                ))}
                <th>50</th>
                <th>50</th>
                <th>50</th>
                <th>50</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr>
                  <td colSpan={41} style={{ textAlign: "center", padding: 30 }}>No students assigned yet.</td>
                </tr>
              ) : (
                students.map((s, idx) => {
                  const hidden = !!searchLower && !String(s.full_name || "").toLowerCase().includes(searchLower);
                  return (
                    <tr key={s.id} className="student-data-row" style={hidden ? { display: "none" } : undefined}>
                      <td className="sticky-col">{idx + 1}</td>
                      <td className="sticky-col text-left group-divider search-target" title={s.full_name}>
                        <strong>{s.full_name}</strong>
                      </td>
                      {MODULES.map((f, i) => <ScoreCell key={f} sid={s.id} field={f} divider={i === 24} />)}
                      {ACTIVITIES.map((f, i) => <ScoreCell key={f} sid={s.id} field={f} divider={i === 9} />)}
                      {TAIL.map((f) => <ScoreCell key={f} sid={s.id} field={f} />)}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`toast-notification ${toast.err ? "error" : ""} ${toast.show ? "show" : ""}`}>
        <i className={`fa-solid ${toast.err ? "fa-circle-exclamation" : "fa-circle-check"}`} />
        <span>{toast.msg}</span>
      </div>
    </TeacherShell>
  );
}
