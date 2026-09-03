// ── dutyCertificate.ts — batch "Certificate of Duty Hours" printing ──────────
// The teacher picks facilitators, sets each one's rendered duty hours, and prints
// them all in a single print job — one certificate per page. Everything is built
// as a self-contained HTML document and printed from a hidden iframe, so the app's
// own styles never leak into the page and there's no popup-blocker to trip over.

export interface CertShared {
  school: string;
  department: string;
  address: string;
  program: string; // e.g. "3rd-year Bachelor of Science in Information Technology"
  purpose: string; // e.g. "Hawak-Kamay Scholarship"
  schoolYear: string; // e.g. "2026-2027"
  issuedDate: string; // ISO yyyy-mm-dd
  signatoryName: string;
  signatoryTitle: string;
}

export interface CertRecipient {
  name: string;
  subject: string;
  semester: string; // display text, e.g. "first semester"
  hours: string; // as typed
}

const esc = (s: any) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + "th";
  switch (n % 10) {
    case 1: return n + "st";
    case 2: return n + "nd";
    case 3: return n + "rd";
    default: return n + "th";
  }
}

/** "2026-09-28" → "28th day of September 2026". Falls back to the raw string. */
export function formatIssuedDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return iso || "";
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1] || "";
  return `${ordinal(Number(d))} day of ${month} ${y}`;
}

/** "1st Sem"/"2nd Sem" (or a raw quarter) → "first semester" / "second semester". */
export function semesterText(semester?: string): string {
  const s = String(semester || "").toLowerCase();
  if (s.includes("2")) return "second semester";
  return "first semester";
}

/** School year that spans today, e.g. Sep 2026 → "2026-2027", Feb 2026 → "2025-2026". */
export function defaultSchoolYear(now: Date = new Date()): string {
  const y = now.getFullYear();
  // A PH school year starts around June; before then we're still in the prior SY.
  return now.getMonth() >= 5 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

function certificateSection(r: CertRecipient, shared: CertShared, dateText: string, pageBreak: boolean): string {
  return `
  <section class="cert"${pageBreak ? ' style="page-break-after:always"' : ""}>
    <header class="cert-head">
      <div class="cert-school">${esc(shared.school)}</div>
      <div class="cert-dept">${esc(shared.department)}</div>
      <div class="cert-addr">${esc(shared.address)}</div>
    </header>
    <h1 class="cert-title">CERTIFICATE OF DUTY HOURS</h1>
    <div class="cert-body">
      <p>I hereby certify that <strong>${esc(r.name)}</strong>, a <strong>${esc(shared.program)}</strong> student, has rendered <strong>${esc(r.hours)} hours</strong> of duty in the subject <strong>${esc(r.subject)}</strong> during the ${esc(r.semester)} of School Year <strong>${esc(shared.schoolYear)}</strong>.</p>
      <p>This certification is being issued upon the request of the aforementioned student for his/her <strong>${esc(shared.purpose)}</strong>.</p>
      <p>Issued on this ${esc(dateText)}.</p>
    </div>
    <div class="cert-sign">
      <div class="cert-signname">${esc(shared.signatoryName)}</div>
      <div class="cert-signtitle">${esc(shared.signatoryTitle)}</div>
    </div>
  </section>`;
}

const CERT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Georgia, "Times New Roman", serif; color: #111; }
  @page { size: A4; margin: 22mm 20mm; }
  .cert { min-height: 247mm; display: flex; flex-direction: column; padding: 6mm 2mm; }
  .cert-head { text-align: center; line-height: 1.35; }
  .cert-school { font-weight: 700; letter-spacing: 0.06em; font-size: 12pt; text-transform: uppercase; }
  .cert-dept { font-size: 10.5pt; }
  .cert-addr { font-size: 10pt; color: #333; }
  .cert-title { text-align: center; font-size: 17pt; font-weight: 700; letter-spacing: 0.14em; margin: 20mm 0 14mm; }
  .cert-body { font-size: 12.5pt; line-height: 2; text-align: justify; }
  .cert-body p { margin: 0 0 9mm; text-indent: 12mm; }
  .cert-sign { margin-top: 24mm; text-align: center; }
  .cert-signname { font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase; border-top: 1px solid #111; display: inline-block; padding: 3px 18mm 0; }
  .cert-signtitle { font-size: 10.5pt; font-style: italic; margin-top: 2px; }
`;

/** Build a full, self-contained HTML document with one certificate per recipient. */
export function buildCertificatesHtml(recipients: CertRecipient[], shared: CertShared): string {
  const dateText = formatIssuedDate(shared.issuedDate);
  const sections = recipients
    .map((r, i) => certificateSection(r, shared, dateText, i < recipients.length - 1))
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Certificates of Duty Hours</title><style>${CERT_CSS}</style></head><body>${sections}</body></html>`;
}

/** Print the given HTML document from a hidden iframe, then clean it up. */
export function printHtml(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  iframe.srcdoc = html;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    setTimeout(() => iframe.remove(), 500);
  };
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return cleanup();
    try {
      win.onafterprint = cleanup;
    } catch {}
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {}
      // Fallback cleanup in case afterprint never fires (some browsers).
      setTimeout(cleanup, 60000);
    }, 250);
  };
  document.body.appendChild(iframe);
}
