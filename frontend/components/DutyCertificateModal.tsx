"use client";

// Batch printing of "Certificate of Duty Hours" for facilitators. The teacher
// sets the shared certificate details once (remembered across sessions), ticks
// the facilitators to issue to, sets each one's hours, and prints them all in a
// single print job — one certificate per page.

import { useEffect, useMemo, useState } from "react";
import {
  buildCertificatesHtml,
  printHtml,
  semesterText,
  defaultSchoolYear,
  type CertShared,
  type CertRecipient,
} from "@/lib/dutyCertificate";

const SETTINGS_KEY = "duty_cert_settings";

const todayIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function defaultShared(): CertShared {
  let signatoryName = "";
  try {
    signatoryName = localStorage.getItem("cached_user_name") || "";
  } catch {}
  return {
    school: "PHINMA UNIVERSITY OF ILOILO",
    department: "Senior High School Department",
    address: "Rizal Street, Iloilo City",
    program: "3rd-year Bachelor of Science in Information Technology",
    purpose: "Hawak-Kamay Scholarship",
    schoolYear: defaultSchoolYear(),
    issuedDate: todayIso(),
    signatoryName,
    signatoryTitle: "Expert Teacher",
  };
}

function loadShared(): CertShared {
  const base = defaultShared();
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    // Keep issuedDate fresh each open; everything else is remembered.
    return { ...base, ...saved, issuedDate: todayIso() };
  } catch {
    return base;
  }
}

