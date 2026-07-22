"""
records.py — attendance + class_records for a teacher's section.
==============================================================
"""
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import own_section
from ..models import CLASS_RECORD_SCORE_FIELDS, Attendance, ClassRecord
from ..schemas import AttendanceSaveIn, ClassRecordUpsert
from ..security import CurrentTeacher, get_current_teacher
from ..utils import orm_list

router = APIRouter(prefix="/api/sections", tags=["records"])
_ALLOWED = set(CLASS_RECORD_SCORE_FIELDS)


# ── Attendance ──────────────────────────────────────────────────────────────
@router.get("/{section_id}/attendance")
async def get_attendance(
    section_id: str,
    date: Optional[str] = Query(default=None),
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    section = await own_section(db, teacher, section_id)
    stmt = select(Attendance).where(
        Attendance.section == section.title, Attendance.teacher_id == UUID(teacher.id)
    )
    if date is not None:
        stmt = stmt.where(Attendance.date == date)
    # Safety cap so one request can never pull an unbounded set as data grows.
    # A single section's attendance is roster × school-days; 50k newest rows is
    # ~6 school years for a 40-student class — unreachable in normal use, so the
    # frontend's attendance-rate math (which reads the whole section) is never
    # actually truncated. The idx_attendance_teacher_section_date index keeps
    # this fast; see backend/sql/001_performance_indexes.sql.
    stmt = stmt.order_by(Attendance.created_at.desc()).limit(50000)
    rows = (await db.execute(stmt)).scalars().all()
    return {"attendance": orm_list(rows)}


@router.post("/{section_id}/attendance")
async def save_attendance(
    section_id: str,
    body: AttendanceSaveIn,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    section = await own_section(db, teacher, section_id)
    await db.execute(
        delete(Attendance)
        .where(Attendance.section == section.title)
        .where(Attendance.date == body.date)
        .where(Attendance.teacher_id == UUID(teacher.id))
    )
    for item in body.items:
        db.add(
            Attendance(
                date=body.date,
                section=section.title,
                subject=body.subject or section.subject,
                facilitator_id=None,
                teacher_id=UUID(teacher.id),
                student_name=item.student_name,
                student_id_no=item.student_id_no or "",
                status=item.status,
                remarks=item.remarks,
                quarter=body.quarter,
            )
        )
    await db.commit()
    return {"message": "Attendance saved", "count": len(body.items)}


# ── Class records ───────────────────────────────────────────────────────────
@router.get("/{section_id}/class-records")
async def get_records(
    section_id: str,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    section = await own_section(db, teacher, section_id)
    rows = (
        await db.execute(select(ClassRecord).where(ClassRecord.section_id == section.id))
    ).scalars().all()
    return {"records": orm_list(rows)}


@router.post("/{section_id}/class-records")
async def upsert_records(
    section_id: str,
    records: List[ClassRecordUpsert],
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    section = await own_section(db, teacher, section_id)
    written = 0
    for rec in records:
        values = {"student_id": rec.student_id, "section_id": str(section.id)}
        if rec.id:
            values["id"] = rec.id
        if rec.date is not None:
            values["date"] = rec.date
        if rec.quarter is not None:
            values["quarter"] = rec.quarter
        for k, v in (rec.scores or {}).items():
            if k in _ALLOWED:
                values[k] = v
        stmt = pg_insert(ClassRecord).values(**values)
        update_cols = {k: stmt.excluded[k] for k in values if k != "id"}
        # Guard against cross-teacher overwrite: the conflict target is the PK
        # `id`, so a body carrying another section's record id would otherwise
        # hijack that row. Only update rows that already belong to THIS
        # teacher's section; an out-of-section id becomes a no-op instead.
        stmt = stmt.on_conflict_do_update(
            index_elements=["id"],
            set_=update_cols,
            where=(ClassRecord.section_id == str(section.id)),
        )
        await db.execute(stmt)
        written += 1
    await db.commit()
    return {"message": "Records saved", "count": written}
