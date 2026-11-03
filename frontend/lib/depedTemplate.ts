// ── depedTemplate.ts — fill the official DepEd SHS E-Class-Record ─────────────
// The teacher enters scores in the app; this drops those scores into the exact
// official DepEd class-record workbook (public/deped-class-record-template.xlsx)
// so the teacher only has to VIEW the filled form. We write the raw score inputs,
// the student names and a few header fields; the Total / Percentage / Weighted
// columns stay the workbook's own formulas (the file is flagged to recalculate on
// open), and the logos, weights and transmutation table are the template's,
// untouched. The Initial Grade (AL) and Quarterly Grade (AM) are written from the
// app's own grading (lib/grading.ts) so the form always matches the class-record
// page, and the Final Semestral Grade sheet is filled for Q2/Q4.
//
// Only the SELECTED quarter is visible: Q1/Q3 hide 2ND + Final, Q2/Q4 hide 1ST.
// The other quarter's raw scores are never written into the file.
//
// Fill map (per learner, one row each — see STUDENT_ROWS below):
//   INPUT DATA   B/C/D/E = learner's name (drives the 1ST/2ND/Final sheets)
//   1ST  (Q1/Q3) G = Σ modules, H = Σ activities, T = Σ performance tasks,
//                AG = Achievement Test, AH = Quarterly Exam, AL/AM = grades
//   2ND  (Q2/Q4) same columns, second quarter of the semester
//   Final Semestral Grade  F = Q1/Q3 grade, N = Q2/Q4 grade, V/Z = average/remark

import { finalGrade, initialGrade } from "./grading";

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
  quarter?: string; // DB quarter to export ("1".."4"); defaults to the semester's first
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

/** Open the workbook on a given tab (`activeTab` index on <workbookView>). */
function setActiveTab(xml: string, index: number): string {
  return xml.replace(/<workbookView\b([^>]*?)(\/?)>/, (_m, attrs, selfClose) => {
    const cleaned = attrs.replace(/\sactiveTab="\d+"/g, "");
    return `<workbookView${cleaned} activeTab="${index}"${selfClose}>`;
  });
}

/** Mark one worksheet's <sheetView> as the selected tab (or clear it). */
function setTabSelected(xml: string, selected: boolean): string {
  return xml.replace(/<sheetView\b([^>]*?)(\/?)>/, (_m, attrs, selfClose) => {
    const cleaned = attrs.replace(/\stabSelected="\d+"/g, "");
    return `<sheetView${cleaned}${selected ? ' tabSelected="1"' : ""}${selfClose}>`;
  });
}

/** Read a numeric cell's cached value. Returns null for a missing/blank/text cell. */
function getCellNumber(xml: string, ref: string): number | null {
  const m = xml.match(new RegExp(`<c r="${ref}"[^>]*>\\s*<v>([^<]+)</v>`));
  if (!m) return null;
  const n = Number(m[1]);
  return isFinite(n) ? n : null;
}

/** Show or hide one worksheet by name in xl/workbook.xml. The official workbook
 *  ships every quarter's tab, but a download must show only the selected quarter
 *  (+ the Final Semestral Grade sheet in Q2/Q4), so the rest are hidden. */
