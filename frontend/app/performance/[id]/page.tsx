"use client";

// Per-section Class Performance analytics (ported from performance(2).html):
// stat cards, three Chart.js charts (per-quarter trend, grade distribution,
// average per component), and a searchable/filterable/sortable ranking table,
// plus Excel export and Print. Grades use the shared grading.ts logic (same as
// the dashboard, class record, and faci panel) so numbers match everywhere.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Chart, registerables } from "chart.js";
import { apiGet } from "@/lib/api";
import { setSubjectConfigs, passingFor, finalGrade } from "@/lib/grading";
import TeacherShell from "@/components/TeacherShell";
import { writeStyledSheet } from "@/lib/export";
import "./detail.css";

Chart.register(...registerables);

const SEMESTER_QUARTERS: Record<string, string[]> = {
  "1st Sem": ["1", "2"],
  "2nd Sem": ["3", "4"],
  Summer: ["1"],
};
const qNorm = (q: any) => String(q ?? 0).replace(/[^1-4]/g, "") || "0";
const filled = (v: any) => v !== null && v !== undefined && v !== "";
const ordinal = (q: string) => q + (q === "1" ? "st" : q === "2" ? "nd" : q === "3" ? "rd" : "th") + " Qtr";

type Row = { full_name: string; written_works: number; perf_task: number; quarterly_exam: number; final_grade: number };
type SortKey = "rank" | "name" | "ww" | "pt" | "qe" | "grade";

