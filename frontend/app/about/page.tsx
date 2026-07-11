"use client";

// About the System (ported from about.html) — an authenticated shell page with
// static informational sections. Lucide icons in the original are mapped to the
// Font Awesome set used across the rest of the ported app.
import TeacherShell from "@/components/TeacherShell";
import "./about.css";

const SECTIONS: { icon: string; title: string; text: React.ReactNode }[] = [
  {
    icon: "fa-file-lines",
    title: "System Overview",
    text: "AcadTrack is a comprehensive academic management system designed to streamline classroom administration. It empowers educators to efficiently manage class records, track the progress of modules and activities, and monitor daily student attendance — all from one centralized, intuitive dashboard.",
  },
  {
    icon: "fa-bullseye",
    title: "Our Mission",
    text: "Our mission is to reduce manual paperwork and simplify classroom tracking. By streamlining these administrative tasks, we enable teachers to focus their time and energy on student development, productivity, and fostering a highly engaging learning environment.",
  },
  {
    icon: "fa-gear",
    title: "How It Works",
    text: "Teachers can easily organize student directories by section and monitor daily classroom activities. The system allows educators to log attendance seamlessly, track the completion of academic requirements like modules and quizzes, and generate comprehensive class reports to evaluate overall student participation.",
  },
  {
    icon: "fa-robot",
    title: "AI Teacher Assistant",
    text: "A built-in AI assistant answers questions about your classes in plain language — top or struggling students, who passed or failed, missing requirements, attendance, and quick class summaries. It understands questions written in Hiligaynon, Filipino, or English and always replies in clear English, reading directly from your own records so its numbers match your dashboard.",
  },
  {
    icon: "fa-percent",
    title: "Flexible Grading System",
    text: "Set your own grading scheme for each subject — the weight of Written Work, Performance Tasks, Exams, and Attendance, plus the passing grade. Every grade across the dashboard, class records, performance reports, and the facilitator panel is computed from these settings, so nothing is hardcoded and every screen stays consistent.",
  },
  {
    icon: "fa-users",
    title: "Facilitator Roles (RBAC)",
    text: "Built on Role-Based Access Control, the system separates the Teacher and Facilitator roles. Teachers manage sections, grading, and accounts; facilitators are limited to their assigned section for submitting attendance and class records. Each account can see only its own data.",
  },
  {
    icon: "fa-arrows-rotate",
    title: "Dual-Panel, Real-Time Sync",
    text: "AcadTrack runs as two connected panels — the Teacher Panel and the Facilitator Panel — backed by a real-time database. Attendance and class records submitted by a facilitator appear on the teacher's dashboard right away, so everyone works from the same up-to-date information.",
  },
  {
    icon: "fa-shield-halved",
    title: "Data Privacy & Security",
    text: "We take the privacy of academic records seriously. Each account's data is isolated using database Row-Level Security (RLS), account passwords are protected with industry-standard bcrypt hashing, and facilitators can access only the section assigned to them — keeping every teacher's records private.",
  },
  {
    icon: "fa-award",
    title: "About This Project",
    text: (
      <>
        AcadTrack was developed by <strong>Team MJR Vertex</strong> — Mark Frizas, Jean Rose Banay, and Rutz Cabrera — from
        PHINMA University of Iloilo, and presented at the 2nd INNOVEX 2026 International Conference. It showcases a
        Role-Based Access Control academic management system with an integrated AI teaching assistant.
      </>
    ),
  },
];

export default function AboutPage() {
  return (
    <TeacherShell active="about" title="About the System">
      <div className="about-card">
        {SECTIONS.map((s) => (
          <div className="about-section" key={s.title}>
            <div className="section-title">
              <div className="icon-box"><i className={`fa-solid ${s.icon}`} /></div>
              {s.title}
            </div>
            <p className="section-text">{s.text}</p>
          </div>
        ))}
      </div>
    </TeacherShell>
  );
}
