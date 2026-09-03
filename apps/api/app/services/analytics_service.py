"""Aggregation for the dashboards.

Honest note on what is real and what is not.

Everything on the dashboards is now measured. Engagement, attendance and
quiz results used to be generated from the organisation id and flagged
`synthetic: true`, because there was no view tracking table, no
attendance register and no quiz attempt table. Those tables exist, so
these functions count rows.

The `synthetic` key stays in every response shape, set to False. The
frontend badges on it, and one series still uses it: revenue_series
fills months that hold no recorded payments, which it flags per call
rather than always.

The remaining figure with no source is watch time on a document, which
has no meaningful duration to measure. Videos report real seconds.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import as_date
from app.models import (
    AttendanceRecord,
    Content,
    ContentView,
    Event,
    QuizAttempt,
    Student,
    StudentPayment,
    User,
)


def _seed(*parts: str) -> int:
    digest = hashlib.sha256("|".join(parts).encode()).digest()
    return int.from_bytes(digest[:4], "big")


def _spread(seed: int, count: int, low: int, high: int) -> list[int]:
    """Stable pseudo random series in a range. Not a measurement."""
    out = []
    value = seed
    for _ in range(count):
        value = (value * 1103515245 + 12345) & 0x7FFFFFFF
        out.append(low + value % max(1, high - low))
    return out


# ----------------------------------------------------------------------
# Real aggregates
# ----------------------------------------------------------------------


async def payment_totals(session: AsyncSession, org_id: str) -> dict:
    result = await session.execute(
        select(
            StudentPayment.status,
            func.count(StudentPayment.payment_id),
            func.coalesce(func.sum(StudentPayment.amount), 0),
        )
        .where(StudentPayment.org_id == org_id)
        .group_by(StudentPayment.status)
    )
    by_status = {row[0]: {"count": row[1], "amount": float(row[2])} for row in result}

    collected = by_status.get("paid", {}).get("amount", 0.0)
    outstanding = sum(
        v["amount"] for k, v in by_status.items() if k != "paid"
    )
    expected = collected + outstanding
    return {
        "byStatus": by_status,
        "collected": collected,
        "outstanding": outstanding,
        "collectionRate": round(collected / expected * 100) if expected else 0,
        "pendingReview": by_status.get("pending_review", {}).get("count", 0),
        "overdue": by_status.get("overdue", {}).get("count", 0),
    }


async def content_counts(session: AsyncSession, org_id: str) -> dict:
    result = await session.execute(
        select(Content.type, func.count(Content.content_id))
        .where(Content.org_id == org_id)
        .group_by(Content.type)
    )
    by_type = dict(result.all())
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    recent = await session.execute(
        select(func.count(Content.content_id)).where(
            Content.org_id == org_id, Content.created_at >= week_ago
        )
    )
    return {
        "byType": by_type,
        "total": sum(by_type.values()),
        "addedThisWeek": recent.scalar_one(),
    }


async def student_counts(session: AsyncSession, org_id: str) -> dict:
    total = await session.execute(
        select(func.count(Student.student_id)).where(Student.org_id == org_id)
    )
    paid = await session.execute(
        select(func.count(func.distinct(StudentPayment.student_id))).where(
            StudentPayment.org_id == org_id, StudentPayment.status == "paid"
        )
    )
    return {"total": total.scalar_one(), "paid": paid.scalar_one()}


async def event_counts(session: AsyncSession, org_id: str) -> dict:
    now = datetime.now(timezone.utc)
    upcoming = await session.execute(
        select(func.count(Event.event_id)).where(
            Event.org_id == org_id, Event.scheduled_at >= now
        )
    )
    return {"upcoming": upcoming.scalar_one()}


# ----------------------------------------------------------------------

async def revenue_series(session: AsyncSession, org_id: str, months: int = 7) -> dict:
    """Fees collected per month, from the payment rows.

    Counts `paid` only. Money invoiced and not received is outstanding,
    not revenue, and a chart that adds the two answers a question nobody
    asked.

    Bucketed by created_at, because there is no separate paid_at column.
    That is accurate for a fee recorded when it clears, which is how the
    teacher screens work, and it would need revisiting if payments were
    ever back dated.

    A month with no recorded payments is reported as zero rather than
    filled in. That is a change from the earlier version, which
    generated plausible figures for empty months and flagged the whole
    series synthetic: with real payment history seeded, a zero is a fact
    about a quiet month and inventing over it hides exactly the dip a
    teacher would want to see.
    """
    now = datetime.now(timezone.utc)

    # Month starts, oldest first. Built by walking back a month at a
    # time rather than by subtracting 30 days, which drifts.
    starts = []
    y, m = now.year, now.month
    for _ in range(months):
        starts.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    starts.reverse()

    result = await session.execute(
        select(
            func.extract("year", StudentPayment.created_at).label("y"),
            func.extract("month", StudentPayment.created_at).label("m"),
            func.sum(StudentPayment.amount),
        )
        .where(
            StudentPayment.org_id == org_id,
            StudentPayment.status == "paid",
        )
        .group_by("y", "m")
    )
    totals = {(int(y), int(m)): float(total or 0) for y, m, total in result.all()}

    MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    points = [
        {"label": MONTH[m - 1], "value": round(totals.get((y, m), 0))}
        for y, m in starts
    ]
    collected = sum(p["value"] for p in points)

    return {
        "synthetic": False,
        "note": None,
        "points": points,
        "total": collected,
        "months": months,
    }


# Measured, from the learning record tables
# ----------------------------------------------------------------------
#
# These four used to be generated and flagged `synthetic: true`. They now
# count rows. The flag stays in the response shape, set to False, because
# the frontend badges on it and removing the key would be a silent change
# to the contract for the one screen that still has a synthetic series.
#
# All four keep returning a value for an empty tenant rather than null. A
# school on its first day has no attendance and no attempts, and that is
# a zero to be displayed, not an error state.


async def engagement_series(session: AsyncSession, org_id: str, days: int = 7) -> dict:
    """Content views per day, this period against the one before it.

    Counted from content_views. Two windows of the same length so the
    comparison is like for like: seven days against the seven before,
    not against a calendar week that may be partly in the future.
    """
    now = datetime.now(timezone.utc)
    today = now.date()
    start = today - timedelta(days=days - 1)
    prev_start = start - timedelta(days=days)

    async def daily(frm, to):
        result = await session.execute(
            select(
                func.date(ContentView.viewed_at).label("day"),
                func.count(ContentView.view_id),
            )
            .where(
                ContentView.org_id == org_id,
                func.date(ContentView.viewed_at) >= frm,
                func.date(ContentView.viewed_at) <= to,
            )
            .group_by(func.date(ContentView.viewed_at))
        )
        # SQLite hands back a string from date(), Postgres a date object.
        # Normalising here keeps the caller from caring which driver it is.
        return {as_date(day): count for day, count in result.all()}

    current = await daily(start, today)
    previous = await daily(prev_start, start - timedelta(days=1))

    points = []
    for i in range(days):
        day = start + timedelta(days=i)
        points.append(
            {
                "label": day.strftime("%a"),
                "value": current.get(day, 0),
                "compare": previous.get(day - timedelta(days=days), 0),
            }
        )

    total = sum(p["value"] for p in points)
    before = sum(p["compare"] for p in points)
    return {
        "synthetic": False,
        "note": None,
        "points": points,
        "total": total,
        # No previous activity means no percentage to quote. Reporting
        # a 100% rise from nothing is the sort of number that gets put
        # in a board pack and then has to be explained.
        "deltaPct": round((total - before) / before * 100) if before else None,
    }


async def attendance_weeks(
    session: AsyncSession, org_id: str, student_id: str, weeks: int = 12
) -> dict:
    """One student's attendance grid, from the register.

    A day with no class is "none" rather than absent. Marking every
    holiday as an absence would put a perfectly regular student at
    around forty percent, which is worse than showing nothing.
    """
    start_day = (datetime.now(timezone.utc) - timedelta(days=weeks * 7 - 1)).date()

    result = await session.execute(
        select(Event.scheduled_at, AttendanceRecord.status)
        .join(Event, Event.event_id == AttendanceRecord.event_id)
        .where(
            AttendanceRecord.org_id == org_id,
            AttendanceRecord.student_id == student_id,
            func.date(Event.scheduled_at) >= start_day,
        )
    )
    marks: dict = {}
    for scheduled_at, status in result.all():
        marks[as_date(scheduled_at)] = status

    grid = []
    for w in range(weeks):
        week = []
        for d in range(7):
            day = start_day + timedelta(days=w * 7 + d)
            week.append({"date": day.isoformat(), "mark": marks.get(day, "none")})
        grid.append(week)

    flat = [c for wk in grid for c in wk if c["mark"] != "none"]
    present = sum(1 for c in flat if c["mark"] == "present")
    late = sum(1 for c in flat if c["mark"] == "late")
    return {
        "synthetic": False,
        "note": None,
        "weeks": grid,
        "sessions": len(flat),
        "present": present,
        "late": late,
        "absent": sum(1 for c in flat if c["mark"] == "absent"),
        "excused": sum(1 for c in flat if c["mark"] == "excused"),
        # Late still means they were taught. Counting it against them
        # would make the figure answer a different question from the
        # one a parent is asking.
        "attendancePct": round((present + late) / len(flat) * 100) if flat else None,
    }


async def quiz_mix(session: AsyncSession, org_id: str) -> dict:
    """How the organisation is doing on quizzes, by best attempt.

    Best attempt per student per quiz, not every attempt. A student who
    fails once and then passes has learned the material, which is what
    the teacher is asking about, and counting both runs would report
    them as half a failure.
    """
    best = (
        select(
            QuizAttempt.content_id.label("content_id"),
            QuizAttempt.student_id.label("student_id"),
            func.max(
                case(
                    (QuizAttempt.max_score > 0, QuizAttempt.score * 100 / QuizAttempt.max_score),
                    else_=0,
                )
            ).label("pct"),
        )
        .where(
            QuizAttempt.org_id == org_id,
            QuizAttempt.submitted_at.is_not(None),
        )
        .group_by(QuizAttempt.content_id, QuizAttempt.student_id)
        .subquery()
    )

    result = await session.execute(select(best.c.pct))
    scores = [float(row[0]) for row in result.all()]

    passed = sum(1 for s in scores if s >= 60)
    borderline = sum(1 for s in scores if 40 <= s < 60)
    failed = sum(1 for s in scores if s < 40)
    total = len(scores)

    return {
        "synthetic": False,
        "note": None,
        "segments": [
            {"label": "Passed", "value": passed},
            {"label": "Borderline", "value": borderline},
            {"label": "Failed", "value": failed},
        ],
        "graded": total,
        "passRate": round(passed / total * 100) if total else None,
    }


async def subject_reach(session: AsyncSession, org_id: str) -> list[dict]:
    """Per subject: how many items, and what share of students opened one.

    Reach is distinct viewers over the student roll, so it answers "did
    this land" rather than "how many clicks did it get". One student
    watching a video forty times is one student reached.
    """
    items = await session.execute(
        select(Content.subject, func.count(Content.content_id))
        .where(Content.org_id == org_id, Content.subject.is_not(None))
        .group_by(Content.subject)
        .order_by(func.count(Content.content_id).desc())
    )
    counts = items.all()

    roll = await session.execute(
        select(func.count(Student.student_id)).where(Student.org_id == org_id)
    )
    students = roll.scalar_one() or 0

    reached = await session.execute(
        select(
            Content.subject,
            func.count(func.distinct(ContentView.student_id)),
        )
        .join(ContentView, ContentView.content_id == Content.content_id)
        .where(Content.org_id == org_id, Content.subject.is_not(None))
        .group_by(Content.subject)
    )
    by_subject = dict(reached.all())

    return [
        {
            "subject": subject,
            "items": count,
            "learners": by_subject.get(subject, 0),
            "reach": round(by_subject.get(subject, 0) / students * 100) if students else 0,
            "synthetic": False,
        }
        for subject, count in counts
    ]


async def teacher_directory(session: AsyncSession, org_id: str) -> dict[str, str]:
    """user_id to name, for labelling rows without an N+1 per row."""
    result = await session.execute(
        select(User.user_id, User.name).where(User.org_id == org_id)
    )
    return dict(result.all())
