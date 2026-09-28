-- 004_rls_perf_optimization.sql
--
-- Applied to the live Supabase project (njzvuwkepaasnsvuujgx) on 2026-09-28.
-- Clears every Supabase performance advisor warning (auth_rls_initplan,
-- multiple_permissive_policies, unused_index) WITHOUT changing access:
--   * the authenticated teacher keeps full owner access via
--     "Enable ALL access for owner";
--   * the faci panel (anon) keeps access via the untouched faci_anon_* / `true`
--     policies;
--   * the backend uses service_role, which bypasses RLS entirely.
-- Verified after applying: the busiest teacher still reads 8 sections / 444
-- students / 665 class_records / 16 facilitators as `authenticated`.

-- 1. Drop redundant duplicate permissive policies. Each is fully covered by the
--    table's "Enable ALL access for owner" policy for the authenticated teacher,
--    and is a no-op for anon (auth.uid() is null → the predicate is false), so
--    the faci panel is unaffected.
DROP POLICY IF EXISTS "Teachers can only access their own facilitators" ON public.facilitators;
DROP POLICY IF EXISTS "Teachers can view their own sections"   ON public.sections;
DROP POLICY IF EXISTS "Teachers can insert their own sections" ON public.sections;
DROP POLICY IF EXISTS "Teachers can update their own sections" ON public.sections;
DROP POLICY IF EXISTS "Teachers can delete their own sections" ON public.sections;
DROP POLICY IF EXISTS "Teachers can manage their own students" ON public.students;

-- 2. Wrap auth.uid() in (select ...) so Postgres evaluates it once per query
--    (an InitPlan) instead of once per row. Semantically identical.
ALTER POLICY "Enable ALL access for owner" ON public.attendance
  USING ((select auth.uid()) = teacher_id)
  WITH CHECK ((select auth.uid()) = teacher_id);

ALTER POLICY "Enable ALL access for owner" ON public.class_records
  USING (EXISTS (SELECT 1 FROM sections WHERE sections.id = class_records.section_id AND sections.teacher_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM sections WHERE sections.id = class_records.section_id AND sections.teacher_id = (select auth.uid())));

ALTER POLICY "Enable ALL access for owner" ON public.facilitators
  USING ((select auth.uid()) = teacher_id)
  WITH CHECK ((select auth.uid()) = teacher_id);

ALTER POLICY "Users can insert their own profile" ON public.profiles
  WITH CHECK ((select auth.uid()) = id);

ALTER POLICY "Users can update own profile" ON public.profiles
  USING ((select auth.uid()) = id);

ALTER POLICY "Enable ALL access for owner" ON public.sections
  USING ((select auth.uid()) = teacher_id)
  WITH CHECK ((select auth.uid()) = teacher_id);

ALTER POLICY "Enable ALL access for owner" ON public.students
  USING (EXISTS (SELECT 1 FROM sections WHERE sections.id = students.section_id AND sections.teacher_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM sections WHERE sections.id = students.section_id AND sections.teacher_id = (select auth.uid())));

-- subjects: also narrow the owner policy from `public` to `authenticated` so it
-- no longer overlaps subjects_anon_read for the anon role. Anon still reads
-- subjects via subjects_anon_read; the teacher writes as authenticated.
ALTER POLICY "Enable ALL access for owner" ON public.subjects
  TO authenticated
  USING ((select auth.uid()) = teacher_id)
  WITH CHECK ((select auth.uid()) = teacher_id);

-- 3. Drop an index the planner never used.
DROP INDEX IF EXISTS public.idx_subjects_teacher_id;
