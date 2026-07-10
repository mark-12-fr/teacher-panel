"""
facilitators.py — teacher manages facilitator accounts (bcrypt passwords).
========================================================================
Mirrors the old Flask /api/facilitators create/update, plus list + delete.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Facilitator
from ..schemas import FacilitatorIn, FacilitatorUpdate
from ..security import CurrentTeacher, get_current_teacher, hash_password
from ..utils import orm_to_dict

router = APIRouter(prefix="/api/facilitators", tags=["facilitators"])


def _public(row: Facilitator) -> dict:
    d = orm_to_dict(row)
    d.pop("password", None)  # never expose the hash
    return d


@router.get("")
async def list_facilitators(
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Facilitator)
            .where(Facilitator.teacher_id == UUID(teacher.id))
            .order_by(Facilitator.created_at.desc())
        )
    ).scalars().all()
    return {"facilitators": [_public(r) for r in rows]}


@router.post("")
async def create_facilitator(
    body: FacilitatorIn,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    row = Facilitator(
        teacher_id=UUID(teacher.id),
        full_name=body.full_name,
        section=body.section,
        subject=body.subject,
        account_id=body.account_id,
        password=hash_password(body.password),
        status="Inactive",
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That Account ID is already taken. Please use a different one.",
        )
    await db.refresh(row)
    return {"message": "Facilitator assigned successfully!", "facilitator": _public(row)}


async def _own_faci(db: AsyncSession, teacher: CurrentTeacher, fac_id: str) -> Facilitator:
    try:
        fid = UUID(str(fac_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Facilitator not found.")
    row = (await db.execute(select(Facilitator).where(Facilitator.id == fid))).scalar_one_or_none()
    if row is None or str(row.teacher_id) != str(teacher.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Facilitator not found.")
    return row


@router.patch("/{fac_id}")
async def update_facilitator(
    fac_id: str,
    body: FacilitatorUpdate,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    row = await _own_faci(db, teacher, fac_id)
    data = body.model_dump(exclude_unset=True)
    pw = data.pop("password", None)
    for k, v in data.items():
        setattr(row, k, v)
    if pw:
        row.password = hash_password(pw)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That Account ID is already taken.")
    await db.refresh(row)
    return {"message": "Facilitator successfully updated!", "facilitator": _public(row)}


@router.delete("/{fac_id}")
async def delete_facilitator(
    fac_id: str,
    teacher: CurrentTeacher = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    row = await _own_faci(db, teacher, fac_id)
    await db.execute(delete(Facilitator).where(Facilitator.id == row.id))
    await db.commit()
    return {"ok": True}
