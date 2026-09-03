"""CSV exports.

One router, because every export needs the same three things: the
tenant's own rows and nothing else, a safely written file, and a
Content-Disposition header that makes the browser save it.

Tenant scoping is the usual rule with a sharper edge here. An export is
a file that leaves the product and gets emailed around, so a query that
forgot its org_id would not just show the wrong data on a screen, it
would put another school's roll on somebody's laptop. Every query below
filters on the org resolved from the session.
"""

import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.timeutil import as_utc
from app.middleware.tenant import CurrentOrg, require_platform_access, require_role
from app.models import (
    AttendanceRecord,
    AuditEntry,
    Content,
    Event,
    Organization,
    QuizAttempt,
    QuizQuestion,
    Student,
    StudentPayment,
    User,
)
from app.services import csv_service, quiz_service
from app.services.tier_policy import monthly_revenue

router = APIRouter(prefix="/exports", tags=["exports"])


def _csv(text: str, org_slug: str, kind: str) -> Response:
    """A downloadable CSV response.

    text/csv rather than application/octet-stream so a browser that
    previews it does the sensible thing, and an explicit filename so the
    download is not named after the endpoint.
    """
    name = csv_service.filename(org_slug, kind, datetime.now(timezone.utc))
    return Response(
        content=csv_service.as_bom_utf8(text),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


def _stamp(value) -> str:
    return as_utc(value).strftime("%Y-%m-%d %H:%M") if value else ""


@router.get("/people", dependencies=[Depends(require_role("admin"))])
async def export_people(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """The roll: everyone in this organisation, with their role."""
    result = await session.execute(
        select(User, Student)
        .outerjoin(Student, Student.student_id == User.user_id)
        .where(User.org_id == org.org_id)
        .order_by(User.role, User.name)
    )
    rows = [
        [
            u.name,
            u.email,
            u.role,
            "yes" if u.is_active else "no",
            s.batch if s else "",
            s.group if s else "",
            _stamp(u.last_seen_at),
            _stamp(u.created_at),
        ]
        for u, s in result.all()
    ]
    text = csv_service.write(
        ["Name", "Email", "Role", "Active", "Batch", "Group", "Last seen", "Joined"], rows
    )
    return _csv(text, org.slug, "people")


@router.get("/payments", dependencies=[Depends(require_role("admin", "teacher"))])
async def export_payments(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Fee records. Amounts only, never a card number.

    There is nothing sensitive to redact here because there is nothing
    sensitive stored: the gateway holds the card, and this database
    holds a reference at most (ARCHITECTURE.md section 8).
    """
    result = await session.execute(
        select(StudentPayment, User.name)
        .join(User, User.user_id == StudentPayment.student_id)
        .where(StudentPayment.org_id == org.org_id)
        .order_by(StudentPayment.created_at.desc())
    )
    rows = [
        [
            name,
            f"{float(p.amount):.2f}",
            p.currency,
            p.status,
            p.method,
            _stamp(p.created_at),
            _stamp(p.expiry_date),
        ]
        for p, name in result.all()
    ]
    text = csv_service.write(
        ["Student", "Amount", "Currency", "Status", "Method", "Recorded", "Due"], rows
    )
    return _csv(text, org.slug, "payments")


@router.get("/attendance", dependencies=[Depends(require_role("admin", "teacher"))])
async def export_attendance(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """The register, one row per student per session."""
    result = await session.execute(
        select(AttendanceRecord, Event, User.name)
        .join(Event, Event.event_id == AttendanceRecord.event_id)
        .join(User, User.user_id == AttendanceRecord.student_id)
        .where(AttendanceRecord.org_id == org.org_id)
        .order_by(Event.scheduled_at.desc(), User.name)
    )
    rows = [
        [_stamp(ev.scheduled_at), ev.title, ev.batch or "", name, rec.status]
        for rec, ev, name in result.all()
    ]
    text = csv_service.write(["Session", "Title", "Batch", "Student", "Status"], rows)
    return _csv(text, org.slug, "attendance")


@router.get("/quiz/{quiz_id}", dependencies=[Depends(require_role("admin", "teacher"))])
async def export_quiz_results(
    quiz_id: str,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """One quiz: every student's best attempt, with a mark per question.

    A wide format, one column per question, because that is what gets
    pasted into a mark book. The long format is easier to generate and
    harder to use.
    """
    quiz = await session.execute(
        select(Content).where(
            Content.content_id == quiz_id,
            Content.org_id == org.org_id,
            Content.type == "quiz",
        )
    )
    found = quiz.scalar_one_or_none()
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quiz not found")

    qrows = await session.execute(
        select(QuizQuestion)
        .where(QuizQuestion.org_id == org.org_id, QuizQuestion.content_id == quiz_id)
        .order_by(QuizQuestion.position)
    )
    questions = list(qrows.scalars())

    attempts = await session.execute(
        select(QuizAttempt, User.name)
        .join(User, User.user_id == QuizAttempt.student_id)
        .where(
            QuizAttempt.org_id == org.org_id,
            QuizAttempt.content_id == quiz_id,
            QuizAttempt.submitted_at.is_not(None),
        )
        .order_by(QuizAttempt.submitted_at)
    )
    best: dict = {}
    for a, name in attempts.all():
        held = best.get(a.student_id)
        if held is None or a.percent > held[0].percent:
            best[a.student_id] = (a, name)

    rows = []
    for a, name in sorted(best.values(), key=lambda p: p[1]):
        marked = quiz_service.mark(
            [
                quiz_service.Question(
                    question_id=q.question_id,
                    points=q.points,
                    kind=q.kind,
                    correct_index=q.correct_index,
                )
                for q in questions
            ],
            json.loads(a.answers or "{}"),
            json.loads(a.awarded or "{}"),
        )
        rows.append(
            [name, a.score, a.max_score, a.percent, quiz_service.band_of(a.percent)]
            + [
                "" if marked.per_question.get(q.question_id) is None else marked.per_question[q.question_id]
                for q in questions
            ]
            + [_stamp(a.submitted_at), "yes" if a.marked_at else "not yet"]
        )

    headers = (
        ["Student", "Score", "Out of", "Percent", "Band"]
        + [f"Q{i + 1} ({q.points})" for i, q in enumerate(questions)]
        + ["Submitted", "Marked"]
    )
    return _csv(csv_service.write(headers, rows), org.slug, "quiz-results")


@router.get("/audit", dependencies=[Depends(require_role("admin"))])
async def export_audit(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """This tenant's audit log."""
    result = await session.execute(
        select(AuditEntry)
        .where(AuditEntry.org_id == org.org_id)
        .order_by(AuditEntry.created_at.desc())
    )
    rows = [
        [
            _stamp(e.created_at),
            e.actor_label or "",
            e.action,
            e.target or "",
            e.severity,
            "yes" if e.cross_tenant else "",
        ]
        for e in result.scalars()
    ]
    text = csv_service.write(
        ["When", "Who", "Action", "Target", "Severity", "Cross tenant"], rows
    )
    return _csv(text, org.slug, "audit-log")


@router.get("/platform/tenants", dependencies=[Depends(require_platform_access())])
async def export_tenants(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Every tenant, for LoopLab.

    Guarded by require_platform_access rather than the super_admin role,
    because reading across tenants is the thing that guard exists for.
    LoopLab's own record is excluded: it is the operator, not a customer.
    """
    result = await session.execute(
        select(Organization)
        .where(Organization.is_platform.is_(False))
        .order_by(Organization.name)
    )
    rows = [
        [
            o.name,
            o.slug,
            o.package_tier,
            o.billing_status,
            o.student_count,
            o.teacher_count,
            f"{monthly_revenue(o.package_tier, o.billing_status):.2f}",
            _stamp(o.created_at),
        ]
        for o in result.scalars()
    ]
    text = csv_service.write(
        ["Name", "Slug", "Plan", "Billing", "Students", "Teachers", "MRR (LKR)", "Joined"],
        rows,
    )
    return _csv(text, "looplab", "tenants")
