"""
dashboard.py — profile, schedules, notices, notes (the dashboard board).
=======================================================================
All rows are keyed to the authenticated teacher (profiles.id / user_id).
"""
from datetime import date as date_cls, datetime, time as time_cls, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Attendance, ClassRecord, Note, Notice, Profile, Schedule, Section, Student, Subject
from ..schemas import NoteIn, NoticeIn, ProfileUpdate, ScheduleIn
from ..security import CurrentTeacher, get_current_teacher
from ..utils import orm_list, orm_to_dict

router = APIRouter(prefix="/api", tags=["dashboard"])

# Upper bound on the personal board lists (schedules / notices / notes). These
# are per-teacher and shown newest-first, so capping the fetch means one account
# accumulating years of entries can never pull an unbounded set in one request.
# Far above any real teacher's count, so normal boards are never truncated.
MAX_PERSONAL_ITEMS = 500


# ── Dashboard bulk fetch ────────────────────────────────────────────────────
@router.get("/dashboard-bulk")
async def dashboard_bulk(
    today: Optional[str] = Query(default=None, description="dd/mm/yyyy, matches Attendance.date"),
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Single-request bulk fetch that powers the dashboard.

    The dashboard previously fanned out to 3 endpoints (students, today's
    attendance, class-records) PER SECTION — up to 3N+2 sequential HTTP
    round-trips to Render for a teacher with N sections. This collapses that
    into a handful of queries scoped across all of the teacher's sections at
    once. All grade/attendance-rate math still happens on the frontend
    (lib/grading.ts), unchanged — this endpoint only removes the network
    overhead of fetching the raw rows.
    """
    tid = UUID(teacher.id)

    section_rows = (
        await db.execute(
            select(Section, func.count(Student.id).label("student_count"))
            .outerjoin(Student, Student.section_id == Section.id)
            .where(Section.teacher_id == tid)
            .group_by(Section.id)
            .order_by(Section.created_at.desc())
        )
    ).all()
    sections = []
    section_ids = []
    section_titles = []
    for section, student_count in section_rows:
        d = orm_to_dict(section)
        d["student_count"] = student_count
        sections.append(d)
        section_ids.append(section.id)
        section_titles.append(section.title)

    subjects = orm_list(
        (await db.execute(select(Subject).where(Subject.teacher_id == tid))).scalars().all()
    )

    students: list = []
    records: list = []
    attendance_today: list = []
    if section_ids:
        students = orm_list(
            (
                await db.execute(select(Student).where(Student.section_id.in_(section_ids)))
            ).scalars().all()
        )
        records = orm_list(
            (
                await db.execute(select(ClassRecord).where(ClassRecord.section_id.in_(section_ids)))
            ).scalars().all()
        )
        if today:
            attendance_today = orm_list(
                (
                    await db.execute(
                        select(Attendance).where(
                            Attendance.section.in_(section_titles),
                            Attendance.teacher_id == tid,
                            Attendance.date == today,
                        )
                    )
                ).scalars().all()
            )

    return {
        "sections": sections,
        "subjects": subjects,
        "students": students,
        "class_records": records,
        "attendance_today": attendance_today,
    }


# ── Profile ─────────────────────────────────────────────────────────────────
@router.get("/me")
async def get_me(
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    if teacher.profile is None:
        # First login before a profiles row exists — return the identity we have.
        return {"profile": {"id": teacher.id, "email": teacher.email, "full_name": None}}
    return {"profile": orm_to_dict(teacher.profile)}


@router.patch("/me")
async def update_me(
    body: ProfileUpdate,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    values = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    # Upsert the profile row (it may not exist yet for a brand-new account).
    stmt = pg_insert(Profile).values(id=UUID(teacher.id), **values)
    update_cols = {k: stmt.excluded[k] for k in values}
    if update_cols:
        stmt = stmt.on_conflict_do_update(index_elements=["id"], set_=update_cols)
    else:
        stmt = stmt.on_conflict_do_nothing(index_elements=["id"])
    await db.execute(stmt)
    await db.commit()
    # populate_existing forces a re-read: the auth dependency already loaded the
    # profile into the session's identity map, so a plain select would return
    # that stale copy instead of the values we just upserted.
    row = (
        await db.execute(
            select(Profile).where(Profile.id == UUID(teacher.id)).execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    return {"profile": orm_to_dict(row)}


# ── Schedules ───────────────────────────────────────────────────────────────
@router.get("/schedules")
async def list_schedules(
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Schedule).where(Schedule.user_id == UUID(teacher.id)).order_by(Schedule.created_at.asc()).limit(MAX_PERSONAL_ITEMS)
        )
    ).scalars().all()
    return {"schedules": orm_list(rows)}


@router.post("/schedules")
async def create_schedule(
    body: ScheduleIn,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    row = Schedule(user_id=UUID(teacher.id), subject=body.subject, time=body.time, details=body.details or "")
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"schedule": orm_to_dict(row)}


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(
    schedule_id: str,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        delete(Schedule).where(Schedule.id == UUID(schedule_id), Schedule.user_id == UUID(teacher.id))
    )
    await db.commit()
    return {"ok": True}


# ── Notices ─────────────────────────────────────────────────────────────────
@router.get("/notices")
async def list_notices(
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Notice).where(Notice.user_id == UUID(teacher.id)).order_by(Notice.created_at.desc()).limit(MAX_PERSONAL_ITEMS)
        )
    ).scalars().all()
    return {"notices": orm_list(rows)}


@router.post("/notices")
async def create_notice(
    body: NoticeIn,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    # The DB columns are DATE / TIME, so parse the ISO strings the client sends
    # ("YYYY-MM-DD" and "HH:MM") into real date/time objects (asyncpg needs them).
    def _parse_date(v):
        return date_cls.fromisoformat(v) if v else None

    def _parse_time(v):
        return time_cls.fromisoformat(v) if v else None

    row = Notice(
        user_id=UUID(teacher.id),
        text=body.text,
        date=_parse_date(body.date),
        time=_parse_time(body.time),
        color=body.color or "blue",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"notice": orm_to_dict(row)}


@router.delete("/notices/{notice_id}")
async def delete_notice(
    notice_id: str,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        delete(Notice).where(Notice.id == UUID(notice_id), Notice.user_id == UUID(teacher.id))
    )
    await db.commit()
    return {"ok": True}


# ── Notes ───────────────────────────────────────────────────────────────────
@router.get("/notes")
async def list_notes(
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Note).where(Note.user_id == UUID(teacher.id)).order_by(Note.created_at.desc()).limit(MAX_PERSONAL_ITEMS)
        )
    ).scalars().all()
    return {"notes": orm_list(rows)}


@router.post("/notes")
async def create_note(
    body: NoteIn,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    row = Note(user_id=UUID(teacher.id), content=body.content)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"note": orm_to_dict(row)}


@router.delete("/notes/{note_id}")
async def delete_note(
    note_id: str,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(Note).where(Note.id == UUID(note_id), Note.user_id == UUID(teacher.id)))
    await db.commit()
    return {"ok": True}
