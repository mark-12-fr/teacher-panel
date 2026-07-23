// Excel export helpers — faithful port of export-utils.js (autoFitColumns +
// formatExcelSheet), using the same xlsx-js-style library the legacy app loaded
// on demand from a CDN. `xlsx-js-style` is imported dynamically inside
// writeStyledSheet so its ~430 KB bundle is code-split into its own chunk and
// only fetched when the user actually exports (matching the old lazy-load).
// Reusable by the attendance / class-record / performance detail pages.

type WS = any;

/** Auto-fit every column to its widest cell. Rows before `startRow` (the title
 *  / subtitle banner, which only fills column A) are skipped so a long title
 *  can't blow out the first column's width, and every width is capped. The
 *  first column (the "#" / rank index) is allowed to shrink to its short
 *  content instead of the general minimum. */
function autoFitColumns(XLSX: any, ws: WS, minWidth = 10, startRow = 0, maxWidth = 50): void {
  if (!ws["!ref"]) return;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const from = Math.max(range.s.r, startRow);
  const colWidths: { wch: number }[] = [];
  for (let C = range.s.c; C <= range.e.c; C++) {
    let maxLen = 0;
    for (let R = from; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.v !== undefined) {
        const len = String(cell.v).length;
        if (len > maxLen) maxLen = len;
      }
    }
    const floor = C === range.s.c ? 4 : minWidth; // let the index (#) column be snug
    colWidths[C] = { wch: Math.min(maxWidth, Math.max(floor, maxLen + 3)) };
  }
  ws["!cols"] = colWidths;
}

/** Professional sheet formatting (navy header, borders, zebra striping). */
function formatExcelSheet(XLSX: any, ws: WS, opts: { headerRow?: number; freezeRow?: number } = {}): void {
  if (!ws["!ref"]) return;
  const headerRow = opts.headerRow !== undefined ? opts.headerRow : 0;
  const range = XLSX.utils.decode_range(ws["!ref"]);

  // Freeze panes
  let freezeRow = opts.freezeRow;
  if (freezeRow === undefined) freezeRow = headerRow;
  if (freezeRow >= 0) {
    ws["!freeze"] = { xSplit: 0, ySplit: freezeRow + 1, activePane: "bottomLeft" };
  }

  // Style header row (dark navy, white bold text, centered)
  if (headerRow >= 0 && headerRow <= range.e.r) {
    const hFill = { fgColor: { rgb: "1E3A5F" } };
    const hFont = { bold: true, color: { rgb: "FFFFFF" }, sz: 11, name: "Calibri" };
    const hAlign = { horizontal: "center", vertical: "center", wrapText: true };
    const hBorder = {
      top: { style: "thin", color: { rgb: "334155" } },
      bottom: { style: "medium", color: { rgb: "1E3A5F" } },
      left: { style: "thin", color: { rgb: "334155" } },
      right: { style: "thin", color: { rgb: "334155" } },
    };
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: headerRow, c: C });
      if (!ws[addr]) ws[addr] = { v: "", t: "s" };
      ws[addr].s = { fill: hFill, font: hFont, alignment: hAlign, border: hBorder };
    }
  }

  // Title row styling (if headerRow > 0, row 0 is a title)
  if (headerRow > 0) {
    const tFont = { bold: true, sz: 14, name: "Calibri", color: { rgb: "1E3A5F" } };
    const tAlign = { horizontal: "left", vertical: "center" };
    for (let C = range.s.c; C <= range.e.c; C++) {
      const tAddr = XLSX.utils.encode_cell({ r: 0, c: C });
      if (ws[tAddr]) ws[tAddr].s = { font: tFont, alignment: tAlign };
    }
  }

  // Subtitle row (row 1) — smaller, gray
  if (headerRow > 1) {
    const sFont = { sz: 9, name: "Calibri", color: { rgb: "64748B" }, italic: true };
    const sAlign = { horizontal: "left", vertical: "center" };
    for (let C = range.s.c; C <= range.e.c; C++) {
      const sAddr = XLSX.utils.encode_cell({ r: 1, c: C });
      if (ws[sAddr]) ws[sAddr].s = { font: sFont, alignment: sAlign };
    }
  }

  // Data row styling (clean borders, readable font)
  const dBorder = {
    top: { style: "thin", color: { rgb: "E2E8F0" } },
    bottom: { style: "thin", color: { rgb: "E2E8F0" } },
    left: { style: "thin", color: { rgb: "E2E8F0" } },
    right: { style: "thin", color: { rgb: "E2E8F0" } },
  };
  const dFont = { sz: 10, name: "Calibri", color: { rgb: "334155" } };
  const dAlign = { vertical: "center" };
  for (let R = headerRow + 1; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr2 = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws[addr2]) ws[addr2].s = { font: dFont, alignment: dAlign, border: dBorder };
    }
  }

  // Alternate row shading (very subtle)
  for (let R2 = headerRow + 2; R2 <= range.e.r; R2 += 2) {
    for (let C2 = range.s.c; C2 <= range.e.c; C2++) {
      const addr3 = XLSX.utils.encode_cell({ r: R2, c: C2 });
      if (ws[addr3]) {
        if (!ws[addr3].s) ws[addr3].s = {};
        if (!ws[addr3].s.fill) ws[addr3].s.fill = {};
        ws[addr3].s.fill.fgColor = { rgb: "F4F7FB" };
      }
    }
  }

  // Center numeric columns
  for (let R3 = headerRow + 1; R3 <= range.e.r; R3++) {
    for (let C3 = range.s.c; C3 <= range.e.c; C3++) {
      const addr3n = XLSX.utils.encode_cell({ r: R3, c: C3 });
      if (ws[addr3n] && typeof ws[addr3n].v === "number") {
        if (!ws[addr3n].s) ws[addr3n].s = {};
        ws[addr3n].s.alignment = { horizontal: "center", vertical: "center" };
      }
    }
  }
}

/**
 * Build a styled worksheet from an array-of-arrays and download it as .xlsx.
 * Dynamically imports xlsx-js-style so it's fetched only on first export.
 */
export async function writeStyledSheet(
  rows: any[][],
  opts: { sheetName?: string; fileName: string; headerRow?: number }
): Promise<void> {
  const XLSX: any = await import("xlsx-js-style");
  const ws = XLSX.utils.aoa_to_sheet(rows);
  autoFitColumns(XLSX, ws, 10, opts.headerRow ?? 0);
  formatExcelSheet(XLSX, ws, { headerRow: opts.headerRow });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName || "Sheet1");
  XLSX.writeFile(wb, opts.fileName);
}
