"""Student and Parent portals.

Both are read mostly and both are scoped tighter than the teacher
routes: a student sees their own record, a parent sees their child's.
Neither can enumerate the roster.
"""

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.timeutil import as_utc, is_past, utc_now
from app.middleware.tenant import CurrentOrg, CurrentUser, require_role
from app.models import (
    ClassTicket,
    Content,
    Event,
    ContentView,
    QuizAttempt,
    QuizQuestion,
    Student,
    StudentPayment,
    User,
)
from app.services import analytics_service as analytics
from app.services.page_access_service import require_page

student_router = APIRouter(
    prefix="/student", tags=["student"], dependencies=[Depends(require_role("student"))]
)
parent_router = APIRouter(
    prefix="/parent", tags=["parent"], dependencies=[Depends(require_role("parent"))]
)


async def _self(session: AsyncSession, org_id: str, user_id: str) -> Student:
    result = await session.execute(
        select(Student).where(Student.student_id == user_id, Student.org_id == org_id)
    )
    student = result.scalar_one_or_none()
    if student is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No student record for this account.",
        )
    return student


async def _child_of(session: AsyncSession, org_id: str, parent_id: str) -> tuple[Student, User]:
    """The child linked to this parent, within the same organisation.

    Both the parent link and the org must match. A parent can never
    reach a student outside their own organisation even if a stale
    parent_id somehow pointed there.
    """
    result = await session.execute(
        select(Student, User)
        .join(User, User.user_id == Student.student_id)
        .where(Student.org_id == org_id, Student.parent_id == parent_id)
    )
    row = result.first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No child is linked to this account.",
        )
    return row


# ----------------------------------------------------------------------
# Student
# ----------------------------------------------------------------------


