"use client";

import SectionPickerList from "@/components/SectionPickerList";

export default function AttendancePickerPage() {
  return <SectionPickerList pageTitle="Attendance" cacheKey="list_cache_sections_att" viewPath="/attendance" />;
}
