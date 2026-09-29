-- 005_faci_submission_checks.sql
--
-- Applied to the live Supabase project (njzvuwkepaasnsvuujgx) on 2026-09-29.
-- Verified beforehand on a throwaway Postgres 16 (15 scenarios: first submit,
-- unchanged re-send, partial follow-up submits, teacher edits, cleared cells,
-- numeric-equal values, account_id-style ids, attendance, a broken bookkeeping
-- column never blocking a write, idempotent re-run) and as a rolled-back dry run
-- on the live schema. Cost: ~3 ms extra for a 56-student submit.
--
-- Powers the dashboard's per-facilitator "submitted today" checklist
-- (Module / Activity / AT / PT / Exam / Attendance).
--
-- The facilitator app writes straight to Supabase, so the one place that sees
-- every submission — from any app version, online or synced later — is the
-- database. A trigger notes WHAT a facilitator just submitted by stamping the
-- time on that facilitator's own row:
--
--   facilitators.last_submitted =
--     {"module": "2026-09-29T02:14:05Z", "attendance": "2026-09-29T02:20:41Z", ...}
--
-- The dashboard already loads /api/facilitators, so it reads the stamps for free
-- and shows a check only when a stamp falls on the teacher's CURRENT calendar
-- day — every category therefore resets by itself at midnight, with no job.
--
-- What counts as "submitted":
--   * class_records, written by a facilitator (facilitator_id set — the teacher
--     panel writes NULL for its own saves, so teacher edits never count):
--     a score cell that is now filled in AND differs from before. The
--     facilitator app re-sends the whole section on every submit (locked cells
--     included), so comparing old vs new is what isolates what is actually new.
--       module_1..25 -> module     activity_1..10 -> activity
--       at           -> at         pt_1, pt_2     -> pt        qe -> exam
--   * attendance rows written by a facilitator -> attendance.
--
-- Safety: the trigger can never block a submission (any error inside it is
-- swallowed), touches only facilitators.last_submitted, and skips no-op updates
-- (now() is constant inside a transaction, so a 56-row submit writes each
-- category once). Access is unchanged: the function is SECURITY DEFINER with a
-- pinned search_path and is not callable through the API.

-- 1. Where the stamps live. Nullable + constant default = a metadata-only change.
ALTER TABLE public.facilitators
  ADD COLUMN IF NOT EXISTS last_submitted jsonb DEFAULT '{}'::jsonb;

-- 2. The trigger function.
CREATE OR REPLACE FUNCTION public.track_faci_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  cats  text[] := array[]::text[];
  n     jsonb;
  o     jsonb;
  k     text;
  v     jsonb;
  cat   text;
  stamp text;
  patch jsonb := '{}'::jsonb;
begin
  begin
    if tg_table_name = 'attendance' then
      cats := array['attendance'];
    else
      n := to_jsonb(new);
      o := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
      for k, v in select key, value from jsonb_each(n) loop
        -- an empty or cleared cell is not a submission
        if v = 'null'::jsonb then continue; end if;
        cat := case
          when k ~ '^module_[0-9]+$'   then 'module'
          when k ~ '^activity_[0-9]+$' then 'activity'
          when k = 'at'                then 'at'
          when k ~ '^pt_[0-9]+$'       then 'pt'
          when k = 'qe'                then 'exam'
          else null
        end;
        if cat is null or cat = any (cats) then continue; end if;
        if (o -> k) is distinct from v then cats := cats || cat; end if;
      end loop;
    end if;

    if coalesce(array_length(cats, 1), 0) = 0 then
      return null;
    end if;

    stamp := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    foreach cat in array cats loop
      patch := patch || jsonb_build_object(cat, stamp);
    end loop;

    -- facilitator_id holds the facilitator's uuid (older sessions: account_id).
    update public.facilitators f
       set last_submitted = coalesce(f.last_submitted, '{}'::jsonb) || patch
     where (f.id::text = new.facilitator_id or f.account_id = new.facilitator_id)
       and not (coalesce(f.last_submitted, '{}'::jsonb) @> patch);
  exception when others then
    null; -- bookkeeping must never block a facilitator's submission
  end;
  return null;
end;
$function$;

-- Triggers only need the function to exist; nobody should be able to call it.
REVOKE ALL ON FUNCTION public.track_faci_submission() FROM PUBLIC, anon, authenticated;

-- 3. Fire only for facilitator-authored writes.
DROP TRIGGER IF EXISTS trg_track_faci_submission ON public.class_records;
CREATE TRIGGER trg_track_faci_submission
  AFTER INSERT OR UPDATE ON public.class_records
  FOR EACH ROW WHEN (NEW.facilitator_id IS NOT NULL)
  EXECUTE FUNCTION public.track_faci_submission();

DROP TRIGGER IF EXISTS trg_track_faci_submission ON public.attendance;
CREATE TRIGGER trg_track_faci_submission
  AFTER INSERT OR UPDATE ON public.attendance
  FOR EACH ROW WHEN (NEW.facilitator_id IS NOT NULL)
  EXECUTE FUNCTION public.track_faci_submission();

-- 4. One-time backfill: attendance a facilitator already took TODAY (Philippine
--    date, in the dd/mm/yyyy text the apps store) counts from the first minute
--    instead of from the next submission. Idempotent.
UPDATE public.facilitators f
   SET last_submitted = coalesce(f.last_submitted, '{}'::jsonb)
         || jsonb_build_object('attendance', to_char(a.latest at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  FROM (
    SELECT facilitator_id, max(created_at) AS latest
      FROM public.attendance
     WHERE facilitator_id IS NOT NULL
       AND date = to_char(now() at time zone 'Asia/Manila', 'DD/MM/YYYY')
     GROUP BY facilitator_id
  ) a
 WHERE f.id::text = a.facilitator_id OR f.account_id = a.facilitator_id;
