"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPatch, ApiError } from "@/lib/api";
import { usePageMeta } from "@/lib/page-meta";
import { useCachedData } from "@/hooks/use-cached-data";
import "./facilitators.css";

function getLastSeenText(lastLogin?: string | null): { text: string; isActive: boolean } {
  if (!lastLogin) return { text: "Never logged in", isActive: false };
  let raw = String(lastLogin).trim().replace(" ", "T");
  if (!/(z|[+-]\d{2}:?\d{2})$/i.test(raw)) raw += "Z";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return { text: "Unknown", isActive: false };
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  const isActive = diffMin < 3;
  let text: string;
  if (diffMin < 1) text = "Active now";
  else if (diffMin < 60) text = `${diffMin} min ago`;
  else if (diffMin < 1440) text = `${Math.floor(diffMin / 60)}h ago`;
  else if (diffMin < 2880) text = "Yesterday";
  else text = `${Math.floor(diffMin / 1440)} days ago`;
  return { text, isActive };
}

const avatarFor = (f: any) =>
  f.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(f.full_name)}&background=3b82f6&color=fff&size=128`;

export default function FacilitatorsPage() {
  const [facis, setFacis] = useState<any[]>([]);
  const [sections, setSections] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ show: boolean; msg: string; err: boolean }>({ show: false, msg: "", err: false });

  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", section: "", account_id: "", password: "" });
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [photo, setPhoto] = useState<{ src: string; name: string } | null>(null);

  function showToast(msg: string, err = false) {
    setToast({ show: true, msg, err });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  }

  const fetchFacis = useCallback(async () => {
    const [f, s] = await Promise.all([apiGet("/api/facilitators"), apiGet("/api/sections")]);
    return { facis: f.facilitators || [], sections: s.sections || [] };
  }, []);

  const faciCache = useCachedData("list_cache_facis", fetchFacis, { ttl: 60000 });

  useEffect(() => {
    if (!faciCache.data) return;
    setFacis(faciCache.data.facis);
    setSections(faciCache.data.sections);
  }, [faciCache.data]);

  useEffect(() => {
    if (faciCache.error) showToast("Failed to load facilitators.", true);
  }, [faciCache.error]);

  const stats = useMemo(
    () => ({ total: facis.length, activeSections: new Set(facis.map((f) => f.section)).size }),
    [facis]
  );

  function openAdd() {
    setEditingId(null);
    setForm({ name: "", section: "", account_id: "", password: "" });
    setModal(true);
  }
  function openEdit(f: any) {
    setEditingId(f.id);
    setForm({ name: f.full_name, section: f.section, account_id: f.account_id, password: "" });
    setModal(true);
  }

  async function save() {
    const subject = sections.find((s) => s.title === form.section)?.subject || "";
    const baseValid = form.name.trim() && form.section && subject;
    const allValid = editingId ? baseValid : baseValid && form.account_id.trim() && form.password.trim();
    if (!allValid) {
      showToast("Please fill in all details and select a section!", true);
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const payload: any = { full_name: form.name.trim(), section: form.section, subject };
        if (form.password.trim()) payload.password = form.password.trim();
        await apiPatch(`/api/facilitators/${editingId}`, payload);
      } else {
        await apiPost("/api/facilitators", {
          full_name: form.name.trim(),
          section: form.section,
          subject,
          account_id: form.account_id.trim(),
          password: form.password.trim(),
        });
      }
      setModal(false);
      faciCache.refresh();
      showToast(editingId ? "Facilitator updated!" : "Facilitator assigned!");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) showToast("That Account ID is already taken. Please use a different one.", true);
      else showToast("Error saving facilitator. Please try again.", true);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    try {
      await apiDelete(`/api/facilitators/${id}`);
      faciCache.refresh();
      showToast("Facilitator access removed.");
    } catch {
      showToast("Failed to delete facilitator.", true);
    }
  }

  function copyAccountId(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(id).then(() => showToast("Account ID copied to clipboard!"));
  }

  const filtered = facis.filter((f) => {
    const q = search.toUpperCase();
    return (
      String(f.full_name || "").toUpperCase().includes(q) || String(f.section || "").toUpperCase().includes(q)
    );
  });

  return (
    <>
      <div className="top-info-card">
        <div className="info-col">
          <h3>TOTAL FACILITATORS</h3>
          <h4>{stats.total}</h4>
        </div>
        <div className="info-col">
          <h3>ACTIVE SECTIONS</h3>
          <h4>{stats.activeSections}</h4>
        </div>
      </div>

      <div className="search-container">
        <i className="fa-solid fa-magnifying-glass search-icon" />
        <input
          type="text"
          placeholder="Search facilitator name or section..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Facilitator Name</th>
              <th>Assigned Section</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--text-muted)" }}>
                  No assigned facilitators found. Click the + button to assign one.
                </td>
              </tr>
            ) : (
              filtered.map((f) => {
                const { text: lastSeen, isActive } = getLastSeenText(f.last_login);
                return (
                  <tr key={f.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="faci-avatar"
                          src={avatarFor(f)}
                          alt={f.full_name}
                          onClick={() => setPhoto({ src: avatarFor(f), name: f.full_name })}
                          style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(59, 130, 246, 0.3)" }}
                        />
                        <div>
                          <div style={{ fontWeight: 600, color: "var(--text-dark)" }}>{f.full_name}</div>
                          {f.account_id && (
                            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 3, display: "flex", alignItems: "center", gap: 3 }}>
                              <i className="fa-solid fa-id-badge" style={{ fontSize: "0.62rem" }} />
                              <span style={{ fontFamily: "monospace", letterSpacing: "0.02em" }}>{f.account_id}</span>
                              <button className="copy-id-btn" onClick={(e) => copyAccountId(f.account_id, e)} title="Copy Account ID">
                                <i className="fa-regular fa-copy" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td><span className="badge-section">{f.section}</span></td>
                    <td><span className="badge-subject">{f.subject}</span></td>
                    <td>
                      <div className="status-cell">
                        {isActive ? <div className="pulse-dot" /> : <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#9ca3af", flexShrink: 0 }} />}
                        <div style={{ textAlign: "left" }}>
                          <div style={{ color: isActive ? "#16a34a" : "#9ca3af", fontWeight: isActive ? 700 : 600, fontSize: "0.82rem", lineHeight: 1.2 }}>
                            {isActive ? "Active" : "Inactive"}
                          </div>
                          <div style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>{lastSeen}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="action-btns">
                        <button className="action-btn edit" onClick={() => openEdit(f)}>Edit</button>
                        <button className="action-btn delete" onClick={() => setDeleteTarget({ id: f.id, name: f.full_name })}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <button className="fab-add-btn" title="Assign New Facilitator" onClick={openAdd}>
        <i className="fa-solid fa-plus" style={{ fontSize: 22 }} />
      </button>

      {/* Assign/Edit modal */}
      {modal && (
        <div className="modal-overlay" style={{ display: "flex" }}>
          <div className="modal-content">
            <h4 style={{ marginBottom: 20, color: "var(--text-dark)" }}>{editingId ? "Edit Facilitator" : "Assign Facilitator"}</h4>
            <input type="text" className="modal-input" placeholder="Facilitator Full Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className="modal-select" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })}>
              <option value="" disabled>
                {sections.length ? "Select Section to Assign" : "No sections created yet."}
              </option>
              {sections.map((s) => (
                <option key={s.id} value={s.title}>
                  {s.title} ({s.semester || "1st Sem"})
                </option>
              ))}
            </select>
            <div>
              {!editingId && (
                <input type="text" className="modal-input" placeholder="Account ID (e.g. FACI-001)" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} />
              )}
              <input type="text" className="modal-input" placeholder={editingId ? "New Password (leave blank to keep)" : "Password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button onClick={() => setModal(false)} style={{ flex: 1, padding: 12, borderRadius: 8, border: "none", cursor: "pointer", background: "var(--input-bg)", color: "var(--text-dark)", fontWeight: 500 }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ flex: 2, background: "#3b82f6", color: "white", padding: 12, borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600 }}>
                {saving ? "Saving..." : editingId ? "Save" : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="modal-overlay" style={{ display: "flex" }}>
          <div className="modal-content" style={{ maxWidth: 360, textAlign: "center" }}>
            <div style={{ width: 54, height: 54, borderRadius: "50%", background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 15px" }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ color: "#ef4444", fontSize: "1.4rem" }} />
            </div>
            <h4 style={{ marginBottom: 8, color: "var(--text-dark)" }}>Remove Facilitator?</h4>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 22, lineHeight: 1.5 }}>
              <strong style={{ color: "var(--text-dark)" }}>{deleteTarget.name}</strong>&apos;s access will be permanently removed.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setDeleteTarget(null)} style={{ flex: 1, padding: 11, borderRadius: 8, border: "none", cursor: "pointer", background: "var(--input-bg)", color: "var(--text-dark)", fontWeight: 500, fontSize: "0.9rem" }}>Cancel</button>
              <button onClick={confirmDelete} style={{ flex: 1, padding: 11, borderRadius: 8, border: "none", cursor: "pointer", background: "#ef4444", color: "white", fontWeight: 600, fontSize: "0.9rem" }}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Photo viewer */}
      {photo && (
        <div className="photo-viewer-overlay" style={{ display: "flex" }} onClick={() => setPhoto(null)}>
          <div className="photo-viewer-inner" onClick={(e) => e.stopPropagation()}>
            <button className="photo-viewer-close" onClick={() => setPhoto(null)}><i className="fa-solid fa-xmark" /></button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.src} alt="Facilitator Photo" />
            <div className="photo-viewer-name">{photo.name}</div>
          </div>
        </div>
      )}

      <div className={`toast-notification ${toast.err ? "error" : ""} ${toast.show ? "show" : ""}`}>
        <i className={`fa-solid ${toast.err ? "fa-circle-xmark" : "fa-circle-check"}`} />
        <span>{toast.msg}</span>
      </div>
    </>
  );
}
