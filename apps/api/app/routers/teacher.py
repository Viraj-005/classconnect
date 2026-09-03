"""Teacher portal data.

Every query filters on org.org_id from the session. Nothing here accepts
an org_id from the caller.
"""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.middleware.tenant import CurrentOrg, CurrentUser, require_role
from app.models import Content, Event, Student, StudentPayment, User
from app.services import analytics_service as analytics
from app.services.feature_gate_service import assert_seat_available, seat_usage
from app.services.page_access_service import require_page
from app.services.tier_policy import has_feature

router = APIRouter(
    prefix="/teacher",
    tags=["teacher"],
    dependencies=[Depends(require_role("teacher", "admin"))],
)


def _size_label(size_bytes: int | None) -> str | None:
    if not size_bytes:
        return None
    if size_bytes >= 1_000_000_000:
        return f"{size_bytes / 1_000_000_000:.1f} GB"
    if size_bytes >= 1_000_000:
        return f"{size_bytes / 1_000_000:.0f} MB"
    return f"{size_bytes / 1000:.0f} KB"


def _content_out(row: Content, names: dict[str, str], reach: int) -> dict:
    return {
        "contentId": row.content_id,
        "type": row.type,
        "title": row.title,
        "subject": row.subject,
        "uploaderName": names.get(row.uploader_id or "", "Unknown"),
        "createdAt": row.created_at,
        "durationMins": row.duration_mins,
        "sizeLabel": _size_label(row.size_bytes),
        "views": row.view_count,
        "reachPct": reach,
    }


@router.get("/content", dependencies=[Depends(require_page("teacher.content"))])
async def list_content(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
    type: str | None = None,
    subject: str | None = None,
    q: str | None = None,
) -> list[dict]:
    stmt = (
        select(Content)
        .where(Content.org_id == org.org_id)
        .order_by(Content.created_at.desc())
    )
    if type:
        stmt = stmt.where(Content.type == type)
    if subject:
        stmt = stmt.where(Content.subject == subject)
    if q:
        stmt = stmt.where(Content.title.ilike(f"%{q}%"))

    rows = list((await session.execute(stmt)).scalars())
    names = await analytics.teacher_directory(session, org.org_id)
    # Reach has no source table yet, see analytics_service.
    reaches = analytics._spread(
        analytics._seed(org.org_id, "content-reach"), len(rows), 42, 95
    )
    return [_content_out(r, names, reach) for r, reach in zip(rows, reaches)]


@router.post(
    "/content",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_page("teacher.content"))],
)
async def create_content(
    body: dict,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Create a content record.

    The S3 upload itself is not wired up yet, so this stores metadata
    only and leaves storage_key null. The upload flow will set it.
    """
    row = Content(
        org_id=org.org_id,
        type=body.get("type", "doc"),
        title=body["title"],
        subject=body.get("subject"),
        uploader_id=user.user_id,
        duration_mins=body.get("durationMins"),
    )
    session.add(row)
    await session.flush()
    names = await analytics.teacher_directory(session, org.org_id)
    return _content_out(row, names, 0)


@router.get("/students", dependencies=[Depends(require_page("teacher.students"))])
async def list_students(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
    batch: str | None = None,
    q: str | None = None,
) -> list[dict]:
    stmt = (
        select(Student, User)
        .join(User, User.user_id == Student.student_id)
        .where(Student.org_id == org.org_id)
        .order_by(User.name)
    )
    if batch:
        stmt = stmt.where(Student.batch == batch)
    if q:
        stmt = stmt.where(User.name.ilike(f"%{q}%"))

    rows = list((await session.execute(stmt)).all())

    # Latest payment per student, fetched in one query rather than per row.
    pay_rows = await session.execute(
        select(StudentPayment).where(StudentPayment.org_id == org.org_id)
    )
    latest: dict[str, StudentPayment] = {}
    for p in pay_rows.scalars():
        seen = latest.get(p.student_id)
        if seen is None or p.created_at > seen.created_at:
            latest[p.student_id] = p

    seed = analytics._seed(org.org_id, "students")
    attendance = analytics._spread(seed, len(rows), 55, 99)
    scores = analytics._spread(seed + 1, len(rows), 52, 95)

    out = []
    for (student, user), att, score in zip(rows, attendance, scores):
        payment = latest.get(student.student_id)
        out.append(
            {
                "studentId": student.student_id,
                "name": user.name,
                "email": user.email,
                "batch": student.batch,
                "group": student.group,
                "paymentStatus": payment.status if payment else "unpaid",
                "ticketExpiry": payment.expiry_date if payment and payment.status == "paid" else None,
                "lastActive": user.last_seen_at,
                # Synthetic, see analytics_service.
                "attendancePct": att,
                "avgScore": score,
            }
        )
    return out


@router.post(
    "/students",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_page("teacher.students"))],
)
async def create_student(
    body: dict,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Add a student, subject to the tier seat cap."""
    assert_seat_available(org, "students")

    clash = await session.execute(
        select(User).where(User.org_id == org.org_id, User.email == body["email"])
    )
    if clash.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Someone with that email is already in this organisation.",
        )

    from app.core.security import hash_password

    user = User(
        org_id=org.org_id,
        role="student",
        name=body["name"],
        email=body["email"],
        password_hash=hash_password("change-me-on-first-login"),
    )
    session.add(user)
    await session.flush()

    session.add(
        Student(
            student_id=user.user_id,
            org_id=org.org_id,
            batch=body.get("batch"),
            group=body.get("group"),
        )
    )
    # Counter is denormalised on Organization, so it moves with the row.
    org.student_count += 1
    await session.flush()
    return {"studentId": user.user_id, "name": user.name, "email": user.email}


