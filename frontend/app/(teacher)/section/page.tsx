"use client";

import SectionPickerList from "@/components/SectionPickerList";

export default function SectionListPage() {
  return <SectionPickerList pageTitle="Sections" cacheKey="list_cache_sections_all" viewPath="/section" />;
}
