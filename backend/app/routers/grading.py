"""grading.py — subjects (per-subject grade weights) CRUD."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Subject
from ..schemas import SubjectIn, SubjectUpdate
from ..security import CurrentTeacher, get_current_teacher
from ..utils import orm_list, orm_to_dict

router = APIRouter(prefix="/api/subjects", tags=["subjects"])


@router.get("")
async def list_subjects(
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Subject).where(Subject.teacher_id == UUID(teacher.id)).order_by(Subject.name.asc())
        )
    ).scalars().all()
    return {"subjects": orm_list(rows)}


@router.post("")
async def create_subject(
    body: SubjectIn,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    row = Subject(teacher_id=UUID(teacher.id), **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"subject": orm_to_dict(row)}


async def _own_subject(db: AsyncSession, teacher: CurrentTeacher, subject_id: str) -> Subject:
    try:
        sid = UUID(str(subject_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subject not found.")
    row = (await db.execute(select(Subject).where(Subject.id == sid))).scalar_one_or_none()
    if row is None or str(row.teacher_id) != str(teacher.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subject not found.")
    return row


@router.patch("/{subject_id}")
async def update_subject(
    subject_id: str,
    body: SubjectUpdate,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    row = await _own_subject(db, teacher, subject_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return {"subject": orm_to_dict(row)}


@router.delete("/{subject_id}")
async def delete_subject(
    subject_id: str,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    row = await _own_subject(db, teacher, subject_id)
    await db.execute(delete(Subject).where(Subject.id == row.id))
    await db.commit()
    return {"ok": True}