@router.get("/payments", dependencies=[Depends(require_page("teacher.fees"))])
async def list_payments(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
    status_filter: str | None = Query(default=None, alias="status"),
) -> list[dict]:
    stmt = (
        select(StudentPayment, User)
        .join(User, User.user_id == StudentPayment.student_id)
        .where(StudentPayment.org_id == org.org_id)
        .order_by(StudentPayment.created_at.desc())
    )
    if status_filter:
        stmt = stmt.where(StudentPayment.status == status_filter)

    return [
        {
            "paymentId": p.payment_id,
            "studentId": p.student_id,
            "studentName": u.name,
            "amount": float(p.amount),
            "currency": p.currency,
            "status": p.status,
            "method": p.method,
            "submittedAt": p.created_at,
            "expiryDate": p.expiry_date,
            "slipFilename": p.slip_storage_key.split("/")[-1] if p.slip_storage_key else None,
        }
        for p, u in (await session.execute(stmt)).all()
    ]


@router.post(
    "/payments/{payment_id}/approve",
    dependencies=[Depends(require_page("teacher.fees"))],
)
async def approve_payment(
    payment_id: str,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Approve a slip. Issues a class ticket if the tier includes them."""
    result = await session.execute(
        select(StudentPayment).where(
            StudentPayment.payment_id == payment_id,
            StudentPayment.org_id == org.org_id,
        )
    )
    payment = result.scalar_one_or_none()
    if payment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")

    from datetime import timedelta

    payment.status = "paid"
    payment.reviewed_by = user.user_id
    payment.expiry_date = datetime.now(timezone.utc) + timedelta(days=30)

    issued = False
    if has_feature(org.package_tier, "qr_ticketing"):
        from app.models import ClassTicket
        from app.services.qr_service import issue_ticket

        student = await session.get(Student, payment.student_id)
        holder = await session.get(User, payment.student_id)
        if student and holder:
            _payload, signature, expiry = issue_ticket(
                student_name=holder.name,
                student_id=student.student_id,
                org_id=org.org_id,
                batch=student.batch,
                group=student.group,
            )
            session.add(
                ClassTicket(
                    org_id=org.org_id,
                    student_id=student.student_id,
                    payment_id=payment.payment_id,
                    signature=signature,
                    expiry_date=expiry,
                )
            )
            issued = True

    return {"paymentId": payment.payment_id, "status": payment.status, "ticketIssued": issued}


@router.get("/events", dependencies=[Depends(require_page("teacher.schedule"))])
async def list_events(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[dict]:
    rows = await session.execute(
        select(Event).where(Event.org_id == org.org_id).order_by(Event.scheduled_at)
    )
    names = await analytics.teacher_directory(session, org.org_id)
    events = list(rows.scalars())
    attendees = analytics._spread(
        analytics._seed(org.org_id, "attendees"), len(events), 18, 55
    )
    return [
        {
            "eventId": e.event_id,
            "title": e.title,
            "type": e.type,
            "scheduledAt": e.scheduled_at,
            "durationMins": e.duration_mins,
            "batch": e.batch,
            "createdBy": names.get(e.created_by or "", "Unknown"),
            "attendees": n,
        }
        for e, n in zip(events, attendees)
    ]


@router.post(
    "/events",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_page("teacher.schedule"))],
)
async def create_event(
    body: dict,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    row = Event(
        org_id=org.org_id,
        title=body["title"],
        type=body.get("type", "class"),
        scheduled_at=datetime.fromisoformat(body["scheduledAt"]),
        duration_mins=body.get("durationMins", 60),
        batch=body.get("batch"),
        created_by=user.user_id,
    )
    session.add(row)
    await session.flush()
    return {"eventId": row.event_id, "title": row.title}


@router.get("/overview")
async def overview(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Everything the Teacher home screen needs, in one round trip.

    Screen shaped rather than resource shaped on purpose: the overview
    would otherwise be six requests on first paint.
    """
    payments = await analytics.payment_totals(session, org.org_id)
    content = await analytics.content_counts(session, org.org_id)
    students = await analytics.student_counts(session, org.org_id)
    seats = seat_usage(org, "students")

    return {
        "metrics": {
            "students": students["total"],
            "studentsPaid": students["paid"],
            "contentTotal": content["total"],
            "contentAddedThisWeek": content["addedThisWeek"],
            "collected": payments["collected"],
            "outstanding": payments["outstanding"],
            "collectionRate": payments["collectionRate"],
            "pendingReview": payments["pendingReview"],
            "overdue": payments["overdue"],
            "seatPct": seats.pct,
            "seatLabel": seats.label if hasattr(seats, "label") else None,
        },
        "engagement": await analytics.engagement_series(session, org.org_id),
        "revenue": await analytics.revenue_series(session, org.org_id),
        "quizMix": await analytics.quiz_mix(session, org.org_id),
    }


@router.get("/analytics", dependencies=[Depends(require_page("teacher.analytics"))])
async def analytics_view(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    payments = await analytics.payment_totals(session, org.org_id)
    return {
        "engagement": await analytics.engagement_series(session, org.org_id),
        "revenue": await analytics.revenue_series(session, org.org_id),
        "quizMix": await analytics.quiz_mix(session, org.org_id),
        "subjectReach": await analytics.subject_reach(session, org.org_id),
        "payments": payments,
    }


@router.get("/quizzes", dependencies=[Depends(require_page("teacher.analytics"))])
async def quiz_performance(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[dict]:
    """Quiz rows are real, attempt figures are not. See analytics_service."""
    result = await session.execute(
        select(Content)
        .where(Content.org_id == org.org_id, Content.type == "quiz")
        .order_by(Content.created_at.desc())
    )
    rows = list(result.scalars())
    seed = analytics._seed(org.org_id, "quiz-perf")
    attempts = analytics._spread(seed, len(rows), 22, 55)
    pass_rates = analytics._spread(seed + 1, len(rows), 48, 92)
    averages = analytics._spread(seed + 2, len(rows), 52, 84)
    return [
        {
            "quizId": q.content_id,
            "title": q.title,
            "subject": q.subject,
            "attempts": a,
            "passRate": p,
            "avgScore": avg,
            "dueAt": q.created_at,
            "synthetic": True,
        }
        for q, a, p, avg in zip(rows, attempts, pass_rates, averages)
    ]


@router.get("/subjects")
async def list_subjects(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[str]:
    result = await session.execute(
        select(func.distinct(Content.subject))
        .where(Content.org_id == org.org_id, Content.subject.is_not(None))
        .order_by(Content.subject)
    )
    return [s for (s,) in result.all() if s]
