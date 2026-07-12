"use client";
import { PageMetaProvider } from "@/lib/page-meta";
import TeacherShell from "@/components/TeacherShell";

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageMetaProvider>
      <TeacherShell>{children}</TeacherShell>
    </PageMetaProvider>
  );
}
