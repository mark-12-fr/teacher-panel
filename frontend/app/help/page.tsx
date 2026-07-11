"use client";

// Help & Support (ported from help.html) — an authenticated shell page with an
// FAQ list and a support-contact box. Lucide icons mapped to Font Awesome.
import TeacherShell from "@/components/TeacherShell";
import "./help.css";

const FAQS: { icon: string; title: string; text: React.ReactNode }[] = [
  {
    icon: "fa-calendar-check",
    title: "How do I record daily attendance?",
    text: (
      <>
        Navigate to the <strong>Attendance</strong> tab on the sidebar. Select your designated section and use the status
        buttons (Present, Absent, Late, Excused) next to each student&apos;s name to log their attendance for the day.
      </>
    ),
  },
  {
    icon: "fa-users",
    title: "How do I update a student's information?",
    text: (
      <>
        Go to the <strong>Section</strong> tab to view your student directory. From there, you can view the master list
        and coordinate with the MJR Vertex Administrator if details need to be modified or updated.
      </>
    ),
  },
  {
    icon: "fa-key",
    title: "I forgot my account password",
    text: (
      <>
        Please use the <strong>Forgot Password</strong> link located on the main login page. Alternatively, you may reach
        out to the MJR Vertex Administrator to verify your identity and request a password reset link.
      </>
    ),
  },
  {
    icon: "fa-percent",
    title: "How do I set up my grading percentages?",
    text: (
      <>
        Open the <strong>Grading System</strong> tab and add a subject. Set the weight for Written Work, Performance
        Tasks, Exam, and Attendance (they should total 100%) and the passing grade. These settings drive every grade shown
        in your class records, performance reports, dashboard, and the facilitator panel.
      </>
    ),
  },
  {
    icon: "fa-wand-magic-sparkles",
    title: "How do I use the AI Assistant?",
    text: (
      <>
        Tap the brain icon at the bottom-right of any page and type a question — for example <em>&quot;Who are the top
        students?&quot;</em>, <em>&quot;Sin-o ang mga failing?&quot;</em>, <em>&quot;Who is absent today?&quot;</em>, or{" "}
        <em>&quot;Class summary&quot;</em>. It understands Hiligaynon, Filipino, and English, and always answers in clear
        English using your own records.
      </>
    ),
  },
  {
    icon: "fa-user-plus",
    title: "How do I add or manage a Facilitator?",
    text: (
      <>
        Go to the <strong>Facilitators</strong> tab to create a facilitator account and assign it to one of your sections.
        Facilitators sign in to the separate Facilitator Panel where they can submit attendance and class records for
        their assigned section only — they cannot change your grading or access other sections.
      </>
    ),
  },
  {
    icon: "fa-calendar-days",
    title: "How do I move to the next quarter or semester?",
    text: "Each section has its own quarter and semester setting. When you advance it, the previous quarters stay viewable as read-only history, so past records are never lost or changed by accident.",
  },
  {
    icon: "fa-calculator",
    title: "How is the final grade computed?",
    text: "The final grade combines Written Work, Performance Tasks, Exam, and Attendance using the percentages you set per subject in the Grading System. Scores are merged across quarters (the most recent entry per item is used), so the same student always shows the same grade everywhere.",
  },
];

export default function HelpPage() {
  return (
    <TeacherShell active="help" title="Help & Support">
      <div className="help-card">
        <div className="help-intro">
          <h2>Need Assistance?</h2>
          <p>
            Find quick answers to common questions about managing your student records and attendance, or contact the IT
            Support Desk below.
          </p>
        </div>

        {FAQS.map((f) => (
          <div className="help-section" key={f.title}>
            <div className="section-title">
              <div className="icon-box"><i className={`fa-solid ${f.icon}`} /></div>
              {f.title}
            </div>
            <p className="section-text">{f.text}</p>
          </div>
        ))}

        <div className="support-box">
          <h3><i className="fa-solid fa-headset" /> Contact MJR Vertex Support</h3>
          <p><strong>Email:</strong> mjrvertex@gmail.com</p>
        </div>
      </div>
    </TeacherShell>
  );
}
