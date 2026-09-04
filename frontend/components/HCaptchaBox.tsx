"use client";

// Minimal hCaptcha widget (explicit render, no npm dependency). Loads the
// hCaptcha API once, renders a checkbox, and reports the solved token up. The
// login form gates submit on that token, and passes it to Supabase auth — so if
// captcha is also switched on in the Supabase dashboard it's enforced end-to-end.

import { useEffect, useRef } from "react";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { hcaptcha?: any; }
}

let loader: Promise<void> | null = null;
function loadHCaptcha(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.hcaptcha) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://js.hcaptcha.com/1/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { loader = null; reject(new Error("hCaptcha failed to load")); };
    document.head.appendChild(s);
  });
  return loader;
}

export default function HCaptchaBox({
  siteKey,
  onVerify,
  onExpire,
  onReady,
  theme = "light",
}: {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onReady?: () => void; // fired once the widget actually renders (so the form
  //                       only gates on a captcha that's genuinely available)
  theme?: "light" | "dark";
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadHCaptcha()
      .then(() => {
        if (cancelled || !boxRef.current || !window.hcaptcha) return;
        if (widgetId.current !== null || boxRef.current.childElementCount > 0) return;
        try {
          widgetId.current = window.hcaptcha.render(boxRef.current, {
            sitekey: siteKey,
            theme,
            callback: (token: string) => onVerify(token),
            "expired-callback": () => onExpire?.(),
            "error-callback": () => onExpire?.(),
          });
          onReady?.();
        } catch {
          /* already rendered / transient — ignore */
        }
      })
      .catch(() => {
        /* network/script error — login simply proceeds without the gate */
      });
    return () => {
      cancelled = true;
      try {
        if (widgetId.current !== null && window.hcaptcha) window.hcaptcha.reset(widgetId.current);
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={boxRef} style={{ display: "flex", justifyContent: "center", margin: "2px 0 16px" }} />;
}
