// ── ai.ts — AcadTrack AI assistant logic (port of ai-assistant.js + the pages'
// processSmartDBQuery) ───────────────────────────────────────────────────────
// Deterministic look-ups (top / failing / who passed / a named student / absent
// today / schedule / facilitators / counts / summary) are answered locally so
// the numbers always match the dashboard & class record. Open-ended / advisory
// questions are sent to the backend /api/ai-evaluate with a compiled class-data
// context. Grades use the shared grading.ts logic.
import { apiGet, apiPost } from "@/lib/api";
import { componentScores, finalGrade, passingFor, setSubjectConfigs } from "@/lib/grading";

export type AIData = {
  sections: any[];
  students: any[];
  records: any[];
  attendance: any[];
  schedules: any[];
  facilitators: any[];
};

// ── Text helpers ─────────────────────────────────────────────────────────────
export const escapeHtml = (s: any) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function applyStatusBadges(html: string): string {
  return html
    .replace(/\[PASS\]/g, '<span class="ai-status-badge ai-status-pass">PASS</span>')
    .replace(/\[FAIL\]/g, '<span class="ai-status-badge ai-status-fail">FAIL</span>')
    .replace(/\b(PASSING)\b/g, '<span class="ai-status-badge ai-status-pass">PASSING</span>')
    .replace(/\b(FAILING)\b/g, '<span class="ai-status-badge ai-status-fail">FAILING</span>');
}