function setSheetHidden(xml: string, sheetName: string, hidden: boolean): string {
  const nameAttr = `name="${sheetName}"`;
  return xml.replace(/<sheet\b[^>]*>/g, (tag) => {
    if (!tag.includes(nameAttr)) return tag;
    const cleaned = tag.replace(/\sstate="(?:hidden|veryHidden)"/g, "");
    if (!hidden) return cleaned;
    if (/\/>$/.test(cleaned)) return cleaned.replace(/\s*\/>$/, ' state="hidden"/>');
    return cleaned.replace(/>$/, ' state="hidden">');
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

/** The class-record page's grade for one quarter, or null when the learner has no
 *  scores at all (the page shows "—" there, so the sheet stays blank too).
 *  `initial` = Initial Grade (2 decimals), `quarterly` = transmuted Quarterly Grade. */
function quarterGrade(
  rec: Record<string, any> | undefined,
  subjectName: string,
): { initial: number; quarterly: number } | null {
  if (!rec) return null;
  const c = scoreCells(rec);
  if (c.G === null && c.H === null && c.T === null && c.AG === null && c.AH === null) return null;
  const ig = initialGrade(rec, subjectName);
  return {
    initial: Math.round(ig * 100) / 100,
    quarterly: finalGrade(rec, subjectName),
  };
}

/** Build the filled DepEd class-record workbook as xlsx bytes. */
export async function buildDepedClassRecord(opts: DepedFillOptions): Promise<Uint8Array> {
  const { unzipSync, zipSync, strToU8, strFromU8 } = await import("fflate");

  const res = await fetch(TEMPLATE_URL);
  if (!res.ok) throw new Error("Could not load the DepEd template file.");
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));

  // A DepEd workbook is one semester = two quarters, but only the SELECTED
  // quarter is ever written — a Q2 download can never carry Q1 scores (or the
  // reverse). DB quarter 1/2 = 1st Sem (1ST/2ND sheets); 3/4 = 2nd Sem.
  const selectedQuarter =
    String(opts.quarter ?? (opts.semester === "2nd Sem" ? "3" : "1")).replace(/[^1-4]/g, "") || "1";
  const secondSem = selectedQuarter === "3" || selectedQuarter === "4";
  const secondQ = selectedQuarter === "2" || selectedQuarter === "4";
  const semLabel = secondSem ? "2ND" : "1ST";
  const sheetPath = secondQ ? "xl/worksheets/sheet3.xml" : "xl/worksheets/sheet2.xml";
  const activeTab = secondQ ? 2 : 1; // workbook order: INPUT DATA, 1ST, 2ND, …
  // Q2 needs Q1's grade on the Final sheet, Q4 needs Q3's (the second semester
  // reuses the 1ST/2ND tabs as its first/second quarter).
  const pairedQuarter = secondQ ? (secondSem ? "3" : "1") : null;
  const subjectName = opts.subject || "";

  if ((opts.students || []).length > STUDENT_ROWS.length) {
    // Surface, don't silently drop, a roster larger than the template supports.
    throw new Error(
      `This section has ${opts.students.length} learners but the DepEd template holds ${STUDENT_ROWS.length}. Export in smaller groups.`,
    );
  }
  const students = opts.students || [];
  const used = (i: number) => i < students.length;

  // Strict quarter match. Legacy pre-tagging rows (quarter = null) belong to the
  // first quarter of 1st Sem only — mirroring the grid's own fallback — so they
  // can never leak into Q2/Q4.
  const recForQuarter = (sid: string, quarter: string) => {
    const rows = opts.records || [];
    const exact = rows.find(
      (r) => String(r.student_id) === String(sid) && String(r.quarter) === quarter,
    );
    if (exact) return exact;
    if (quarter === "1") {
      return rows.find(
        (r) =>
          String(r.student_id) === String(sid) &&
          (r.quarter === null || r.quarter === undefined || r.quarter === ""),
      );
    }
    return undefined;
  };
  const recFor = (sid: string) => recForQuarter(sid, selectedQuarter);

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

  // ── Only the selected quarter: 1ST (sheet2) or 2ND (sheet3) ─────────────────
  let xml = strFromU8(files[sheetPath]);

  // The official template's 2ND sheet ships with BLANK "HIGHEST POSSIBLE SCORE"
  // cells (G11/H11/T11), so its Written Work / Performance Task percentages stay
  // empty and every Initial/Quarterly Grade formula resolves to "". Copy the 1ST
  // sheet's values so the component columns compute like the first quarter's.
  if (secondQ) {
    const first = strFromU8(files["xl/worksheets/sheet2.xml"]);
    for (const ref of ["G11", "H11", "T11"]) {
      const v = getCellNumber(first, ref);
      if (v !== null) xml = setCell(xml, ref, v);
    }
  }

  students.forEach((s, i) => {
    const row = STUDENT_ROWS[i];
    const rec = recFor(s.id);
    const c = scoreCells(rec || {});
    const grade = quarterGrade(rec, subjectName);
    xml = setCell(xml, "A" + row, i + 1); // one continuous 1..N numbering
    xml = setCell(xml, "G" + row, c.G);
    xml = setCell(xml, "H" + row, c.H);
    xml = setCell(xml, "T" + row, c.T);
    xml = setCell(xml, "AG" + row, c.AG);
    xml = setCell(xml, "AH" + row, c.AH);
    // AL/AM come from the app's grading, so the form shows the same Initial and
    // Quarterly Grade as the class-record page. No scores → blank cells.
    xml = setCell(xml, "AL" + row, grade ? grade.initial : null);
    xml = setCell(xml, "AM" + row, grade ? grade.quarterly : null);
  });
  // Hide the FEMALE divider and every unused learner row → no stray data on the
  // divider, no trailing blank rows.
  xml = setRowHidden(xml, DIVIDER_ROW, true);
  STUDENT_ROWS.forEach((row, i) => (xml = setRowHidden(xml, row, !used(i))));
  files[sheetPath] = strToU8(xml);

  // Open the workbook on the quarter that was actually filled, and show ONLY the
  // tabs that belong to it: Q1/Q3 = 1ST, Q2/Q4 = 2ND + Final Semestral Grade.
  let wb = strFromU8(files["xl/workbook.xml"]);
  wb = setSheetHidden(wb, "1ST", secondQ);
  wb = setSheetHidden(wb, "2ND", !secondQ);
  wb = setSheetHidden(wb, "Final Semestral Grade", !secondQ);
  wb = setActiveTab(wb, activeTab);
  files["xl/workbook.xml"] = strToU8(wb);
  files["xl/worksheets/sheet2.xml"] = strToU8(
    setTabSelected(strFromU8(files["xl/worksheets/sheet2.xml"]), !secondQ),
  );
  files["xl/worksheets/sheet3.xml"] = strToU8(
    setTabSelected(strFromU8(files["xl/worksheets/sheet3.xml"]), secondQ),
  );

  // ── Final Semestral Grade (sheet4): only in Q2/Q4. Its formulas point at the
  //    other quarter's sheet, which is hidden and deliberately unfilled (no raw
  //    scores may travel with the download), so write the paired quarter's grade
  //    as a value and let the average/remark cells compute from it. ────────────
  let final = strFromU8(files["xl/worksheets/sheet4.xml"]);
  students.forEach((s, i) => {
    const row = STUDENT_ROWS[i];
    final = setCell(final, "A" + row, i + 1);
    if (!secondQ || !pairedQuarter) return;
    const paired = quarterGrade(recForQuarter(s.id, pairedQuarter), subjectName);
    const current = quarterGrade(recFor(s.id), subjectName);
    if (!paired || !current) {
      final = setCell(final, "F" + row, null);
      final = setCell(final, "N" + row, null);
      final = setCell(final, "V" + row, null);
      final = setCell(final, "Z" + row, null);
      return;
    }
    const semestral = Math.round((paired.quarterly + current.quarterly) / 2);
    final = setCell(final, "F" + row, paired.quarterly);
    final = setCell(final, "N" + row, current.quarterly);
    final = setCell(final, "V" + row, semestral);
    final = setCell(final, "Z" + row, semestral >= 75 ? "PASSED" : "FAILED", { string: true });
  });
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
