"use client";

// Per-section class record — the grade spreadsheet (ported from
// class-record(2).html). Columns: 15 Modules + 10 Activities (Written Work),
// AT, PT 1, PT 2, QE. Each cell is a contentEditable that saves on blur to
// POST /api/sections/{id}/class-records (upsert by record id). A Quarter /
// Semester bar mirrors the Section detail page: viewing a non-active quarter
// shows a read-only history; only the active quarter is editable. Includes
// per-student search, live facilitator updates (Supabase realtime), and Excel
// export. There is no computed-grade column here — grades live on Performance.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiPost, apiPatch, cachedGet, invalidateCached } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import { usePageMeta } from "@/lib/page-meta";
import { writeStyledSheet } from "@/lib/export";
import { buildDepedClassRecord, downloadXlsx } from "@/lib/depedTemplate";
import { SkeletonDashWrap, SkeletonTableRows } from "@/components/Skeleton";
import LoadingBar from "@/components/LoadingBar";
import { setSubjectConfigs, componentScores, finalGrade, initialGrade, transmute, displayedTotal, passingFor, isGradeComplete, weightsFor, type ComponentScores } from "@/lib/grading";
import { isOffline, runWhenOnline } from "@/lib/offline";
import "./detail.css";

type Rec = any;

// One card in the student grade-breakdown modal (see quarterBreakdown() below).
type GradeQuarterCard = {
  db: string;
  sem: "1st Sem" | "2nd Sem";
  label: string;
} & (
  | { hasData: true; grade: number; comp: ComponentScores; delta: number | null; inProgress: boolean }
  | { hasData: false; grade: null; comp: null; delta: null }
);

// How many Module columns the grid shows. The database still has module_1..25,
// so raising this back only re-exposes columns that were never dropped; the
// grade only ever counts the module_* values a record actually has.
const MODULE_COUNT = 15;
const MODULES = Array.from({ length: MODULE_COUNT }, (_, i) => `module_${i + 1}`);
const ACTIVITIES = Array.from({ length: 10 }, (_, i) => `activity_${i + 1}`);
const TAIL = ["at", "pt_1", "pt_2", "qe"];
const ALL_SCORE_FIELDS = [...MODULES, ...ACTIVITIES, ...TAIL];
// College sections created before term support stored numeric quarters
// (1,2 in 1st Sem; 3,4 in 2nd Sem). Map those legacy values to the term they
// correspond to so old college sections get proper Prelim/Midterm/Final tabs.
const collegeTermFor = (q: any, sem: string): string => {
  const s = String(q || "").trim();
  if (s === "Prelim" || s === "Midterm" || s === "Final") return s;
  const n = s.replace(/[^1-4]/g, "");
  if (!n) return "Prelim";
  return (
    sem === "2nd Sem"
      ? { "1": "Final", "2": "Final", "3": "Prelim", "4": "Midterm" }
      : { "1": "Prelim", "2": "Midterm", "3": "Final", "4": "Final" }
  )[n] || "Prelim";
};
// Inverse of collegeTermFor: the legacy numeric quarter a record from this
// semester's term would have been stored under (null when there is none).
const legacyNumFor = (term: string, sem: string): string | null => {
  if (sem === "2nd Sem") return term === "Prelim" ? "3" : term === "Midterm" ? "4" : null;
  return term === "Prelim" ? "1" : term === "Midterm" ? "2" : null;
};
const normQ = (q: any, college?: boolean, sem: string = "1st Sem") => {
  if (college) return collegeTermFor(q, sem);
  return q ? String(q).replace(/[^1-4]/g, "") || "1" : "1";
};

// Db `quarter` is 1..4 across the whole school year; 1-2 belong to 1st Sem and
// 3-4 to 2nd Sem (mirrors activateSemester()'s "2nd Sem starts at quarter 3").
// Each entry is one card in the student grade-breakdown modal.
const GRADE_QUARTERS: { db: string; sem: "1st Sem" | "2nd Sem"; label: string }[] = [
  { db: "1", sem: "1st Sem", label: "Q1" },
  { db: "2", sem: "1st Sem", label: "Q2" },
  { db: "3", sem: "2nd Sem", label: "Q1" },
  { db: "4", sem: "2nd Sem", label: "Q2" },
];
// College uses three terms per semester instead of two quarters. Terms repeat
// across semesters (Prelim/Midterm/Final both semesters), so a college
// breakdown only spans the CURRENT semester to avoid ambiguous matches.
const COLLEGE_TERMS: { db: string; label: string }[] = [
  { db: "Prelim", label: "Prelim" },
  { db: "Midterm", label: "Midterm" },
  { db: "Final", label: "Final" },
];
const isCollegeTerm = (v: string) => v === "Prelim" || v === "Midterm" || v === "Final";
// Unlike normQ (used for the single active grid view), this does NOT default a
// missing quarter to "1" — needed to tell "genuinely untagged legacy record"
// apart from "a real Q1 record" when building the multi-quarter breakdown.
const exactQ = (q: any): string | null => {
  if (q === null || q === undefined || q === "") return null;
  const s = String(q);
  if (isCollegeTerm(s)) return s;
  return s.replace(/[^1-4]/g, "") || null;
};
const isFilled = (v: any) => v !== null && v !== undefined && v !== "";
const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

// ── Grid helpers (spreadsheet keyboard nav + paste). Pure DOM, client-only. ──
const fieldLabel = (field: string): string => {
  if (field.startsWith("module_")) return "M" + field.slice(7);
  if (field.startsWith("activity_")) return "A" + field.slice(9);
  return { at: "AT", pt_1: "PT 1", pt_2: "PT 2", qe: "QE" }[field] || field;
};
const cellEl = (sid: string, field: string): HTMLElement | null =>
  typeof document === "undefined"
    ? null
    : document.querySelector<HTMLElement>(
        `#recordTable td[data-sid="${CSS.escape(sid)}"][data-field="${CSS.escape(field)}"]`
      );
