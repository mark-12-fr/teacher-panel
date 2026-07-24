"use client";

// A thin "pure real progress" bar pinned to the top of the viewport. Its width
// is driven ONLY by real load milestones the caller passes in `progress` (0-100)
// — no faked trickle — so it advances exactly as the app's data actually loads
// and reflects the real connection speed. It fades out shortly after `active`
// goes false (loading finished).
export default function LoadingBar({ progress, active }: { progress: number; active: boolean }) {
  const pct = Math.max(0, Math.min(100, progress));
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 99999,
        pointerEvents: "none",
        opacity: active ? 1 : 0,
        transition: "opacity 0.45s ease 0.25s",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: "linear-gradient(90deg, #3b82f6, #22c55e)",
          borderRadius: "0 3px 3px 0",
          boxShadow: "0 0 8px rgba(59, 130, 246, 0.55)",
          transition: "width 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />
    </div>
  );
}
