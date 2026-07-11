"use client";

// Terms of Service (ported from terms.html) — a standalone, public, dark-themed
// legal page (no sidebar/auth). Shares layout styling with /privacy via legal.css.
import "../legal.css";

export default function TermsPage() {
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
          <h1>Terms of Service</h1>
          <p className="updated">Last updated: 2 June 2026</p>

          <p>
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of AcadTrack (&quot;AcadTrack&quot;,
            &quot;we&quot;, &quot;our&quot;, &quot;the Service&quot;), a web-based student management system operated by MJR
            Vertex. By creating an account, signing in, or otherwise using the Service, you agree to these Terms. If you do
            not agree, please do not use the Service.
          </p>

          <h2>1. The Service</h2>
          <p>
            AcadTrack lets teachers manage class sections and students, record attendance and grades, view performance
            reports, and invite facilitators to help encode data. It also provides an optional AI assistant that answers
            questions about a teacher&apos;s own class data. The Service is provided for legitimate educational use only.
          </p>

          <h2>2. Accounts and eligibility</h2>
          <ul>
            <li><strong>Teachers</strong> sign up with Google or an email address and password. You are responsible for the accuracy of your account information.</li>
            <li><strong>Facilitators</strong> do not self-register; they are issued a username (Account ID) and password by the teacher who assigns them to a section.</li>
            <li>You must be of legal age to enter into these Terms (an adult), or have the consent and supervision of your institution.</li>
            <li>You are responsible for keeping your credentials confidential and for all activity that occurs under your account. Notify us promptly of any unauthorized use.</li>
          </ul>

          <h2>3. Acceptable use</h2>
          <p>When using AcadTrack, you agree that you will <strong>not</strong>:</p>
          <ul>
            <li>Access data that does not belong to you, or attempt to bypass authentication, access controls, or rate limits.</li>
            <li>Upload unlawful, harmful, or infringing content, or use the Service to harass or harm others.</li>
            <li>Interfere with, overload, probe, or disrupt the Service or its infrastructure, or attempt to reverse engineer it except where permitted by law.</li>
            <li>Use automated means to scrape or extract data from the Service without our written permission.</li>
          </ul>

          <h2>4. Class and student data</h2>
          <p>
            Teachers enter information about their sections and students (names, ID numbers, attendance, and scores). The
            teacher who creates a section is the <strong>controller</strong> of that data and is responsible for obtaining
            any consent required by their school and by applicable law — including the Philippine Data Privacy Act of 2012
            (RA 10173) — before entering student information. Class data is visible only to the owning teacher and the
            facilitators that teacher assigns. Our handling of personal information is described in our{" "}
            <a href="/privacy">Privacy Policy</a>, which forms part of these Terms.
          </p>

          <h2>5. Intellectual property</h2>
          <p>
            AcadTrack, the AcadTrack name and logo, and the software that powers the Service are owned by MJR Vertex and
            are protected by applicable laws. We grant you a limited, non-exclusive, non-transferable right to use the
            Service for its intended educational purpose. The data you enter remains yours; you grant us only the
            permissions needed to store and display it back to you and your assigned facilitators in order to operate the
            Service.
          </p>

          <h2>6. AI assistant</h2>
          <p>
            The optional AI assistant generates responses using your own class data together with third-party AI providers.
            AI output may contain errors and should be reviewed before being relied upon for grading or other decisions.
            AcadTrack is not responsible for actions taken solely on the basis of AI-generated content.
          </p>

          <h2>7. Availability and changes</h2>
          <p>
            The Service is provided on an &quot;as is&quot; and &quot;as available&quot; basis. We may add, change, suspend,
            or remove features, and we may perform maintenance that temporarily limits availability. We do not guarantee
            that the Service will be uninterrupted, error-free, or free from loss of data, although we take reasonable
            measures to protect it.
          </p>

          <h2>8. Disclaimers and limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, AcadTrack and MJR Vertex disclaim all warranties, whether express or
            implied, including fitness for a particular purpose. We are not liable for any indirect, incidental, or
            consequential damages, or for loss of data or profits, arising from your use of or inability to use the Service.
            Nothing in these Terms excludes liability that cannot be excluded under applicable law.
          </p>

          <h2>9. Termination</h2>
          <p>
            You may stop using the Service at any time. Teachers can delete sections, students, and facilitator assignments
            from inside the app, and may request full account deletion (see the Privacy Policy). We may suspend or terminate
            access if these Terms are violated or if necessary to protect the Service or its users.
          </p>

          <h2>10. Changes to these Terms</h2>
          <p>
            We may update these Terms from time to time. When we do, we will revise the &quot;Last updated&quot; date above
            and, for material changes, notify signed-in users inside the app. Your continued use of the Service after
            changes take effect means you accept the revised Terms.
          </p>

          <h2>11. Governing law</h2>
          <p>
            These Terms are governed by the laws of the Republic of the Philippines, without regard to its conflict of law
            rules. Any disputes shall be subject to the jurisdiction of the appropriate courts of the Philippines.
          </p>

          <h2>12. Contact us</h2>
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
