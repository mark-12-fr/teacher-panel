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
  wwTotal: number; // "perfect score" (total possible) for Written Works; 0 = unset → cap at 100
  ptTotal: number; // "perfect score" for Performance Tasks; 0 = unset
  examTotal: number; // "perfect score" for the Exam (AT + QE); 0 = unset
}

export const GRADE_DEFAULT: Weights = { ww: 30, pt: 50, exam: 20, att: 0, passing: 75, wwTotal: 0, ptTotal: 0, examTotal: 0 };

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
      wwTotal: num(r.ww_total, 0),
      ptTotal: num(r.pt_total, 0),
      examTotal: num(r.exam_total, 0),
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
        wwTotal: num(c.wwTotal, 0),
        ptTotal: num(c.ptTotal, 0),
        examTotal: num(c.examTotal, 0),
      }
    : { ...GRADE_DEFAULT };
}

export function passingFor(subjectName: string): number {
  return weightsFor(subjectName).passing;
}

export interface ComponentScores {
  ww: number; // Written Works = Modules + Activities (0–100). Drives the WW weight.
  wwOnly: number; // Modules + Activities raw sum, capped at 100 (for display fallbacks).
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

/** Component scores (0–100) from a merged class record. Pass `subjectName` so a
 *  configured per-component "perfect score" (total possible) is applied: a
 *  component's % is then (raw / total) × 100 instead of the raw sum capped at
 *  100. e.g. Written Work total = 190 → a student with 130 shows as ~68%. Without
 *  a subject (or when a total is unset) it falls back to the raw sum capped at
 *  100 — the original behaviour, so nothing changes until a teacher sets a total
 *  in the Grading System. */
export function componentScores(record: any, subjectName?: string): ComponentScores {
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
  // Written Works = Modules + Activities. The Achievement Test (AT) belongs to
  // the EXAM together with the Quarterly Exam — each is scored out of 50, so the
  // exam component is (AT + QE) as a percentage of 100. (AT is still shown as its
  // own row in the breakdown; it just feeds the exam bucket, not Written Works.)
  const wwOnly = modulesOnly + activitiesOnly;
  const examRaw = atTotal + totalQE; // AT (/50) + QE (/50) → out of 100
  const w = subjectName != null ? weightsFor(subjectName) : null;
  // (raw / total) × 100 when a total is configured; else the raw sum capped 100.
  const pct = (raw: number, total: number) => (total > 0 ? Math.min((raw / total) * 100, 100) : Math.min(raw, 100));
  return {
    ww: pct(wwOnly, w ? w.wwTotal : 0),
    // Display rows are a RAW point tally — show the real earned totals (not
    // capped at 100), so a Modules sum of 102 shows as 102, not 100. Only the
    // weighted component score (ww/pt/exam above) is normalised; these rows are
    // informational and must reflect what the teacher actually entered.
    wwOnly: wwOnly,
    modulesOnly: modulesOnly,
    activitiesOnly: activitiesOnly,
    at: atTotal,
    pt: pct(totalPT, w ? w.ptTotal : 0),
    qe: Math.min((totalQE / 50) * 100, 100),
    exam: pct(examRaw, w ? w.examTotal : 0),
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

/** Final grade 0–100 for a merged record under a subject's weights.
 *
 *  IN-PROGRESS grading: only components that have actually been GIVEN count. A
 *  component whose columns are all blank is treated as "not handed out yet" — it
 *  is excluded and its weight is redistributed across the given components, so an
 *  empty Performance Task or Quarterly Exam doesn't drag the grade down before
 *  it's administered. A blank is grace; enter a 0 to record a real zero. Once
 *  every component is filled the active weights sum to 100 and this equals the
 *  plain weighted grade — so a completed quarter is unchanged. */
export function finalGrade(record: any, subjectName: string, attendanceScore?: number | null): number {
  const w = weightsFor(subjectName);
  const s = componentScores(record, subjectName);
  const att = attendanceScore === null || attendanceScore === undefined ? 100 : attendanceScore;

  const has = (pred: (k: string) => boolean): boolean => {
    for (const k in record || {}) {
      if (pred(k)) {
        const v = record[k];
        if (v !== null && v !== undefined && v !== "") return true;
      }
    }
    return false;
  };
  const wwGiven = has((k) => k.indexOf("module_") === 0 || k.indexOf("activity_") === 0);
  const ptGiven = has((k) => k.indexOf("pt_") === 0);
  const atGiven = has((k) => k === "at");
  const qeGiven = has((k) => k === "qe");
  const examGiven = atGiven || qeGiven;

  // Exam % from the parts actually given (AT and QE are each half of examTotal —
  // default 50 each), so an unentered QE doesn't halve a student's exam score.
  let examPct = s.exam;
  if (examGiven) {
    const partMax = w.examTotal > 0 ? w.examTotal / 2 : 50;
    const denom = partMax * ((atGiven ? 1 : 0) + (qeGiven ? 1 : 0));
    examPct = denom > 0 ? Math.min(((s.rawAT + s.rawQE) / denom) * 100, 100) : 0;
  }

  let score = 0;
  let activeWeight = 0;
  if (wwGiven) { score += s.ww * w.ww; activeWeight += w.ww; }
  if (ptGiven) { score += s.pt * w.pt; activeWeight += w.pt; }
  if (examGiven) { score += examPct * w.exam; activeWeight += w.exam; }
  if (w.att > 0) { score += att * w.att; activeWeight += w.att; }

  if (activeWeight <= 0) return 0; // nothing entered yet
  return Math.round(score / activeWeight);
}
