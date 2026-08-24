// ── grading.ts — single source of truth for grade weights ───────────────────
// Faithful TypeScript port of the legacy grading.js. Weights per subject come
// from the teacher's `subjects` config (loaded via the API) so faci grades
// match the teacher panel exactly; falls back to the DepEd default otherwise.

export interface Weights {
  ww: number;
  pt: number;
  exam: number;
  att: number;
  passing: number;
}

export const GRADE_DEFAULT: Weights = { ww: 30, pt: 50, exam: 20, att: 0, passing: 75 };

/** Maximum raw Written Work points (Modules + Activities combined). The WW
 *  component is scored as rawPoints ÷ WW_MAX × 100, capped at 100. */
export const WW_MAX = 190;

let SUBJECT_CFG: Record<string, Weights> = {};

const norm = (s: any) => String(s == null ? "" : s).trim().toLowerCase();
const num = (v: any, d: number) => {
  const n = Number(v);
  return isFinite(n) ? n : d;
};

/** Populate the in-memory subject→weights map from the API `subjects` rows. */
export function setSubjectConfigs(subjects: any[]): Record<string, Weights> {
  const map: Record<string, Weights> = {};
  (subjects || []).forEach((r) => {
    map[norm(r.name)] = {
      ww: num(r.ww_percent, GRADE_DEFAULT.ww),
      pt: num(r.pt_percent, GRADE_DEFAULT.pt),
      exam: num(r.exam_percent, GRADE_DEFAULT.exam),
      att: num(r.attendance_percent, GRADE_DEFAULT.att),
      passing: num(r.passing_grade, GRADE_DEFAULT.passing),
    };
  });
  SUBJECT_CFG = map;
  return SUBJECT_CFG;
}

export function weightsFor(subjectName: string): Weights {
  const c = SUBJECT_CFG[norm(subjectName)];
  return c
    ? {
        ww: num(c.ww, GRADE_DEFAULT.ww),
        pt: num(c.pt, GRADE_DEFAULT.pt),
        exam: num(c.exam, GRADE_DEFAULT.exam),
        att: num(c.att, GRADE_DEFAULT.att),
        passing: num(c.passing, GRADE_DEFAULT.passing),
      }
    : { ...GRADE_DEFAULT };
}

export function passingFor(subjectName: string): number {
  return weightsFor(subjectName).passing;
}

export interface ComponentScores {
  ww: number; // Written Works = Modules + Activities, as a % of WW_MAX. Drives the WW weight.
  wwOnly: number; // Same as ww now (kept for callers that referenced it).
  modulesOnly: number; // Modules columns only (for display).
  activitiesOnly: number; // Activity columns only (for display).
  at: number; // The standalone AT (Achievement Test) column on its own (for display).
  pt: number;
  qe: number; // Quarterly Exam alone as a % of 50 (for the display row).
  exam: number; // EXAM component = AT + QE (each /50 → /100). Drives the exam weight.
  rawWW: number;
  rawPT: number;
  rawQE: number;
  rawAT: number; // Raw Achievement Test points.
  rawExam: number; // Raw exam points = AT + QE (out of 100).
}

/** Component scores (each capped at 100) from a merged class record. */
export function componentScores(record: any): ComponentScores {
  let modulesOnly = 0; // module_* columns
  let activitiesOnly = 0; // activity_* columns
  let atTotal = 0; // the standalone AT (Achievement Test) column
  let totalPT = 0;
  const totalQE = num(record && record.qe, 0);
  for (const k in record || {}) {
    const v = record[k];
    if (v === null || v === undefined || v === "") continue;
    if (k.indexOf("module_") === 0) modulesOnly += num(v, 0);
    else if (k.indexOf("activity_") === 0) activitiesOnly += num(v, 0);
    else if (k === "at") atTotal += num(v, 0);
    else if (k.indexOf("pt_") === 0) totalPT += num(v, 0);
  }
  // Written Works = Modules + Activities, scored out of WW_MAX points (see the
  // constant above) so a student earning e.g. 150/190 shows as ~79%, not a
  // capped 100. The Achievement Test (AT) belongs to the EXAM together with
  // the Quarterly Exam — each is scored out of 50, so the exam component is
  // (AT + QE) as a percentage of 100. (AT is still shown as its own row in
  // the breakdown; it just feeds the exam bucket, not Written Works.)
  const wwOnly = modulesOnly + activitiesOnly;
  const examRaw = atTotal + totalQE; // AT (/50) + QE (/50) → out of 100
  return {
    ww: Math.min((wwOnly / WW_MAX) * 100, 100),
    wwOnly: Math.min((wwOnly / WW_MAX) * 100, 100),
    modulesOnly: Math.min(modulesOnly, 100),
    activitiesOnly: Math.min(activitiesOnly, 100),
    at: Math.min(atTotal, 100),
    pt: Math.min(totalPT, 100),
    qe: Math.min((totalQE / 50) * 100, 100),
    exam: Math.min(examRaw, 100),
    rawWW: wwOnly,
    rawPT: totalPT,
    rawQE: totalQE,
    rawAT: atTotal,
    rawExam: examRaw,
  };
}

/** The point total shown as the headline of each grade-breakdown card: the five
 *  displayed component scores (Modules, Activity, Achievement Test, Performance
 *  Task, Quarterly Exam) added together, each rounded exactly the way the modal
 *  renders them so the big number always equals the sum of the rows beneath it.
 *  This is a raw point tally for the teacher's convenience, NOT the weighted
 *  grade — that stays available via finalGrade(). */
export function displayedTotal(c: ComponentScores): number {
  return (
    Math.round(c.modulesOnly) +
    Math.round(c.activitiesOnly) +
    Math.round(c.at) +
    Math.round(c.pt) +
    Math.round(c.qe)
  );
}

/** Attendance score 0–100 from {present, late, total}. No records → 100. */
export function attScore(att: { present?: number; late?: number; total?: number } | null | undefined): number {
  if (!att || !att.total) return 100;
  const present = num(att.present, 0);
  const late = num(att.late, 0);
  return Math.min(((present + 0.5 * late) / att.total) * 100, 100);
}

/** Final grade 0–100 for a merged record under a subject's weights. */
export function finalGrade(record: any, subjectName: string, attendanceScore?: number | null): number {
  const w = weightsFor(subjectName);
  const s = componentScores(record);
  const att = attendanceScore === null || attendanceScore === undefined ? 100 : attendanceScore;
  return Math.round(
    s.ww * (w.ww / 100) + s.pt * (w.pt / 100) + s.exam * (w.exam / 100) + att * (w.att / 100)
  );
}
