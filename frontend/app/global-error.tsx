"use client";
// Last-resort boundary: replaces the root layout itself when it crashes, so it
// must render its own <html>/<body>. The shared card uses inline styles with
// fallbacks, so it works even though no app CSS has loaded here.
import ErrorRecovery from "@/components/ErrorRecovery";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <ErrorRecovery error={error} reset={reset} variant="fullscreen" />
      </body>
    </html>
  );
}
