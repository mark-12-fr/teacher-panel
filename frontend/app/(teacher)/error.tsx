"use client";
// Boundary for the teacher pages. It renders INSIDE the app shell, so when one
// screen crashes the sidebar keeps working and the teacher can simply move on
// (or let it recover by itself) instead of losing the whole app.
import ErrorRecovery from "@/components/ErrorRecovery";

export default function TeacherError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorRecovery error={error} reset={reset} variant="page" />;
}
