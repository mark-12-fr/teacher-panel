// ── grading.ts — single source of truth for grade weights ───────────────────
// Component-based grading: Written Work (WW), Performance Tasks (PT), Exam.
// Each component has a weight % and optional perfect score (total possible).
// Initial Grade = Σ(weighted scores), Final Grade = transmutation of Initial Grade.

export interface Weights {
  ww: number;
  pt: number;
  exam: number;
  passing: number;
  wwTotal: number; // perfect score for Written Work; 0 = unset → cap at 100
  ptTotal: number; // perfect score for Performance Tasks; 0 = unset
  examTotal: number; // perfect score for Exam (AT + QE); 0 = unset
}

export const GRADE_DEFAULT: Weights = { ww: 25, pt: 45, exam: 30, passing: 75, wwTotal: 0, ptTotal: 0, examTotal: 0 };

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

// ── Component scores ───────────────────────────────────────────────────────

export interface ComponentScores {
  // Written Work
  modulesOnly: number; // raw sum of module_* columns
  activitiesOnly: number; // raw sum of activity_* columns
  rawWW: number; // WW raw score = modules + activities
  wwPct: number; // WW percentage score = (raw / total) × 100
  wwWS: number; // WW weighted score = wwPct × (wwWeight / 100)

  // Performance Tasks
  rawPT: number; // PT raw score (sum of pt_* columns)
  ptPct: number; // PT percentage score
  ptWS: number; // PT weighted score

  // Exam
  rawAT: number; // Achievement Test raw score
  rawQE: number; // Quarterly Exam raw score
  rawExam: number; // Exam raw score = AT + QE
  examPct: number; // Exam percentage score
  examWS: number; // Exam weighted score

  // Totals
  ww: number; // WW percentage (for backward compat with charts)
  pt: number; // PT percentage (for backward compat)
  qe: number; // QE display percentage
  exam: number; // Exam percentage (for backward compat)
}

/** Component scores with percentage and weighted scores for each component.
 *  Pass `subjectName` so configured perfect scores and weights are applied. */
export function componentScores(record: any, subjectName?: string): ComponentScores {
  let modulesOnly = 0;
  let activitiesOnly = 0;
  let atTotal = 0;
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

  const rawWW = modulesOnly + activitiesOnly;
  const rawExam = atTotal + totalQE;
  const w = subjectName != null ? weightsFor(subjectName) : null;

  // Percentage = (raw / total) × 100 when total is configured; else min(raw, 100)
  const pct = (raw: number, total: number) => (total > 0 ? Math.min((raw / total) * 100, 100) : Math.min(raw, 100));

  const wwPct = pct(rawWW, w ? w.wwTotal : 0);
  const ptPct = pct(totalPT, w ? w.ptTotal : 0);
  const examPct = pct(rawExam, w ? w.examTotal : 0);

  // Weighted Score = percentage × (weight / 100)
  const wwWS = w ? wwPct * (w.ww / 100) : 0;
  const ptWS = w ? ptPct * (w.pt / 100) : 0;
  const examWS = w ? examPct * (w.exam / 100) : 0;

  return {
    modulesOnly,
    activitiesOnly,
    rawWW,
    wwPct,
    wwWS,

    rawPT: totalPT,
    ptPct,
    ptWS,

    rawAT: atTotal,
    rawQE: totalQE,
    rawExam,
    examPct,
    examWS,

    // backward compat fields
    ww: wwPct,
    pt: ptPct,
    qe: totalQE > 0 ? Math.min((totalQE / 50) * 100, 100) : 0,
    exam: examPct,
  };
}

// ── Initial Grade ──────────────────────────────────────────────────────────

/** Initial Grade = sum of all weighted scores (no rounding).
 *  Do NOT round during intermediate calculations. */
export function initialGrade(record: any, subjectName: string): number {
  const s = componentScores(record, subjectName);
  return s.wwWS + s.ptWS + s.examWS;
}

// ── Transmutation / Final Grade ────────────────────────────────────────────

/** DepEd standard transmutation table: Initial Grade → Final Grade.
 *  Maps the raw Initial Grade (0-100) to the transmuted Quarterly Grade.
 *  Based on the official DepEd transmutation formula. */
const TRANSMUTATION_TABLE: [number, number][] = [
  [99.5, 100],
  [98.32, 99],
  [97.14, 98],
  [95.96, 97],
  [94.78, 96],
  [93.6, 95],
  [92.42, 94],
  [91.24, 93],
  [90.06, 92],
  [88.88, 91],
  [87.7, 90],
  [86.52, 89],
  [85.34, 88],
  [84.16, 87],
  [82.98, 86],
  [81.8, 85],
  [80.62, 84],
  [79.44, 83],
  [78.26, 82],
  [77.08, 81],
  [75.9, 80],
  [74.72, 79],
  [73.54, 78],
  [72.36, 77],
  [71.18, 76],
  [70, 75],
  [65.34, 74],
  [60.67, 73],
  [56.01, 72],
  [51.34, 71],
  [46.67, 70],
  [42.01, 69],
  [37.34, 68],
  [32.68, 67],
  [28.01, 66],
  [23.35, 65],
  [18.68, 64],
  [14.01, 63],
  [9.35, 62],
  [4.68, 61],
  [0, 60],
];

/** Transmute an Initial Grade (0-100) to a Final/Quarterly Grade using the
 *  DepEd standard transmutation table. */
export function transmute(initialGrade: number): number {
  if (initialGrade < 0) return 60;
  if (initialGrade >= 99.5) return 100;

  for (const [minScore, finalGrade] of TRANSMUTATION_TABLE) {
    if (initialGrade >= minScore) return finalGrade;
  }
  return 60;
}

/** Final/Quarterly Grade: transmuted from Initial Grade.
 *  The calculation order: Raw → Percentage → Weighted → Initial → Transmuted → Final. */
export function finalGrade(record: any, subjectName: string): number {
  const ig = initialGrade(record, subjectName);
  return transmute(ig);
}

// ── In-progress detection ──────────────────────────────────────────────────

/** True when every weighted component has been given, so initialGrade() is
 *  the COMPLETE grade (not re-weighted). The Exam needs BOTH AT and QE. */
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

// ── Display helpers ────────────────────────────────────────────────────────

/** The raw point total shown as the headline of each grade-breakdown card.
 *  Modules + Activities + Performance Task + Exam (AT + QE). */
export function displayedTotal(c: ComponentScores): number {
  return (
    Math.round(c.modulesOnly) +
    Math.round(c.activitiesOnly) +
    Math.round(c.rawPT) +
    Math.round(c.rawExam)
  );
}
