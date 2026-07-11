"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { clearUserCache } from "@/hooks/useAuth";
import "./sign.css";

export default function SignUpPage() {
  const sb = getSupabase();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [emailMsg, setEmailMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [matchMsg, setMatchMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [strength, setStrength] = useState({ width: "0%", color: "#e5e7eb" });
  const [emailExists, setEmailExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; msg: string; err: boolean }>({
    show: false,
    msg: "",
    err: false,
  });

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      if (data.session) window.location.href = "/dashboard";
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showToast(msg: string, err = false) {
    setToast({ show: true, msg, err });
    setTimeout(() => setToast((t) => ({ ...t, show: false })), 3000);
  }

  async function loginWithGoogle() {
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + "/dashboard", queryParams: { prompt: "select_account" } },
      });
      if (error) throw error;
    } catch {
      showToast("Failed to connect to Google", true);
    }
  }

  async function checkEmail() {
    if (!email) return;
    try {
      const { data } = await sb.from("profiles").select("email").eq("email", email);
      if (data && data.length > 0) {
        setEmailExists(true);
        setEmailMsg({ text: `This account ${email} is already registered`, ok: false });
      } else {
        setEmailExists(false);
        setEmailMsg({ text: "Email is available", ok: true });
      }
    } catch (e) {
      console.error("Error checking email:", e);
    }
  }

  function checkStrength(val: string) {
    let score = 0;
    if (val.length >= 8) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    const colors = ["#ef4444", "#f59e0b", "#3b82f6", "#10b981"];
    setStrength({ width: score * 25 + "%", color: colors[score - 1] || "#e5e7eb" });
  }

  function checkMatch(pass: string, conf: string) {
    if (!conf) {
      setMatchMsg(null);
      return;
    }
    setMatchMsg(pass === conf ? { text: "Passwords match", ok: true } : { text: "Passwords do not match", ok: false });
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (emailExists) return showToast("This email is already registered.", true);
    if (password !== confirm) return showToast("Passwords do not match.", true);
    setBusy(true);
    try {
      const { data: authData, error: authError } = await sb.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (authError) {
        showToast(authError.message || "Failed to create account", true);
        setBusy(false);
        return;
      }
      if (authData.user) {
        try {
          await sb.from("profiles").upsert([{ id: authData.user.id, full_name: fullName, email }]);
        } catch (pe) {
          console.error("Profile insert warning:", pe);
        }
        // Fresh account — clear any previous user's cache on this browser,
        // then stamp this account as the owner of the cached identity.
        clearUserCache();
        if (authData.session) localStorage.setItem("access_token", authData.session.access_token);
        localStorage.setItem("user_id", authData.user.id);
        localStorage.setItem("cached_user_id", authData.user.id);
        localStorage.setItem("cached_user_name", fullName);
        showToast("Account successfully created! Redirecting to Dashboard...");
        setTimeout(() => (window.location.href = "/dashboard"), 2000);
      }
    } catch (err) {
      console.error("Signup error:", err);
      showToast("An unexpected error occurred.", true);
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <main className="auth-main">
        <div className="login-card">
          <h2>Create Account</h2>
          <p className="login-subtitle">Sign up to get started</p>

          <button type="button" onClick={loginWithGoogle} className="google-btn">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" width={18} alt="" />
            Continue with Google
          </button>

          <div className="divider">or sign up with email</div>

          <form onSubmit={handleSignUp}>
            <div className="form-group">
              <input type="text" required placeholder=" " value={fullName} onChange={(e) => setFullName(e.target.value)} />
              <label>Full Name</label>
            </div>
            <div className="form-group">
              <input type="email" required placeholder=" " value={email} onChange={(e) => setEmail(e.target.value)} onBlur={checkEmail} />
              <label>Email Address</label>
              {emailMsg && (
                <div className={`field-msg ${emailMsg.ok ? "success" : "error"}`} style={{ display: "block" }}>
                  {emailMsg.text}
                </div>
              )}
            </div>
            <div className="form-group">
              <input
                type="password"
                required
                placeholder=" "
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  checkStrength(e.target.value);
                  checkMatch(e.target.value, confirm);
                }}
              />
              <label>Password</label>
              <div className="strength-meter">
                <div className="strength-fill" style={{ width: strength.width, background: strength.color }} />
              </div>
            </div>
            <div className="form-group">
              <input
                type="password"
                required
                placeholder=" "
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  checkMatch(password, e.target.value);
                }}
              />
              <label>Confirm Password</label>
              {matchMsg && (
                <div className={`field-msg ${matchMsg.ok ? "success" : "error"}`} style={{ display: "block" }}>
                  {matchMsg.text}
                </div>
              )}
            </div>
            <button type="submit" className="btn-login" disabled={busy}>
              {busy ? "Creating Account..." : "Create Account"}
            </button>
          </form>

          <div className="login-text">
            Already have an account? <a href="/login">Log in</a>
          </div>
        </div>
      </main>

      <div className={`toast-notification ${toast.err ? "error" : ""} ${toast.show ? "show" : ""}`}>
        <i className={`fa-solid ${toast.err ? "fa-xmark" : "fa-check"}`} />
        <span>{toast.msg}</span>
      </div>
    </div>
  );
}
