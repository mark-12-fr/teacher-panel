// Public landing page (ported from home.html). Static — no auth required.
import "./home.css";

export const metadata = {
  title: "AcadTrack — Student Management System for Teachers and Facilitators",
};

export default function HomePage() {
  const year = new Date().getFullYear();
  return (
    <div className="home-page">
      <header className="nav">
        <div className="container nav-inner">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="AcadTrack logo" />
            AcadTrack
          </div>
          <nav className="nav-links">
            <a href="#features">Features</a>
            <a href="#audience">Who it&apos;s for</a>
            <a href="/privacy">Privacy</a>
            <a className="nav-cta" href="/login">Sign in</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container">
            <h1>
              One place to teach, track, and <span>grow your class</span>
            </h1>
            <p>
              AcadTrack is a real-time student management system built for teachers and class
              facilitators. Take attendance, record grades, monitor performance, and stay in sync
              across every device — laptop or phone.
            </p>
            <div className="cta-row">
              <a className="btn btn-primary" href="/login">
                <i className="fa-solid fa-right-to-bracket" /> Teacher sign in
              </a>
              <a className="btn btn-ghost" href="/sign">
                <i className="fa-solid fa-user-plus" /> Create teacher account
              </a>
            </div>
          </div>
        </section>

        <section id="features">
          <div className="container">
            <div className="section-title">
              <h2>Everything a class needs in one workspace</h2>
              <p>Built for Philippine schools running quarterly grading periods.</p>
            </div>
            <div className="features">
              {[
                ["fa-clipboard-user", "Daily attendance", "Mark students Present, Absent, Late, or Excused. See today's count at a glance and export a CSV per month."],
                ["fa-table-list", "Class records", "Inputs for 25 modules, 10 activities, two performance tasks, and the quarterly exam. Scores carry forward across quarters so nothing is lost."],
                ["fa-chart-line", "Performance overview", "Per-quarter class average, pass rate, highest and lowest grades, and a leaderboard with per-student attendance percentage."],
                ["fa-users", "Facilitator handoff", "Assign facilitators to sections. They submit attendance and scores from any device; the teacher sees everything live with notifications."],
                ["fa-bell", "Cross-device notifications", "Real-time alerts on phone or desktop the moment a facilitator submits work — even when the browser is closed."],
                ["fa-shield-halved", "Secure by default", "Google sign-in, password reset via 6-digit OTP, and per-section access control keep the right data with the right teacher."],
              ].map(([icon, title, body]) => (
                <div className="feature" key={title}>
                  <div className="feature-icon">
                    <i className={`fa-solid ${icon}`} />
                  </div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="audience" id="audience">
          <div className="container">
            <div className="section-title">
              <h2>Two roles, one connected workflow</h2>
              <p>Teachers own the section. Facilitators help them carry the load.</p>
            </div>
            <div className="audience-grid">
              <div className="audience-card">
                <h3>For teachers</h3>
                <p>Manage every section you handle from one dashboard.</p>
                <ul>
                  <li><i className="fa-solid fa-check" /> Create sections per semester and quarter</li>
                  <li><i className="fa-solid fa-check" /> Edit attendance and scores live</li>
                  <li><i className="fa-solid fa-check" /> Assign facilitators per section</li>
                  <li><i className="fa-solid fa-check" /> Export CSV for grade submission</li>
                </ul>
                <a className="btn btn-primary" href="/login">Sign in as teacher</a>
              </div>
              <div className="audience-card">
                <h3>For facilitators</h3>
                <p>Help the teacher capture attendance and scores in the field.</p>
                <ul>
                  <li><i className="fa-solid fa-check" /> Mobile-first record entry</li>
                  <li><i className="fa-solid fa-check" /> Auto-follow the teacher&apos;s quarter</li>
                  <li><i className="fa-solid fa-check" /> Receive teacher edits instantly</li>
                  <li><i className="fa-solid fa-check" /> Submitted scores are locked from re-edits</li>
                </ul>
                <a className="btn btn-ghost" href="/login">Facilitator portal</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="container foot-row">
          <p>© {year} AcadTrack · MJR Vertex. All rights reserved.</p>
          <div className="foot-links">
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms</a>
            <a href="mailto:mjrvertex@gmail.com">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