const labelStyle: React.CSSProperties = { fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, display: "block", textTransform: "uppercase", letterSpacing: "0.03em" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border-color, #e5e7eb)", background: "var(--input-bg, #fff)", color: "var(--text-dark)", fontSize: "0.9rem" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

export default function DutyCertificateModal({
  facis,
  sections,
  onClose,
  onToast,
}: {
  facis: any[];
  sections: any[];
  onClose: () => void;
  onToast?: (msg: string, err?: boolean) => void;
}) {
  const [shared, setShared] = useState<CertShared>(defaultShared);
  const [defaultHours, setDefaultHours] = useState("100");
  const [selected, setSelected] = useState<Record<string, string>>({}); // faciId → hours
  const [search, setSearch] = useState("");

  useEffect(() => {
    setShared(loadShared());
  }, []);

  const set = (k: keyof CertShared, v: string) => setShared((s) => ({ ...s, [k]: v }));

  const semesterFor = (faci: any): string =>
    semesterText(sections.find((s) => s.title === faci.section)?.semester);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return facis;
    return facis.filter(
      (f) => String(f.full_name || "").toUpperCase().includes(q) || String(f.section || "").toUpperCase().includes(q),
    );
  }, [facis, search]);

  const selectedIds = Object.keys(selected);
  const allFilteredSelected = filtered.length > 0 && filtered.every((f) => f.id in selected);

  function toggle(faci: any) {
    setSelected((prev) => {
      const next = { ...prev };
      if (faci.id in next) delete next[faci.id];
      else next[faci.id] = defaultHours;
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = { ...prev };
        filtered.forEach((f) => delete next[f.id]);
        return next;
      }
      const next = { ...prev };
      filtered.forEach((f) => { if (!(f.id in next)) next[f.id] = defaultHours; });
      return next;
    });
  }
  function setHours(id: string, v: string) {
    setSelected((prev) => ({ ...prev, [id]: v }));
  }
  function applyDefaultHoursToAll() {
    setSelected((prev) => {
      const next: Record<string, string> = {};
      for (const id of Object.keys(prev)) next[id] = defaultHours;
      return next;
    });
  }

  function persist() {
    try {
      const { issuedDate, ...rest } = shared;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
    } catch {}
  }

  function handlePrint() {
    if (selectedIds.length === 0) {
      onToast?.("Pick at least one facilitator to print a certificate for.", true);
      return;
    }
    const byId = new Map(facis.map((f) => [f.id, f]));
    const recipients: CertRecipient[] = selectedIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((f: any) => ({
        name: f.full_name || "",
        subject: f.subject || "",
        semester: semesterFor(f),
        hours: (selected[f.id] ?? defaultHours).trim() || "0",
      }));
    persist();
    printHtml(buildCertificatesHtml(recipients, shared));
    onToast?.(`Opening print for ${recipients.length} certificate${recipients.length === 1 ? "" : "s"}…`);
  }

  return (
    <div className="modal-overlay" style={{ display: "flex" }}>
      <div className="modal-content" style={{ maxWidth: 720, width: "94%", maxHeight: "92vh", overflowY: "auto" }}>
        <h4 style={{ marginBottom: 4, color: "var(--text-dark)" }}>Certificates of Duty Hours</h4>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 18 }}>
          Set the details once, pick who to issue to, then print them all in one go — one certificate per page.
        </p>

        {/* Shared certificate details */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 8 }}>
          <Field label="School Year"><input style={inputStyle} value={shared.schoolYear} onChange={(e) => set("schoolYear", e.target.value)} /></Field>
          <Field label="Date Issued"><input type="date" style={inputStyle} value={shared.issuedDate} onChange={(e) => set("issuedDate", e.target.value)} /></Field>
          <Field label="Program / Year Level"><input style={inputStyle} value={shared.program} onChange={(e) => set("program", e.target.value)} /></Field>
          <Field label="Purpose (for his/her …)"><input style={inputStyle} value={shared.purpose} onChange={(e) => set("purpose", e.target.value)} /></Field>
          <Field label="Signatory Name"><input style={inputStyle} value={shared.signatoryName} onChange={(e) => set("signatoryName", e.target.value)} /></Field>
          <Field label="Signatory Title"><input style={inputStyle} value={shared.signatoryTitle} onChange={(e) => set("signatoryTitle", e.target.value)} /></Field>
          <Field label="School Name"><input style={inputStyle} value={shared.school} onChange={(e) => set("school", e.target.value)} /></Field>
          <Field label="Department"><input style={inputStyle} value={shared.department} onChange={(e) => set("department", e.target.value)} /></Field>
          <Field label="Address"><input style={inputStyle} value={shared.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Duty hours (applies to all)">
            <div style={{ display: "flex", gap: 6 }}>
              <input type="number" min={0} style={{ ...inputStyle, flex: 1 }} value={defaultHours} onChange={(e) => setDefaultHours(e.target.value)} />
              <button type="button" onClick={applyDefaultHoursToAll} title="Apply this to every selected facilitator"
                style={{ padding: "0 12px", borderRadius: 8, border: "1px solid var(--border-color, #e5e7eb)", background: "var(--input-bg, #fff)", color: "var(--text-dark)", cursor: "pointer", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                Apply
              </button>
            </div>
          </Field>
        </div>

        {/* Facilitator selection */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 8px" }}>
          <strong style={{ color: "var(--text-dark)", fontSize: "0.95rem" }}>Select facilitators <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>({selectedIds.length} selected)</span></strong>
          <button type="button" onClick={toggleAll} style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: "0.82rem", fontWeight: 600 }}>
            {allFilteredSelected ? "Clear all" : "Select all"}
          </button>
        </div>
        <input placeholder="Search name or section…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />

        <div style={{ border: "1px solid var(--border-color, #e5e7eb)", borderRadius: 10, overflow: "hidden" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: "0.9rem" }}>No facilitators found.</div>
          ) : (
            filtered.map((f, i) => {
              const on = f.id in selected;
              return (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i === 0 ? "none" : "1px solid var(--border-color, #f0f0f0)", background: on ? "rgba(59,130,246,0.06)" : "transparent" }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(f)} style={{ width: 17, height: 17, flexShrink: 0, cursor: "pointer" }} />
                  <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => toggle(f)}>
                    <div style={{ fontWeight: 600, color: "var(--text-dark)", fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.full_name}</div>
                    <div style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>{f.section}{f.subject ? ` • ${f.subject}` : ""}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, opacity: on ? 1 : 0.4 }}>
                    <input type="number" min={0} disabled={!on} value={on ? selected[f.id] : defaultHours} onChange={(e) => setHours(f.id, e.target.value)}
                      style={{ width: 66, padding: "6px 8px", borderRadius: 7, border: "1px solid var(--border-color, #e5e7eb)", background: "var(--input-bg, #fff)", color: "var(--text-dark)", fontSize: "0.85rem", textAlign: "center" }} />
                    <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>hrs</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 8, border: "none", cursor: "pointer", background: "var(--input-bg, #eef1f5)", color: "var(--text-dark)", fontWeight: 500 }}>Cancel</button>
          <button onClick={handlePrint} disabled={selectedIds.length === 0}
            style={{ flex: 2, background: selectedIds.length === 0 ? "#93c5fd" : "#3b82f6", color: "white", padding: 12, borderRadius: 8, border: "none", cursor: selectedIds.length === 0 ? "not-allowed" : "pointer", fontWeight: 600 }}>
            <i className="fa-solid fa-print" style={{ marginRight: 8 }} />
            Print {selectedIds.length || ""} Certificate{selectedIds.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
