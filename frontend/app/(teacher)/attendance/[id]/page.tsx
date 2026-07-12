"use client";

// Per-section attendance grid (ported from attendance(2).html). A month-at-a-
// time spreadsheet: click a cell to cycle P → A → L → (clear), or type P/A/L.
// Every edit persists the whole day through POST /api/sections/{id}/attendance
// (which replaces that date's rows), so the end state matches the legacy
// per-cell upsert. Includes today's summary, month navigation, per-student
// history, live cross-panel updates (Supabase realtime), and Excel export.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import { usePageMeta } from "@/lib/page-meta";
import { writeStyledSheet } from "@/lib/export";
import "./detail.css";

type Att = { student_name: string; date: string; status: string };

const MONTHS_UP = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const normQ = (q: any) => (q ? String(q).replace(/[^1-4]/g, "") || "1" : "1");
const todayGB = () => new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
const markOf = (status?: string | null) =>
  status === "Present" ? { m: "P", c: "mark-p" } : status === "Absent" ? { m: "A", c: "mark-a" } : status === "Late" ? { m: "L", c: "mark-l" } : { m: "-", c: "mark-none" };

export default function AttendanceGridPage() {
  const params = useParams<{ id: string }>();
  const sectionId = params.id;

  const [section, setSection] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<Att[]>([]);
  const attRef = useRef<Att[]>([]);
  // Dates with a save in flight — our own realtime echoes for these are ignored
  // so the whole-day rewrite doesn't flicker the optimistic UI.
  const savingDates = useRef<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ show: boolean; msg: string; err: boolean }>({ show: false, msg: "", err: false });

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  const [history, setHistory] = useState<{ open: boolean; name: string }>({ open: false, name: "" });

  function showToast(msg: string, err = false) {
    setToast({ show: true, msg, err });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 4000);
  }

  const setAtt = useCallback((next: Att[]) => {
    attRef.current = next;
    setAttendance(next);
  }, []);

  const loadDetails = useCallback(async () => {
    try {
      const r = await apiGet(`/api/sections/${sectionId}`);
      setSection(r.section);
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

  const loadAttendance = useCallback(async () => {
    try {
      const r = await apiGet(`/api/sections/${sectionId}/attendance`);
      const rows: Att[] = (r.attendance || []).map((a: any) => ({ student_name: a.student_name, date: a.date, status: a.status }));
      setAtt(rows);
    } catch {}
  }, [sectionId, setAtt]);

  useEffect(() => {
    loadDetails();
    loadStudents();
    loadAttendance();
  }, [loadDetails, loadStudents, loadAttendance]);

  // Live cross-panel updates: a facilitator (or another tab) writing attendance
  // for this section reflects here. No-op if realtime isn't enabled on the DB.
  const sectionTitle = section?.title;
  useEffect(() => {
    if (!sectionTitle) return;
    let channel: any;
    try {
      channel = getSupabase()
        .channel("teacher-attendance-" + sectionId)
        .on("postgres_changes", { event: "*", schema: "public", table: "attendance" }, (payload: any) => {
          const rec = payload.new || payload.old;
          if (!rec || rec.section !== sectionTitle) return;
          if (savingDates.current.has(rec.date)) return; // our own in-flight write
          const base = attRef.current.filter((a) => !(a.student_name === rec.student_name && a.date === rec.date));
          if (payload.eventType !== "DELETE" && rec.status) base.push({ student_name: rec.student_name, date: rec.date, status: rec.status });
          setAtt(base);
        })
        .subscribe();
    } catch {}
    return () => {
      try {
        if (channel) getSupabase().removeChannel(channel);
      } catch {}
    };
  }, [sectionTitle, sectionId, setAtt]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = `${MONTHS_UP[month]} ${year}`;
  const isCurrentMonth = month === now.getMonth() && year === now.getFullYear();
  const todayDay = now.getDate();

  // (student_name|date) → status, for O(1) cell lookup.
  const attMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of attendance) m.set(`${a.student_name}__${a.date}`, a.status);
    return m;
  }, [attendance]);

  const dateFor = useCallback((day: number) => `${pad2(day)}/${pad2(month + 1)}/${year}`, [month, year]);

  // Today's tallies (matches the summary cards + dashboard row).
  const summary = useMemo(() => {
    const t = todayGB();
    let present = 0, absent = 0, late = 0;
    for (const a of attendance) {
      if (a.date !== t) continue;
      if (a.status === "Present") present++;
      else if (a.status === "Absent") absent++;
      else if (a.status === "Late") late++;
    }
    return { present, absent, late };
  }, [attendance]);

  // Persist one full day (replace-that-date semantics of the bulk endpoint).
  async function setCell(name: string, date: string, nextStatus: string | null) {
    const original = attRef.current.find((a) => a.student_name === name && a.date === date)?.status ?? null;
    const apply = (status: string | null) => {
      const base = attRef.current.filter((a) => !(a.student_name === name && a.date === date));
      if (status) base.push({ student_name: name, date, status });
      setAtt(base);
      return base;
    };
    const next = apply(nextStatus);
    const items = students
      .map((s) => {
        const st = next.find((a) => a.student_name === s.full_name && a.date === date)?.status;
        return st ? { student_name: s.full_name, student_id_no: "", status: st } : null;
      })
      .filter(Boolean);
    savingDates.current.add(date);
    try {
      await apiPost(`/api/sections/${sectionId}/attendance`, {
        section: section?.title || "",
        date,
        subject: section?.subject || "",
        quarter: normQ(section?.quarter),
        items,
      });
    } catch {
      apply(original); // revert only this cell, not the whole array
      showToast("Save failed. Check your connection or permissions.", true);
    } finally {
      // Small grace period so trailing echoes from our own write are ignored.
      setTimeout(() => savingDates.current.delete(date), 1200);
    }
  }

  // Click cycles P → A → L → (clear) → P.
  function onCellClick(name: string, date: string) {
    const cur = attMap.get(`${name}__${date}`);
    const nextStatus = cur === "Present" ? "Absent" : cur === "Absent" ? "Late" : cur === "Late" ? null : "Present";
    setCell(name, date, nextStatus);
  }
  function onCellKey(e: React.KeyboardEvent, name: string, date: string) {
    const key = e.key.toUpperCase();
    let status: string | null | undefined;
    if (key === "P") status = "Present";
    else if (key === "A") status = "Absent";
    else if (key === "L") status = "Late";
    else if (key === "BACKSPACE" || key === "DELETE" || key === "-" || key === " ") status = null;
    if (status !== undefined) {
      e.preventDefault();
      setCell(name, date, status);
    }
  }

  const filteredStudents = useMemo(() => {
    const t = search.toLowerCase();
    return students.map((s, i) => ({ s, i, hidden: !!t && !String(s.full_name || "").toLowerCase().includes(t) }));
  }, [students, search]);

  // Per-student history grouped by month (ported from renderHistoryModal).
  const historyData = useMemo(() => {
    if (!history.open) return null;
    const recs = attendance.filter((a) => a.student_name === history.name);
    const monthMap: Record<string, { label: string; p: number; a: number; l: number }> = {};
    for (const r of recs) {
      if (!r.date) continue;
      const parts = r.date.split("/");
      if (parts.length !== 3) continue;
      const [, mm, yyyy] = parts;
      const key = `${yyyy}-${mm}`;
      const label = `${MONTHS[parseInt(mm, 10) - 1]} ${yyyy}`;
      if (!monthMap[key]) monthMap[key] = { label, p: 0, a: 0, l: 0 };
      const s = (r.status || "").toLowerCase();
      if (s === "present") monthMap[key].p++;
      else if (s === "absent") monthMap[key].a++;
      else if (s === "late") monthMap[key].l++;
    }
    const sorted = Object.entries(monthMap).sort((a, b) => b[0].localeCompare(a[0]));
    let totalP = 0, totalA = 0, totalL = 0;
    sorted.forEach(([, m]) => { totalP += m.p; totalA += m.a; totalL += m.l; });
    return { rows: sorted.map(([, m]) => m), totalP, totalA, totalL, totalDays: totalP + totalA + totalL };
  }, [history, attendance]);

  async function exportExcel() {
    try {
      showToast("Generating Excel...");
      const sectionName = section?.title || "Section";
      const subjectName = section?.subject || "";
      const rows: any[][] = [];
      rows.push([`Attendance Report — ${sectionName}${subjectName ? " — " + subjectName : ""}`]);
      rows.push([`Month: ${monthLabel}  |  Generated: ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`]);
      rows.push([]);

      const headers: any[] = ["#", "Student Name"];
      for (let d = 1; d <= daysInMonth; d++) headers.push(String(d));
      headers.push("Present", "Absent", "Late");
      rows.push(headers);

      let totP = 0, totA = 0, totL = 0;
      students.forEach((stud, idx) => {
        const row: any[] = [idx + 1, stud.full_name];
        let p = 0, a = 0, l = 0;
        for (let d = 1; d <= daysInMonth; d++) {
          const status = attMap.get(`${stud.full_name}__${dateFor(d)}`);
          const mark = markOf(status).m;
          row.push(mark === "-" ? "" : mark);
          if (mark === "P") p++;
          else if (mark === "A") a++;
          else if (mark === "L") l++;
        }
        row.push(p, a, l);
        totP += p; totA += a; totL += l;
        rows.push(row);
      });

      rows.push([]);
      rows.push(["", "GRAND TOTAL", ...Array(daysInMonth).fill(""), totP, totA, totL]);

      await writeStyledSheet(rows, {
        sheetName: "Attendance",
        headerRow: 3,
        fileName: `Attendance_${sectionName}_${monthLabel.replace(/\s+/g, "_")}.xlsx`,
      });
      showToast("Attendance exported successfully!");
    } catch (e: any) {
      showToast("Export failed: " + (e?.message || e), true);
    }
  }

  const exportBtn = (
    <button className="export-btn" onClick={exportExcel}>
      <i className="fa-solid fa-file-excel" /> <span className="export-text">Export Excel</span>
    </button>
  );

  usePageMeta("Attendance", undefined, exportBtn);

  const quarter = normQ(section?.quarter);

  return (
    <>
      <div className="dashboard-wrapper">
        <div className="dash-wrap"><h3>SEMESTER</h3><h4>{section?.semester || "1st Sem"}</h4></div>
        <div className="dash-wrap"><h3>QUARTER</h3><h4 className="badge">Q{quarter}</h4></div>
        <div className="dash-wrap"><h3>SUBJECT</h3><h4>{section?.subject || "--"}</h4></div>
        <div className="dash-wrap"><h3>TOTAL STUDENTS</h3><h4>{students.length}</h4></div>
        <div className="dash-wrap"><h3>SECTION</h3><h4 className="badge">{section?.title || "--"}</h4></div>
      </div>

      <div className="inf-summary">
        <div className="dat-box dat-box-centered">
          <div className="dat-icon dat-icon-total"><i className="fa-solid fa-users" /></div>
          <h4>TOTAL STUDENTS</h4>
          <p className="txt-total">{students.length}</p>
        </div>
        <div className="dat-box dat-box-centered">
          <div className="dat-icon dat-icon-present"><i className="fa-solid fa-user-check" /></div>
          <h4>TODAY&apos;S PRESENT</h4>
          <p className="txt-present">{summary.present}</p>
        </div>
        <div className="dat-box dat-box-centered">
          <div className="dat-icon dat-icon-absent"><i className="fa-solid fa-user-xmark" /></div>
          <h4>TODAY&apos;S ABSENT</h4>
          <p className="txt-absent">{summary.absent}</p>
        </div>
        <div className="dat-box dat-box-centered">
          <div className="dat-icon dat-icon-late"><i className="fa-solid fa-clock" /></div>
          <h4>TODAY&apos;S LATE</h4>
          <p className="txt-late">{summary.late}</p>
        </div>
      </div>

      <div className="attendance-table-container">
        <div className="table-header">
          <div className="search-container">
            <i className="fa-solid fa-magnifying-glass search-icon" />
            <input type="text" placeholder="Search student name..." value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && (
              <button className="search-clear" style={{ display: "flex" }} onClick={() => setSearch("")} title="Clear">
                <i className="fa-solid fa-times" />
              </button>
            )}
          </div>

          <div className="month-controls">
            <button onClick={() => changeMonth(-1)} className="month-nav-btn"><i className="fa-solid fa-chevron-left" /></button>
            <span id="currentMonthLabel" style={{ fontWeight: 700, width: 130, textAlign: "center", color: "var(--text-dark)" }}>{monthLabel}</span>
            <button onClick={() => changeMonth(1)} className="month-nav-btn"><i className="fa-solid fa-chevron-right" /></button>
            <button className="month-today-btn" onClick={jumpToCurrentMonth} title="Jump to current month"><i className="fa-solid fa-calendar-day" /> Today</button>
          </div>

          <div className="legend-controls">
            <span className="legend-pill legend-pill-p">P = Present</span>
            <span className="legend-pill legend-pill-a">A = Absent</span>
            <span className="legend-pill legend-pill-l">L = Late</span>
          </div>
        </div>

        <div className="table-responsive">
          <table className="record-table">
            <thead>
              <tr>
                <th className="sticky-col-1" rowSpan={2}>#</th>
                <th className="sticky-col-2" rowSpan={2}>Student Name</th>
                <th colSpan={daysInMonth} style={{ borderBottom: "1px solid var(--border-color)", textAlign: "center", background: "var(--table-header)" }}>{monthLabel}</th>
              </tr>
              <tr>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                  <th key={d} className={isCurrentMonth && d === todayDay ? "today-col-header" : undefined}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr>
                  <td colSpan={daysInMonth + 2} style={{ padding: 0 }}>
                    <div className="empty-state">
                      <div className="empty-state-icon"><i className="fa-solid fa-calendar-xmark" /></div>
                      <div className="empty-state-title">No students enrolled</div>
                      <div className="empty-state-msg">Add students in this section to start taking attendance.</div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredStudents.map(({ s, i, hidden }) => (
                  <tr key={s.id} className="student-data-row" style={hidden ? { display: "none" } : undefined}>
                    <td className="sticky-col-1">{i + 1}</td>
                    <td className="sticky-col-2 search-target name-clickable" title="Click to view attendance history" onClick={() => setHistory({ open: true, name: s.full_name })}>
                      {s.full_name}
                    </td>
                    {Array.from({ length: daysInMonth }, (_, di) => di + 1).map((d) => {
                      const date = dateFor(d);
                      const { m, c } = markOf(attMap.get(`${s.full_name}__${date}`));
                      const todayCls = isCurrentMonth && d === todayDay ? " today-col" : "";
                      return (
                        <td
                          key={d}
                          className={`editable-cell ${c}${todayCls}`}
                          tabIndex={0}
                          title="Click to cycle or Type P, A, L"
                          onClick={() => onCellClick(s.full_name, date)}
                          onKeyDown={(e) => onCellKey(e, s.full_name, date)}
                        >
                          <span className="mark-letter">{m}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Student history modal */}
      <div className={`history-overlay${history.open ? " active" : ""}`} onClick={(e) => e.target === e.currentTarget && setHistory({ open: false, name: "" })}>
        <div className="history-panel">
          <div className="history-panel-header">
            <div>
              <h3>{history.name}</h3>
              <p>{(section?.title || "Section") + (section?.subject ? " · " + section.subject : "")}</p>
            </div>
            <button className="history-close-btn" onClick={() => setHistory({ open: false, name: "" })}>
              <i className="fa-solid fa-times" />
            </button>
          </div>
          <div className="history-panel-body">
            {historyData && historyData.totalDays === 0 ? (
              <div className="history-empty">
                <i className="fa-solid fa-calendar-xmark" style={{ fontSize: "2rem", marginBottom: 12, display: "block", color: "var(--border-color)" }} />
                No attendance records found for this student in this section.
              </div>
            ) : historyData ? (
              <>
                <div className="history-summary-row">
                  <div className="history-stat"><span>Present</span><strong className="hist-p">{historyData.totalP}</strong></div>
                  <div className="history-stat"><span>Absent</span><strong className="hist-a">{historyData.totalA}</strong></div>
                  <div className="history-stat"><span>Late</span><strong className="hist-l">{historyData.totalL}</strong></div>
                  <div className="history-stat"><span>Total Days</span><strong>{historyData.totalDays}</strong></div>
                </div>
                <table className="history-month-table">
                  <thead>
                    <tr><th>Month</th><th>Present</th><th>Absent</th><th>Late</th></tr>
                  </thead>
                  <tbody>
                    {historyData.rows.map((m, idx) => (
                      <tr key={idx}>
                        <td>{m.label}</td>
                        <td className={m.p ? "hist-p" : ""}>{m.p || "—"}</td>
                        <td className={m.a ? "hist-a" : ""}>{m.a || "—"}</td>
                        <td className={m.l ? "hist-l" : ""}>{m.l || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="history-total-row">
                      <td>Total</td>
                      <td className="hist-p">{historyData.totalP}</td>
                      <td className="hist-a">{historyData.totalA}</td>
                      <td className="hist-l">{historyData.totalL}</td>
                    </tr>
                  </tfoot>
                </table>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className={`toast-notification ${toast.err ? "error" : ""} ${toast.show ? "show" : ""}`}>
        <i className={`fa-solid ${toast.err ? "fa-circle-exclamation" : "fa-circle-check"}`} />
        <span>{toast.msg}</span>
      </div>
    </>
  );

  function changeMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 0) { m = 11; y--; }
    else if (m > 11) { m = 0; y++; }
    setMonth(m);
    setYear(y);
  }
  function jumpToCurrentMonth() {
    const d = new Date();
    setMonth(d.getMonth());
    setYear(d.getFullYear());
  }
}