export default function PerformanceDetailPage() {
  const params = useParams<{ id: string }>();
  const sectionId = params.id;

  const [section, setSection] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; msg: string; err: boolean }>({ show: false, msg: "", err: false });

  const [tableState, setTableState] = useState<{ filter: string; search: string; sortKey: SortKey; sortDir: "asc" | "desc" }>({
    filter: "all",
    search: "",
    sortKey: "grade",
    sortDir: "desc",
  });

  const lineRef = useRef<HTMLCanvasElement>(null);
  const pieRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLCanvasElement>(null);
  const charts = useRef<{ line?: any; pie?: any; bar?: any }>({});

  function showToast(msg: string, err = false) {
    setToast({ show: true, msg, err });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 4000);
  }

  const load = useCallback(async () => {
    try {
      const sec = (await apiGet(`/api/sections/${sectionId}`)).section;
      setSection(sec);
      const [stu, rec, subj] = await Promise.all([
        apiGet(`/api/sections/${sectionId}/students`),
        apiGet(`/api/sections/${sectionId}/class-records`),
        apiGet(`/api/subjects`),
      ]);
      setSubjectConfigs(subj.subjects || []); // weights/passing before any grade calc
      setStudents(stu.students || []);
      setRecords(rec.records || []);
      try {
        const att = await apiGet(`/api/sections/${sectionId}/attendance`);
        setAttendance(att.attendance || []);
      } catch {}
      setReady(true);
    } catch {
      showToast("Unauthorized or Section not found", true);
    }
  }, [sectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const subject = section?.subject || "";
  const semester = section?.semester || "1st Sem";
  const passing = useMemo(() => (ready ? passingFor(subject) : 75), [ready, subject]);

  // ── Derive per-student rows + aggregate stats (mirrors loadPerformanceData) ──
  const perf = useMemo(() => {
    // Attendance tallies keyed by student name (teacher students have no id_no).
    const attByName: Record<string, { present: number; late: number; excused: number; total: number }> = {};
    for (const a of attendance) {
      const name = a.student_name ? String(a.student_name).trim().toLowerCase() : "";
      if (!name) continue;
      if (!attByName[name]) attByName[name] = { present: 0, late: 0, excused: 0, total: 0 };
      const s = (a.status || "").toLowerCase();
      if (s === "present") attByName[name].present++;
      else if (s === "late") attByName[name].late++;
      else if (s === "excused") attByName[name].excused++;
      attByName[name].total++;
    }

    const qBuckets: Record<string, { t: number; c: number }> = { "1": { t: 0, c: 0 }, "2": { t: 0, c: 0 }, "3": { t: 0, c: 0 }, "4": { t: 0, c: 0 } };

    const rows: Row[] = students.map((student) => {
      const studentRecords = records
        .filter((r) => r.student_id === student.id)
        .sort((a, b) => Number(qNorm(a.quarter)) - Number(qNorm(b.quarter)));
      const merged = studentRecords.reduce((acc: any, curr: any) => {
        Object.keys(curr).forEach((k) => {
          if (filled(curr[k])) acc[k] = curr[k];
        });
        return acc;
      }, {});

      let ww = 0;
      let pt = 0;
      const qe = Number(merged.qe) || 0;
      for (const k in merged) {
        if (k.startsWith("module_") || k.startsWith("activity_") || k === "at") ww += Number(merged[k]) || 0;
        else if (k.startsWith("pt_")) pt += Number(merged[k]) || 0;
      }

      const att = attByName[String(student.full_name || "").trim().toLowerCase()];
      const att100 = att && att.total > 0 ? Math.round(((att.present + 0.5 * (att.late + att.excused)) / att.total) * 100) : 100;
      const final = finalGrade(merged, subject, att100);

      // Per-quarter trend: each quarter's own record, only if it has a real score.
      studentRecords.forEach((rec) => {
        let hasScore = false;
        for (const k in rec) {
          if (!filled(rec[k])) continue;
          if (Number(rec[k]) > 0) {
            hasScore = true;
            break;
          }
        }
        if (!hasScore) return;
        const qk = qNorm(rec.quarter) === "0" ? "1" : qNorm(rec.quarter);
        if (qBuckets[qk]) {
          qBuckets[qk].t += finalGrade(rec, subject, 100);
          qBuckets[qk].c++;
        }
      });

      return { full_name: student.full_name || "No Name", written_works: ww, perf_task: pt, quarterly_exam: qe, final_grade: final };
    });

    let totalGrade = 0;
    let passed = 0;
    let highest = -Infinity;
    let lowest = Infinity;
    let totalWW = 0;
    let totalPT = 0;
    let totalExam = 0;
    const dist = { "90+": 0, "85-89": 0, "80-84": 0, "<80": 0 };
    rows.forEach((s) => {
      const g = s.final_grade || 0;
      totalGrade += g;
      if (g >= passing) passed++;
      if (g > 0) {
        if (g > highest) highest = g;
        if (g < lowest) lowest = g;
      }
      totalWW += s.written_works || 0;
      totalPT += s.perf_task || 0;
      totalExam += s.quarterly_exam || 0;
      if (g >= 90) dist["90+"]++;
      else if (g >= 85) dist["85-89"]++;
      else if (g >= 80) dist["80-84"]++;
      else dist["<80"]++;
    });

    return { rows, stats: { totalGrade, passed, highest, lowest, totalWW, totalPT, totalExam, dist, qBuckets } };
  }, [students, records, attendance, subject, passing]);

  const num = perf.rows.length;
  const stats = perf.stats;

  // ── Charts ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const neutral = isDark ? "#818cf8" : "#3b82f6";
    const up = "#22c55e";
    const down = "#ef4444";
    const n = num || 1;

    // Line: class average per quarter (this semester's quarters + any with data).
    const semQ = SEMESTER_QUARTERS[semester] || ["1", "2"];
    const withData = ["1", "2", "3", "4"].filter((q) => stats.qBuckets[q].c > 0);
    const quarters = [...new Set([...semQ, ...withData])].sort();
    const lineLabels = quarters.map(ordinal);
    const lineData = quarters.map((q) => (stats.qBuckets[q].c > 0 ? Number((stats.qBuckets[q].t / stats.qBuckets[q].c).toFixed(2)) : null));

    const valid = lineData.filter((v) => v != null && !isNaN(v as number)) as number[];
    const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    const fillRGB = avg == null ? "59, 130, 246" : avg >= passing ? "34, 197, 94" : "239, 68, 68";

    charts.current.line?.destroy();
    charts.current.pie?.destroy();
    charts.current.bar?.destroy();

    const lctx = lineRef.current?.getContext("2d");
    if (lctx) {
      const grad = lctx.createLinearGradient(0, 0, 0, 250);
      grad.addColorStop(0, `rgba(${fillRGB}, 0.28)`);
      grad.addColorStop(0.6, `rgba(${fillRGB}, 0.07)`);
      grad.addColorStop(1, `rgba(${fillRGB}, 0)`);
      charts.current.line = new Chart(lctx, {
        type: "line",
        data: {
          labels: lineLabels,
          datasets: [
            {
              label: "Class Average",
              data: lineData as any,
              borderColor: neutral,
              segment: { borderColor: (c: any) => { const v = c?.p1?.parsed?.y; return v == null || isNaN(v) ? neutral : Number(v) >= passing ? up : down; } },
              backgroundColor: grad,
              borderWidth: 3,
              pointBackgroundColor: (c: any) => { const v = c.raw; return v == null || isNaN(v) ? neutral : Number(v) >= passing ? up : down; },
              pointBorderColor: "#ffffff",
              pointBorderWidth: 2,
              pointRadius: 5,
              pointHoverRadius: 7,
              fill: true,
              tension: 0.3,
              spanGaps: true,
            },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 } } },
      });
    }

    const pctx = pieRef.current?.getContext("2d");
    if (pctx) {
      charts.current.pie = new Chart(pctx, {
        type: "doughnut",
        data: {
          labels: ["90+", "85-89", "80-84", "<80"],
          datasets: [{ data: [stats.dist["90+"], stats.dist["85-89"], stats.dist["80-84"], stats.dist["<80"]], backgroundColor: ["#10b981", "#3b82f6", "#f59e0b", "#ef4444"], borderWidth: 2, borderColor: "#ffffff" }],
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: "60%", plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 }, padding: 10 } } } },
      });
    }

    const bctx = barRef.current?.getContext("2d");
    if (bctx) {
      charts.current.bar = new Chart(bctx, {
        type: "bar",
        data: {
          labels: ["WW", "PT", "Exam"],
          datasets: [{ label: "Average Raw Score", data: [Number((stats.totalWW / n).toFixed(2)), Number((stats.totalPT / n).toFixed(2)), Number((stats.totalExam / n).toFixed(2))], backgroundColor: ["#3b82f6", "#10b981", "#f59e0b"], borderRadius: 4, maxBarThickness: 40 }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } },
      });
    }

    return () => {
      charts.current.line?.destroy();
      charts.current.pie?.destroy();
      charts.current.bar?.destroy();
      charts.current = {};
    };
  }, [ready, perf, passing, semester, num, stats]);

  // ── Ranking table ────────────────────────────────────────────────────────────
  const tieBreak = (a: Row, b: Row) => {
    const sumA = (a.written_works || 0) + (a.perf_task || 0) + (a.quarterly_exam || 0);
    const sumB = (b.written_works || 0) + (b.perf_task || 0) + (b.quarterly_exam || 0);
    if (sumA !== sumB) return sumB - sumA;
    return String(a.full_name || "").localeCompare(String(b.full_name || ""));
  };

  const tableRows = useMemo(() => {
    let filtered = perf.rows.slice();
    if (tableState.filter === "pass") filtered = filtered.filter((s) => (s.final_grade || 0) >= passing);
    else if (tableState.filter === "fail") filtered = filtered.filter((s) => (s.final_grade || 0) > 0 && (s.final_grade || 0) < passing);
    else if (tableState.filter === "top10") filtered = filtered.slice().sort((a, b) => (b.final_grade || 0) - (a.final_grade || 0)).slice(0, 10);

    const q = tableState.search.trim().toLowerCase();
    if (q) filtered = filtered.filter((s) => (s.full_name || "").toLowerCase().includes(q));

    const dir = tableState.sortDir === "asc" ? 1 : -1;
    const key = tableState.sortKey;
    filtered.sort((a, b) => {
      switch (key) {
        case "name":
          return (a.full_name || "").toLowerCase().localeCompare((b.full_name || "").toLowerCase()) * dir;
        case "ww":
          return ((a.written_works || 0) - (b.written_works || 0)) * dir;
        case "pt":
          return ((a.perf_task || 0) - (b.perf_task || 0)) * dir;
        case "qe":
          return ((a.quarterly_exam || 0) - (b.quarterly_exam || 0)) * dir;
        case "rank":
        case "grade":
        default: {
          const av = a.final_grade || 0;
          const bv = b.final_grade || 0;
          if (av !== bv) return (av - bv) * dir;
          return tieBreak(a, b);
        }
      }
    });
    return filtered;
  }, [perf.rows, tableState, passing]);

  function toggleSort(k: SortKey) {
    setTableState((s) =>
      s.sortKey === k
        ? { ...s, sortDir: s.sortDir === "asc" ? "desc" : "asc" }
        : { ...s, sortKey: k, sortDir: k === "name" ? "asc" : "desc" }
    );
  }

  async function exportExcel() {
    if (!perf.rows.length) return showToast("No data to export.", true);
    try {
      showToast("Generating Excel...");
      const sectionLabel = section?.title || "Section";
      const out: any[][] = [];
      out.push([`Class Performance — ${sectionLabel}`]);
      out.push([`Q${qNorm(section?.quarter) === "0" ? "1" : qNorm(section?.quarter)}  |  Generated: ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`]);
      out.push([]);
      out.push(["Rank", "Student Name", "Written Works", "Performance Task", "Quarterly Exam", "Final Grade"]);
      tableRows.forEach((s, i) => out.push([i + 1, String(s.full_name || ""), s.written_works || 0, s.perf_task || 0, s.quarterly_exam || 0, s.final_grade || 0]));
      await writeStyledSheet(out, {
        sheetName: "Performance",
        headerRow: 3,
        fileName: `Class_Performance_${sectionLabel.replace(/[^a-z0-9-_]/gi, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      });
      showToast("Excel exported successfully!");
    } catch (e: any) {
      showToast("Export failed: " + (e?.message || e), true);
    }
  }

  const classAvg = num > 0 ? (stats.totalGrade / num).toFixed(2) : "—";
  const passRate = num > 0 ? ((stats.passed / num) * 100).toFixed(0) + "%" : "—";
  const failingCount = perf.rows.filter((s) => (s.final_grade || 0) > 0 && (s.final_grade || 0) < passing).length;

  const actions = (
    <div className="topbar-actions">
      <button className="export-btn" onClick={exportExcel} title="Export to Excel">
        <i className="fa-solid fa-file-excel" /> <span className="export-text">Export Excel</span>
      </button>
      <button className="export-btn" onClick={() => window.print()} title="Print report">
        <i className="fa-solid fa-print" /> <span className="export-text">Print</span>
      </button>
    </div>
  );

  const arrow = (k: SortKey) => (tableState.sortKey === k ? (tableState.sortDir === "asc" ? "▴" : "▾") : "▾");

  return (
    <TeacherShell active="performance" title="Class Performance" action={actions}>
      <div className="dashboard-wrapper">
        <div className="dash-wrap"><h3>SEMESTER</h3><h4>{section?.semester || "1st Sem"}</h4></div>
        <div className="dash-wrap"><h3>SUBJECT</h3><h4>{section?.subject || "--"}</h4></div>
        <div className="dash-wrap"><h3>TOTAL STUDENTS</h3><h4>{students.length}</h4></div>
        <div className="dash-wrap"><h3>SECTION</h3><h4 className="badge">{section?.title || "--"}</h4></div>
      </div>

      <div className="failing-alert" id="failingAlert" style={{ display: failingCount > 0 ? "flex" : "none" }}>
        <i className="fa-solid fa-triangle-exclamation" />
        <span>{failingCount} student{failingCount === 1 ? "" : "s"} currently falling below {passing}%. Consider intervention.</span>
      </div>

      <div className="stats-grid">
        <div className="stat-card stat-card-blue"><h5>Class Average</h5><h2 className="text-blue">{classAvg}</h2></div>
        <div className="stat-card stat-card-green"><h5>Pass Rate</h5><h2 className="text-green">{passRate}</h2></div>
        <div className="stat-card stat-card-yellow"><h5>Highest Grade</h5><h2>{stats.highest === -Infinity ? "—" : stats.highest}</h2></div>
        <div className="stat-card stat-card-red"><h5>Lowest Grade</h5><h2 className="text-red">{stats.lowest === Infinity ? "—" : stats.lowest}</h2></div>
      </div>

      <div className="charts-grid">
        <div className="chart-card chart-full">
          <h3>Performance Trend</h3>
          <p>Class Average per Quarter</p>
          <div className="chart-container"><canvas ref={lineRef} /></div>
        </div>
        <div className="chart-card">
          <h3>Grade Distribution</h3>
          <p>Percentage of Class Grades</p>
          <div className="chart-container pie-container"><canvas ref={pieRef} /></div>
        </div>
        <div className="chart-card">
          <h3>Average per Component</h3>
          <p>Which one is higher?</p>
          <div className="chart-container"><canvas ref={barRef} /></div>
        </div>
      </div>

      <div className="table-card">
        <div className="table-card-header">
          <h3>All Students Ranking</h3>
          <div className="table-controls">
            <input type="text" className="table-search" placeholder="Search student..." value={tableState.search} onChange={(e) => setTableState((s) => ({ ...s, search: e.target.value }))} />
            {(["all", "pass", "fail", "top10"] as const).map((f) => (
              <button key={f} className={`filter-btn${tableState.filter === f ? " active" : ""}`} onClick={() => setTableState((s) => ({ ...s, filter: f }))}>
                {f === "all" ? "All" : f === "pass" ? "Passing" : f === "fail" ? "Failing" : "Top 10"}
              </button>
            ))}
          </div>
        </div>
        <div className="table-responsive-wrapper">
          <table>
            <thead>
              <tr>
                {([
                  ["rank", "Rank"],
                  ["name", "Student Name"],
                  ["ww", "Written Works"],
                  ["pt", "Perf. Task"],
                  ["qe", "Quarterly Exam"],
                  ["grade", "Final Grade"],
                ] as [SortKey, string][]).map(([k, label]) => (
                  <th key={k} className={`sortable${tableState.sortKey === k ? " active" : ""}`} onClick={() => toggleSort(k)}>
                    {label} <span className="sort-arrow">{arrow(k)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!ready ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: 20 }}>Loading...</td></tr>
              ) : perf.rows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>No students assigned to this section yet.</td></tr>
              ) : tableRows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>No students match the current filter.</td></tr>
              ) : (
                tableRows.map((s, index) => {
                  const rank = index + 1;
                  const rankClass = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "rank-other";
                  return (
                    <tr key={s.full_name + index}>
                      <td><span className={`rank-badge ${rankClass}`}>{rank}</span></td>
                      <td>{s.full_name}</td>
                      <td>{s.written_works || 0}</td>
                      <td>{s.perf_task || 0}</td>
                      <td>{s.quarterly_exam || 0}</td>
                      <td><strong>{s.final_grade || 0}</strong></td>
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
