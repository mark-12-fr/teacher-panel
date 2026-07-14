"""schemas.py — request/response models for the Teacher API."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Profile ─────────────────────────────────────────────────────────────────
class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    theme: Optional[str] = None
    email: Optional[str] = None


# ── Sections ────────────────────────────────────────────────────────────────
class SectionIn(BaseModel):
    title: str
    subject: Optional[str] = None
    room: Optional[str] = None
    semester: Optional[str] = None
    school_year: Optional[str] = None
    quarter: Optional[str] = None


class SectionUpdate(BaseModel):
    title: Optional[str] = None
    subject: Optional[str] = None
    room: Optional[str] = None
    semester: Optional[str] = None
    school_year: Optional[str] = None
    quarter: Optional[str] = None

    class Config:
        extra = "ignore"


# ── Students ────────────────────────────────────────────────────────────────
class StudentIn(BaseModel):
    full_name: str
    id_no: Optional[str] = None


class StudentUpdate(BaseModel):
    full_name: Optional[str] = None
    id_no: Optional[str] = None


class StudentsBulkIn(BaseModel):
    """Add many students to a section at once (paste a class list)."""
    students: List[StudentIn]


# ── Subjects (grade config) ─────────────────────────────────────────────────
class SubjectIn(BaseModel):
    name: str
    ww_percent: float = 30
    pt_percent: float = 50
    exam_percent: float = 20
    attendance_percent: float = 0
    passing_grade: float = 75


class SubjectUpdate(BaseModel):
    name: Optional[str] = None
    ww_percent: Optional[float] = None
    pt_percent: Optional[float] = None
    exam_percent: Optional[float] = None
    attendance_percent: Optional[float] = None
    passing_grade: Optional[float] = None


# ── Facilitators ────────────────────────────────────────────────────────────
class FacilitatorIn(BaseModel):
    full_name: str
    section: str
    subject: str
    account_id: str
    password: str


class FacilitatorUpdate(BaseModel):
    full_name: Optional[str] = None
    section: Optional[str] = None
    subject: Optional[str] = None
    account_id: Optional[str] = None
    password: Optional[str] = None
    status: Optional[str] = None
    avatar_url: Optional[str] = None

    class Config:
        extra = "ignore"


# ── Schedules / notices / notes ─────────────────────────────────────────────
class ScheduleIn(BaseModel):
    subject: str
    time: str
    details: Optional[str] = None


class NoticeIn(BaseModel):
    text: str
    date: Optional[str] = None
    time: Optional[str] = None
    color: Optional[str] = "blue"


class NoteIn(BaseModel):
    content: str


# ── Attendance / records ────────────────────────────────────────────────────
class AttendanceItem(BaseModel):
    student_name: str
    student_id_no: Optional[str] = ""
    status: str
    remarks: Optional[str] = None


class AttendanceSaveIn(BaseModel):
    section: str
    date: str
    subject: Optional[str] = None
    quarter: Optional[str] = None
    items: List[AttendanceItem]


class ClassRecordUpsert(BaseModel):
    id: Optional[str] = None

    class Config:
        extra = "allow"
    student_id: str
    quarter: Optional[str] = None
    date: Optional[str] = None
    scores: Dict[str, Any] = Field(default_factory=dict)


# ── AI ──────────────────────────────────────────────────────────────────────
class AiEvaluateIn(BaseModel):
    question: str
    context: str = ""


# ── Push ────────────────────────────────────────────────────────────────────
class PushSubscribeIn(BaseModel):
    endpoint: str
    subscription: Dict[str, Any]
