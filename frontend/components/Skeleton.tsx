// Shimmering loading placeholders shown on a page's first data fetch (no
// cached data yet). Kept purely presentational: each variant reuses the
// SAME CSS classes as the real content (.section-card, .dash-wrap, .stat-card,
// table cells, …) so nothing shifts or resizes once real data replaces it.
import "@/app/skeleton.css";

export function Skel({ width, height = 14, radius = 6, style }: { width: string | number; height?: string | number; radius?: number; style?: React.CSSProperties }) {
  return <div className="skel-bone" style={{ width, height, borderRadius: radius, ...style }} />;
}

/** Matches the section/class-record/attendance/performance picker card grid. */
export function SkeletonSectionCards({ count = 6 }: { count?: number }) {
  return (
    <div className="sections-wrapper">
      {Array.from({ length: count }, (_, i) => (
        <div className="section-card" key={i} aria-hidden>
          <div style={{ width: "100%" }}>
            <Skel width="65%" height={20} style={{ marginBottom: 10 }} />
            <Skel width="40%" height={14} style={{ marginBottom: 18 }} />
            <div className="tags-wrapper">
              <Skel width={90} height={24} radius={20} />
              <Skel width={70} height={24} radius={20} />
              <Skel width={80} height={24} radius={20} />
              <Skel width={60} height={24} radius={20} />
              <Skel width={95} height={24} radius={20} />
            </div>
          </div>
          <div className="card-actions" style={{ marginTop: 16 }}>
            <Skel width={70} height={34} radius={8} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Generic table body placeholder — drop inside an existing <table><tbody>. */
export function SkeletonTableRows({ rows = 6, cols = 3 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <Skel width={c === 0 ? "60%" : "80%"} height={14} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Matches the SEMESTER/QUARTER/SUBJECT/TOTAL STUDENTS/SECTION strip used by
 * the section/class-record/attendance detail pages (.dashboard-wrapper). */
export function SkeletonDashWrap({ count = 5 }: { count?: number }) {
  return (
    <div className="dashboard-wrapper">
      {Array.from({ length: count }, (_, i) => (
        <div className="dash-wrap" key={i} aria-hidden>
          <Skel width={70} height={11} style={{ margin: "0 auto 8px" }} />
          <Skel width={50} height={18} style={{ margin: "0 auto" }} />
        </div>
      ))}
    </div>
  );
}

/** Matches the dashboard's 4 top stat tiles (.stat-card). */
export function SkeletonStatCard({ variant }: { variant: "blue" | "green" | "yellow" | "purple" }) {
  return (
    <div className={`dash-card stat-card stat-card-${variant}`} aria-hidden>
      <div className="stat-icon-wrapper" style={{ background: "transparent" }}>
        <Skel width={44} height={44} radius={12} />
      </div>
      <div style={{ width: "100%" }}>
        <Skel width="70%" height={11} style={{ marginBottom: 10 }} />
        <Skel width="40%" height={22} />
      </div>
    </div>
  );
}
