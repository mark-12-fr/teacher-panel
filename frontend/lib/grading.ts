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

/** The point total shown as the headline of each grade-breakdown card: the four
 *  displayed component scores — Modules, Activity, Performance Task, and the Exam
 *  — added together, each rounded exactly the way the modal renders them so the
 *  big number always equals the sum of the rows beneath it. The Exam pools the
 *  Achievement Test and the Quarterly Exam (AT + QE), the same bucket the grade
 *  uses, so the AT is counted once — inside the Exam — and never added again on
 *  its own. A raw point tally for the teacher's convenience, NOT the weighted
 *  grade — that stays available via finalGrade(). */
export function displayedTotal(c: ComponentScores): number {
  return (
    Math.round(c.modulesOnly) +
    Math.round(c.activitiesOnly) +
    Math.round(c.rawPT) +
    Math.round(c.rawExam)
  );
}

/** Attendance score 0–100 from {present, late, total}. No records → 100. */
export function attScore(att: { present?: number; late?: number; total?: number } | null | undefined): number {
  if (!att || !att.total) return 100;
  const present = num(att.present, 0);
  const late = num(att.late, 0);
  return Math.min(((present + 0.5 * late) / att.total) * 100, 100);
}

// Round to 2 decimals the way a spreadsheet's ROUND(x, 2) does (half away from
// zero for positive grades). The +1e-9 nudge absorbs binary float error so a
// value like 11.185 rounds to 11.19, matching the teacher's Excel exactly.
const round2 = (n: number): number => Math.round((n + 1e-9) * 100) / 100;

/** Percentage Score (PS) for a component: raw / perfect × 100, capped at 100 and
 *  rounded to 2 decimals — the "PS" column in the DepEd class record. When no
 *  perfect score is configured (legacy 0), fall back to the raw sum capped 100. */
function componentPct(raw: number, perfect: number): number {
  return perfect > 0 ? round2(Math.min((raw / perfect) * 100, 100)) : round2(Math.min(raw, 100));
}

export interface GradeBreakdown {
  wwPS: number;
  wwWS: number;
  ptPS: number;
  ptWS: number;
  examPS: number;
  examWS: number;
  attPS: number;
  attWS: number;
  initial: number; // Initial Grade — sum of weighted scores, 2 decimals.
  final: number; // Final / Quarterly Grade — the Initial Grade transmuted.
}

// The school's transmutation table (Initial Grade → Final/Quarterly Grade),
// transcribed verbatim from the teacher's Excel IFS formula. Rows are
// [lowerBound, upperBound, grade], ordered high→low; the two decimals are exact.
// Passing (75) needs an Initial Grade of 70.00; the floor grade is 60.
const TRANSMUTATION: [number, number, number][] = [
  [99.5, 100, 100], [98.32, 99.49, 99], [97.14, 98.31, 98], [95.96, 97.13, 97], [94.78, 95.95, 96],
  [93.6, 94.77, 95], [92.42, 93.59, 94], [91.24, 92.41, 93], [90.06, 91.23, 92], [88.88, 90.05, 91],
  [87.7, 88.87, 90], [86.52, 87.69, 89], [85.34, 86.51, 88], [84.16, 85.33, 87], [82.98, 84.15, 86],
  [81.8, 82.97, 85], [80.62, 81.79, 84], [79.44, 80.61, 83], [78.26, 79.43, 82], [77.08, 78.25, 81],
  [75.9, 77.07, 80], [74.72, 75.89, 79], [73.54, 74.71, 78], [72.36, 73.53, 77], [71.18, 72.35, 76],
  [70, 71.17, 75], [65.34, 69.99, 74], [60.67, 65.33, 73], [56.01, 60.66, 72], [51.34, 56, 71],
  [46.67, 51.33, 70], [42.01, 46.66, 69], [37.34, 42, 68], [32.68, 37.33, 67], [28.01, 32.67, 66],
  [23.35, 28, 65], [18.68, 23.34, 64], [14.01, 18.67, 63], [9.35, 14, 62], [4.68, 9.34, 61], [0, 4.67, 60],
];