/** Convert the AI's markdown reply into the widget's HTML. */
export function formatAIText(text: string): string {
  let html = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(
      /`([^`]+?)`/g,
      '<code style="background:rgba(125,125,125,0.16);padding:1px 6px;border-radius:5px;font-size:0.9em;font-family:ui-monospace,Menlo,Consolas,monospace;">$1</code>'
    );
  html = applyStatusBadges(html);
  const lines = html.split("\n");
  let out = "";
  let listType: null | "ul" | "ol" = null;
  const closeList = () => {
    if (listType) {
      out += listType === "ol" ? "</ol>" : "</ul>";
      listType = null;
    }
  };
  lines.forEach((line) => {
    const t = line.trim();
    if (/^###\s+/.test(t)) {
      closeList();
      out += '<div class="ai-subheader">' + t.replace(/^###\s+/, "") + "</div>";
    } else if (/^##\s+/.test(t)) {
      closeList();
      out += '<div class="ai-section-header">' + t.replace(/^#{1,2}\s+/, "") + "</div>";
    } else if (/^\d+\.\s+/.test(t)) {
      if (listType !== "ol") {
        closeList();
        out += "<ol class='ai-list' style='list-style:decimal;padding-left:22px;'>";
        listType = "ol";
      }
      out += '<li style="margin:2px 0;">' + t.replace(/^\d+\.\s+/, "") + "</li>";
    } else if (/^[-*•]\s+/.test(t)) {
      if (listType !== "ul") {
        closeList();
        out += "<ul class='ai-list'>";
        listType = "ul";
      }
      out += "<li>" + t.replace(/^[-*•]\s+/, "") + "</li>";
    } else {
      closeList();
      if (t) out += "<p>" + t + "</p>";
    }
  });
  closeList();
  return out || escapeHtml(text);
}

/** Open-ended / advisory questions go to the AI model; factual look-ups don't. */
export function isEvaluationIntent(q: string): boolean {
  return /evaluate|analy|assess|improve|suggest|recommend|rekomendasyon|advice|advis|next step|what should i|ano.{0,8}dapat|dapat.{0,6}(himu|buhat)|remedial|remediation|intervention|action plan|strateg|draft.*(message|parent|letter)|(parent|message).*draft|predict|prediction|weekly summary|monthly summary|summary report|generate.*report|attendance.*month|month.*attendance|compare|comparison|section comparison|pattern|trend|at.?risk|risk.*fail|honor.?roll|honor list|perfect.*attendance|most.*improv|improv.*most|nag.?improv|progress.*student|how.*to.*help|how.*can.*help|paano.*bulig|bulig.*paano|ngaa.*(bagsak|fail|palya|nubo|mababa)/i.test(
    q || ""
  );
}

/** Warm small-talk (greetings / thanks / who-are-you); null for data questions. */
export function smallTalk(query: string): string | null {
  const q = String(query || "").toLowerCase();
  const dataWord =
    /grade|grado|score|puntos|student|estudyante|pasa|bagsak|fail|pass|top|highest|lowest|best|rank|absent|present|late|attendance|missing|kulang|exam|module|activit|performance|section|honor|risk|improv|summary|overview|report|compare|schedule|klase|facilitator|logs|population|how many|pila|id number|id ni|id of/i;
  if (dataWord.test(q)) return null;
  if (/\b(thank|thanks|salamat)\b/.test(q))
    return "You're very welcome! 😊 I'm always here if you need anything else about your classes.";
  if (
    /\b(hi|hello|hey|yo|kamusta|kumusta|maayong|magandang)\b/.test(q) ||
    q.includes("good morning") ||
    q.includes("good afternoon") ||
    q.includes("good evening")
  )
    return "Hi there! 👋 I'm your AcadTrack assistant. I can help you check grades, attendance, top or struggling students, missing requirements, and quick class summaries. What would you like to know?";
  if (/\b(who are you|sin-?o ka|what can you do|what do you do)\b/.test(q))
    return "I'm your AcadTrack AI assistant. 🙂 I can pull up grades and pass/fail, find your top or struggling students, check who's absent today, list missing requirements, and summarize how your class is doing. I understand Hiligaynon, Filipino, and English — just ask me anything about your classes!";
  return null;
}

// ── Grade helpers shared by the local handlers ──────────────────────────────
const qnum = (q: any) => Number(String(q ?? 0).replace(/[^1-4]/g, "") || 0);
const subjectOf = (data: AIData, sectionId: any) =>
  (data.sections.find((s) => s.id === sectionId) || {}).subject || "";

/** Merge a student's records across quarters (latest non-empty wins). */
function mergedRecord(data: AIData, studentId: any): any | null {
  const recs = data.records
    .filter((r) => r.student_id === studentId)
    .sort((a, b) => qnum(a.quarter) - qnum(b.quarter));
  if (!recs.length) return null;
  return recs.reduce((acc: any, c: any) => {
    Object.keys(c).forEach((k) => {
      if (c[k] !== null && c[k] !== undefined && c[k] !== "") acc[k] = c[k];
    });
    return acc;
  }, {});
}
// ── Section / quarter scoping (so "top in HUMSS 1" and "Q2 / Prelim" work) ───
const TERM_TO_Q: Record<string, string> = { prelim: "1", midterm: "2", final: "3", finals: "3" };
const normQtr = (q: any): string => {
  const t = String(q ?? "").trim().toLowerCase();
  return TERM_TO_Q[t] || t.replace(/[^1-4]/g, "");
};
/** The section whose title appears in the query (longest match wins), or null. */
function resolveSection(query: string, sections: any[]): any | null {
  const q = String(query || "").toLowerCase();
  let best: any = null;
  sections.forEach((s) => {
    const t = String(s.title || "").trim().toLowerCase();
    if (t && q.includes(t) && (!best || t.length > String(best.title || "").trim().length)) best = s;
  });
  return best;
}
/** A quarter/term digit ("1".."4") named in the query, or null. "final grade"
 *  is NOT treated as a term — only "final term"/"prelim"/"midterm"/"QN". */
function resolveQuarter(query: string): string | null {
  const q = " " + String(query || "").toLowerCase().replace(/[?.,]/g, " ") + " ";
  if (/\bprelim(?:inary)?\b/.test(q)) return "1";
  if (/\bmidterm\b/.test(q)) return "2";
  if (/\bfinal\s+term\b/.test(q)) return "3";
  const m = q.match(/\bq\s?([1-4])\b/) || q.match(/\b([1-4])(?:st|nd|rd|th)?\s+quarter\b/) || q.match(/\bquarter\s+([1-4])\b/);
  return m ? m[1] : null;
}
/** A single quarter's merged record for a student (or null if none). */
function quarterRecord(data: AIData, studentId: any, quarter: string): any | null {
  const recs = data.records.filter((r) => r.student_id === studentId && normQtr(r.quarter) === quarter);
  if (!recs.length) return null;
  return recs.reduce((acc: any, c: any) => {
    Object.keys(c).forEach((k) => { if (c[k] !== null && c[k] !== undefined && c[k] !== "") acc[k] = c[k]; });
    return acc;
  }, {});
}

// ── Facilitator logs (fetched via API; parallels formatFacilitatorLogsHTML) ──
export async function formatFacilitatorLogs(facilitators: any[]): Promise<string> {
  if (!facilitators || facilitators.length === 0) return "You haven't assigned any facilitators yet.";
  const logs = await Promise.all(
    facilitators.map((f) =>
      apiGet(`/api/facilitators/${f.id}/logs`)
        .then((r) => (r.logs && r.logs[0]) || null)
        .catch(() => null)
    )
  );
  const fmt = (ts: any) =>
    ts
      ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
      : null;
  let res = "<strong>Facilitators Logs:</strong><ul class='ai-list' style='list-style:none; padding-left:0;'>";
  facilitators.forEach((f, i) => {
    const log = logs[i];
    const timeIn = log && log.time_in ? fmt(log.time_in) : '<span style="color:#ef4444;">No record</span>';
    const stillActive = log && log.time_in && (!log.time_out || Date.now() - new Date(log.time_out).getTime() < 60000);
    const timeOut = stillActive
      ? '<span style="color:#10b981;">Currently Active</span>'
      : log && log.time_out
      ? fmt(log.time_out)
      : '<span style="color:#f59e0b;">Not signed out</span>';
    res += `<li style="margin-bottom:12px; background:rgba(0,0,0,0.03); padding:12px; border-radius:8px;">
      👤 <strong>${escapeHtml(f.full_name)}</strong> <span style="font-size:0.85rem; color:var(--text-muted);">(${escapeHtml(f.section || "Unassigned")})</span><br>
      <div style="font-size:0.85rem; margin-top:8px; display:flex; flex-direction:column; gap:5px;">
        <span><i class="fa-solid fa-arrow-right-to-bracket" style="color:#10b981; width:16px;"></i> Time In: <strong>${timeIn}</strong></span>
        <span><i class="fa-solid fa-arrow-right-from-bracket" style="color:#ef4444; width:16px;"></i> Time Out: <strong>${timeOut}</strong></span>
      </div>
    </li>`;
  });
  return res + "</ul>";
}

// ── Backend call ─────────────────────────────────────────────────────────────
export async function callAIEvaluate(question: string, context: string, signal?: AbortSignal): Promise<string> {
  try {
    const r = await apiPost("/api/ai-evaluate", { question, context }, { signal });
    if (r && r.reply) return formatAIText(r.reply);
    return escapeHtml((r && r.error) || "The server took too long. Please send your question again.");
  } catch (e: any) {
    const msg = String(e?.message || "");
    if (signal?.aborted || /abort/i.test(msg)) return ""; // cancelled by the user — caller ignores ""
    if (/429|rate|limit|quota/i.test(msg)) return "Please wait a moment and try again.";
    return "The server is waking up and took too long. Please send your question again.";
  }
}

// ── Context builder (faithful port of buildAIContext) ────────────────────────
export function buildAIContext(query: string, data: AIData): string {
  const { students, sections, records, attendance } = data;
  const isAssess = (k: string) => k.startsWith("module_") || k.startsWith("activity_") || k.startsWith("pt_") || k === "qe" || k === "at";
  const pretty = (k: string) => {
    if (k.startsWith("module_")) return "Module " + k.slice(7);
    if (k.startsWith("activity_")) return "Activity " + k.slice(9);
    if (k.startsWith("pt_")) return "Performance Task " + k.slice(3);
    if (k === "qe") return "Quarterly Exam";
    if (k === "at") return "Achievement Test";
    return k;
  };
  const isEmpty = (v: any) => v === null || v === undefined || v === "" || Number(v) === 0;

  const activeBySection: Record<string, Set<string>> = {};
  records.forEach((r) => {
    const sid = r.section_id;
    if (!activeBySection[sid]) activeBySection[sid] = new Set();
    Object.keys(r).forEach((k) => {
      if (isAssess(k) && Number(r[k]) > 0) activeBySection[sid].add(k);
    });
  });

  const analyze = (st: any) => {
    const merged = mergedRecord(data, st.id) || {};
    const sec = sections.find((x) => x.id === st.section_id) || {};
    // Use the shared grade engine so the breakdown matches the actual grade and
    // the rest of the app: Written Works = Modules + Activities, the Exam
    // component = Achievement Test + Quarterly Exam, and per-subject component
    // totals (e.g. WW out of 190) are applied.
    const comp = componentScores(merged, sec.subject);
    const ww = Math.round(comp.ww);
    const pt = Math.round(comp.pt);
    const exam = Math.round(comp.exam);
    const grade = finalGrade(merged, sec.subject);
    const passing = passingFor(sec.subject);
    const active = Array.from(activeBySection[st.section_id] || []);
    const missing = active.filter((k) => isEmpty(merged[k])).map(pretty);
    const att = attendance.filter((a) => (a.student_name || "").toLowerCase() === (st.full_name || "").toLowerCase());
    const abs = att.filter((a) => a.status === "Absent").length;
    const late = att.filter((a) => a.status === "Late").length;
    return { merged, active, ww, pt, exam, grade, passing, missing, abs, late };
  };

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todays = [
    pad(now.getDate()) + "/" + pad(now.getMonth() + 1) + "/" + now.getFullYear(),
    now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()),
    pad(now.getMonth() + 1) + "/" + pad(now.getDate()) + "/" + now.getFullYear(),
  ];
  const isToday = (d: any) => d && todays.indexOf(String(d).trim()) !== -1;
  const cleanNm = (v: any) => String(v == null ? "" : v).replace(/\s*,\s*/g, " ").trim();

  const nameExtracted = (String(query).split(/ni |of |si |kay |for |para /)[1] || "").replace("?", "").trim();
  const s = nameExtracted ? students.find((st) => (st.full_name || "").toLowerCase().includes(nameExtracted)) : null;

  if (s) {
    const a = analyze(s);
    const sec = sections.find((x) => x.id === s.section_id) || {};
    const scoreLines = a.active.map((k) => {
      const v = a.merged[k];
      return pretty(k) + ": " + (v === null || v === undefined || v === "" ? "none" : v);
    });
    const tAtt = attendance.filter((x) => (x.student_name || "").toLowerCase() === (s.full_name || "").toLowerCase() && isToday(x.date));
    const todayStatus = tAtt.length ? tAtt[0].status : "no record for today";
    return `STUDENT: ${cleanNm(s.full_name)}\nSection: ${sec.title || "N/A"} | Subject: ${sec.subject || "N/A"}\nFinal grade: ${a.grade}% (${a.grade >= a.passing ? "PASSING" : "FAILING"}; passing is ${a.passing}%)\nWritten Work total: ${a.ww}% | Performance Tasks total: ${a.pt}% | Exam (Achievement Test + Quarterly Exam): ${a.exam}%\nScores per assigned assessment: ${scoreLines.join("; ") || "none recorded"}\nMissing/zero items (count ${a.missing.length}): ${a.missing.length ? a.missing.join(", ") : "none"}\nAttendance: ${a.abs} absences, ${a.late} lates | Today: ${todayStatus}`;
  }

  const todayAbsent: string[] = [];
  const todayLate: string[] = [];
  attendance.forEach((x) => {
    if (isToday(x.date)) {
      if (x.status === "Absent") todayAbsent.push(cleanNm(x.student_name));
      else if (x.status === "Late") todayLate.push(cleanNm(x.student_name));
    }
  });

  const lines = students
    .map((st) => ({ st, a: analyze(st), sec: sections.find((x) => x.id === st.section_id) || {} }))
    .sort((x, y) => y.a.grade - x.a.grade)
    .map(({ st, a, sec }) => {
      const missStr = a.missing.length ? (a.missing.length > 8 ? a.missing.slice(0, 8).join("/") + " +" + (a.missing.length - 8) : a.missing.join("/")) : "none";
      return `${cleanNm(st.full_name)} (${sec.title || "N/A"}): Final ${a.grade}% [${a.grade >= a.passing ? "PASS" : "FAIL"}] | Missing(${a.missing.length}): ${missStr} | TotalAbsences-allDates ${a.abs}, TotalLates ${a.late}`;
    });

  const q = (query || "").toLowerCase();
  let extra = "";

  if (/at.?risk|risk.*fail|posible.*fail/.test(q)) {
    const atRisk = students.filter((st) => {
      const a = analyze(st);
      return a.grade < a.passing && a.abs >= 3;
    });
    extra += `\n\nAT-RISK STUDENTS (grade below the subject's passing grade AND 3+ absences, count=${atRisk.length}):\n` +
      (atRisk.map((st) => { const a = analyze(st); const sec = sections.find((x) => x.id === st.section_id) || {}; return `- ${cleanNm(st.full_name)} (${sec.title || "N/A"}): grade=${a.grade}%, absences=${a.abs}, missing=${a.missing.length} items`; }).join("\n") || "None found.");
  }
  if (/compare|section.*comparison|comparison.*section/.test(q)) {
    const rows = sections
      .map((sec) => {
        const ss = students.filter((st) => st.section_id === sec.id);
        if (!ss.length) return null;
        const ana = ss.map((st) => analyze(st));
        const grades = ana.map((a) => a.grade);
        const avg = Math.round(grades.reduce((a, b) => a + b, 0) / grades.length);
        const passing = ana.filter((a) => a.grade >= a.passing).length;
        const failing = ana.filter((a) => a.grade < a.passing).length;
        const top = ss.map((st) => ({ name: cleanNm(st.full_name), grade: analyze(st).grade })).sort((a, b) => b.grade - a.grade)[0];
        return `- ${sec.title || "N/A"} (${sec.subject || "N/A"}): avg=${avg}%, passing=${passing}, failing=${failing}, total=${ss.length}, top student=${top ? top.name + " " + top.grade + "%" : "N/A"}`;
      })
      .filter(Boolean);
    extra += `\n\nSECTION COMPARISON:\n${rows.join("\n") || "No sections yet."}`;
  }
  if (/pattern|trend|always.*absent|day.*absent/.test(q)) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const absByDay: Record<string, number> = {};
    attendance.filter((a) => a.status === "Absent").forEach((a) => {
      const d = new Date(a.date);
      if (!isNaN(d.getTime())) {
        const day = dayNames[d.getDay()];
        absByDay[day] = (absByDay[day] || 0) + 1;
      }
    });
    const dayPattern = Object.entries(absByDay).sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d}: ${c} absences`).join(", ");
    const topAbsent = students
      .map((st) => { const a = analyze(st); return { name: cleanNm(st.full_name), abs: a.abs }; })
      .filter((x) => x.abs > 0)
      .sort((a, b) => b.abs - a.abs)
      .slice(0, 10)
      .map((x) => `${x.name} (${x.abs} absences)`);
    extra += `\n\nATTENDANCE PATTERNS:\nAbsences by day of week: ${dayPattern || "no data"}\nMost absent students: ${topAbsent.join("; ") || "none"}`;
  }
  if (/weekly|summary report|generate.*report|weekly summary/.test(q)) {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentAtt = attendance.filter((a) => { const d = new Date(a.date); return !isNaN(d.getTime()) && d >= sevenDaysAgo; });
    const weeklyAbsent = recentAtt.filter((a) => a.status === "Absent").length;
    const weeklyLate = recentAtt.filter((a) => a.status === "Late").length;
    const failingCount = students.filter((st) => analyze(st).grade < analyze(st).passing).length;
    const passingCount = students.filter((st) => analyze(st).grade >= analyze(st).passing).length;
    const avgGrade = students.length ? Math.round(students.reduce((sum, st) => sum + analyze(st).grade, 0) / students.length) : 0;
    extra += `\n\nWEEKLY SUMMARY (last 7 days):\nAttendance: ${weeklyAbsent} absence records, ${weeklyLate} late records\nGrades: ${passingCount} passing, ${failingCount} failing, class average=${avgGrade}%\nTotal students: ${students.length} across ${sections.length} section(s)`;
  }
  if (/honor.?roll|honor list|grade.*90|above.*90/.test(q)) {
    const honorRoll = students
      .map((st) => ({ st, a: analyze(st), sec: sections.find((x) => x.id === st.section_id) || {} }))
      .filter(({ a }) => a.grade >= 90)
      .sort((a, b) => b.a.grade - a.a.grade);
    extra += `\n\nHONOR ROLL (grade 90%+, count=${honorRoll.length}):\n` +
      (honorRoll.map(({ st, a, sec }) => `- ${cleanNm(st.full_name)} (${sec.title || "N/A"}): ${a.grade}%`).join("\n") || "No students with 90%+ yet.");
  }
  if (/perfect.*attendance|perfect attendance|wala.*absent|zero.*absent/.test(q)) {
    const perfect = students.filter((st) => { const a = analyze(st); return a.abs === 0 && a.late === 0; });
    const nearPerfect = students.filter((st) => { const a = analyze(st); return a.abs === 0 && a.late > 0; });
    extra += `\n\nPERFECT ATTENDANCE (0 absences, 0 lates, count=${perfect.length}):\n` +
      (perfect.map((st) => { const sec = sections.find((x) => x.id === st.section_id) || {}; return `- ${cleanNm(st.full_name)} (${sec.title || "N/A"})`; }).join("\n") || "None found.");
    if (nearPerfect.length) {
      extra += `\n\nNEAR-PERFECT (0 absences but has lates, count=${nearPerfect.length}):\n` +
        nearPerfect.map((st) => { const a = analyze(st); const sec = sections.find((x) => x.id === st.section_id) || {}; return `- ${cleanNm(st.full_name)} (${sec.title || "N/A"}): ${a.late} late(s)`; }).join("\n");
    }
  }
  if (/monthly|month.*attendance|attendance.*month|monthly.*summary|month.*summary/.test(q)) {
    const monthMap: Record<string, { name: string; absent: number; late: number; present: number }> = {};
    attendance.forEach((a) => {
      if (!a.date) return;
      const d = new Date(a.date);
      if (isNaN(d.getTime())) return;
      const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      const monthName = d.toLocaleString("en-US", { month: "long", year: "numeric" });
      if (!monthMap[key]) monthMap[key] = { name: monthName, absent: 0, late: 0, present: 0 };
      if (a.status === "Absent") monthMap[key].absent++;
      else if (a.status === "Late") monthMap[key].late++;
      else monthMap[key].present++;
    });
    const monthSummary = Object.entries(monthMap).sort((a, b) => a[0].localeCompare(b[0])).map(([, m]) => `- ${m.name}: ${m.absent} absences, ${m.late} lates, ${m.present} present`);
    extra += `\n\nMONTHLY ATTENDANCE SUMMARY (${monthSummary.length} month(s)):\n` + (monthSummary.join("\n") || "No attendance records yet.");
  }
  if (/most.*improv|improv.*most|nag.?improv|progress.*student/.test(q)) {
    const improved = students
      .map((st) => {
        const merged = mergedRecord(data, st.id) || {};
        const moduleKeys = Object.keys(merged).filter((k) => k.startsWith("module_")).sort((a, b) => (parseInt(a.replace("module_", "")) || 0) - (parseInt(b.replace("module_", "")) || 0));
        if (moduleKeys.length < 2) return null;
        const half = Math.ceil(moduleKeys.length / 2);
        const earlyAvg = moduleKeys.slice(0, half).reduce((s, k) => s + (Number(merged[k]) || 0), 0) / half;
        const recentAvg = moduleKeys.slice(half).reduce((s, k) => s + (Number(merged[k]) || 0), 0) / (moduleKeys.length - half);
        const sec = sections.find((x) => x.id === st.section_id) || {};
        return { name: cleanNm(st.full_name), section: sec.title || "N/A", early: Math.round(earlyAvg), recent: Math.round(recentAvg), diff: Math.round(recentAvg - earlyAvg), grade: analyze(st).grade };
      })
      .filter((x) => x && x.diff > 0)
      .sort((a: any, b: any) => b.diff - a.diff)
      .slice(0, 10) as any[];
    extra += `\n\nMOST IMPROVED STUDENTS (early vs recent module scores, count=${improved.length}):\n` +
      (improved.map((x) => `- ${x.name} (${x.section}): early avg=${x.early}pts → recent avg=${x.recent}pts (+${x.diff}pts) | final grade=${x.grade}%`).join("\n") || "Not enough module data to determine improvement yet.");
  }
  if (/predict|prediction|final grade.*all|all.*final grade/.test(q)) {
    const predictions = students.map((st) => {
      const a = analyze(st);
      const sec = sections.find((x) => x.id === st.section_id) || {};
      const potential = Math.min(100, a.grade + a.missing.length * 3);
      return `- ${cleanNm(st.full_name)} (${sec.title || "N/A"}): current=${a.grade}% [${a.grade >= a.passing ? "PASS" : "FAIL"}], potential if missing submitted=~${potential}% [${potential >= a.passing ? "PASS" : "FAIL"}], missing=${a.missing.length} items`;
    });
    extra += `\n\nGRADE PREDICTIONS (current vs potential if all missing items submitted):\n${predictions.join("\n") || "No data."}`;
  }

  const passingSet = [...new Set(sections.map((sec) => passingFor(sec.subject)))].sort((a, b) => a - b);
  const passingNote =
    passingSet.length <= 1
      ? `passing grade ${passingSet[0] || 75}%`
      : `passing grade varies by subject (${passingSet.join("%, ")}%) — use each student's own [PASS]/[FAIL] tag`;
  return `CLASS DATA (${passingNote}; component weights are set per subject in the Grading System). ${sections.length} section(s), ${students.length} student(s).\nToday's date: ${todays[0]}.\nABSENT TODAY (count=${todayAbsent.length}): ${todayAbsent.length ? todayAbsent.join("; ") : "none"}.\nLATE TODAY (count=${todayLate.length}): ${todayLate.length ? todayLate.join("; ") : "none"}.\nIMPORTANT: For "who is absent today" / "how many absent today", use ONLY the ABSENT TODAY list above (each name is one student, separated by ';'). Do NOT use the per-student TotalAbsences-allDates numbers below for "today".\nPer-student, already RANKED from highest to lowest final grade (use this order for top/failing/ranking; these absence/late totals are across ALL dates, not today):\n${lines.join("\n") || "No students yet."}${extra}`;
}

