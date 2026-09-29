"use client";

// The six things a facilitator submits during the day. `key` is the key in
// facilitators.last_submitted — the DB stamps it with the time of the facilitator's
// latest submission (backend/sql/005_faci_submission_checks.sql).
const CHECKS = [
  { key: "module", label: "Module", full: "Module" },
  { key: "activity", label: "Activity", full: "Activity" },
  { key: "at", label: "AT", full: "Achievement Test" },
  { key: "pt", label: "PT", full: "Performance Task" },
  { key: "exam", label: "Exam", full: "Quarterly Exam" },
  { key: "attendance", label: "Attendance", full: "Attendance" },
] as const;

type CheckKey = (typeof CHECKS)[number]["key"];
export type FaciSubmitted = Partial<Record<CheckKey, string>>;

// College sections have no Achievement Test / Performance Task / Quarterly Exam
// (the facilitator app hides those columns), so there is nothing to wait for.
const COLLEGE_SKIPS = new Set<CheckKey>(["at", "pt", "exam"]);

/** Keep only the known keys, and only when the value is a timestamp string. */
export function pickSubmitted(raw: unknown): FaciSubmitted {
  const out: FaciSubmitted = {};
  if (raw && typeof raw === "object") {
    for (const { key } of CHECKS) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "string" && v) out[key] = v;
    }
  }
  return out;
}

/** Local midnight (ms) of the current day. */
export const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const DoneIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="8" fill="currentColor" />
    <path className="tick" d="M4.6 8.3l2.3 2.3 4.5-4.7" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PendingIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.75" />
  </svg>
);

/**
 * "What has this facilitator submitted TODAY?" — one tile per item: a check and
 * the time it was submitted, or "not submitted yet". A stamp only counts when it
 * falls on the teacher's current calendar day (`dayStart`), so every tile resets
 * by itself at midnight. The grid is 2 / 3 / 6 tiles across depending on the
 * width of the row (see .faci-checks in teacher-shell.css).
 */
export default function FaciChecklist({
  submitted,
  college,
  dayStart,
}: {
  submitted?: FaciSubmitted | null;
  college?: boolean;
  dayStart: number;
}) {
  return (
    <div className="faci-checks" role="list" aria-label="Submitted today">
      {CHECKS.filter((c) => !(college && COLLEGE_SKIPS.has(c.key))).map((c) => {
        const at = submitted?.[c.key] ? new Date(submitted[c.key] as string).getTime() : NaN;
        const done = Number.isFinite(at) && at >= dayStart;
        return (
          <div
            key={c.key}
            role="listitem"
            className={`faci-check${done ? " done" : ""}`}
            title={done ? `${c.full} submitted today at ${timeOf(at)}` : `${c.full}: nothing submitted yet today`}
          >
            {done ? <DoneIcon /> : <PendingIcon />}
            <span className="faci-check-txt">
              <span className="faci-check-label">{c.label}</span>
              <span className="faci-check-sub">
                {done ? (
                  <>
                    <span className="faci-check-vh">submitted today at </span>
                    {timeOf(at)}
                  </>
                ) : (
                  "not submitted yet"
                )}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
