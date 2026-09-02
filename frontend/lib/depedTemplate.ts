// ── depedTemplate.ts — fill the official DepEd SHS E-Class-Record ─────────────
// The teacher enters scores in the app; this drops those scores into the exact
// official DepEd class-record workbook (public/deped-class-record-template.xlsx)
// so the teacher only has to VIEW the filled form. We write only the raw score
// inputs, the student names and a few header fields; every Total / Percentage /
// Weighted / Initial / Quarterly grade is left to the workbook's own formulas
// (the file is flagged to recalculate on open), and the logos, weights and
// transmutation table are the template's, untouched.
//
// Fill map (per learner, one row each — see STUDENT_ROWS below):
//   INPUT DATA   B/C/D/E = learner's name (drives the 1ST/2ND/Final sheets)
//   1ST  (Q1/Q3) G = Σ modules, H = Σ activities, T = Σ performance tasks,
//                AG = Achievement Test, AH = Quarterly Exam
//   2ND  (Q2/Q4) same columns, second quarter of the semester
// Everything else in the workbook is a formula and recomputes from these.

const TEMPLATE_URL = "/deped-class-record-template.xlsx";

// The official form splits learners into a MALE block (rows 13-62) and a FEMALE
// block (rows 64-113) around a divider row (63). The app has no sex field, so we
// fill ONE continuous roster across both blocks, skipping the divider — then hide
// the divider and every unused row so the form shows a single clean numbered list
// with no stray data on the divider and no trailing blank rows. 100 rows in all.
const STUDENT_ROWS: number[] = [];
for (let r = 13; r <= 62; r++) STUDENT_ROWS.push(r);
for (let r = 64; r <= 113; r++) STUDENT_ROWS.push(r);
const DIVIDER_ROW = 63; // "FEMALE" divider on 1ST / 2ND / Final
const FINAL_MALE_LABEL_ROW = 12; // "MALE" label row, only on the Final sheet

export interface DepedStudent {
  id: string;
  full_name?: string;
}

export interface DepedFillOptions {
  students: DepedStudent[];
  records: Array<Record<string, any>>; // every class-record row for the section
  semester: string; // "1st Sem" | "2nd Sem"
  subject?: string;
  sectionTitle?: string;
  teacherName?: string;
}

const escXml = (s: any) =>
  String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Replace one cell in a worksheet's XML, preserving its style index `s`.
 *  number → numeric cell · string (opts.string) → inline-string cell ·
 *  null/""/undefined → blank cell. A missing cell ref is a safe no-op. */