/** Convert an Initial Grade to the Final/Quarterly Grade via the school's
 *  transmutation table. Never calculate the Final Grade from raw scores — always
 *  transmute the Initial Grade (raw → % → weighted → initial → transmute). */
export function transmute(initial: number): number {
  if (initial >= 100) return 100;
  for (const [lo, , g] of TRANSMUTATION) if (initial >= lo) return g; // table is high→low
  return 60;
}

/** Full component breakdown for one record: each component's Percentage Score
 *  and Weighted Score, then the Initial Grade and the transmuted Final Grade —
 *  the exact quantities the DepEd class record (and the teacher's Excel) show.
 *
 *  The pipeline is strictly Raw → Percentage → Weighted → Initial → Transmute →
 *  Final; nothing is derived from a flat "TOTAL". A component with 0% weight
 *  contributes 0 to the Initial Grade. Blank components score 0 (not excluded),
 *  matching the Excel — the transmutation lifts a low Initial back up. */
export function gradeBreakdown(record: any, subjectName: string, attendanceScore?: number | null): GradeBreakdown {
  const w = weightsFor(subjectName);
  const s = componentScores(record, subjectName);
  const att = attendanceScore === null || attendanceScore === undefined ? 100 : round2(Math.min(Math.max(attendanceScore, 0), 100));

  const wwPS = componentPct(s.rawWW, w.wwTotal); // Written Work = Modules + Activities
  const ptPS = componentPct(s.rawPT, w.ptTotal); // Performance Tasks
  const examPS = componentPct(s.rawExam, w.examTotal); // Exam = Achievement Test + Quarterly Exam
  const attPS = att;

  const wwWS = round2(wwPS * (w.ww / 100));
  const ptWS = round2(ptPS * (w.pt / 100));
  const examWS = round2(examPS * (w.exam / 100));
  const attWS = round2(attPS * (w.att / 100));

  const initial = round2(wwWS + ptWS + examWS + attWS);
  return { wwPS, wwWS, ptPS, ptWS, examPS, examWS, attPS, attWS, initial, final: transmute(initial) };
}

/** Initial Grade (0–100, 2 decimals): the sum of the weighted component scores,
 *  BEFORE transmutation. This is what the class record's "Initial Grade" column
 *  shows. Store/compare with its decimals — do not round to a whole number. */
export function initialGrade(record: any, subjectName: string, attendanceScore?: number | null): number {
  return gradeBreakdown(record, subjectName, attendanceScore).initial;
}

/** Final / Quarterly Grade (whole number): the Initial Grade run through the
 *  school's transmutation table. This is the official quarterly grade used for
 *  ranking, pass/fail and reports. */
export function finalGrade(record: any, subjectName: string, attendanceScore?: number | null): number {
  return gradeBreakdown(record, subjectName, attendanceScore).final;
}

/** True when every weighted component has been given, so finalGrade() is the
 *  FINAL grade (not the re-weighted in-progress one). The Exam needs BOTH the
 *  Achievement Test and the Quarterly Exam. Drives the "In-progress" tag. */
export function isGradeComplete(record: any, subjectName: string): boolean {
  const w = weightsFor(subjectName);
  const has = (pred: (k: string) => boolean): boolean => {
    for (const k in record || {}) {
      if (pred(k)) { const v = record[k]; if (v !== null && v !== undefined && v !== "") return true; }
    }
    return false;
  };
  if (w.ww > 0 && !has((k) => k.indexOf("module_") === 0 || k.indexOf("activity_") === 0)) return false;
  if (w.pt > 0 && !has((k) => k.indexOf("pt_") === 0)) return false;
  if (w.exam > 0 && !(has((k) => k === "at") && has((k) => k === "qe"))) return false;
  return true;
}
