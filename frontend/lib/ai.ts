// ── ai.ts — AcadTrack AI assistant logic (port of ai-assistant.js + the pages'
// processSmartDBQuery) ───────────────────────────────────────────────────────
// Deterministic look-ups (top / failing / who passed / a named student / absent
// today / schedule / facilitators / counts / summary) are answered locally so
// the numbers always match the dashboard & class record. Open-ended / advisory
// questions are sent to the backend /api/ai-evaluate with a compiled class-data
// context. Grades use the shared grading.ts logic.
import { apiGet, apiPost } from "@/lib/api";
import { finalGrade, passingFor, setSubjectConfigs } from "@/lib/grading";

export type AIData = {
  sections: any[];
  students: any[];
  records: any[];
  attendance: any[];
  schedules: any[];
  facilitators: any[];
};

// ── Text helpers ─────────────────────────────────────────────────────────────
const escapeHtml = (s: any) =>
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
const gradeOf = (data: AIData, student: any) =>
  finalGrade(mergedRecord(data, student.id) || {}, subjectOf(data, student.section_id), 100);
const passingOf = (data: AIData, student: any) => passingFor(subjectOf(data, student.section_id));

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
export async function callAIEvaluate(question: string, context: string): Promise<string> {
  try {
    const r = await apiPost("/api/ai-evaluate", { question, context });
    if (r && r.reply) return formatAIText(r.reply);
    return escapeHtml((r && r.error) || "The server took too long. Please send your question again.");
  } catch (e: any) {
    const msg = String(e?.message || "");
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
    if (k === "qe") return "Exam";
    if (k === "at") return "AT";
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
    let totalWW = 0;
    let totalPT = 0;
    const totalQE = Number(merged.qe) || 0;
    for (const k in merged) {
      if (k.startsWith("module_") || k.startsWith("activity_") || k === "at") totalWW += Number(merged[k]) || 0;
      if (k.startsWith("pt_")) totalPT += Number(merged[k]) || 0;
    }
    const ww = Math.round(Math.min(totalWW, 100));
    const pt = Math.round(Math.min(totalPT, 100));
    const qe = Math.round(Math.min((totalQE / 50) * 100, 100));
    const sec = sections.find((x) => x.id === st.section_id) || {};
    const grade = finalGrade(merged, sec.subject, 100);
    const passing = passingFor(sec.subject);
    const active = Array.from(activeBySection[st.section_id] || []);
    const missing = active.filter((k) => isEmpty(merged[k])).map(pretty);
    const att = attendance.filter((a) => (a.student_name || "").toLowerCase() === (st.full_name || "").toLowerCase());
    const abs = att.filter((a) => a.status === "Absent").length;
    const late = att.filter((a) => a.status === "Late").length;
    return { merged, active, ww, pt, qe, grade, passing, missing, abs, late };
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
    return `STUDENT: ${cleanNm(s.full_name)}\nSection: ${sec.title || "N/A"} | Subject: ${sec.subject || "N/A"}\nFinal grade: ${a.grade}% (${a.grade >= a.passing ? "PASSING" : "FAILING"}; passing is ${a.passing}%)\nWritten Work total: ${a.ww}% | Performance Tasks total: ${a.pt}% | Exam: ${a.qe}%\nScores per assigned assessment: ${scoreLines.join("; ") || "none recorded"}\nMissing/zero items (count ${a.missing.length}): ${a.missing.length ? a.missing.join(", ") : "none"}\nAttendance: ${a.abs} absences, ${a.late} lates | Today: ${todayStatus}`;
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
export async function processSmartDBQuery(rawQuery: string, data: AIData): Promise<string> {
  const query = rawQuery.toLowerCase();
  const st = smallTalk(query);
  if (st) return st;

  const { students, sections, schedules, facilitators, attendance } = data;
  if (sections.length === 0) return "It appears you haven't set up any active sections yet.";

  if (isEvaluationIntent(query)) return callAIEvaluate(rawQuery, buildAIContext(query, data));

  if (query.includes("top") || query.includes("highest") || query.includes("best")) {
    if (students.length === 0) return "You don't have any students registered yet.";
    const scored = students
      .map((s) => ({ name: s.full_name, grade: gradeOf(data, s), section: (sections.find((x) => x.id === s.section_id) || {}).title }))
      .sort((a, b) => b.grade - a.grade)
      .slice(0, 5);
    let res = "<strong>🌟 Here are your top performers:</strong><br><br>";
    scored.forEach((s, i) => (res += `<strong>#${i + 1} ${escapeHtml(s.name)}</strong> - ${s.grade}% <span style="font-size:0.8rem; color:var(--text-muted);">(${escapeHtml(s.section || "")})</span><br>`));
    return res;
  }
  if (query.includes("fail") || query.includes("bagsak") || query.includes("below")) {
    const failing: any[] = [];
    students.forEach((s) => {
      const grade = gradeOf(data, s);
      if (grade > 0 && grade < passingOf(data, s)) failing.push({ name: s.full_name, grade });
    });
    if (failing.length === 0) return "Excellent news! None of your students are currently failing.";
    failing.sort((a, b) => a.grade - b.grade);
    let res = "<strong>📉 These students are currently below the passing grade:</strong><br><br>";
    failing.forEach((f) => (res += `- <strong>${escapeHtml(f.name)}</strong> (${f.grade}%)<br>`));
    return res;
  }
  if (query.includes("who passed") || query.includes("who is passing") || query.includes("passing student") || query.includes("passing list") || query.includes("mga pasado") || query.includes("mga nakapasa")) {
    const list: any[] = [];
    students.forEach((s) => {
      const grade = gradeOf(data, s);
      if (grade >= passingOf(data, s)) list.push({ name: s.full_name, grade, section: (sections.find((x) => x.id === s.section_id) || {}).title || "Unknown" });
    });
    if (list.length === 0) return "No students have reached the passing grade yet.";
    list.sort((a, b) => b.grade - a.grade);
    let res = `<strong>Passing students (${list.length}):</strong><br><br>`;
    list.forEach((f) => (res += `- <strong>${escapeHtml(f.name)}</strong> <span style="font-size:0.8rem; color:var(--text-muted);">(${escapeHtml(f.section)})</span> — ${f.grade}%<br>`));
    return res;
  }
  if ((query.includes("wala") && (query.includes("pasa") || query.includes("module") || query.includes("activity"))) || query.includes("missing")) {
    const missingStudents: string[] = [];
    data.records.forEach((r) => {
      let hasMissing = false;
      for (let i = 1; i <= 5; i++) if (r[`module_${i}`] == null || r[`module_${i}`] === "") hasMissing = true;
      if (hasMissing) {
        const stud = students.find((s) => s.id === r.student_id);
        if (stud) missingStudents.push(stud.full_name);
      }
    });
    if (missingStudents.length === 0) return "All students have submitted their recorded modules and activities.";
    return "<strong>The following students have missing requirements:</strong><br><br>- " + missingStudents.join("<br>- ");
  }
  if (query.includes("score ni") || query.includes("grade of") || query.includes("grade ni") || query.includes("pasado ba si") || query.includes("nakapasa bala si") || query.includes("score of")) {
    const name = query.split(/ni |of |si /)[1]?.replace("?", "").trim();
    if (!name) return "Please specify the student's name. Example: <em>'What is the grade of Mark?'</em>";
    const stud = students.find((s) => s.full_name.toLowerCase().includes(name));
    if (!stud) return `I could not find a student named "<strong>${escapeHtml(name)}</strong>" in your class lists.`;
    if (!mergedRecord(data, stud.id)) return `There are no grade records entered for <strong>${escapeHtml(stud.full_name)}</strong> yet.`;
    const grade = gradeOf(data, stud);
    const status = grade >= passingOf(data, stud) ? "<span style='color:#10b981;'>Passing</span>" : "<span style='color:#ef4444;'>Failing</span>";
    return `The current calculated grade for <strong>${escapeHtml(stud.full_name)}</strong> is <strong>${grade}%</strong>. They are currently ${status}.`;
  }
  if (query.includes("absent") || query.includes("attendance")) {
    if (attendance.length === 0) return "I couldn't find any attendance records in your lists.";
    const absent: Record<string, number> = {};
    attendance.forEach((a) => { if (a.status === "Absent") absent[a.student_name] = (absent[a.student_name] || 0) + 1; });
    const sorted = Object.keys(absent).sort((a, b) => absent[b] - absent[a]);
    if (sorted.length === 0) return "You have perfect attendance across all classes! No absences recorded.";
    let res = "<strong>📅 Here are the students with the most absences:</strong><br><br>";
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
  if (query.includes("pila ka student") || query.includes("how many students") || query.includes("population")) {
    return `You currently handle a total of <strong>${students.length} students</strong> distributed across <strong>${sections.length} active sections</strong>.`;
  }
  if (query.includes("id number") || query.includes("id ni") || query.includes("id of")) {
    const name = query.split(/ni |of /)[1]?.replace("?", "").trim();
    if (!name) return "Please specify the student. Example: <em>'What is the ID number of Kevin?'</em>";
    const stud = students.find((s) => s.full_name.toLowerCase().includes(name));
    if (!stud) return `I couldn't locate "<strong>${escapeHtml(name)}</strong>" in the database.`;
    return `The ID number for <strong>${escapeHtml(stud.full_name)}</strong> is: <strong>${stud.id}</strong>.`;
  }
  if (query.includes("summary") || query.includes("overview") || query.includes("performance") || query.includes("kamusta")) {
    const total = students.length;
    let pass = 0;
    students.forEach((s) => { if (gradeOf(data, s) >= passingOf(data, s)) pass++; });
    const rate = total > 0 ? Math.round((pass / total) * 100) : 0;
    return (
      `<strong>📊 Here's a quick snapshot of your class:</strong><br><br>` +
      `• Total Active Sections: <strong>${sections.length}</strong><br>` +
      `• Total Handled Students: <strong>${total}</strong><br>` +
      `• Overall Passing Rate: <strong>${rate}%</strong><br><br>` +
      `<em>Tip: You can ask me to list down the top students or those who are failing.</em>`
    );
  }
  return callAIEvaluate(rawQuery, buildAIContext(query, data));
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