// ── Deterministic query router (port of processSmartDBQuery) ─────────────────
export async function processSmartDBQuery(
  rawQuery: string,
  data: AIData,
  opts?: { history?: string; signal?: AbortSignal }
): Promise<string> {
  const query = rawQuery.toLowerCase();
  const st = smallTalk(query);
  if (st) return st;

  const { students, sections, schedules, facilitators, attendance } = data;
  if (sections.length === 0) return "It appears you haven't set up any active sections yet.";

  // Open-ended questions go to the model, with recent conversation prepended so
  // follow-ups ("what should I do about them?") have context.
  const evalContext = () => {
    const ctx = buildAIContext(query, data);
    return opts?.history ? `RECENT CONVERSATION (for follow-up context):\n${opts.history}\n\n${ctx}` : ctx;
  };
  if (isEvaluationIntent(query)) return callAIEvaluate(rawQuery, evalContext(), opts?.signal);

  // ── Scope: a section ("HUMSS 1") and/or a quarter/term ("Q2", "Prelim") ─────
  const scopeSection = resolveSection(rawQuery, sections);
  const scopeQuarter = resolveQuarter(rawQuery);
  const scoped = scopeSection ? students.filter((s) => String(s.section_id) === String(scopeSection.id)) : students;
  const recFor = (s: any) => (scopeQuarter ? quarterRecord(data, s.id, scopeQuarter) : mergedRecord(data, s.id));
  const gradeFor = (s: any) => finalGrade(recFor(s) || {}, subjectOf(data, s.section_id));
  const passFor = (s: any) => passingFor(subjectOf(data, s.section_id));
  const secTitle = (s: any) => (sections.find((x) => x.id === s.section_id) || {}).title || "";
  const absOf = (s: any) => attendance.filter((a) => (a.student_name || "").toLowerCase() === (s.full_name || "").toLowerCase() && a.status === "Absent").length;
  const qLabel = (qd: string) => (scopeSection && scopeSection.school_level === "College" ? ({ "1": "Prelim", "2": "Midterm", "3": "Final" } as Record<string, string>)[qd] : "") || "Q" + qd;
  const scopeBits: string[] = [];
  if (scopeSection) scopeBits.push(scopeSection.title);
  if (scopeQuarter) scopeBits.push(qLabel(scopeQuarter));
  const inScope = scopeBits.length ? " in " + scopeBits.join(" · ") : "";
  const label = scopeBits.length ? ` <span style="font-size:0.8rem; color:var(--text-muted);">(${escapeHtml(scopeBits.join(" · "))})</span>` : "";
  const noStudents = scopeSection ? `No students found in <strong>${escapeHtml(scopeSection.title)}</strong>.` : "You don't have any students registered yet.";

  if (query.includes("top") || query.includes("highest") || query.includes("best")) {
    if (!scoped.length) return noStudents;
    const scored = scoped
      .map((s) => ({ name: s.full_name, grade: gradeFor(s), section: secTitle(s) }))
      .filter((x) => x.grade > 0)
      .sort((a, b) => b.grade - a.grade)
      .slice(0, 5);
    if (!scored.length) return `No grades recorded yet${inScope}.`;
    let res = `<strong>🌟 Top performers${label}:</strong><br><br>`;
    scored.forEach((s, i) => (res += `<strong>#${i + 1} ${escapeHtml(s.name)}</strong> - ${s.grade}% <span style="font-size:0.8rem; color:var(--text-muted);">(${escapeHtml(s.section || "")})</span><br>`));
    return res;
  }
  if (query.includes("fail") || query.includes("bagsak") || query.includes("below")) {
    const failing: any[] = [];
    scoped.forEach((s) => { const grade = gradeFor(s); if (grade > 0 && grade < passFor(s)) failing.push({ name: s.full_name, grade, section: secTitle(s) }); });
    if (failing.length === 0) return `Excellent news! No students are currently failing${inScope}.`;
    failing.sort((a, b) => a.grade - b.grade);
    let res = `<strong>📉 Students below the passing grade${label}:</strong><br><br>`;
    failing.forEach((f) => (res += `- <strong>${escapeHtml(f.name)}</strong> (${f.grade}%) <span style="font-size:0.8rem; color:var(--text-muted);">(${escapeHtml(f.section)})</span><br>`));
    return res;
  }
  if (/needs? help|need .*help|struggl|kinahanglan.*bulig|nabudlay/.test(query)) {
    const rows = scoped
      .map((s) => { const grade = gradeFor(s); const abs = absOf(s); return { name: s.full_name, section: secTitle(s), grade, abs, flag: (grade > 0 && grade < passFor(s)) || abs >= 3 }; })
      .filter((r) => r.flag)
      .sort((a, b) => a.grade - b.grade);
    if (!rows.length) return `No students are flagged as needing help${inScope} right now. 🎉`;
    let res = `<strong>🆘 Students who may need help${label} (low grade or 3+ absences):</strong><br><br>`;
    rows.forEach((r) => (res += `- <strong>${escapeHtml(r.name)}</strong> — ${r.grade > 0 ? r.grade + "%" : "no grade"}, ${r.abs} absence${r.abs === 1 ? "" : "s"} <span style="font-size:0.8rem; color:var(--text-muted);">(${escapeHtml(r.section)})</span><br>`));
    return res;
  }
  if (/(wala|walang|hasn'?t|has not|haven'?t|no record|indi pa|hindi pa|not yet|missing).{0,24}(quarterly exam|exam|\bqe\b|achievement test|achievement)|(quarterly exam|\bqe\b|achievement test|achievement).{0,24}(wala|walang|missing|no record|indi pa|hindi pa|not yet)/.test(query)) {
    const wantAT = /achievement/.test(query);
    const field = wantAT ? "at" : "qe";
    const fLabel = wantAT ? "Achievement Test" : "Quarterly Exam";
    const missing = scoped
      .map((s) => ({ s, r: recFor(s) }))
      .filter(({ r }) => r && (r[field] == null || r[field] === "" || Number(r[field]) === 0))
      .map(({ s }) => ({ name: s.full_name, section: secTitle(s) }));
    if (!missing.length) return `Everyone${inScope} already has a ${fLabel} score recorded. ✅`;
    let res = `<strong>📝 No ${fLabel} score yet${label} (${missing.length}):</strong><br><br>`;
    missing.forEach((m) => (res += `- <strong>${escapeHtml(m.name)}</strong> <span style="font-size:0.8rem; color:var(--text-muted);">(${escapeHtml(m.section)})</span><br>`));
    return res;
  }
  if (query.includes("who passed") || query.includes("who is passing") || query.includes("passing student") || query.includes("passing list") || query.includes("mga pasado") || query.includes("mga nakapasa")) {
    const list: any[] = [];
    scoped.forEach((s) => { const grade = gradeFor(s); if (grade > 0 && grade >= passFor(s)) list.push({ name: s.full_name, grade, section: secTitle(s) || "Unknown" }); });
    if (list.length === 0) return `No students have reached the passing grade yet${inScope}.`;
    list.sort((a, b) => b.grade - a.grade);
    let res = `<strong>Passing students${label} (${list.length}):</strong><br><br>`;
    list.forEach((f) => (res += `- <strong>${escapeHtml(f.name)}</strong> <span style="font-size:0.8rem; color:var(--text-muted);">(${escapeHtml(f.section)})</span> — ${f.grade}%<br>`));
    return res;
  }
  if ((query.includes("wala") && (query.includes("pasa") || query.includes("module") || query.includes("activity"))) || query.includes("missing") || query.includes("kulang")) {
    // "Active" assessment = one at least one student in the section has scored,
    // so an item that was never given is never flagged. A student is missing an
    // item when it's blank or zero. Dedupe by student (not per quarter record —
    // the old check only looked at modules 1-5 and listed a student per record).
    const isAssess = (k: string) => k.startsWith("module_") || k.startsWith("activity_") || k.startsWith("pt_") || k === "qe" || k === "at";
    const activeBySection: Record<string, Set<string>> = {};
    data.records.forEach((r) => {
      if (!activeBySection[r.section_id]) activeBySection[r.section_id] = new Set();
      Object.keys(r).forEach((k) => { if (isAssess(k) && Number(r[k]) > 0) activeBySection[r.section_id].add(k); });
    });
    const missingList: { name: string; count: number; section: string }[] = [];
    scoped.forEach((s) => {
      const merged = recFor(s);
      if (!merged) return;
      const active = Array.from(activeBySection[s.section_id] || []);
      const missCount = active.filter((k) => merged[k] == null || merged[k] === "" || Number(merged[k]) === 0).length;
      if (missCount > 0) missingList.push({ name: s.full_name || "No Name", count: missCount, section: secTitle(s) });
    });
    if (missingList.length === 0) return `All students have submitted their recorded requirements${inScope}.`;
    missingList.sort((a, b) => b.count - a.count);
    let res = `<strong>Students with missing requirements${label}:</strong><br><br>`;
    missingList.forEach((m) => (res += `- <strong>${escapeHtml(m.name)}</strong> <span style="font-size:0.8rem; color:var(--text-muted);">(${escapeHtml(m.section)})</span> — ${m.count} missing<br>`));
    return res;
  }
  if (query.includes("score ni") || query.includes("grade of") || query.includes("grade ni") || query.includes("pasado ba si") || query.includes("nakapasa bala si") || query.includes("score of")) {
    const name = query.split(/ni |of |si /)[1]?.replace("?", "").trim();
    if (!name) return "Please specify the student's name. Example: <em>'What is the grade of Mark?'</em>";
    const stud = students.find((s) => (s.full_name || "").toLowerCase().includes(name));
    if (!stud) return `I could not find a student named "<strong>${escapeHtml(name)}</strong>" in your class lists.`;
    const rec = recFor(stud);
    if (!rec) return `There are no grade records entered for <strong>${escapeHtml(stud.full_name)}</strong>${scopeQuarter ? " for " + escapeHtml(qLabel(scopeQuarter)) : ""} yet.`;
    const grade = finalGrade(rec, subjectOf(data, stud.section_id));
    const status = grade >= passingFor(subjectOf(data, stud.section_id)) ? "<span style='color:#10b981;'>Passing</span>" : "<span style='color:#ef4444;'>Failing</span>";
    return `The current grade for <strong>${escapeHtml(stud.full_name)}</strong>${scopeQuarter ? " (" + escapeHtml(qLabel(scopeQuarter)) + ")" : ""} is <strong>${grade}%</strong>. They are currently ${status}.`;
  }
  if (/attendance rate|attendance %|percent.*attend|attend.*percent|rate.*attend/.test(query)) {
    const rows = scopeSection ? attendance.filter((a) => (a.section || "") === scopeSection.title) : attendance;
    if (!rows.length) return `No attendance records found${inScope}.`;
    let present = 0, late = 0;
    rows.forEach((a) => { if (a.status === "Present") present++; else if (a.status === "Late") late++; });
    const total = rows.length;
    const rate = total ? Math.round(((present + 0.5 * late) / total) * 100) : 0;
    return `<strong>📊 Attendance rate${label}: ${rate}%</strong><br><small>${present} present, ${late} late, ${total - present - late} absent across ${total} record(s). (Late counts as half.)</small>`;
  }
  if (query.includes("absent") || query.includes("attendance")) {
    const rows = scopeSection ? attendance.filter((a) => (a.section || "") === scopeSection.title) : attendance;
    if (rows.length === 0) return `I couldn't find any attendance records${inScope}.`;
    const absent: Record<string, number> = {};
    rows.forEach((a) => { if (a.status === "Absent") absent[a.student_name] = (absent[a.student_name] || 0) + 1; });
    const sorted = Object.keys(absent).sort((a, b) => absent[b] - absent[a]);
    if (sorted.length === 0) return `Perfect attendance${inScope}! No absences recorded.`;
    let res = `<strong>📅 Most absences${label}:</strong><br><br>`;
    sorted.slice(0, 5).forEach((name) => (res += `- <strong>${escapeHtml(name)}</strong> <span style="color:#ef4444;">(${absent[name]} absences)</span><br>`));
    return res;
  }
  if (query.includes("schedule") || query.includes("klase") || query.includes("class sched")) {
    if (schedules.length === 0) return "You do not have any schedules recorded. Would you like to add one via the Dashboard?";
    let res = "<strong>Here is your current class schedule:</strong><br><br>";
    schedules.forEach((s) => (res += `📅 <strong>${escapeHtml(s.subject)}</strong><br><small>${escapeHtml(s.time)} | ${escapeHtml(s.details)}</small><br><br>`));
    return res;
  }
  if (query.includes("facilitator") || query.includes("faci")) {
    return formatFacilitatorLogs(facilitators);
  }
  if (query.includes("pila ka student") || query.includes("how many student") || query.includes("population") || query.includes("pila ka estudyante")) {
    if (scopeSection) return `<strong>${escapeHtml(scopeSection.title)}</strong> has <strong>${scoped.length} student${scoped.length === 1 ? "" : "s"}</strong>.`;
    return `You currently handle a total of <strong>${students.length} students</strong> distributed across <strong>${sections.length} active sections</strong>.`;
  }
  if (query.includes("id number") || query.includes("id ni") || query.includes("id of")) {
    const name = query.split(/ni |of /)[1]?.replace("?", "").trim();
    if (!name) return "Please specify the student. Example: <em>'What is the ID number of Kevin?'</em>";
    const stud = students.find((s) => (s.full_name || "").toLowerCase().includes(name));
    if (!stud) return `I couldn't locate "<strong>${escapeHtml(name)}</strong>" in the database.`;
    return `The ID number for <strong>${escapeHtml(stud.full_name)}</strong> is: <strong>${escapeHtml(stud.id_no || stud.id)}</strong>.`;
  }
  if (query.includes("summary") || query.includes("overview") || query.includes("performance") || query.includes("kamusta") || query.includes("pass rate") || query.includes("passing rate")) {
    const pop = scoped;
    let pass = 0, graded = 0;
    pop.forEach((s) => { const g = gradeFor(s); if (g > 0) { graded++; if (g >= passFor(s)) pass++; } });
    const rate = graded > 0 ? Math.round((pass / graded) * 100) : 0;
    if (scopeSection) {
      return `<strong>📊 ${escapeHtml(scopeSection.title)}${scopeQuarter ? " · " + escapeHtml(qLabel(scopeQuarter)) : ""}:</strong><br><br>• Students: <strong>${pop.length}</strong><br>• Graded: <strong>${graded}</strong><br>• Passing rate: <strong>${rate}%</strong> (${pass}/${graded})`;
    }
    return (
      `<strong>📊 Here's a quick snapshot of your class:</strong><br><br>` +
      `• Total Active Sections: <strong>${sections.length}</strong><br>` +
      `• Total Handled Students: <strong>${pop.length}</strong><br>` +
      `• Overall Passing Rate: <strong>${rate}%</strong> (${pass}/${graded} graded)<br><br>` +
      `<em>Tip: Try "top in ${escapeHtml(sections[0]?.title || "your section")}", "who needs help", or "attendance rate".</em>`
    );
  }
  return callAIEvaluate(rawQuery, evalContext(), opts?.signal);
}

