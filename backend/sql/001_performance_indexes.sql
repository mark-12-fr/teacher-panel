-- 001_performance_indexes.sql
-- ============================================================================
-- Performance indexes for the AcadTrack shared Supabase Postgres database
-- (used by BOTH the teacher panel and the faci panel).
--
-- WHY: every hot query in the app filters a big table by a foreign-key / owner
-- column — class_records by section_id, attendance by teacher+section, students
-- by section_id, and the per-teacher / per-user dashboard lists. In Postgres a
-- FOREIGN KEY does NOT create an index automatically (only PRIMARY KEYs do), so
-- without these, each of those lookups is a SEQUENTIAL SCAN. That is fine on a
-- few thousand rows but degrades badly toward millions — exactly the "500 users
-- + millions of records" case. With these indexes Postgres jumps straight to
-- the matching rows and stays fast at scale.
--
-- SAFE TO RUN ANYTIME: every statement is idempotent (IF NOT EXISTS), creates
-- no data, and can be reversed with the matching DROP INDEX. Create them now
-- while the tables are still small — index creation is then instant. (If a
-- table is ALREADY large when you run this, swap CREATE INDEX for
-- `CREATE INDEX CONCURRENTLY` — same statements, but run one at a time and NOT
-- inside a transaction — so writes aren't blocked while the index builds.)
--
-- HOW TO APPLY: Supabase Dashboard -> SQL Editor -> paste this file -> Run.
-- (Or via the Supabase CLI / any psql session against the same database.)
-- ============================================================================

-- ── class_records — the hottest table: loaded per section every time the
--    record page opens, and fanned out per section on the dashboard. ──────────
CREATE INDEX IF NOT EXISTS idx_class_records_section_id
    ON public.class_records (section_id);
CREATE INDEX IF NOT EXISTS idx_class_records_student_id
    ON public.class_records (student_id);

-- ── attendance — grows every school day; always filtered by the owning
--    teacher + section, often narrowed to a single date. A composite index
--    serves the "whole section" read, the per-date read, and the per-day
--    delete-before-resave, all from one structure. ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_attendance_teacher_section_date
    ON public.attendance (teacher_id, section, date);

-- ── students — listed per section (roster). ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_students_section_id
    ON public.students (section_id);

-- ── per-teacher lookups (sections / subjects / facilitators lists). ─────────
CREATE INDEX IF NOT EXISTS idx_sections_teacher_id
    ON public.sections (teacher_id);
CREATE INDEX IF NOT EXISTS idx_subjects_teacher_id
    ON public.subjects (teacher_id);
CREATE INDEX IF NOT EXISTS idx_facilitators_teacher_id
    ON public.facilitators (teacher_id);

-- ── facilitator_logs — "latest 5 for this facilitator" (ORDER BY time_in DESC).
--    The DESC ordering in the index lets that come straight off the top. ───────
CREATE INDEX IF NOT EXISTS idx_facilitator_logs_facilitator_time
    ON public.facilitator_logs (facilitator_id, time_in DESC);

-- ── per-user dashboard lists (schedules / notices / notes). ─────────────────
CREATE INDEX IF NOT EXISTS idx_schedules_user_id
    ON public.schedules (user_id);
CREATE INDEX IF NOT EXISTS idx_notices_user_id
    ON public.notices (user_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_id
    ON public.notes (user_id);

-- Verify afterwards (optional): the query below lists every index now present.
--   SELECT tablename, indexname FROM pg_indexes
--   WHERE schemaname = 'public' ORDER BY tablename, indexname;