const flashCell = (el: HTMLElement | null, kind: "ok" | "err") => {
  if (!el) return;
  el.style.backgroundColor = kind === "ok" ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)";
  setTimeout(() => (el.style.backgroundColor = "transparent"), 1000);
};
const focusEl = (el: HTMLElement | null) => {
  if (!el) return;
  el.focus();
  try {
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  } catch {}
};
// Caret at the very start / end of a single-line cell → arrow keys jump cells
// instead of moving the caret within the text.
const caretAtBoundary = (el: HTMLElement, atEnd: boolean): boolean => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return true;
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return false;
  return atEnd ? r.startOffset === (el.textContent || "").length : r.startOffset === 0;
};
// Same column, next/previous *visible* student row.
const siblingRowCell = (cur: HTMLElement, field: string, dir: 1 | -1): HTMLElement | null => {
  const tr = cur.closest("tr");
  if (!tr) return null;
  let row = (dir > 0 ? tr.nextElementSibling : tr.previousElementSibling) as HTMLElement | null;
  while (row && (row.style.display === "none" || !row.classList.contains("student-data-row")))
    row = (dir > 0 ? row.nextElementSibling : row.previousElementSibling) as HTMLElement | null;
  return row ? row.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`) : null;
};
// Same row, next/previous editable score cell.
const siblingFieldCell = (cur: HTMLElement, dir: 1 | -1): HTMLElement | null => {
  let el = (dir > 0 ? cur.nextElementSibling : cur.previousElementSibling) as HTMLElement | null;
  while (el && !el.getAttribute("data-field"))
    el = (dir > 0 ? el.nextElementSibling : el.previousElementSibling) as HTMLElement | null;
  return el;
};

export default function ClassRecordGridPage() {
  const params = useParams<{ id: string }>();
  const sectionId = params.id;

  const [section, setSection] = useState<any>(null);
  const [college, setCollege] = useState(false);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  const [records, setRecords] = useState<Rec[]>([]);
  const recordsRef = useRef<Rec[]>([]);
  const [detailStudent, setDetailStudent] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ show: boolean; msg: string; err: boolean }>({ show: false, msg: "", err: false });

  // Bumps only on (re)load and quarter/semester view change → forces the
  // uncontrolled cells to remount with fresh values. Per-cell saves never bump
  // it, so they can't clobber an in-progress edit elsewhere in the grid.
  const [dataVersion, setDataVersion] = useState(0);

  const [currentQuarter, setCurrentQuarter] = useState("1");
  const [viewQuarter, setViewQuarter] = useState("1");
  const [currentSemester, setCurrentSemester] = useState("1st Sem");
  const [viewSemester, setViewSemester] = useState("1st Sem");
  const [activatingQ, setActivatingQ] = useState(false);
  const [activatingS, setActivatingS] = useState(false);

  const lastLocalSave = useRef(0);

  // Undo history: each edit / paste pushes ONE set of prior values; Ctrl+Z pops
  // and restores it. doUndoRef lets a stable document listener call the latest
  // closure (which reads current quarter / records) without going stale.
  const undoStack = useRef<{ items: { sid: string; field: string; value: string }[]; label: string }[]>([]);
  const doUndoRef = useRef<() => void>(() => {});

  // Manual save: every edited cell is STAGED here (keyed `sid|field`) with the
  // value to write and the last-SAVED value for undo. Nothing hits the server
  // until "Save Scores" is pressed. dirtyCount mirrors the map size so the Save
  // button + unsaved badge re-render; `saving` disables the button mid-post.
  const pendingRef = useRef<Map<string, { sid: string; field: string; value: string; oldVal: string }>>(new Map());
  const [dirtyCount, setDirtyCount] = useState(0);
  const [saving, setSaving] = useState(false);

  function showToast(msg: string, err = false) {
    setToast({ show: true, msg, err });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 4000);
  }

  // Warn before a tab close / refresh drops staged-but-unsaved scores.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyCount]);

  const commitRecords = useCallback((next: Rec[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  const loadDetails = useCallback(async (fresh = false) => {
    try {
      const r = await cachedGet(fresh ? null : `sec_${sectionId}`, `/api/sections/${sectionId}`);
      const sec = r.section;
      setSection(sec);
      const cs = sec.semester || "1st Sem";
      setCurrentSemester(cs);
      setViewSemester(cs);
      const cq = normQ(sec.quarter, sec.school_level === "College", cs);
      setCurrentQuarter(cq);
      setViewQuarter(cq);
      setCollege(sec.school_level === "College");
    } catch {
      showToast("Unauthorized or Section not found", true);
    }
  }, [sectionId]);

  const loadStudents = useCallback(async (fresh = false) => {
    try {
      const r = await cachedGet(fresh ? null : `stud_${sectionId}`, `/api/sections/${sectionId}/students`);
      setStudents(r.students || []);
    } catch {}
  }, [sectionId]);

  // Signature of the last records we rendered, so a poll/focus/realtime reload
  // that returns identical data doesn't remount every cell (and jump the
  // teacher's scroll or cursor). Sorted by id so a non-deterministic row order
  // from the DB can't look like a change.
  const lastRecordsSig = useRef<string>("");
  const loadRecords = useCallback(async (fresh = false) => {
    // Never clobber the grid while the teacher has unsaved staged edits — a
    // poll/reload here would replace them with the DB values and make the
    // typed scores "disappear" (they'd still be pending for Save, but the
    // grid would show empty cells). Reloads resume once Save clears the
    // pending map.
    if (pendingRef.current.size > 0) return;
    try {
      const r = await cachedGet(fresh ? null : `rec_${sectionId}`, `/api/sections/${sectionId}/class-records`);
      const rows = r.records || [];
      const sig = JSON.stringify([...rows].sort((a: Rec, b: Rec) => String(a.id).localeCompare(String(b.id))));
      if (sig === lastRecordsSig.current) return; // nothing changed — don't churn the grid
      lastRecordsSig.current = sig;
      commitRecords(rows);
      setDataVersion((v) => v + 1);
    } catch {}
  }, [sectionId, commitRecords]);

  // Grade weights, so the per-student breakdown modal computes the SAME final
  // grade the Performance page would show — not essential to the spreadsheet
  // itself, so it fails silently (falls back to default weights).
  const loadGradingInputs = useCallback(async () => {
    try {
      const subj = await cachedGet("subjects", `/api/subjects`);
      setSubjectConfigs(subj.subjects || []);
    } catch {}
  }, []);

  useEffect(() => {
    // Pure real progress: the bar advances one step for each of the four data
    // loads as it actually finishes, so it fills at the true speed of the
    // connection (no faked trickle) and hits 100% exactly when the page is ready.
    const tasks = [loadDetails, loadStudents, loadRecords, loadGradingInputs];
    let done = 0;
    setLoadProgress(0);
    Promise.allSettled(
      tasks.map((t) =>
        Promise.resolve(t()).finally(() => {
          done += 1;
          setLoadProgress(Math.round((done / tasks.length) * 100));
        })
      )
    ).then(() => {
      setLoading(false);
      // The initial records load reads the ≤20s localStorage cache for an instant
      // paint; follow it with one fresh read so a grid opened right after a
      // facilitator submitted shows the new scores immediately, not a poll-cycle
      // later. The signature guard makes this a no-op when nothing changed.
      loadRecords(true);
    });
  }, [loadDetails, loadStudents, loadRecords, loadGradingInputs]);

  // Live roster updates: a student added/edited/removed elsewhere reflects
  // here (columns are per-student rows). No-op if realtime isn't enabled.
  useEffect(() => {
    let channel: any;
    try {
      channel = getSupabase()
        .channel("teacher-cr-roster-" + sectionId)
        .on("postgres_changes", { event: "*", schema: "public", table: "students" }, (payload: any) => {
          const row = payload.new || payload.old;
          if (String(row?.section_id) !== String(sectionId)) return;
          loadStudents(true);
        })
        .subscribe();
    } catch {}
    return () => {
      try {
        if (channel) getSupabase().removeChannel(channel);
      } catch {}
    };
  }, [sectionId, loadStudents]);

  // Live facilitator updates: reload when this section's records change
  // elsewhere. Skipped briefly after our own writes to avoid a self-triggered
  // reload that would remount cells mid-edit. No-op if realtime isn't enabled.
  useEffect(() => {
    let channel: any;
    try {
      channel = getSupabase()
        .channel("teacher-class-records-" + sectionId)
        .on("postgres_changes", { event: "*", schema: "public", table: "class_records" }, (payload: any) => {
          const rec = payload.new || payload.old;
          const sid = rec?.section_id;
          if (String(sid) !== String(sectionId)) return;
          if (Date.now() - lastLocalSave.current < 2000) return;
          if (pendingRef.current.size > 0) return; // keep unsaved edits; they win until Saved
          loadRecords(true);
          loadGradingInputs(); // weights/attendance may have changed too — keep modal grades aligned
          showToast("Records have been updated by a Facilitator!");
        })
        .subscribe();
    } catch {}
    return () => {
      try {
        if (channel) getSupabase().removeChannel(channel);
      } catch {}
    };
  }, [sectionId, loadRecords]);

  // Polling fallback: if Supabase realtime isn't enabled for this DB the page
  // would never notice facilitator submissions. Refresh every 20s while the
  // tab is visible — the backend cache is invalidated by the push webhook, so
  // these reads always return the latest scores.
  useEffect(() => {
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadRecords(true);
        loadGradingInputs();
      }
    }, 20000);
    return () => clearInterval(poll);
  }, [loadRecords, loadGradingInputs]);

  // Refresh the instant this tab is looked at again. The common case is a
  // facilitator submitting scores from their phone while the teacher has this
  // page open in a background tab: the 20s poll is paused while hidden and a
  // realtime event can be missed, so without this the grid can sit stale until
  // the teacher happens to reload. Firing on both visibilitychange and window
  // focus covers tab-switching and app-switching alike; the signature guard in
  // loadRecords keeps a no-change refresh from disturbing the grid.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden") {
        loadRecords(true);
        loadGradingInputs();
      }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [loadRecords, loadGradingInputs]);

  // Ctrl/Cmd+Z anywhere on the page → undo the last score change. A focused
  // grid cell handles it first (and preventDefaults); this catches the case
  // where focus has left the grid. Never hijacks undo inside a text input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      if (e.defaultPrevented) return; // a grid cell already handled it
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (undoStack.current.length === 0) return;
      e.preventDefault();
      doUndoRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const quarterLocked = String(viewQuarter) !== String(currentQuarter);
  const semesterLocked = viewSemester !== currentSemester;
  // Width of the grid in columns, for the "no students" / skeleton rows: the 3
  // sticky columns (#, ID, Name) + Modules + 10 Activities + AT/PT 1/PT 2/QE
  // (senior high only) + TOTAL and GRADE.
  const gridColSpan = 3 + MODULE_COUNT + 10 + (college ? 0 : 4) + 3;
  const quarterTabs = college ? COLLEGE_TERMS.map((t) => t.db) : ["1", "2", "3", "4"];
  const qLabel = (q: string) => (college ? q : `Q${q}`);

  // Record shown for a student in the viewed quarter (falls back to a legacy
  // quarter-less row), matching the original createRow() lookup.
  const recForView = useCallback(
    (sid: string) => {
      const legacy = college ? legacyNumFor(String(viewQuarter), viewSemester) : null;
      return (
        records.find((r) => r.student_id === sid && String(r.quarter) === String(viewQuarter)) ||
        (legacy ? records.find((r) => r.student_id === sid && String(r.quarter) === legacy) : undefined) ||
        records.find((r) => r.student_id === sid && (r.quarter === null || r.quarter === undefined)) ||
        null
      );
    },
    [records, viewQuarter, viewSemester, college]
  );

  // One card per quarter for the grade-breakdown modal: each quarter's OWN
  // record only (never merged across quarters, unlike the Performance page's
  // single "current" snapshot) so a genuine Q1→Q2→Q3→Q4 progression shows.
  // A pre-quarter-tagging legacy record (quarter is null) has no quarter of its
  // own, so it's shown under Q1 — the one existing fallback recForView() also
  // uses — rather than appearing (identically) under all four cards.
  function quarterBreakdown(sid: string, fullName: string): GradeQuarterCard[] {
    const subjectName = section?.subject || "";
    const src = college
      ? COLLEGE_TERMS.map((t) => ({ ...t, sem: (viewSemester || "1st Sem") as "1st Sem" | "2nd Sem" }))
      : GRADE_QUARTERS;
    const cards: GradeQuarterCard[] = src.map((dq) => {
      const rec =
        records.find((r) => r.student_id === sid && (college ? collegeTermFor(r.quarter, dq.sem) === dq.db : exactQ(r.quarter) === dq.db)) ||
        ((dq.db === "1" || (college && dq.db === "Prelim")) ? records.find((r) => r.student_id === sid && exactQ(r.quarter) === null) : undefined);
      const hasData = !!rec && ALL_SCORE_FIELDS.some((f) => isFilled(rec[f]));
      if (!hasData) return { ...dq, hasData: false as const, grade: null, comp: null, delta: null };
      const comp = componentScores(rec, subjectName);
      const grade = finalGrade(rec, subjectName);
      return { ...dq, hasData: true as const, grade, comp, delta: null, inProgress: !isGradeComplete(rec, subjectName) };
    });
    // Quarter-over-quarter change, only between consecutive quarters that both
    // have real data (so a gap — e.g. Q2 skipped — doesn't produce a delta).
    let prevGrade: number | null = null;
    for (const c of cards) {
      if (!c.hasData) continue;
      if (prevGrade !== null) c.delta = c.grade - prevGrade;
      prevGrade = c.grade;
    }
    return cards;
  }

  // Discards any staged-but-unsaved scores (the view reloads), so confirm first.
  function confirmDropUnsaved(): boolean {
    if (pendingRef.current.size === 0) return true;
    if (!window.confirm("You have unsaved scores. Switching will discard them. Switch anyway?")) return false;
    pendingRef.current.clear();
    setDirtyCount(0);
    return true;
  }

  function setViewQuarterAndReload(q: string) {
    if (!confirmDropUnsaved()) return;
    setViewQuarter(q);
    setDataVersion((v) => v + 1);
  }
  function setViewSemesterOnly(sem: string) {
    if (!confirmDropUnsaved()) return;
    setViewSemester(sem);
  }

  async function activateQuarter() {
    if (quarterLocked && !window.confirm(`Switch active quarter to ${qLabel(viewQuarter)}? Past records stay saved.`)) return;
    setActivatingQ(true);
    try {
      await apiPatch(`/api/sections/${sectionId}`, { quarter: viewQuarter });
      invalidateCached(`sec_${sectionId}`);
      setCurrentQuarter(viewQuarter);
      setDataVersion((v) => v + 1);
      showToast(`Section updated to ${qLabel(viewQuarter)}!`);
    } catch {
      showToast("Failed to update quarter.", true);
    } finally {
      setActivatingQ(false);
    }
  }

  async function activateSemester() {
    const newQuarter = viewSemester === "1st Sem" ? (college ? "Prelim" : "1") : college ? "Prelim" : "3";
    if (semesterLocked && !window.confirm(`Switch to ${viewSemester}? Quarter will reset to ${qLabel(newQuarter)}. Past records stay saved.`)) return;
    setActivatingS(true);
    try {
      await apiPatch(`/api/sections/${sectionId}`, { semester: viewSemester, quarter: newQuarter });
      invalidateCached(`sec_${sectionId}`);
      setCurrentSemester(viewSemester);
      setCurrentQuarter(newQuarter);
      setViewQuarter(newQuarter);
      setDataVersion((v) => v + 1);
      showToast(`Section updated to ${viewSemester}!`);
    } catch {
      showToast("Failed to update semester.", true);
    } finally {
      setActivatingS(false);
    }
  }

  // ── Manual save ───────────────────────────────────────────────────────────
  // Edits are STAGED locally (optimistic — the row's GRADE and the live preview
  // update at once) and only written to the server when "Save Scores" is
  // pressed. This keeps score entry smooth instead of firing a network
  // round-trip every time you leave a cell.

  // Record an edited cell in the pending map (or drop it when it's back to its
  // saved value). `savedVal` — the last SAVED value — is only used the FIRST
  // time a cell becomes dirty, so undo/Save always restore the right baseline
  // even after several edits to the same cell before saving.
  function markPending(sid: string, field: string, value: string, savedVal: string) {
    const key = `${sid}|${field}`;
    const prev = pendingRef.current.get(key);
    const originalOld = prev ? prev.oldVal : savedVal;
    if (value === originalOld) pendingRef.current.delete(key);
    else pendingRef.current.set(key, { sid, field, value, oldVal: originalOld });
    setDirtyCount(pendingRef.current.size);
  }

  // Apply one edit to the in-memory records array (no network). Mutates `arr`.
  function applyLocalScore(arr: Rec[], sid: string, field: string, value: string) {
    const activeQ = currentQuarter;
    const val: any = value === "" ? null : value;
    const legacyQ = college ? legacyNumFor(String(activeQ), currentSemester) : null;
    const existing =
      arr.find((r) => r.student_id === sid && String(r.quarter) === String(activeQ)) ||
      (legacyQ ? arr.find((r) => r.student_id === sid && String(r.quarter) === legacyQ) : undefined) ||
      arr.find((r) => r.student_id === sid && (r.quarter === null || r.quarter === undefined));
    const id = existing?.id || newId();
    const quarterToSave = existing && existing.quarter != null ? existing.quarter : activeQ;
    let idx = arr.findIndex((r) => r.id === id);
    if (idx < 0) idx = arr.findIndex((r) => r.student_id === sid && String(r.quarter) === String(quarterToSave));
    if (idx >= 0) arr[idx] = { ...arr[idx], id, [field]: val, quarter: quarterToSave };
    else arr.push({ id, student_id: sid, section_id: sectionId, quarter: quarterToSave, [field]: val });
  }

  // Stage a single edited cell — fired on blur / spreadsheet navigation.
  function stageScore(sid: string, field: string, cell: HTMLTableCellElement) {
    const newValue = cell.innerText.trim();
    const oldVal = cell.dataset.oldVal ?? "";
    if (newValue === oldVal) return;
    if (quarterLocked) return; // never write to a non-active quarter
    if (newValue !== "" && isNaN(Number(newValue))) {
      cell.innerText = oldVal;
      showToast("Please enter numbers only.", true);
      return;
    }
    const rec = recForView(sid);
    const savedVal = rec && isFilled(rec[field]) ? String(rec[field]) : "";
    const arr = recordsRef.current.slice();
    applyLocalScore(arr, sid, field, newValue);
    commitRecords(arr);
    cell.dataset.oldVal = newValue;
    markPending(sid, field, newValue, savedVal);
  }

  // Stage many cells at once (Excel paste, or an undo that restores several) —
  // same optimistic local update, batched; the write still waits for Save.
  function stageMany(entries: { sid: string; field: string; value: string }[]) {
    if (quarterLocked || entries.length === 0) return;
    const arr = recordsRef.current.slice();
    const savedByKey: Record<string, string> = {};
    for (const { sid, field } of entries) {
      const key = `${sid}|${field}`;
      if (key in savedByKey) continue;
      const rec =
        arr.find((r) => r.student_id === sid && String(r.quarter) === String(currentQuarter)) ||
        arr.find((r) => r.student_id === sid && (r.quarter === null || r.quarter === undefined));
      savedByKey[key] = rec && isFilled(rec[field]) ? String(rec[field]) : "";
    }
    for (const { sid, field, value } of entries) applyLocalScore(arr, sid, field, value);
    commitRecords(arr);
    for (const { sid, field, value } of entries) {
      const el = cellEl(sid, field);
      if (el) {
        el.innerText = value;
        el.dataset.oldVal = value;
      }
      markPending(sid, field, value, savedByKey[`${sid}|${field}`]);
    }
  }

  // Write every staged edit to the server in ONE batch (grouped per student).
  // On success the pending set clears and the batch goes on the undo stack; on
  // failure the edits stay staged so the facilitator can just press Save again.
  async function savePending() {
    if (quarterLocked) {
      showToast("Switch to the active quarter to save.", true);
      return;
    }
    const entries = Array.from(pendingRef.current.values());
    if (entries.length === 0) {
      showToast("No new scores to save.");
      return;
    }
    setSaving(true);
    const activeQ = currentQuarter;
    const byStudent: Record<string, { id: string; quarter: any; scores: Record<string, any> }> = {};
    const undoItems: { sid: string; field: string; value: string }[] = [];
    for (const { sid, field, value, oldVal } of entries) {
      const legacyQ = college ? legacyNumFor(String(activeQ), currentSemester) : null;
      const existing =
        recordsRef.current.find((r) => r.student_id === sid && String(r.quarter) === String(activeQ)) ||
        (legacyQ ? recordsRef.current.find((r) => r.student_id === sid && String(r.quarter) === legacyQ) : undefined) ||
        recordsRef.current.find((r) => r.student_id === sid && (r.quarter === null || r.quarter === undefined));
      const id = existing?.id || byStudent[sid]?.id || newId();
      const quarterToSave = existing && existing.quarter != null ? existing.quarter : activeQ;
      if (!byStudent[sid]) byStudent[sid] = { id, quarter: quarterToSave, scores: {} };
      byStudent[sid].scores[field] = value === "" ? null : value;
      undoItems.push({ sid, field, value: oldVal });
    }
    try {
      const payload = Object.entries(byStudent).map(([sid, p]) => ({
        id: p.id,
        student_id: sid,
        quarter: p.quarter,
        scores: p.scores,
      }));
      await apiPost(`/api/sections/${sectionId}/class-records`, payload);
      invalidateCached(`rec_${sectionId}`);
      lastLocalSave.current = Date.now();
      for (const { sid, field } of entries) flashCell(cellEl(sid, field), "ok");
      undoStack.current.push({
        items: undoItems,
        label: entries.length > 1 ? `${entries.length} scores` : `${students.find((x) => x.id === entries[0].sid)?.full_name || "score"} · ${fieldLabel(entries[0].field)}`,
      });
      pendingRef.current.clear();
      setDirtyCount(0);
      showToast(`Saved ${entries.length} score${entries.length === 1 ? "" : "s"}.`);
    } catch (e: any) {
      // Offline: keep the edits staged (pendingRef still holds them, cells still
      // show their pending markers) and re-run this exact save automatically when
      // the connection returns. Reusing savePending itself — rather than a second
      // write path — means there's nothing new to keep in sync and the retry is
      // idempotent (records upsert by id).
      if (isOffline()) {
        runWhenOnline("class-record-save", () => savePending());
        showToast("Offline — your scores will save automatically when you reconnect.");
      } else {
        for (const { sid, field } of entries) flashCell(cellEl(sid, field), "err");
        const status = e?.status;
        const detail = e?.message;
        const msg = status
          ? "Failed to save (" + status + "): " + (detail || "server error")
          : "Failed to save. Check your connection, CORS, or permissions.";
        showToast(msg, true);
      }
    } finally {
      setSaving(false);
    }
  }

  function doUndo() {
    if (quarterLocked) return showToast("Switch to the active quarter to undo.", true);
    const set = undoStack.current.pop();
    if (!set) return showToast("Nothing to undo.");
    stageMany(set.items);
    showToast(`Undid: ${set.label} — press Save to keep it.`);
  }

  // Spreadsheet-style keyboard navigation between editable cells.
  function handleGridKeyDown(e: ReactKeyboardEvent<HTMLTableCellElement>, field: string) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      doUndo();
      return;
    }
    if (quarterLocked) return;
    const cur = e.currentTarget;
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = siblingRowCell(cur, field, 1);
      cur.blur(); // fires onBlur → stageScore
      focusEl(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = siblingRowCell(cur, field, -1);
      cur.blur();
      focusEl(next);
    } else if (e.key === "ArrowRight" && caretAtBoundary(cur, true)) {
      const next = siblingFieldCell(cur, 1);
      if (next) {
        e.preventDefault();
        cur.blur();
        focusEl(next);
      }
    } else if (e.key === "ArrowLeft" && caretAtBoundary(cur, false)) {
      const next = siblingFieldCell(cur, -1);
      if (next) {
        e.preventDefault();
        cur.blur();
        focusEl(next);
      }
    }
  }

  // Paste a block copied from Excel/Sheets: rows split on newlines (→ students),
  // columns on tabs (→ score fields), starting at the pasted cell. Non-numeric
  // cells are skipped so a stray header/name doesn't land in a score box.
  function handleGridPaste(e: ReactClipboardEvent<HTMLTableCellElement>, field: string) {
    if (quarterLocked) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!text) return;
    e.preventDefault();
    const matrix = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n").map((l) => l.split("\t"));

    const startTr = e.currentTarget.closest("tr");
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("#recordTable tbody tr.student-data-row")
    ).filter((r) => r.style.display !== "none");
    const startRowIdx = startTr ? rows.indexOf(startTr as HTMLElement) : -1;
    const startFieldIdx = ALL_SCORE_FIELDS.indexOf(field);
    if (startRowIdx < 0 || startFieldIdx < 0) return;

    const entries: { sid: string; field: string; value: string }[] = [];
    for (let r = 0; r < matrix.length; r++) {
      const targetRow = rows[startRowIdx + r];
      if (!targetRow) break;
      const tsid = targetRow.querySelector<HTMLElement>("[data-sid]")?.getAttribute("data-sid");
      if (!tsid) continue;
      for (let c = 0; c < matrix[r].length; c++) {
        const f = ALL_SCORE_FIELDS[startFieldIdx + c];
        if (!f) break;
        const raw = (matrix[r][c] ?? "").trim();
        if (raw !== "" && isNaN(Number(raw))) continue; // skip non-numeric
        entries.push({ sid: tsid, field: f, value: raw });
      }
    }
    if (entries.length) {
      stageMany(entries);
      showToast(`Pasted ${entries.length} score${entries.length === 1 ? "" : "s"} — press Save to keep ${entries.length === 1 ? "it" : "them"}.`);
    }
  }

  // Live final grade for the viewed quarter (null when the row has no scores).
  function liveGradeFor(sid: string): number | null {
    const rec = recForView(sid);
    if (!rec || !ALL_SCORE_FIELDS.some((f) => isFilled(rec[f]))) return null;
    return finalGrade(rec, section?.subject || "");
  }

  // Live initial grade for the viewed quarter.
  function liveInitialGradeFor(sid: string): number | null {
    const rec = recForView(sid);
    if (!rec || !ALL_SCORE_FIELDS.some((f) => isFilled(rec[f]))) return null;
    return Math.round(initialGrade(rec, section?.subject || "") * 100) / 100;
  }

  // Raw point total for the viewed quarter: every entered score added up
  // (all 15 modules + 10 activities + AT + PT 1 + PT 2 + QE). null when the
  // student has no scores yet, so the cell shows "—" like the GRADE column.
  function totalScoreFor(sid: string): number | null {
    const rec = recForView(sid);
    if (!rec) return null;
    let sum = 0;
    let any = false;
    for (const f of ALL_SCORE_FIELDS) {
      if (!isFilled(rec[f])) continue;
      const n = Number(rec[f]);
      if (isFinite(n)) {
        sum += n;
        any = true;
      }
    }
    return any ? Math.round(sum * 100) / 100 : null;
  }

  async function exportExcel() {
    if (loading || students.length === 0) {
      showToast(
        loading
          ? "Still loading — wait for the class record to appear, then export."
          : "Nothing to export: no students are loaded for this section. Reload the page and try again.",
        true,
      );
      return;
    }
    try {
      showToast("Generating Excel...");
      const sectionName = section?.title || "Section";
      const subjectName = section?.subject || "";
      const w = weightsFor(subjectName);
      const rows: any[][] = [];

      // Row 1-2: School info header
      rows.push([`SCHOOL NAME:`, ``, `SCHOOL ID:`, ``, `SCHOOL YEAR:`, ``]);
      rows.push([``, `GRADE & SECTION: ${sectionName}`, ``, `TEACHER:`, ``, `SUBJECT: ${subjectName}`]);
      rows.push([``, `SEMESTER: ${currentSemester}`, ``, ``, ``, `QUARTER: ${qLabel(currentQuarter)}`]);
      rows.push([]);

      // Row 4: Component headers with weights
      const wwWeight = w.ww;
      const ptWeight = w.pt;
      const examWeight = w.exam;
      rows.push([
        "LEARNERS' NAMES", "ID Number",
        `WRITTEN WORK (${wwWeight}%)`, "", "", "", "", "", "", "", "", "", "", "",
        `PERFORMANCE TASKS (${ptWeight}%)`, "", "", "", "", "", "", "", "", "", "",
        `QUARTERLY ASSESSMENT (${examWeight}%)`, "", "", "", "",
        "Initial Grade", "Quarterly Grade"
      ]);

      // Row 5: Sub-headers
      const wwCols = Array.from({ length: 10 }, (_, i) => String(i + 1));
      const ptCols = Array.from({ length: 10 }, (_, i) => String(i + 1));
      rows.push([
        "", "",
        ...wwCols, "Total", "PS", "WS",
        ...ptCols, "Total", "PS", "WS",
        "AT", "QE", "Total", "PS", "WS",
        "", ""
      ]);

      // Row 6: Highest Possible Score
      const wwPerfect = w.wwTotal || 100;
      const ptPerfect = w.ptTotal || 100;
      const examPerfect = w.examTotal || 100;
      rows.push([
        "HIGHEST POSSIBLE SCORE", "",
        ...Array(10).fill(""),
        wwPerfect, "100.00", `${wwWeight}%`,
        ...Array(10).fill(""),
        ptPerfect, "100.00", `${ptWeight}%`,
        "50", "50", examPerfect, "100.00", `${examWeight}%`,
        "", ""
      ]);

      // Student rows
      students.forEach((s) => {
        const rec = recForView(s.id);
        const cs = rec ? componentScores(rec, subjectName) : null;

        // Written Work columns (1-10): first 10 module/activity fields
        const wwValues: any[] = [];
        for (let i = 1; i <= 10; i++) {
          const moduleVal = rec ? rec[`module_${i}`] : null;
          const activityVal = rec ? rec[`activity_${i}`] : null;
          const m = moduleVal !== null && moduleVal !== undefined && moduleVal !== "" ? Number(moduleVal) : 0;
          const a = activityVal !== null && activityVal !== undefined && activityVal !== "" ? Number(activityVal) : 0;
          wwValues.push(m + a > 0 ? m + a : "");
        }
        const wwTotal = cs ? Math.round(cs.rawWW * 100) / 100 : 0;
        const wwPS = cs ? cs.wwPct.toFixed(2) : "0.00";
        const wwWS = cs ? cs.wwWS.toFixed(2) : "0.00";

        // Performance Tasks columns (1-10): pt_1 through pt_10
        const ptValues: any[] = [];
        for (let i = 1; i <= 10; i++) {
          const ptVal = rec ? rec[`pt_${i}`] : null;
          ptValues.push(ptVal !== null && ptVal !== undefined && ptVal !== "" ? ptVal : "");
        }
        const ptTotal = cs ? Math.round(cs.rawPT * 100) / 100 : 0;
        const ptPS = cs ? cs.ptPct.toFixed(2) : "0.00";
        const ptWS = cs ? cs.ptWS.toFixed(2) : "0.00";

        // Quarterly Assessment
        const atVal = rec && rec.at !== null && rec.at !== undefined && rec.at !== "" ? rec.at : "";
        const qeVal = rec && rec.qe !== null && rec.qe !== undefined && rec.qe !== "" ? rec.qe : "";
        const examTotal = cs ? Math.round(cs.rawExam * 100) / 100 : 0;
        const examPS = cs ? cs.examPct.toFixed(2) : "0.00";
        const examWS = cs ? cs.examWS.toFixed(2) : "0.00";

        // Initial Grade and Quarterly Grade
        const ig = rec ? (Math.round(initialGrade(rec, subjectName) * 100) / 100) : null;
        const qg = liveGradeFor(s.id);

        const row = [
          s.full_name || "", s.id_no || "",
          ...wwValues, wwTotal, wwPS, wwWS,
          ...ptValues, ptTotal, ptPS, ptWS,
          atVal, qeVal, examTotal, examPS, examWS,
          ig !== null ? ig.toFixed(2) : "",
          qg !== null ? qg : ""
        ];
        rows.push(row);
      });

      await writeStyledSheet(rows, {
        sheetName: "Class Record",
        headerRow: 3,
        fileName: `Class_Record_${sectionName.replace(/\s+/g, "_")}.xlsx`,
      });
      showToast("Class Record exported successfully!");
    } catch (e: any) {
      showToast("Export failed: " + (e?.message || e), true);
    }
  }

  // Fill the official DepEd SHS E-Class-Record workbook (logos, formulas and
  // transmutation table intact) with the entered scores — both quarters of the
  // active semester — so the teacher just opens it and views the finished form.
  async function exportDepedForm() {
    if (loading || students.length === 0) {
      showToast(
        loading
          ? "Still loading — wait for the class record to appear, then export."
          : "Nothing to export: no students are loaded for this section. Reload the page and try again.",
        true,
      );
      return;
    }
    try {
      showToast("Generating DepEd form...");
      const teacherName =
        (typeof localStorage !== "undefined" && localStorage.getItem("cached_user_name")) || "";
      const bytes = await buildDepedClassRecord({
        students,
        records,
        semester: currentSemester,
        subject: section?.subject || "",
        sectionTitle: section?.title || "",
        teacherName,
      });
      const safe = (section?.title || "Section").replace(/\s+/g, "_");
      downloadXlsx(bytes, `DepEd_Class_Record_${safe}.xlsx`);
      showToast("DepEd form generated!");
    } catch (e: any) {
      showToast("DepEd form failed: " + (e?.message || e), true);
    }
  }

  const exportBtn = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <button className="export-btn" onClick={exportExcel}>
        <i className="fa-solid fa-file-excel" /> Export Excel
      </button>
      {!college && (
        <button className="export-btn" onClick={exportDepedForm} title="Fill the official DepEd class-record form with these scores">
          <i className="fa-solid fa-file-lines" /> DepEd Form
        </button>
      )}
    </div>
  );

  usePageMeta("Class Record", section?.title ? `Section: ${section.title}` : undefined, exportBtn);

  // Two-finger trackpad swipe scrolls the grid sideways, so reaching for the
  // scrollbar at the bottom isn't the only way across 30-odd columns.
  //
  // The container is already `overflow-x: auto`, but a browser hands a sideways
  // trackpad gesture to history navigation ("swipe to go back") unless the
  // element under the pointer claims it — so take deltaX and preventDefault.
  // React attaches onWheel passively, where preventDefault is ignored, hence the
  // native listener. Re-runs on the key that remounts the container.
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Sideways intent only: a horizontal swipe, or Shift + wheel. A plain
      // vertical scroll must still scroll the page, not the grid.
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!dx) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = Math.min(Math.max(el.scrollLeft + dx, 0), max);
      if (next === el.scrollLeft) return; // already at that edge — let it through
      el.scrollLeft = next;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewSemester, viewQuarter]);

  const searchLower = search.toLowerCase();
  doUndoRef.current = doUndo; // keep the document Ctrl+Z listener on the latest closure

  function ScoreCell({ sid, field, divider }: { sid: string; field: string; divider?: boolean }) {
    const rec = recForView(sid);
    const v = rec ? rec[field] : null;
    const display = v === null || v === undefined || v === "" ? "" : String(v);
    const cls = "editable-score" + (divider ? " group-divider" : "") + (quarterLocked ? " locked" : "");
    return (
      <td
        key={`${sid}-${field}-${dataVersion}`}
        className={cls}
        data-field={field}
        data-sid={sid}
        tabIndex={quarterLocked ? undefined : 0}
        contentEditable={!quarterLocked}
        suppressContentEditableWarning
        onFocus={quarterLocked ? undefined : (e) => (e.currentTarget.dataset.oldVal = e.currentTarget.innerText.trim())}
        onBlur={quarterLocked ? undefined : (e) => stageScore(sid, field, e.currentTarget)}
        onKeyDown={(e) => handleGridKeyDown(e, field)}
        onPaste={quarterLocked ? undefined : (e) => handleGridPaste(e, field)}
      >
        {display}
      </td>
    );
  }

  return (
    <>
      <LoadingBar progress={loadProgress} active={loading} />
      {loading ? (
        <SkeletonDashWrap />
      ) : (
        <div className="dashboard-wrapper">
          <div className="dash-wrap"><h3>SEMESTER</h3><h4>{currentSemester}</h4></div>
          <div className="dash-wrap"><h3>QUARTER</h3><h4 className="badge">{qLabel(currentQuarter)}</h4></div>
          <div className="dash-wrap"><h3>SUBJECT</h3><h4>{section?.subject || "--"}</h4></div>
          <div className="dash-wrap"><h3>TOTAL STUDENTS</h3><h4>{students.length}</h4></div>
          <div className="dash-wrap"><h3>SECTION</h3><h4 className="badge">{section?.title || "--"}</h4></div>
        </div>
      )}

      <div className="class-record-container">
        <div className="search-container">
          <i className="fa-solid fa-magnifying-glass search-icon" />
          <input type="text" placeholder="Search student name or ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="quarter-bar">
          <span className="quarter-bar-label">{college ? "Term" : "Quarter"}</span>
          {quarterTabs.map((q) => (
            <button
              key={q}
              className={`q-tab${q === viewQuarter ? " viewing" : ""}${q === currentQuarter ? " active-q" : ""}`}
              onClick={() => setViewQuarterAndReload(q)}
            >
              {qLabel(q)}
            </button>
          ))}
          {quarterLocked && (
            <>
              <span className="lock-banner" style={{ display: "inline-flex" }}>
                <i className="fa-solid fa-lock" /> {qLabel(viewQuarter)} is not yet active.
              </span>
              <button className="q-activate-btn" style={{ display: "inline-flex" }} disabled={activatingQ} onClick={activateQuarter}>
                {activatingQ ? "Saving..." : `Activate ${qLabel(viewQuarter)}`}
              </button>
            </>
          )}
        </div>

        <div className="quarter-bar" style={{ marginBottom: 10 }}>
          <span className="quarter-bar-label">Semester</span>
          {["1st Sem", "2nd Sem"].map((sem) => (
            <button
              key={sem}
              className={`s-tab${sem === viewSemester ? " viewing-s" : ""}${sem === currentSemester ? " active-s" : ""}`}
              onClick={() => setViewSemesterOnly(sem)}
            >
              {sem}
            </button>
          ))}
          {semesterLocked && (
            <>
              <span className="lock-banner" style={{ display: "inline-flex" }}>
                <i className="fa-solid fa-lock" /> {viewSemester} is not yet active.
              </span>
              <button className="q-activate-btn" style={{ display: "inline-flex" }} disabled={activatingS} onClick={activateSemester}>
                {activatingS ? "Saving..." : `Activate ${viewSemester}`}
              </button>
            </>
          )}
        </div>

        {!quarterLocked && !loading && (
          <div className="save-bar">
            <button
              type="button"
              className={`save-scores-btn${dirtyCount > 0 ? " has-unsaved" : ""}`}
              onClick={savePending}
              disabled={saving || dirtyCount === 0}
              title={dirtyCount > 0 ? "Save your entered scores" : "No new scores to save"}
            >
              <i className="fa-solid fa-floppy-disk" />
              {saving ? "Saving…" : dirtyCount > 0 ? `Save ${dirtyCount} score${dirtyCount === 1 ? "" : "s"}` : "All saved"}
            </button>
            {dirtyCount > 0 && (
              <span className="unsaved-note">Unsaved — press Save (scores are not saved automatically).</span>
            )}
            <span
              className="grid-hint"
              style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "flex", gap: 16, flexWrap: "wrap", marginLeft: "auto" }}
            >
              <span><b>Enter</b> / <b>↑ ↓</b> students</span>
              <span><b>Tab</b> / <b>← →</b> columns</span>
              <span>Paste from <b>Excel</b></span>
              <span><b>Ctrl</b>+<b>Z</b> undo</span>
            </span>
          </div>
        )}

        <div className="table-responsive fade-swap" ref={gridScrollRef} key={`${viewSemester}-${viewQuarter}`}>
          <table id="recordTable">
            <thead>
              <tr>
                <th rowSpan={2} className="sticky-col">#</th>
                <th rowSpan={2} className="sticky-col" style={{ textAlign: "center" }}>ID No.</th>
                <th rowSpan={2} className="sticky-col text-left group-divider">Student Name</th>
                <th colSpan={MODULE_COUNT} className="header-group group-divider header-modules">MODULES</th>
                <th colSpan={10} className="header-group group-divider header-activities">ACTIVITIES</th>
                {!college && (
                  <>
                    <th className="header-group header-at">AT</th>
                    <th className="header-group header-pt">PT 1</th>
                    <th className="header-group header-pt">PT 2</th>
                    <th className="header-group header-qe">QE</th>
                  </>
                )}
                <th rowSpan={2} className="header-group group-divider" style={{ minWidth: 60 }}>TOTAL</th>
                <th rowSpan={2} className="header-group" style={{ minWidth: 70 }}>Initial Grade</th>
                <th rowSpan={2} className="header-group" style={{ minWidth: 70 }}>Quarterly Grade</th>
              </tr>
              <tr>
                {Array.from({ length: MODULE_COUNT }, (_, i) => i + 1).map((n) => (
                  <th key={`m${n}`} className={n === MODULE_COUNT ? "group-divider" : undefined}>{n}</th>
                ))}
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <th key={`a${n}`} className={n === 10 ? "group-divider" : undefined}>{n}</th>
                ))}
                {!college && (
                  <>
                    <th>50</th>
                    <th>50</th>
                    <th>50</th>
                    <th>50</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRows rows={6} cols={gridColSpan} />
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={gridColSpan} style={{ textAlign: "center", padding: 30 }}>No students assigned yet.</td>
                </tr>
              ) : (
                students.map((s, idx) => {
                  const hidden = !!searchLower && !`${s.full_name || ""} ${s.id_no || ""}`.toLowerCase().includes(searchLower);
                  return (
                    <tr key={s.id} className="student-data-row" style={hidden ? { display: "none" } : undefined}>
                      <td className="sticky-col">{idx + 1}</td>
                      <td className="sticky-col search-id" style={{ textAlign: "center" }}>{s.id_no || "—"}</td>
                      <td className="sticky-col text-left group-divider search-target">
                        <button
                          type="button"
                          className="student-name-btn"
                          title={`${s.full_name} — tap to view grade breakdown`}
                          onClick={() => setDetailStudent(s)}
                        >
                          <strong>{s.full_name}</strong>
                        </button>
                      </td>
                      {MODULES.map((f, i) => <ScoreCell key={f} sid={s.id} field={f} divider={i === 24} />)}
                      {ACTIVITIES.map((f, i) => <ScoreCell key={f} sid={s.id} field={f} divider={i === 9} />)}
                      {!college && TAIL.map((f) => <ScoreCell key={f} sid={s.id} field={f} />)}
                      {(() => {
                        const t = totalScoreFor(s.id);
                        return (
                          <td
                            className="group-divider"
                            title={t === null ? "No scores yet" : "Sum of all entered scores"}
                            style={{ fontWeight: 700, textAlign: "center", color: t === null ? "var(--text-muted)" : "var(--text-dark)" }}
                          >
                            {t === null ? "—" : t}
                          </td>
                        );
                      })()}
                      {(() => {
                        const ig = liveInitialGradeFor(s.id);
                        return (
                          <td
                            title={ig === null ? "No scores yet" : "Initial Grade (before transmutation)"}
                            style={{ fontWeight: 700, textAlign: "center", color: ig === null ? "var(--text-muted)" : "var(--text-dark)" }}
                          >
                            {ig === null ? "—" : ig.toFixed(2)}
                          </td>
                        );
                      })()}
                      {(() => {
                        const g = liveGradeFor(s.id);
                        const pass = g !== null && g >= passingFor(section?.subject || "");
                        return (
                          <td
                            className="grade-live-cell"
                            title={g === null ? "No scores yet" : pass ? "Passing" : "Below passing"}
                            style={{
                              fontWeight: 700,
                              textAlign: "center",
                              color: g === null ? "var(--text-muted)" : pass ? "#059669" : "#dc2626",
                              background: g === null ? undefined : pass ? "rgba(16,185,129,0.10)" : "rgba(239,68,68,0.10)",
                            }}
                          >
                            {g === null ? "—" : g}
                          </td>
                        );
                      })()}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`toast-notification ${toast.err ? "error" : ""} ${toast.show ? "show" : ""}`}>
        <i className={`fa-solid ${toast.err ? "fa-circle-exclamation" : "fa-circle-check"}`} />
        <span>{toast.msg}</span>
      </div>

      {detailStudent && (
        <StudentGradeModal
          student={detailStudent}
          section={section}
          cards={quarterBreakdown(detailStudent.id, detailStudent.full_name)}
          passingGrade={passingFor(section?.subject || "")}
          college={college}
          onClose={() => setDetailStudent(null)}
        />
      )}
    </>
  );
}

function StudentGradeModal({
  student,
  section,
  cards,
  passingGrade,
  college,
  onClose,
}: {
  student: any;
  section: any;
  cards: GradeQuarterCard[];
  passingGrade: number;
  college: boolean;
  onClose: () => void;
}) {
  const bySem: Record<string, GradeQuarterCard[]> = { "1st Sem": [], "2nd Sem": [] };
  for (const c of cards) bySem[c.sem].push(c);
  const sems = (Object.keys(bySem) as ("1st Sem" | "2nd Sem")[]).filter((s) => bySem[s].length > 0);

  return (
    <div className="grade-modal-overlay" onClick={onClose}>
      <div className="grade-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="grade-modal-header">
          <div>
            <h3>{student.full_name}</h3>
            <p>
              {section?.title || "Section"}
              {section?.subject ? ` • ${section.subject}` : ""}
            </p>
          </div>
          <button className="grade-modal-close" onClick={onClose} aria-label="Close">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="grade-modal-body">
          {sems.map((sem) => (
            <div className="grade-sem-block" key={sem}>
              <p className="grade-sem-title">{sem}</p>
              <div className="grade-quarter-grid">
                {bySem[sem].map((c) => (
                  <div className={`grade-quarter-card${c.hasData ? "" : " is-empty"}`} key={sem + c.label}>
                    <div className="grade-quarter-head">
                      <span>{c.label}</span>
                      {c.hasData && c.delta !== null && (
                        <span className={`grade-delta ${c.delta >= 0 ? "up" : "down"}`}>
                          {c.delta >= 0 ? "▲" : "▼"} {Math.abs(c.delta)}
                        </span>
                      )}
                    </div>
                    {c.hasData ? (
                      <>
                        <div className="grade-quarter-final total">{displayedTotal(c.comp)}</div>
                        <div className="grade-component-row">
                          <span>Modules</span>
                          <b>{Math.round(c.comp.modulesOnly)}</b>
                        </div>
                        <div className="grade-component-row">
                          <span>Activity</span>
                          <b>{Math.round(c.comp.activitiesOnly)}</b>
                        </div>
                        {!college && (
                          <>
                            <div className="grade-component-row">
                              <span>Performance Task</span>
                              <b>{Math.round(c.comp.rawPT)}</b>
                            </div>
                            <div className="grade-component-row">
                              <span>Exam (AT + QE)</span>
                              <b>{Math.round(c.comp.rawExam)}</b>
                            </div>
                          </>
                        )}
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-color, rgba(125,125,125,0.2))" }}>
                          <div className="grade-component-row" style={{ fontSize: "0.78rem" }}>
                            <span>WW — PS</span>
                            <b>{c.comp.wwPct.toFixed(2)}%</b>
                          </div>
                          <div className="grade-component-row" style={{ fontSize: "0.78rem" }}>
                            <span>WW — WS</span>
                            <b>{c.comp.wwWS.toFixed(2)}</b>
                          </div>
                          <div className="grade-component-row" style={{ fontSize: "0.78rem" }}>
                            <span>PT — PS</span>
                            <b>{c.comp.ptPct.toFixed(2)}%</b>
                          </div>
                          <div className="grade-component-row" style={{ fontSize: "0.78rem" }}>
                            <span>PT — WS</span>
                            <b>{c.comp.ptWS.toFixed(2)}</b>
                          </div>
                          <div className="grade-component-row" style={{ fontSize: "0.78rem" }}>
                            <span>Exam — PS</span>
                            <b>{c.comp.examPct.toFixed(2)}%</b>
                          </div>
                          <div className="grade-component-row" style={{ fontSize: "0.78rem" }}>
                            <span>Exam — WS</span>
                            <b>{c.comp.examWS.toFixed(2)}</b>
                          </div>
                        </div>
                        <div className="grade-component-row" style={{ marginTop: 6, fontWeight: 700, color: "var(--text-dark)" }}>
                          <span>Initial Grade</span>
                          <b>{(c.comp.wwWS + c.comp.ptWS + c.comp.examWS).toFixed(2)}</b>
                        </div>
                        <div className={`grade-component-row grade-average-row ${c.grade >= passingGrade ? "pass" : "fail"}`}>
                          <span>Quarterly Grade</span>
                          <b>{c.grade}</b>
                        </div>
                        {c.inProgress && (
                          <div style={{ marginTop: 8, fontSize: "0.7rem", fontWeight: 700, color: "#b45309", background: "rgba(245,158,11,0.15)", borderRadius: 6, padding: "4px 8px", textAlign: "center", letterSpacing: "0.02em" }}>
                            <i className="fa-solid fa-hourglass-half" style={{ marginRight: 5 }} />IN-PROGRESS · NOT YET FINAL
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="grade-quarter-final empty">No data yet</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