function setCell(xml: string, ref: string, value: any, opts: { string?: boolean } = {}): string {
  const re = new RegExp(`<c r="${ref}"((?:[^>]*?))(?:/>|>[\\s\\S]*?</c>)`);
  const blank = value === "" || value === null || value === undefined;
  return xml.replace(re, (_m, attrs) => {
    const s = (attrs.match(/\ss="(\d+)"/) || [, ""])[1];
    const sa = s ? ` s="${s}"` : "";
    if (blank) return `<c r="${ref}"${sa}/>`;
    if (opts.string)
      return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${escXml(value)}</t></is></c>`;
    return `<c r="${ref}"${sa}><v>${value}</v></c>`;
  });
}

/** Show or hide a whole worksheet row (adds/removes hidden="1" on the <row>).
 *  A missing or self-closing row is a safe no-op. */
function setRowHidden(xml: string, rownum: number, hidden: boolean): string {
  return xml.replace(new RegExp(`<row r="${rownum}"((?:[^>/]*?))>`), (_m, attrs) => {
    const cleaned = attrs.replace(/\shidden="1"/g, "");
    return `<row r="${rownum}"${cleaned}${hidden ? ' hidden="1"' : ""}>`;
  });
}

/** Sum of every filled `prefix*` field on a record, or null when none is filled
 *  (blank must stay blank so the template's COUNT()=0 → empty Total, not a 0). */
function sumFields(rec: Record<string, any>, prefix: string): number | null {
  let sum = 0;
  let any = false;
  for (const k in rec) {
    if (k.indexOf(prefix) !== 0) continue;
    const v = rec[k];
    if (v === null || v === undefined || v === "") continue;
    sum += Number(v) || 0;
    any = true;
  }
  return any ? sum : null;
}

/** A single numeric field, or null when unfilled. */
function fieldVal(rec: Record<string, any>, key: string): number | null {
  const v = rec ? rec[key] : null;
  if (v === null || v === undefined || v === "") return null;
  return Number(v) || 0;
}

/** The five score-input cells for one quarter, following the teacher panel's own
 *  rule so the official sheet shows the SAME grade it does:
 *   • a learner with no scores at all stays fully blank (the sheet shows no grade);
 *   • a learner with any score gets a grade, and a wholly-missing component counts
 *     as 0 — we drop a 0 into that component's first cell so the sheet scores it 0
 *     instead of blanking the whole Initial Grade (which is what the raw template
 *     does when a component's Total is empty). Written Work = modules (G) +
 *     activities (H); Performance Task = T; Exam = Achievement Test (AG) + QE (AH). */
function scoreCells(rec: Record<string, any>): {
  G: number | null; H: number | null; T: number | null; AG: number | null; AH: number | null;
} {
  const modules = sumFields(rec, "module_");
  const activities = sumFields(rec, "activity_");
  const pt = sumFields(rec, "pt_");
  const at = fieldVal(rec, "at");
  const qe = fieldVal(rec, "qe");
  if ([modules, activities, pt, at, qe].every((v) => v === null)) {
    return { G: null, H: null, T: null, AG: null, AH: null };
  }
  // Written Work Total and Performance Task Total blank out when their inputs are
  // all empty (COUNT()=0), which would blank the whole Initial Grade — so seed a 0.
  // The Exam Total is a plain SUM, already 0 when empty, so leave AT/QE as-is.
  const wwMissing = modules === null && activities === null;
  return {
    G: wwMissing ? 0 : modules,
    H: activities,
    T: pt === null ? 0 : pt,
    AG: at,
    AH: qe,
  };
}

/** Build the filled DepEd class-record workbook as xlsx bytes. */
export async function buildDepedClassRecord(opts: DepedFillOptions): Promise<Uint8Array> {
  const { unzipSync, zipSync, strToU8, strFromU8 } = await import("fflate");

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error("Could not load the DepEd template file.");
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));

  // A DepEd workbook is one semester = two quarters. 1st Sem → DB quarters 1 & 2
  // (1ST/2ND sheets); 2nd Sem → 3 & 4. S8 shows which semester it is.
  const secondSem = opts.semester === "2nd Sem";
  const dbQuarters = secondSem ? ["3", "4"] : ["1", "2"];
  const semLabel = secondSem ? "2ND" : "1ST";

  if ((opts.students || []).length > STUDENT_ROWS.length) {
    // Surface, don't silently drop, a roster larger than the template supports.
    throw new Error(
      `This section has ${opts.students.length} learners but the DepEd template holds ${STUDENT_ROWS.length}. Export in smaller groups.`,
    );
  }
  const students = opts.students || [];
  const used = (i: number) => i < students.length;

  const recFor = (sid: string, q: string) =>
    (opts.records || []).find(
      (r) => String(r.student_id) === String(sid) && String(r.quarter) === q,
    );

  // ── INPUT DATA sheet: header + learner names (the other sheets pull these) ──
  let input = strFromU8(files["xl/worksheets/sheet1.xml"]);
  if (opts.teacherName) input = setCell(input, "S7", opts.teacherName, { string: true });
  if (opts.subject) input = setCell(input, "AE7", opts.subject, { string: true });
  if (opts.sectionTitle) input = setCell(input, "K7", opts.sectionTitle, { string: true });
  input = setCell(input, "S8", semLabel, { string: true });
  students.forEach((s, i) => {
    const row = STUDENT_ROWS[i];
    const name = s.full_name || "";
    for (const col of ["B", "C", "D", "E"]) input = setCell(input, col + row, name, { string: true });
  });
  files["xl/worksheets/sheet1.xml"] = strToU8(input);

  // ── 1ST (sheet2) and 2ND (sheet3): the raw score inputs per quarter ─────────
  ["xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"].forEach((path, qi) => {
    let xml = strFromU8(files[path]);
    students.forEach((s, i) => {
      const row = STUDENT_ROWS[i];
      const c = scoreCells(recFor(s.id, dbQuarters[qi]) || {});
      xml = setCell(xml, "A" + row, i + 1); // one continuous 1..N numbering
      xml = setCell(xml, "G" + row, c.G);
      xml = setCell(xml, "H" + row, c.H);
      xml = setCell(xml, "T" + row, c.T);
      xml = setCell(xml, "AG" + row, c.AG);
      xml = setCell(xml, "AH" + row, c.AH);
    });
    // Hide the FEMALE divider and every unused learner row → no stray data on the
    // divider, no trailing blank rows.
    xml = setRowHidden(xml, DIVIDER_ROW, true);
    STUDENT_ROWS.forEach((row, i) => (xml = setRowHidden(xml, row, !used(i))));
    files[path] = strToU8(xml);
  });

  // ── Final Semestral Grade (sheet4): grades flow in by formula, so just tidy —
  //    renumber, and hide the MALE/FEMALE labels plus the unused rows. ──────────
  let final = strFromU8(files["xl/worksheets/sheet4.xml"]);
  students.forEach((_s, i) => (final = setCell(final, "A" + STUDENT_ROWS[i], i + 1)));
  final = setRowHidden(final, FINAL_MALE_LABEL_ROW, true);
  final = setRowHidden(final, DIVIDER_ROW, true);
  STUDENT_ROWS.forEach((row, i) => (final = setRowHidden(final, row, !used(i))));
  files["xl/worksheets/sheet4.xml"] = strToU8(final);

  return zipSync(files, { level: 6 });
}

/** Trigger a browser download of the given xlsx bytes. */
export function downloadXlsx(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
