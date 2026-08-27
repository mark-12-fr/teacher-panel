-- 003_notifications.sql
-- In-app notification feed behind the teacher panel's bell icon.
--
-- Rows are written by the backend webhook dispatcher (push.py) at the same
-- point it sends a Web Push, so one coalesced facilitator submission produces
-- exactly one notification instead of one per student row.
--
-- RLS is ON with NO policy: only the service role — the API's direct Postgres
-- connection — can read or write these rows, so the public anon key held by the
-- facilitator panel can never read another teacher's feed.
--
-- Idempotent: safe to run more than once.
CREATE TABLE IF NOT EXISTS public.notifications (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id    uuid NOT NULL,
    kind          text NOT NULL,          -- 'attendance' | 'class_records'
    title         text NOT NULL,
    body          text NOT NULL,
    url           text,                   -- in-app link, e.g. /attendance/{id}
    section_label text,
    read_at       timestamptz,            -- NULL = unread
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_teacher_created_idx
    ON public.notifications (teacher_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_teacher_unread_idx
    ON public.notifications (teacher_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
