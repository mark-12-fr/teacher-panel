"use client";

// Privacy Policy (ported from privacy.html) — a standalone, public, dark-themed
// legal page (no sidebar/auth). Shares layout styling with /terms via legal.css.
import "../legal.css";

export default function PrivacyPage() {
  const year = new Date().getFullYear();
  return (
    <div className="legal-page">
      <header className="nav">
        <div className="container nav-inner">
          <a className="brand" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="AcadTrack logo" />
            AcadTrack
          </a>
          <a className="back-link" href="/">← Back to home</a>
        </div>
      </header>

      <main>
        <div className="container">
          <h1>Privacy Policy</h1>
          <p className="updated">Last updated: 28 May 2026</p>

          <p>
            AcadTrack (&quot;we&quot;, &quot;our&quot;, &quot;the Service&quot;) is a web-based student management system
            operated by MJR Vertex. This Privacy Policy explains what information we collect when teachers, facilitators,
            and students use the Service, how we use that information, and the choices available to you.
          </p>

          <h2>1. Information we collect</h2>
          <p>We collect the minimum information required to run the gradebook and attendance features:</p>
          <ul>
            <li><strong>Account information.</strong> When a teacher signs up or signs in with Google, we receive your name, email address, profile picture, and an authentication identifier from Google. Facilitators are issued a username and password by the teacher who invites them.</li>
            <li><strong>Class data.</strong> Section titles, subjects, room numbers, semester, quarter, school year, student names and ID numbers, attendance status (Present / Absent / Late / Excused / remarks), and class-record scores (modules, activities, performance tasks, quarterly exam).</li>
            <li><strong>Operational data.</strong> Sign-in timestamps, last-active timestamps for facilitators, browser push subscription identifiers, and basic device/browser metadata so we can deliver real-time notifications.</li>
          </ul>

          <h2>2. How we use the information</h2>
          <ul>
            <li>To provide the core features: attendance, class record entry, performance reports, and facilitator collaboration.</li>
            <li>To authenticate users and protect access to teacher- or facilitator-only data.</li>
            <li>To send real-time and push notifications when a facilitator submits work or a teacher edits scores.</li>
            <li>To support troubleshooting and improve the Service&apos;s reliability and performance.</li>
          </ul>
          <p>We do <strong>not</strong> sell personal information, and we do <strong>not</strong> use it for advertising.</p>

          <h2>3. Where data is stored</h2>
          <p>
            AcadTrack stores data on Supabase (PostgreSQL) and is delivered through Vercel. Both providers maintain
            industry-standard physical, network, and administrative safeguards. Communication between your device and our
            servers is encrypted in transit via HTTPS.
          </p>

          <h2>4. Sharing</h2>
          <p>
            Class data is visible only to the teacher who created the section and the facilitators that teacher has
            assigned to it. We do not share class data with third parties except as required by law or to operate the
            Service (for example, the database and hosting providers listed above).
          </p>

          <h2>5. Google user data</h2>
          <p>
            When you sign in with Google, AcadTrack receives only the basic profile fields you approve on the Google
            consent screen (name, email address, and profile picture). We use this information solely to create and
            authenticate your AcadTrack account. AcadTrack&apos;s use of information received from Google APIs adheres to
            the{" "}
            <a href="https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>,
            including the Limited Use requirements.
          </p>

          <h2>6. Notifications and push subscriptions</h2>
          <p>
            If you grant permission, AcadTrack registers a Web Push subscription with your browser so we can deliver
            class-record and attendance alerts to your device even when the app is not open. You can revoke this permission
            at any time from your browser&apos;s site settings.
          </p>

          <h2>7. Cookies and local storage</h2>
          <p>
            We use local storage and cookies to keep you signed in, remember your preferred theme and quarter, and cache
            profile information for faster loading. We do not use cookies for cross-site tracking or advertising.
          </p>

          <h2>8. Data retention and deletion</h2>
          <p>
            Class records and attendance are retained as long as the section exists so teachers can review and export
            historical grades. Teachers can delete sections, students, and facilitator assignments from inside the app at
            any time, which removes the associated data.
          </p>
          <p>
            To request deletion of your AcadTrack account and all associated data, contact us at{" "}
            <a href="mailto:mjrvertex@gmail.com">mjrvertex@gmail.com</a> from the email address tied to your account.
          </p>

          <h2>9. Children&apos;s privacy</h2>
          <p>
            AcadTrack is intended to be used by teachers and facilitators (adults). When a teacher enters student
            information into the system, the teacher is responsible for obtaining the consent required by their school and
            applicable laws (e.g., the Philippine Data Privacy Act of 2012, RA 10173).
          </p>

          <h2>10. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. When we do, we will update the &quot;Last updated&quot;
            date at the top of this page and, for material changes, notify signed-in users inside the app.
          </p>

          <h2>11. Contact us</h2>
          <div className="card">
            <p style={{ margin: 0 }}>
              <strong>MJR Vertex — AcadTrack</strong><br />
              Email: <a href="mailto:mjrvertex@gmail.com">mjrvertex@gmail.com</a><br />
              Website: <a href="https://acadtrack.asia">https://acadtrack.asia</a>
            </p>
          </div>
        </div>
      </main>

      <footer>
        <p>© {year} AcadTrack · MJR Vertex. All rights reserved.</p>
      </footer>
    </div>
  );
}
