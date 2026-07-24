"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { clearUserCache } from "@/hooks/useAuth";
import "./login.css";

type ToastType = "success" | "error" | "info";

export default function LoginPage() {
  const sb = getSupabase();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [loginBtn, setLoginBtn] = useState<"idle" | "busy" | "done">("idle");
  const [googleBusy, setGoogleBusy] = useState(false);

  const [splashHidden, setSplashHidden] = useState(false);
  const [splashFill, setSplashFill] = useState(0);
  const [splashFillMs, setSplashFillMs] = useState(1700);
  const [splashSubtitle, setSplashSubtitle] = useState("MJR Vertex");

  const [toast, setToast] = useState<{ show: boolean; msg: string; type: ToastType }>({
    show: false,
    msg: "",
    type: "success",
  });

  // Forgot-password modal state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetStep, setResetStep] = useState<"email" | "otp">("email");
  const [resetEmail, setResetEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [otpTimer, setOtpTimer] = useState("Code expires in 60s");
  const [resendEnabled, setResendEnabled] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const otpEmailRef = useRef<string | null>(null);

  function showToast(msg: string, type: ToastType = "success") {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  }

  useEffect(() => {
    let active = true;
    sb.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setSplashSubtitle("Loading your workspace...");
        setSplashFillMs(700);
        setSplashFill(100); // reaches full just before the 800ms redirect
        setTimeout(() => (window.location.href = "/dashboard"), 800);
      } else {
        const saved = localStorage.getItem("remembered_email");
        if (saved) {
          setEmail(saved);
          setRememberMe(true);
        }
        setSplashFill(100); // fills over ~1700ms, then the splash reveals the form
        setTimeout(() => setSplashHidden(true), 1800);
      }
    });
    return () => {
      active = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loginWithGoogle() {
    setGoogleBusy(true);
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/dashboard",
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch {
      showToast("Connection failed. Please check your internet.", "error");
      setGoogleBusy(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginBtn("busy");
    if (rememberMe) localStorage.setItem("remembered_email", email.trim());
    else localStorage.removeItem("remembered_email");

    const { data, error } = await sb.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });
    if (error) {
      showToast("Incorrect email or password. Please try again.", "error");
      setLoginBtn("idle");
    } else {
      // Switching to a different account? Drop the previous user's cached
      // identity and chat so it can't be shown for this one.
      if (data.user && localStorage.getItem("cached_user_id") !== data.user.id) {
        clearUserCache();
      }
      // Keep the legacy keys the old app used (some shared scripts read them).
      localStorage.removeItem("faci_id");
      if (data.session) localStorage.setItem("access_token", data.session.access_token);
      if (data.user) localStorage.setItem("user_id", data.user.id);
      showToast("Login successful. Redirecting...");
      setLoginBtn("done");
      setTimeout(() => (window.location.href = "/dashboard"), 1000);
    }
  }

  // ── Forgot / reset password ────────────────────────────────────────────────
  function stopOtpTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }
  function startOtpTimer() {
    stopOtpTimer();
    let remaining = 60;
    setResendEnabled(false);
    setOtpTimer(`Code expires in ${remaining}s`);
    timerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        stopOtpTimer();
        setOtpTimer("Code expired. Tap Resend.");
        setResendEnabled(true);
      } else {
        setOtpTimer(`Code expires in ${remaining}s`);
      }
    }, 1000);
  }
  function openForgot() {
    setResetEmail("");
    setResetStep("email");
    setForgotOpen(true);
  }
  function closeForgot() {
    setForgotOpen(false);
    stopOtpTimer();
    otpEmailRef.current = null;
  }
  async function sendResetOtp() {
    const em = resetEmail.trim();
    if (!em) {
      showToast("Please enter an email address", "error");
      return;
    }
    setResetBusy(true);
    const { error } = await sb.auth.resetPasswordForEmail(em);
    setResetBusy(false);
    if (error) {
      showToast("Could not send code. Check the email and try again.", "error");
      return;
    }
    otpEmailRef.current = em;
    setOtp("");
    setNewPw("");
    setConfirmPw("");
    setResetStep("otp");
    startOtpTimer();
    showToast("Verification code sent! Check your email.", "info");
  }
  async function resendResetOtp() {
    if (!otpEmailRef.current) {
      setResetStep("email");
      return;
    }
    setResendEnabled(false);
    const { error } = await sb.auth.resetPasswordForEmail(otpEmailRef.current);
    if (error) {
      showToast("Could not resend code. Try again.", "error");
      setResendEnabled(true);
      return;
    }
    startOtpTimer();
    showToast("New code sent!", "info");
  }
  async function verifyOtpAndReset() {
    if (!/^\d{6,8}$/.test(otp.trim())) return showToast("Enter the code from your email", "error");
    if (newPw.length < 6) return showToast("Password must be at least 6 characters", "error");
    if (newPw !== confirmPw) return showToast("Passwords do not match", "error");
    if (!otpEmailRef.current) {
      showToast("Session expired, please request a new code", "error");
      setResetStep("email");
      return;
    }
    setVerifyBusy(true);
    const { error: verr } = await sb.auth.verifyOtp({
      email: otpEmailRef.current,
      token: otp.trim(),
      type: "recovery",
    });
    if (verr) {
      showToast("Invalid or expired code", "error");
      setVerifyBusy(false);
      return;
    }
    const { error: uerr } = await sb.auth.updateUser({ password: newPw });
    if (uerr) {
      showToast("Could not update password. Try again.", "error");
      setVerifyBusy(false);
      return;
    }
    await sb.auth.signOut();
    localStorage.removeItem("access_token");
    localStorage.removeItem("user_id");
    stopOtpTimer();
    otpEmailRef.current = null;
    setVerifyBusy(false);
    setForgotOpen(false);
    showToast("Password updated! Please log in with your new password.", "info");
  }

  return (
    <div className="login-page">
      <div className="splash-screen" style={splashHidden ? { opacity: 0, visibility: "hidden" } : undefined}>
        <div className="splash-content">
          <div className="splash-logo-container">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="Logo" />
          </div>
          <h1 className="splash-title">AcadTrack</h1>
          <p className="splash-subtitle">{splashSubtitle}</p>
          <div className="splash-loader">
            <div
              className="splash-loader-fill"
              style={{ width: `${splashFill}%`, transition: `width ${splashFillMs}ms cubic-bezier(0.4, 0, 0.2, 1)` }}
            />
          </div>
        </div>
      </div>

      <main className="auth-main">
        <div className="login-card">
          <h2>Welcome Teacher</h2>
          <p className="login-subtitle">Login to your account</p>

          <button type="button" className="google-btn" onClick={loginWithGoogle} disabled={googleBusy}>
            {googleBusy ? (
              <>
                <i className="fa-solid fa-circle-notch fa-spin" /> Authenticating...
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="https://www.svgrepo.com/show/475656/google-color.svg" width={18} alt="" />
                Continue with Google
              </>
            )}
          </button>

          <div className="divider">or continue with email</div>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <input type="email" required placeholder=" " value={email} onChange={(e) => setEmail(e.target.value)} />
              <label>Email Address</label>
            </div>
            <div className="form-group">
              <input
                type={showPw ? "text" : "password"}
                required
                placeholder=" "
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <label>Password</label>
              <button type="button" className="pw-toggle" tabIndex={-1} onClick={() => setShowPw((v) => !v)}>
                <i className={`fa-solid ${showPw ? "fa-eye-slash" : "fa-eye"}`} />
              </button>
            </div>
            <div className="login-options">
              <label className="remember-me">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} /> Remember me
              </label>
              <a className="forgot-link" onClick={openForgot}>
                Forgot password?
              </a>
            </div>
            <button type="submit" className="btn-login" disabled={loginBtn !== "idle"}
              style={loginBtn === "done" ? { background: "linear-gradient(135deg, #10b981, #059669)" } : undefined}>
              {loginBtn === "busy" ? (
                <>
                  <i className="fa-solid fa-circle-notch fa-spin" /> Authenticating...
                </>
              ) : loginBtn === "done" ? (
                <>
                  <i className="fa-solid fa-check" /> Authentication Successful
                </>
              ) : (
                "Login"
              )}
            </button>
          </form>

          <div className="login-text">
            Don&apos;t have an account? <a href="/sign">Sign up</a>
          </div>
        </div>
      </main>

      <div className={`toast-notification ${toast.type} ${toast.show ? "show" : ""}`}>
        <i className={`fa-solid ${toast.type === "error" ? "fa-xmark" : toast.type === "info" ? "fa-circle-info" : "fa-check"}`} />
        <span>{toast.msg}</span>
      </div>

      {forgotOpen && (
        <div className="modal-overlay" style={{ display: "flex" }}>
          <div className="modal-content">
            {resetStep === "email" ? (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: "1.3rem" }}>Reset Password</h3>
                <p style={{ fontSize: "0.9rem", color: "#64748b", marginBottom: 20 }}>
                  Enter your email and we&apos;ll send you a verification code.
                </p>
                <div className="form-group" style={{ marginBottom: 20 }}>
                  <input type="email" placeholder=" " required style={{ background: "white" }} value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
                  <label>Email Address</label>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={closeForgot} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", cursor: "pointer", background: "#f1f5f9", color: "#333", fontWeight: 600 }}>
                    Cancel
                  </button>
                  <button type="button" onClick={sendResetOtp} disabled={resetBusy} style={{ flex: 2, background: "#3b82f6", color: "white", padding: 12, borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 600 }}>
                    {resetBusy ? <><i className="fa-solid fa-circle-notch fa-spin" /> Sending...</> : "Send Code"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: "1.3rem" }}>Enter Verification Code</h3>
                <p style={{ fontSize: "0.9rem", color: "#64748b", marginBottom: 16 }}>
                  We sent a code to <strong>{otpEmailRef.current}</strong>. Enter it below along with your new password.
                </p>
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <input type="text" inputMode="numeric" maxLength={8} placeholder=" " style={{ background: "white", letterSpacing: 6, textAlign: "center", fontSize: "1.2rem", fontWeight: 700 }} value={otp} onChange={(e) => setOtp(e.target.value)} />
                  <label>Verification Code</label>
                </div>
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <input type={showNewPw ? "text" : "password"} placeholder=" " minLength={6} style={{ background: "white" }} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                  <label>New Password</label>
                  <button type="button" className="pw-toggle" tabIndex={-1} onClick={() => setShowNewPw((v) => !v)}>
                    <i className={`fa-solid ${showNewPw ? "fa-eye-slash" : "fa-eye"}`} />
                  </button>
                </div>
                <div className="form-group" style={{ marginBottom: 8 }}>
                  <input type={showConfirmPw ? "text" : "password"} placeholder=" " minLength={6} style={{ background: "white" }} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
                  <label>Confirm New Password</label>
                  <button type="button" className="pw-toggle" tabIndex={-1} onClick={() => setShowConfirmPw((v) => !v)}>
                    <i className={`fa-solid ${showConfirmPw ? "fa-eye-slash" : "fa-eye"}`} />
                  </button>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem", color: "#64748b", margin: "6px 0 16px" }}>
                  <span>{otpTimer}</span>
                  <button type="button" onClick={resendResetOtp} disabled={!resendEnabled} style={{ background: "none", border: "none", color: "#3b82f6", fontWeight: 600, cursor: "pointer", padding: 0, opacity: resendEnabled ? 1 : 0.5 }}>
                    Resend
                  </button>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={() => { stopOtpTimer(); setResetStep("email"); }} style={{ flex: 1, padding: 12, borderRadius: 10, border: "none", cursor: "pointer", background: "#f1f5f9", color: "#333", fontWeight: 600 }}>
                    Back
                  </button>
                  <button type="button" onClick={verifyOtpAndReset} disabled={verifyBusy} style={{ flex: 2, background: "#3b82f6", color: "white", padding: 12, borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 600 }}>
                    {verifyBusy ? <><i className="fa-solid fa-circle-notch fa-spin" /> Verifying...</> : "Reset Password"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