@student_router.get("/overview")
async def student_overview(
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    student = await _self(session, org.org_id, user.user_id)

    payments = await session.execute(
        select(StudentPayment)
        .where(
            StudentPayment.org_id == org.org_id,
            StudentPayment.student_id == student.student_id,
        )
        .order_by(StudentPayment.created_at.desc())
    )
    payment_rows = list(payments.scalars())
    current = next((p for p in payment_rows if p.status == "paid"), None)

    content = await session.execute(
        select(Content)
        .where(Content.org_id == org.org_id)
        .order_by(Content.created_at.desc())
        .limit(4)
    )
    items = list(content.scalars())
    progress = analytics._spread(
        analytics._seed(org.org_id, user.user_id, "progress"), len(items), 0, 101
    )

    events = await session.execute(
        select(Event)
        .where(Event.org_id == org.org_id, Event.scheduled_at >= datetime.now(timezone.utc))
        .order_by(Event.scheduled_at)
        .limit(4)
    )

    attendance = await analytics.attendance_weeks(session, org.org_id, student.student_id)

    return {
        "student": {
            "studentId": student.student_id,
            "name": user.name,
            "batch": student.batch,
            "group": student.group,
            "paymentStatus": current.status if current else "unpaid",
            "ticketExpiry": current.expiry_date if current else None,
            "attendancePct": attendance["attendancePct"],
        },
        "track": [
            {
                "id": c.content_id,
                "title": c.title,
                "subject": c.subject,
                "type": c.type,
                "durationMins": c.duration_mins or 0,
                "progress": p,
                "watchedMins": round((c.duration_mins or 0) * p / 100),
                "synthetic": True,
            }
            for c, p in zip(items, progress)
        ],
        "events": [
            {
                "eventId": e.event_id,
                "title": e.title,
                "type": e.type,
                "scheduledAt": e.scheduled_at,
                "durationMins": e.duration_mins,
                "batch": e.batch,
            }
            for e in events.scalars()
        ],
    }


@student_router.get("/library", dependencies=[Depends(require_page("student.library"))])
async def student_library(
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    subject: str | None = None,
    q: str | None = None,
) -> list[dict]:
    stmt = (
        select(Content)
        .where(Content.org_id == org.org_id)
        .order_by(Content.created_at.desc())
    )
    if subject:
        stmt = stmt.where(Content.subject == subject)
    if q:
        stmt = stmt.where(Content.title.ilike(f"%{q}%"))

    rows = list((await session.execute(stmt)).scalars())

    # Real progress, from this student's own views. The furthest point
    # reached rather than the most recent, so rewatching the opening of
    # a video does not undo the bar.
    seen = await session.execute(
        select(ContentView.content_id, func.max(ContentView.progress_pct))
        .where(
            ContentView.org_id == org.org_id,
            ContentView.student_id == user.user_id,
        )
        .group_by(ContentView.content_id)
    )
    progress = dict(seen.all())

    return [
        {
            "contentId": c.content_id,
            "title": c.title,
            "subject": c.subject,
            "type": c.type,
            "durationMins": c.duration_mins,
            "createdAt": c.created_at,
            "progress": progress.get(c.content_id, 0) or 0,
            # Whether there is actually a file behind this. The UI needs
            # it to say "not uploaded yet" rather than opening a blank
            # tab, which is what it did before there was any storage.
            "hasFile": bool(c.storage_key),
            "fileName": c.original_name,
            "sizeBytes": c.size_bytes,
            "synthetic": False,
        }
        for c in rows
    ]


@student_router.get("/quizzes", dependencies=[Depends(require_page("student.quizzes"))])
async def student_quizzes(
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[dict]:
    """Quizzes set for this student, with their real attempt state.

    Status and score used to be generated here because there was no
    attempt table. There is one now, so this joins it. The shape did not
    change, which was the point of flagging rather than faking the
    contract.

    Best attempt wins where there are several, so a student who retook a
    quiz sees the result they earned rather than the first one.
    """
    result = await session.execute(
        select(Content)
        .where(Content.org_id == org.org_id, Content.type == "quiz")
        .order_by(Content.created_at.desc())
    )
    rows = list(result.scalars())

    counts = await session.execute(
        select(QuizQuestion.content_id, func.count(QuizQuestion.question_id))
        .where(QuizQuestion.org_id == org.org_id)
        .group_by(QuizQuestion.content_id)
    )
    question_count = dict(counts.all())

    attempts = await session.execute(
        select(QuizAttempt)
        .where(QuizAttempt.org_id == org.org_id, QuizAttempt.student_id == user.user_id)
        .order_by(QuizAttempt.started_at)
    )
    best: dict[str, QuizAttempt] = {}
    in_progress: set[str] = set()
    for a in attempts.scalars():
        if a.submitted_at is None:
            in_progress.add(a.content_id)
            continue
        held = best.get(a.content_id)
        if held is None or a.percent > held.percent:
            best[a.content_id] = a

    now = utc_now()
    out = []
    for quiz in rows:
        due = quiz.created_at + timedelta(days=14)
        graded = best.get(quiz.content_id)
        if graded is not None:
            status = "graded"
        elif quiz.content_id in in_progress or not is_past(due):
            # An attempt left open still counts as open, so a dropped
            # connection does not read as a missed quiz.
            status = "open"
        else:
            status = "missed"

        out.append(
            {
                "quizId": quiz.content_id,
                "title": quiz.title,
                "subject": quiz.subject,
                "questions": question_count.get(quiz.content_id, 0),
                "dueAt": due,
                "status": status,
                "score": graded.percent if graded else None,
                "attempts": sum(
                    1 for c in [graded] if c is not None
                ),
                "inProgress": quiz.content_id in in_progress,
                "synthetic": False,
            }
        )
    return out


@student_router.get("/payments", dependencies=[Depends(require_page("student.payments"))])
async def student_payments(
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[dict]:
    result = await session.execute(
        select(StudentPayment)
        .where(
            StudentPayment.org_id == org.org_id,
            StudentPayment.student_id == user.user_id,
        )
        .order_by(StudentPayment.created_at.desc())
    )
    return [
        {
            "paymentId": p.payment_id,
            "amount": float(p.amount),
            "currency": p.currency,
            "status": p.status,
            "method": p.method,
            "submittedAt": p.created_at,
            "expiryDate": p.expiry_date,
        }
        for p in result.scalars()
    ]


@student_router.get("/ticket", dependencies=[Depends(require_page("student.ticket"))])
async def student_ticket(
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """The student's own live ticket.

    The signed payload is regenerated here rather than stored, so a
    stolen database row is not itself a usable credential.
    """
    student = await _self(session, org.org_id, user.user_id)
    # Newest live ticket, not the only one. Reissue revokes the previous
    # row, but two reissues racing can briefly leave two live, and
    # scalar_one_or_none turns that into a 500 on a read path. A
    # student opening their pass should never see the app fall over
    # because of a write that happened elsewhere.
    result = await session.execute(
        select(ClassTicket)
        .where(
            ClassTicket.org_id == org.org_id,
            ClassTicket.student_id == student.student_id,
            ClassTicket.revoked.is_(False),
        )
        .order_by(ClassTicket.created_at.desc())
        .limit(1)
    )
    ticket = result.scalars().first()
    if ticket is None or is_past(ticket.expiry_date):
        return {"active": False, "reason": "No active ticket. Settle fees to get one."}

    from app.services.qr_service import TicketPayload
    import json

    payload = TicketPayload(
        student_name=user.name,
        student_id=student.student_id,
        org_id=org.org_id,
        batch=student.batch or "",
        group=student.group or "",
        # Signed payloads must carry an unambiguous instant, so the
        # stored value is normalised before it is serialised.
        expiry_date=as_utc(ticket.expiry_date).isoformat(),
    ).to_dict()

    return {
        "active": True,
        "ticketId": ticket.ticket_id,
        "payload": json.dumps({**payload, "sig": ticket.signature}, separators=(",", ":")),
        "expiryDate": ticket.expiry_date,
        "scanCount": ticket.scan_count,
        "batch": student.batch,
        "group": student.group,
    }


# ----------------------------------------------------------------------
# Parent
# ----------------------------------------------------------------------


@parent_router.get("/progress")
async def parent_progress(
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    student, child = await _child_of(session, org.org_id, user.user_id)
    attendance = await analytics.attendance_weeks(session, org.org_id, student.student_id)

    subjects_result = await session.execute(
        select(Content.subject)
        .where(Content.org_id == org.org_id, Content.subject.is_not(None))
        .distinct()
    )
    subjects = [s for (s,) in subjects_result.all() if s]

    seed = analytics._seed(org.org_id, student.student_id, "grades")
    scores = analytics._spread(seed, len(subjects), 58, 94)

    payments = await session.execute(
        select(StudentPayment)
        .where(
            StudentPayment.org_id == org.org_id,
            StudentPayment.student_id == student.student_id,
        )
        .order_by(StudentPayment.created_at.desc())
    )
    payment_rows = list(payments.scalars())
    current = next((p for p in payment_rows if p.status == "paid"), None)

    return {
        "child": {
            "studentId": student.student_id,
            "name": child.name,
            "batch": student.batch,
            "group": student.group,
            "attendancePct": attendance["attendancePct"],
            "paymentStatus": current.status if current else "unpaid",
            "ticketExpiry": current.expiry_date if current else None,
        },
        "attendance": attendance,
        "subjects": [
            {
                "subject": subject,
                "score": score,
                # Trend to the current score, so the sparkline ends where
                # the printed number says it does.
                "trend": analytics._spread(seed + i, 6, max(45, score - 18), score + 4)
                + [score],
                "delta": score - analytics._spread(seed + i, 1, max(45, score - 18), score + 4)[0],
                "synthetic": True,
            }
            for i, (subject, score) in enumerate(zip(subjects, scores))
        ],
        "payments": [
            {
                "paymentId": p.payment_id,
                "amount": float(p.amount),
                "currency": p.currency,
                "status": p.status,
                "method": p.method,
                "submittedAt": p.created_at,
                "expiryDate": p.expiry_date,
            }
            for p in payment_rows
        ],
    }


@parent_router.get(
    "/attendance", dependencies=[Depends(require_page("parent.attendance"))]
)
async def parent_attendance(
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    student, _child = await _child_of(session, org.org_id, user.user_id)
    return await analytics.attendance_weeks(session, org.org_id, student.student_id)