// ── Data loader — aggregate all of the teacher's data via the API ────────────
export async function loadAIData(): Promise<AIData> {
  const [secResp, subjResp, schedResp, faciResp] = await Promise.all([
    apiGet("/api/sections").catch(() => ({ sections: [] })),
    apiGet("/api/subjects").catch(() => ({ subjects: [] })),
    apiGet("/api/schedules").catch(() => ({ schedules: [] })),
    apiGet("/api/facilitators").catch(() => ({ facilitators: [] })),
  ]);
  const sections = secResp.sections || [];
  setSubjectConfigs(subjResp.subjects || []);

  const students: any[] = [];
  const records: any[] = [];
  const attendance: any[] = [];
  await Promise.all(
    sections.map(async (s: any) => {
      const [stu, rec, att] = await Promise.all([
        apiGet(`/api/sections/${s.id}/students`).catch(() => ({ students: [] })),
        apiGet(`/api/sections/${s.id}/class-records`).catch(() => ({ records: [] })),
        apiGet(`/api/sections/${s.id}/attendance`).catch(() => ({ attendance: [] })),
      ]);
      (stu.students || []).forEach((x: any) => students.push({ ...x, section_id: x.section_id || s.id }));
      (rec.records || []).forEach((x: any) => records.push(x));
      (att.attendance || []).forEach((x: any) => attendance.push(x));
    })
  );

  return { sections, students, records, attendance, schedules: schedResp.schedules || [], facilitators: faciResp.facilitators || [] };
}
