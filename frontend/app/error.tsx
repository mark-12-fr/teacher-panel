"use client";
// Root-level boundary: catches a crash anywhere outside a page's own boundary
// (login, sign-up, the app shell itself) and heals it instead of a blank page.
import ErrorRecovery from "@/components/ErrorRecovery";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorRecovery error={error} reset={reset} variant="fullscreen" />;
}
