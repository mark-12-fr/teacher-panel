"""
sections.py — sections CRUD (+ cascade delete) and their students.
================================================================
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..deps import own_section
from ..models import Attendance, ClassRecord, Section, Student
from ..schemas import (
    SectionIn,
    SectionUpdate,
    StudentIn,
    StudentsBulkIn,
    StudentUpdate,
)
from ..security import CurrentTeacher, get_current_teacher
from ..utils import orm_list, orm_to_dict

router = APIRouter(prefix="/api", tags=["sections"])


@router.get("/sections")
async def list_sections(
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    # One query with a LEFT JOIN + COUNT instead of a follow-up
    # /sections/{id}/students request per section — the list pages (Section,
    # Class Record, Attendance, Class Performance) used to fire N extra HTTP
    # round-trips just to show a student count.
    rows = (
        await db.execute(
            select(Section, func.count(Student.id).label("student_count"))
            .outerjoin(Student, Student.section_id == Section.id)
            .where(Section.teacher_id == UUID(teacher.id))
            .group_by(Section.id)
            .order_by(Section.created_at.desc())
        )
    ).all()
    sections = []
    for section, student_count in rows:
        d = orm_to_dict(section)
        d["student_count"] = student_count
        sections.append(d)
    return {"sections": sections}


@router.get("/active-school-year")
async def active_school_year(
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Section.school_year)
            .where(Section.teacher_id == UUID(teacher.id))
            .distinct()
        )
    ).scalars().all()
    # Return the most recent school year (e.g., "2025-2026")
    years = [y for y in rows if y]
    years.sort(reverse=True)
    return {"school_year": years[0] if years else None}


@router.get("/sections/{section_id}")
async def get_section(
    section_id: str,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    section = await own_section(db, teacher, section_id)
    return {"section": orm_to_dict(section)}


@router.post("/sections")
async def create_section(
    body: SectionIn,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    row = Section(
        teacher_id=UUID(teacher.id),
        title=body.title,
        subject=body.subject,
        room=body.room,
        semester=body.semester,
        school_year=body.school_year,
        quarter=body.quarter,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"section": orm_to_dict(row)}


@router.patch("/sections/{section_id}")
async def update_section(
    section_id: str,
    body: SectionUpdate,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    section = await own_section(db, teacher, section_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(section, k, v)
    await db.commit()
    await db.refresh(section)
    return {"section": orm_to_dict(section)}


@router.delete("/sections/{section_id}")
async def delete_section(
    section_id: str,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """Delete a section and its dependent rows (students, class_records,
    attendance) — mirrors the legacy cascade in section.html."""
    section = await own_section(db, teacher, section_id)
    await db.execute(delete(ClassRecord).where(ClassRecord.section_id == section.id))
    await db.execute(delete(Student).where(Student.section_id == section.id))
    await db.execute(
        delete(Attendance).where(
            Attendance.section == section.title, Attendance.teacher_id == UUID(teacher.id)
        )
    )
    await db.execute(delete(Section).where(Section.id == section.id))
    await db.commit()
    return {"ok": True}


# ── Students (subresource of a section) ─────────────────────────────────────
@router.get("/sections/{section_id}/students")
async def list_students(
    section_id: str,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    section = await own_section(db, teacher, section_id)
    rows = (
        await db.execute(
            select(Student).where(Student.section_id == section.id).order_by(Student.full_name.asc())
        )
    ).scalars().all()
    return {"students": orm_list(rows)}


@router.post("/sections/{section_id}/students")
async def add_student(
    section_id: str,
    body: StudentIn,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    section = await own_section(db, teacher, section_id)
    row = Student(section_id=section.id, full_name=body.full_name, gender=body.gender)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"student": orm_to_dict(row)}


@router.post("/sections/{section_id}/students/bulk")
async def add_students_bulk(
    section_id: str,
    body: StudentsBulkIn,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    section = await own_section(db, teacher, section_id)
    created = []
    for s in body.students:
        row = Student(section_id=section.id, full_name=s.full_name, gender=s.gender)
        db.add(row)
        created.append(row)
    await db.commit()
    for r in created:
        await db.refresh(r)
    return {"students": orm_list(created), "count": len(created)}


async def _own_student(db: AsyncSession, teacher: CurrentTeacher, student_id: str) -> Student:
    try:
        sid = UUID(str(student_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found.")
    student = (await db.execute(select(Student).where(Student.id == sid))).scalar_one_or_none()
    if student is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found.")
    # Ensure the student's section belongs to this teacher.
    await own_section(db, teacher, str(student.section_id))
    return student


@router.patch("/students/{student_id}")
async def update_student(
    student_id: str,
    body: StudentUpdate,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    student = await _own_student(db, teacher, student_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(student, k, v)
    await db.commit()
    await db.refresh(student)
    return {"student": orm_to_dict(student)}


@router.delete("/students/{student_id}")
async def delete_student(
    student_id: str,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    student = await _own_student(db, teacher, student_id)
    await db.execute(delete(ClassRecord).where(ClassRecord.student_id == student.id))
    await db.execute(delete(Student).where(Student.id == student.id))
    await db.commit()
    return {"ok": True}
