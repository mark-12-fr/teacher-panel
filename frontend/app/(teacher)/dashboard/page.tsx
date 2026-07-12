"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Chart, registerables } from "chart.js";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { setSubjectConfigs, finalGrade, weightsFor, passingFor } from "@/lib/grading";
import { usePageMeta } from "@/lib/page-meta";
import { useCachedData } from "@/hooks/use-cached-data";

Chart.register(...registerables);

const filled = (v: any) => v !== null && v !== undefined && v !== "";
const normalizeQtr = (q: any) => String(q || "1").replace(/[^1-4]/g, "") || "1";

interface TopStudent {
  name: string;
  section: string;
  grade: number;
}

const cardsInit = { sections: 0, students: 0, present: 0, absent: 0 };

function useGreeting() {
  const [greeting, setGreeting] = useState("Welcome");
  useEffect(() => {
    const update = () => {
      const h = new Date().getHours();
      setGreeting(h < 12 ? "Good Morning" : h < 18 ? "Good Afternoon" : "Good Evening");
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, []);
  return greeting;
}

function useTeacherInfo() {
  const [title, setTitle] = useState("Ma'am");
  const [firstName, setFirstName] = useState("Teacher");
  useLayoutEffect(() => {
    try {
      const cached = localStorage.getItem("cached_user_title");
      if (cached === "Ma'am" || cached === "Sir") setTitle(cached);
      else {
        const name = localStorage.getItem("cached_user_name") || "";
        const first = name.split(" ")[0] || "";
        const last = first.slice(-1).toLowerCase();
        const t = "aei".includes(last) ? "Ma'am" : "Sir";
        localStorage.setItem("cached_user_title", t);
        setTitle(t);
      }
      const name = localStorage.getItem("cached_user_name") || "Teacher";
      setFirstName(name.split(" ")[0] || "Teacher");
    } catch {}
  }, []);
  return { title, firstName };
}

export default function DashboardPage() {
  usePageMeta("Dashboard", "Teacher Overview");
  const greeting = useGreeting();
  const { title: teacherTitle, firstName: teacherFirstName } = useTeacherInfo();

  const [cards, setCards] = useState<typeof cardsInit>(cardsInit);
  const [rates, setRates] = useState<{ p: number; a: number } | null>(null);
  const [chartData, setChartData] = useState<(number | null)[]>([null, null, null, null]);
  const [activeSem, setActiveSem] = useState("both");
  const [passing, setPassing] = useState(75);
  const [top, setTop] = useState<TopStudent[]>([]);

  const [schedules, setSchedules] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [noteInput, setNoteInput] = useState("");

  const [clock, setClock] = useState({ time: "", date: "" });
  const [toast, setToast] = useState<{ show: boolean; msg: string; err: boolean }>({ show: false, msg: "", err: false });
  const [loadError, setLoadError] = useState<string | null>(null);

  const [schedModal, setSchedModal] = useState(false);
  const [noticeModal, setNoticeModal] = useState(false);
  const [sched, setSched] = useState({ subject: "", time: "", details: "" });
  const [notice, setNotice] = useState({ text: "", date: "", time: "" });

  const [attModal, setAttModal] = useState<{ open: boolean; title: string; list: any[] }>({ open: false, title: "", list: [] });
  const [secModal, setSecModal] = useState(false);

  const sectionsRef = useRef<any[]>([]);
  const todayAttRef = useRef<any[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  function showToast(msg: string, err = false) {
    setToast({ show: true, msg, err });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  }

  // ── Live clock ──────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock({
        time: now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }),
        date: now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" }),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Cache helpers ──────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    let sections: any[] = [];
    let subjects: any[] = [];
    try {
      const [secResp, subjResp] = await Promise.all([apiGet("/api/sections"), apiGet("/api/subjects")]);
      sections = secResp.sections || [];
      subjects = subjResp.subjects || [];
      setSubjectConfigs(subjects);
    } catch {
      throw new Error("Failed to fetch sections/subjects");
    }

    const today = `${String(new Date().getDate()).padStart(2, "0")}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${new Date().getFullYear()}`;

    let totalStudents = 0;
    let present = 0;
    let absent = 0;
    const todayAtt: any[] = [];
    const qTotals = { "1": { t: 0, c: 0 }, "2": { t: 0, c: 0 }, "3": { t: 0, c: 0 }, "4": { t: 0, c: 0 } } as Record<string, { t: number; c: number }>;
    const allScores: TopStudent[] = [];

    try {
      const perSection = await Promise.all(
        sections.map(async (s: any) => {
          try {
            const [st, att, rec] = await Promise.all([
              apiGet(`/api/sections/${s.id}/students`),
              apiGet(`/api/sections/${s.id}/attendance?date=${encodeURIComponent(today)}`),
              apiGet(`/api/sections/${s.id}/class-records`),
            ]);
            return { s, students: st.students || [], attendance: att.attendance || [], records: rec.records || [] };
          } catch {
            return { s, students: [], attendance: [], records: [] };
          }
        })
      );

      perSection.forEach(({ s, students, attendance, records }) => {
        totalStudents += students.length;
        attendance.forEach((r: any) => {
          if (r.status === "Present") present++;
          else absent++;
          todayAtt.push({ status: r.status, student_name: r.student_name, section: s.title });
        });

        students.forEach((student: any) => {
          const studentRecords = records
            .filter((r: any) => r.student_id === student.id)
            .sort((a: any, b: any) => Number(normalizeQtr(a.quarter)) - Number(normalizeQtr(b.quarter)));
          if (!studentRecords.length) return;

          studentRecords.forEach((row: any) => {
            let hasScore = false;
            for (const key in row) {
              if ((key.startsWith("module_") || key.startsWith("activity_") || key.startsWith("pt_") || key === "at" || key === "qe") && Number(row[key]) > 0) {
                hasScore = true;
                break;
              }
            }
            if (!hasScore) return;
            const qtr = normalizeQtr(row.quarter);
            const grade = finalGrade(row, s.subject, 100);
            if (qTotals[qtr]) {
              qTotals[qtr].t += grade;
              qTotals[qtr].c++;
            }
          });

          const merged = studentRecords.reduce((acc: any, curr: any) => {
            Object.keys(curr).forEach((k) => {
              if (filled(curr[k])) acc[k] = curr[k];
            });
            return acc;
          }, {});
          allScores.push({ name: student.full_name || "No Name", section: s.title, grade: finalGrade(merged, s.subject, 100) });
        });
      });
    } catch {
      // Per-section data failures are non-fatal
    }

    const semCounts: Record<string, number> = {};
    sections.forEach((s: any) => {
      if (s.semester) semCounts[s.semester] = (semCounts[s.semester] || 0) + 1;
    });
    let sem = "both";
    if (semCounts["2nd Sem"] > 0 && !semCounts["1st Sem"]) sem = "2nd Sem";
    else if (semCounts["1st Sem"] > 0 && !semCounts["2nd Sem"]) sem = "1st Sem";

    const qAvg = (k: string) => (qTotals[k].c > 0 ? Number((qTotals[k].t / qTotals[k].c).toFixed(2)) : null);

    const norm = (v: any) => String(v == null ? "" : v).trim().toLowerCase();
    const cfgVals = subjects.map((r: any) => Number(r.passing_grade)).filter((n: number) => isFinite(n));
    const distinct = [...new Set(cfgVals)] as number[];
    const sole = distinct.length === 1 ? distinct[0] : null;
    let dashPassing = 75;
    if (distinct.length > 0) {
      const perSec = sections.map((s: any) => {
        const p = passingFor(s.subject);
        return isFinite(p) ? p : sole != null ? sole : Math.min(...distinct);
      });
      const set = [...new Set(perSec)] as number[];
      dashPassing = set.length === 1 ? set[0] : set.length ? Math.min(...set) : sole != null ? sole : Math.min(...distinct);
    }

    allScores.sort((a, b) => b.grade - a.grade);
    const totAtt = present + absent;

    return {
      sections,
      todayAtt,
      cards: { sections: sections.length, students: totalStudents, present, absent },
      rates: totAtt > 0 ? { p: Math.round((present / totAtt) * 100), a: 100 - Math.round((present / totAtt) * 100) } : null,
      chartData: [qAvg("1"), qAvg("2"), qAvg("3"), qAvg("4")],
      activeSem: sem,
      passing: dashPassing,
      top: allScores.slice(0, 5),
    };
  }, []);

  const fetchSchedules = useCallback(async () => { try { return (await apiGet("/api/schedules")).schedules || []; } catch { return []; } }, []);
  const fetchNotices = useCallback(async () => { try { return (await apiGet("/api/notices")).notices || []; } catch { return []; } }, []);
  const fetchNotes = useCallback(async () => { try { return (await apiGet("/api/notes")).notes || []; } catch { return []; } }, []);

  const statsCache = useCachedData("dash_cache_stats", fetchStats, { ttl: 300000 });
  const schedCache = useCachedData("dash_cache_sched", fetchSchedules, { ttl: 300000 });
  const noticeCache = useCachedData("dash_cache_notice", fetchNotices, { ttl: 300000 });
  const noteCache = useCachedData("dash_cache_note", fetchNotes, { ttl: 300000 });

  // Apply cached data to state
  useEffect(() => {
    if (!statsCache.data) return;
    const d = statsCache.data;
    sectionsRef.current = d.sections;
    todayAttRef.current = d.todayAtt;
    setCards(d.cards);
    setRates(d.rates);
    setChartData(d.chartData);
    setActiveSem(d.activeSem);
    setPassing(d.passing);
    setTop(d.top);
  }, [statsCache.data]);

  useEffect(() => {
    if (!schedCache.data) return;
    setSchedules(schedCache.data);
  }, [schedCache.data]);

  useEffect(() => {
    if (!noticeCache.data) return;
    setNotices(noticeCache.data);
  }, [noticeCache.data]);

  useEffect(() => {
    if (!noteCache.data) return;
    setNotes(noteCache.data);
  }, [noteCache.data]);

  // Only show error on full failure (no cached data at all)
  useEffect(() => {
    if (statsCache.error && !statsCache.data) {
      setLoadError("Failed to load dashboard data. Check your connection.");
    }
  }, [statsCache.error, statsCache.data]);

  // ── Chart ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (chartRef.current) chartRef.current.destroy();

    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const gridColor = isDark ? "rgba(148, 163, 184, 0.1)" : "rgba(15, 23, 42, 0.06)";
    const labelColor = isDark ? "#9ca3af" : "#64748b";
    const neutralClr = isDark ? "#818cf8" : "#3b82f6";
    const upClr = "#22c55e";
    const downClr = "#ef4444";
    const PASS = passing;
    const pointColors = chartData.map((v) => (v == null ? neutralClr : Number(v) >= PASS ? upClr : downClr));
    const valid = chartData.filter((v) => v != null && !isNaN(v as number)) as number[];
    const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    const fillRGB = avg == null ? "59, 130, 246" : avg >= PASS ? "34, 197, 94" : "239, 68, 68";
    const gradient = ctx.createLinearGradient(0, 0, 0, 230);
    gradient.addColorStop(0, `rgba(${fillRGB}, 0.28)`);
    gradient.addColorStop(0.6, `rgba(${fillRGB}, 0.07)`);
    gradient.addColorStop(1, `rgba(${fillRGB}, 0)`);

    chartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels: ["Q1", "Q2", "Q3", "Q4"],
        datasets: [
          {
            label: "Class Average",
            data: chartData as any,
            borderColor: neutralClr,
            segment: {
              borderColor: (segCtx: any) => {
                const v = segCtx?.p1?.parsed?.y;
                if (v == null || isNaN(v)) return neutralClr;
                return Number(v) >= PASS ? upClr : downClr;
              },
            },
            backgroundColor: gradient,
            borderWidth: 2.5,
            pointBackgroundColor: pointColors,
            pointBorderColor: isDark ? "#1f2937" : "#ffffff",
            pointBorderWidth: 3,
            pointRadius: 6,
            pointHoverRadius: 9,
            fill: true,
            tension: 0.4,
            spanGaps: true,
          },
          {
            label: `Passing (${PASS}%)`,
            data: Array(4).fill(PASS),
            borderColor: "rgba(34, 197, 94, 0.6)",
            backgroundColor: "transparent",
            borderWidth: 1.5,
            borderDash: [5, 5],
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
            tension: 0,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 8, right: 4 } },
        interaction: { mode: "index", intersect: false },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: gridColor },
            ticks: { color: labelColor, font: { size: 11, family: "Inter", weight: 500 }, stepSize: 25, callback: (v: any) => v + "%" },
          },
          x: { grid: { display: false }, ticks: { color: labelColor, font: { size: 12, family: "Inter", weight: 600 } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items: any) => items[0].label,
              label: (c: any) => {
                if (c.dataset.label?.indexOf("Passing (") === 0) return "";
                return c.parsed.y !== null ? `Class Average: ${c.parsed.y.toFixed(1)}%` : "No data yet";
              },
            },
          },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [chartData, passing]);

  // ── Cache helpers (write-through to localStorage) ─────────────────────────
  // ── Optimistic CRUD handlers ──────────────────────────────────────────────
  const tempId = () => "_opt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  async function saveSchedule() {
    if (!sched.subject.trim() || !sched.time || !sched.details.trim()) return showToast("Please fill in all fields.", true);
    const [h, m] = sched.time.split(":");
    const hour = parseInt(h);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    const entry = { id: tempId(), subject: sched.subject.trim(), time: `${hour12}:${m} ${ampm}`, details: sched.details.trim() };
    setSchedules((prev) => [entry, ...prev]);
    setSched({ subject: "", time: "", details: "" });
    setSchedModal(false);
    try {
      await apiPost("/api/schedules", { subject: entry.subject, time: entry.time, details: entry.details });
      schedCache.refresh();
    } catch {
      setSchedules((prev) => prev.filter((x) => x.id !== entry.id));
      showToast("Failed to add schedule.", true);
    }
  }
  async function deleteSchedule(id: string) {
    const removed = schedules.find((x) => x.id === id);
    setSchedules((prev) => prev.filter((x) => x.id !== id));
    try {
      await apiDelete(`/api/schedules/${id}`);
      schedCache.refresh();
    } catch {
      if (removed) setSchedules((prev) => [removed, ...prev]);
      showToast("Failed to delete schedule.", true);
    }
  }
  async function saveNotice() {
    if (!notice.text.trim() || !notice.date) return showToast("Please fill in the notice and date.", true);
    const colors = ["blue", "orange", "green"];
    const entry = { id: tempId(), text: notice.text.trim(), date: notice.date, time: notice.time || null, color: colors[Math.floor(Math.random() * colors.length)] };
    setNotices((prev) => [entry, ...prev]);
    setNotice({ text: "", date: "", time: "" });
    setNoticeModal(false);
    try {
      await apiPost("/api/notices", { text: entry.text, date: entry.date, time: entry.time, color: entry.color });
      noticeCache.refresh();
    } catch {
      setNotices((prev) => prev.filter((x) => x.id !== entry.id));
      showToast("Failed to add notice.", true);
    }
  }
  async function deleteNotice(id: string) {
    const removed = notices.find((x) => x.id === id);
    setNotices((prev) => prev.filter((x) => x.id !== id));
    try {
      await apiDelete(`/api/notices/${id}`);
      noticeCache.refresh();
    } catch {
      if (removed) setNotices((prev) => [removed, ...prev]);
      showToast("Failed to delete notice.", true);
    }
  }
  async function addNote() {
    const t = noteInput.trim();
    if (!t) return;
    const entry = { id: tempId(), content: t };
    setNotes((prev) => [entry, ...prev]);
    setNoteInput("");
    try {
      await apiPost("/api/notes", { content: t });
      noteCache.refresh();
    } catch {
      setNotes((prev) => prev.filter((x) => x.id !== entry.id));
      showToast("Failed to save note.", true);
    }
  }
  async function deleteNote(id: string) {
    const removed = notes.find((x) => x.id === id);
    setNotes((prev) => prev.filter((x) => x.id !== id));
    try {
      await apiDelete(`/api/notes/${id}`);
      noteCache.refresh();
    } catch {
      if (removed) setNotes((prev) => [removed, ...prev]);
      showToast("Failed to delete note.", true);
    }
  }

  function showAttendanceDetails(type: "present" | "absent") {
    const list = todayAttRef.current
      .filter((r) => (type === "present" ? r.status === "Present" : r.status !== "Present"))
      .sort((a, b) => String(a.section).localeCompare(String(b.section)));
    setAttModal({ open: true, title: type === "present" ? "Today's Present Students" : "Today's Absent & Late Students", list });
  }

  const fmtNoticeDateTime = (n: any) => {
    let s = "";
    if (n.date) s = new Date(n.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    if (n.time) {
      const [h, m] = String(n.time).split(":");
      const hour = parseInt(h);
      const ampm = hour >= 12 ? "PM" : "AM";
      s += ` - ${hour % 12 || 12}:${m} ${ampm}`;
    }
    return s;
  };
  const schedStatus = (time: string) => {
    if (!time) return "upcoming";
    try {
      const parts = time.trim().split(/\s+/);
      const [hR, mR] = parts[0].split(":");
      const ampm = (parts[1] || "AM").toUpperCase();
      let h = parseInt(hR);
      if (ampm === "PM" && h !== 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      const d = new Date();
      d.setHours(h, parseInt(mR) || 0, 0, 0);
      const now = Date.now();
      if (now > d.getTime() + 3600000) return "past";
      if (now >= d.getTime()) return "current";
      return "upcoming";
    } catch {
      return "upcoming";
    }
  };

  const semLabel = activeSem === "1st Sem" ? "1st Semester" : activeSem === "2nd Sem" ? "2nd Semester" : "1st-2nd Semester";
  const validChart = chartData.filter((v) => v != null && (v as number) > 0) as number[];
  const overallAvg = validChart.length ? Math.round(validChart.reduce((a, b) => a + b, 0) / validChart.length) : null;

  return (
    <>
      {loadError && (
        <div className="error-banner" style={{ background: "#fef2f2", color: "#dc2626", padding: "12px 16px", borderRadius: 8, marginBottom: 16, display: "flex", alignItems: "center", gap: 8, fontSize: "0.9rem" }}>
          <i className="fa-solid fa-circle-exclamation" /> {loadError}
        </div>
      )}
      <div className="dashboard-grid">
        <div className="div-banner">
          <div className="banner-shine" />
          <div className="welcome-text">
            <h2>
              <i className="fa-solid fa-sun" style={{ color: "#fbbf24" }} /> {greeting}, {teacherTitle} {teacherFirstName}!
            </h2>
            <p style={{ fontSize: "0.95rem", opacity: 0.9 }}>Here&apos;s a quick overview of your classes today.</p>
          </div>
          <div className="time-container">
            <span>{clock.time}</span>
            <small>{clock.date}</small>
          </div>
        </div>

        <div className="dash-card stat-card stat-card-blue">
          <div className="stat-icon-wrapper stat-icon-blue"><i className="fa-solid fa-users" /></div>
          <div>
            <span className="stat-title">TOTAL STUDENTS</span>
            <div className="stat-value">{cards.students}</div>
          </div>
        </div>

        <div className="dash-card stat-card stat-card-green" onClick={() => setSecModal(true)} style={{ cursor: "pointer" }} title="Click to view sections">
          <div className="stat-icon-wrapper stat-icon-green"><i className="fa-solid fa-layer-group" /></div>
          <div>
            <span className="stat-title">TOTAL SECTIONS</span>
            <div className="stat-value">{cards.sections}</div>
          </div>
        </div>

        <div className="dash-card stat-card stat-card-yellow" onClick={() => showAttendanceDetails("absent")} style={{ cursor: "pointer" }}>
          <div className="stat-icon-wrapper stat-icon-yellow"><i className="fa-solid fa-user-xmark" /></div>
          <div>
            <span className="stat-title">TODAY&apos;S ABSENT &amp; LATE</span>
            <div className="stat-value">{cards.absent}</div>
            {rates && <div className={`attend-rate ${rates.a <= 20 ? "rate-good" : rates.a <= 40 ? "rate-warn" : "rate-bad"}`}>{rates.a}% absent/late</div>}
          </div>
        </div>

        <div className="dash-card stat-card stat-card-purple" onClick={() => showAttendanceDetails("present")} style={{ cursor: "pointer" }}>
          <div className="stat-icon-wrapper stat-icon-purple"><i className="fa-solid fa-user-check" /></div>
          <div>
            <span className="stat-title">TODAY&apos;S PRESENT</span>
            <div className="stat-value">{cards.present}</div>
            {rates && <div className={`attend-rate ${rates.p >= 80 ? "rate-good" : rates.p >= 60 ? "rate-warn" : "rate-bad"}`}>{rates.p}% present today</div>}
          </div>
        </div>

        <div className="dash-card main-chart">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h4 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: 7 }}>Class Performance Overview</h4>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                <span className="chart-badge chart-badge-sem"><i className="fa-regular fa-calendar" style={{ fontSize: "0.65rem" }} /> {semLabel}</span>
                <span className="chart-badge chart-badge-qtr"><i className="fa-solid fa-layer-group" style={{ fontSize: "0.65rem" }} /> Q1 – Q4</span>
                <span className="chart-badge chart-badge-pass"><i className="fa-solid fa-minus" style={{ fontSize: "0.65rem" }} /> {passing}% Passing</span>
              </div>
            </div>
            {overallAvg != null && (
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontWeight: 500, marginBottom: 1 }}>Overall Avg</div>
                <div style={{ fontSize: "1.55rem", fontWeight: 800, color: overallAvg >= passing ? "#16a34a" : "#dc2626", lineHeight: 1 }}>{overallAvg}%</div>
              </div>
            )}
          </div>
          <div style={{ position: "relative", height: 230, width: "100%" }}>
            <canvas ref={canvasRef} />
          </div>
        </div>

        <div className="dash-card side-list">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h4>Today&apos;s Schedule</h4>
            <button onClick={() => setSchedModal(true)} style={{ background: "#3b82f6", color: "white", border: "none", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center" }}>
              <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
            </button>
          </div>
          <ul className="list-container" style={{ maxHeight: 190, overflowY: "auto" }}>
            {schedules.length === 0 ? (
              <li className="empty-msg" style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "20px 0" }}>No classes for today.</li>
            ) : (
              schedules.map((s) => {
                const status = schedStatus(s.time);
                return (
                  <li className={`item-row${status === "current" ? " sched-now" : ""}`} key={s.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ color: status === "past" ? "var(--text-muted)" : "var(--text-dark)", fontSize: "0.88rem", fontWeight: status === "current" ? 700 : 600 }}>{s.subject}</span>
                        {status === "current" && <span style={{ fontSize: "0.65rem", color: "#22c55e", fontWeight: 700, background: "rgba(34,197,94,0.12)", padding: "2px 7px", borderRadius: 4, marginLeft: 6 }}>NOW</span>}
                      </div>
                      <small style={{ color: status === "past" ? "var(--text-muted)" : "var(--text-dark)", opacity: status === "past" ? 1 : 0.72, fontSize: "0.78rem" }}>
                        {s.time}
                        {s.details ? " · " + s.details : ""}
                      </small>
                    </div>
                    <i className="fa-solid fa-trash-can delete-btn" onClick={() => deleteSchedule(s.id)} />
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="dash-card bottom-card-lg">
          <h4 style={{ marginBottom: 15 }}>Top Students</h4>
          <ul className="list-container" style={{ maxHeight: 200, overflowY: "auto", padding: 0 }}>
            {top.length === 0 ? (
              <li style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.9rem", marginTop: 20 }}>No performance data available yet</li>
            ) : (
              top.map((s, i) => {
                const barClr = s.grade >= passing ? "#22c55e" : "#ef4444";
                const gradeClr = s.grade >= passing ? "#16a34a" : "#dc2626";
                const rankColors = ["#f59e0b", "#9ca3af", "#cd7f32"];
                const rankBgs = ["rgba(245,158,11,0.13)", "rgba(156,163,175,0.13)", "rgba(205,127,50,0.13)"];
                return (
                  <li className="item-row" key={i} style={{ padding: "7px 5px", alignItems: "center", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 0 }}>
                      <span style={{ minWidth: 26, height: 26, borderRadius: "50%", background: i < 3 ? rankBgs[i] : "var(--hover-bg)", color: i < 3 ? rankColors[i] : "var(--text-muted)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: i < 3 ? 800 : 700, fontSize: "0.78rem", flexShrink: 0 }}>
                        {i < 3 ? `#${i + 1}` : i + 1}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.87rem", fontWeight: 600, color: "var(--text-dark)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 3 }}>{s.section}</div>
                        <div style={{ height: 4, background: "var(--border-color)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.min(s.grade, 100)}%`, background: barClr, borderRadius: 3 }} />
                        </div>
                      </div>
                    </div>
                    <span style={{ fontWeight: 800, fontSize: "0.93rem", color: gradeClr, flexShrink: 0 }}>{s.grade}%</span>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="dash-card bottom-card-sm">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h4>Notice Board</h4>
            <button onClick={() => setNoticeModal(true)} style={{ background: "#3b82f6", color: "white", border: "none", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center" }}>
              <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
            </button>
          </div>
          <div style={{ maxHeight: 140, overflowY: "auto", width: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {notices.length === 0 ? (
                  <tr><td colSpan={3} style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "20px 0" }}>No notices.</td></tr>
                ) : (
                  notices.map((n) => (
                    <tr key={n.id}>
                      <td className="notice-dot-cell"><div className={`notice-dot ${n.color}`} style={{ marginTop: 6 }} /></td>
                      <td className="notice-main-cell">
                        <div className="notice-text" style={{ marginBottom: 2 }}>{n.text}</div>
                        <div className="notice-date">{fmtNoticeDateTime(n)}</div>
                      </td>
                      <td className="notice-action-cell"><button className="delete-btn" onClick={() => deleteNotice(n.id)}><i className="fa-solid fa-trash-can" /></button></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="dash-card notes-card">
          <h4 style={{ marginBottom: 15 }}>Quick Notes</h4>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
            <input type="text" placeholder="Write a reminder..." value={noteInput} onChange={(e) => setNoteInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} style={{ flexGrow: 1, height: 35, padding: "0 10px", borderRadius: 8, outline: "none", fontSize: "0.9rem" }} />
            <button onClick={addNote} style={{ cursor: "pointer", background: "#3b82f6", color: "white", border: "none", borderRadius: 8, width: 35, height: 35, display: "flex", justifyContent: "center", alignItems: "center" }}>
              <i className="fa-solid fa-plus" style={{ fontSize: 14 }} />
            </button>
          </div>
          <ul className="list-container" style={{ maxHeight: 120, overflowY: "auto" }}>
            {notes.map((n) => (
              <li className="item-row" key={n.id}>
                <span style={{ fontSize: "0.9rem", color: "var(--text-dark)", overflowWrap: "break-word" }}>{n.content}</span>
                <button className="delete-btn" onClick={() => deleteNote(n.id)}><i className="fa-solid fa-trash-can" /></button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Toast */}
      <div className={`toast-notification ${toast.err ? "error" : ""} ${toast.show ? "show" : ""}`}>
        <i className={`fa-solid ${toast.err ? "fa-circle-xmark" : "fa-circle-check"}`} />
        <span>{toast.msg}</span>
      </div>

      {/* Schedule modal */}
      {schedModal && (
        <div className="modal-overlay" style={{ display: "flex" }}>
          <div className="modal-content">
            <h4 style={{ marginBottom: 15 }}>New Schedule</h4>
            <input type="text" placeholder="Subject" value={sched.subject} onChange={(e) => setSched({ ...sched, subject: e.target.value })} style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 6, outline: "none" }} />
            <input type="time" value={sched.time} onChange={(e) => setSched({ ...sched, time: e.target.value })} style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 6, outline: "none", fontFamily: "Inter, sans-serif" }} />
            <input type="text" placeholder="Section & Room" value={sched.details} onChange={(e) => setSched({ ...sched, details: e.target.value })} style={{ width: "100%", padding: 10, marginBottom: 15, borderRadius: 6, outline: "none" }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setSchedModal(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", cursor: "pointer", background: "#f1f5f9", color: "#333" }}>Cancel</button>
              <button onClick={saveSchedule} style={{ flex: 2, background: "#3b82f6", color: "white", padding: 10, borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600 }}>Add Now</button>
            </div>
          </div>
        </div>
      )}

      {/* Notice modal */}
      {noticeModal && (
        <div className="modal-overlay" style={{ display: "flex" }}>
          <div className="modal-content">
            <h4 style={{ marginBottom: 15 }}>New Notice</h4>
            <textarea placeholder="Notice Details (e.g. Faculty meeting - Friday 3:00 PM)" value={notice.text} onChange={(e) => setNotice({ ...notice, text: e.target.value })} style={{ width: "100%", padding: 10, marginBottom: 10, borderRadius: 6, outline: "none", resize: "vertical", minHeight: 80, fontFamily: "Inter, sans-serif" }} />
            <div style={{ display: "flex", gap: 10, marginBottom: 15 }}>
              <input type="date" value={notice.date} onChange={(e) => setNotice({ ...notice, date: e.target.value })} style={{ flex: 1, padding: 10, borderRadius: 6, outline: "none", fontFamily: "Inter, sans-serif" }} />
              <input type="time" value={notice.time} onChange={(e) => setNotice({ ...notice, time: e.target.value })} style={{ flex: 1, padding: 10, borderRadius: 6, outline: "none", fontFamily: "Inter, sans-serif" }} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setNoticeModal(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: "none", cursor: "pointer", background: "#f1f5f9", color: "#333" }}>Cancel</button>
              <button onClick={saveNotice} style={{ flex: 2, background: "#3b82f6", color: "white", padding: 10, borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600 }}>Post Notice</button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance detail modal */}
      {attModal.open && (
        <div className="modal-overlay" style={{ display: "flex" }}>
          <div className="modal-content" style={{ maxWidth: 450 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
              <h4>{attModal.title}</h4>
              <button onClick={() => setAttModal({ ...attModal, open: false })} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "var(--text-muted)" }}><i className="fa-solid fa-xmark" /></button>
            </div>
            <ul className="list-container" style={{ maxHeight: 300, overflowY: "auto", padding: 0 }}>
              {attModal.list.length === 0 ? (
                <li style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.9rem", padding: "20px 0" }}>No students found in this category.</li>
              ) : (
                attModal.list.map((st, i) => {
                  const c = st.status === "Present" ? "#22c55e" : st.status === "Late" ? "#f59e0b" : "#ef4444";
                  return (
                    <li className="item-row" key={i}>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <strong style={{ color: "var(--text-dark)", fontSize: "0.95rem" }}>{st.student_name}</strong>
                        <small style={{ color: "var(--text-muted)" }}>{st.section} - <span style={{ fontWeight: 600, color: c }}>{st.status}</span></small>
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>
      )}

      {/* Sections detail modal */}
      {secModal && (
        <div className="modal-overlay" style={{ display: "flex" }}>
          <div className="modal-content" style={{ maxWidth: 450 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
              <h4><i className="fa-solid fa-layer-group" style={{ color: "#22c55e", marginRight: 5 }} /> My Sections</h4>
              <button onClick={() => setSecModal(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "var(--text-muted)" }}><i className="fa-solid fa-xmark" /></button>
            </div>
            <ul className="list-container" style={{ maxHeight: 300, overflowY: "auto", padding: 0 }}>
              {sectionsRef.current.length === 0 ? (
                <li style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.9rem", padding: "20px 0" }}>No sections found.</li>
              ) : (
                [...sectionsRef.current].sort((a, b) => String(a.title).localeCompare(String(b.title))).map((s, i) => (
                  <li className="item-row" key={s.id}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <strong style={{ color: "var(--text-dark)", fontSize: "0.95rem" }}>{s.title}</strong>
                      <small style={{ color: "var(--text-muted)" }}>{s.subject || ""}{s.semester ? " · " + s.semester : ""}</small>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
