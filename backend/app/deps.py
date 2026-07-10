"""deps.py — ownership helpers so a teacher only ever touches their own rows."""
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Section
from .security import CurrentTeacher


async def own_section(db: AsyncSession, teacher: CurrentTeacher, section_id: str) -> Section:
    """Load a section and assert it belongs to the authenticated teacher."""
    try:
        sid = UUID(str(section_id))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found.")
    section = (
        await db.execute(select(Section).where(Section.id == sid))
    ).scalar_one_or_none()
    if section is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found.")
    if str(section.teacher_id) != str(teacher.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your section.")
    return section
