"""Quizzes, attendance and content views.

The three write paths that turn the dashboards from generated numbers
into counted ones. Grouped in one router because they are the same kind
of thing, a record of what a student actually did, and because the
tenant scoping argument is identical for all of them: every query below
filters on the org_id resolved from the session, and every id that
arrives from the client is only ever used in a WHERE clause alongside
it. Guessing another tenant's quiz id returns 404, not their questions.
"""

import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.timeutil import utc_now
from app.middleware.tenant import (
    CurrentOrg,
    CurrentUser,
    require_platform_access,
    require_role,
)
from app.models import (
    ATTENDANCE_STATUSES,
    QUESTION_KINDS,
    AttendanceRecord,
    AuditEntry,
    Batch,
    Content,
    ContentView,
    Event,
    QuizAttempt,
    QuizQuestion,
    Organization,
    Student,
    User,
)
from app.services import quiz_service, storage_service
from app.services.feature_gate_service import has_feature

router = APIRouter(tags=["learning"])


# ----------------------------------------------------------------------
# Quizzes, student side
# ----------------------------------------------------------------------


async def _load_quiz(session: AsyncSession, org_id: str, quiz_id: str) -> Content:
    result = await session.execute(
        select(Content).where(
            Content.content_id == quiz_id,
            Content.org_id == org_id,
            Content.type == "quiz",
        )
    )
    quiz = result.scalar_one_or_none()
    if quiz is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Quiz not found")
    return quiz


@router.post("/student/quizzes/{quiz_id}/start", dependencies=[Depends(require_role("student"))])
async def start_attempt(
    quiz_id: str,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Begin, or resume, an attempt at a quiz.

    Resuming rather than always starting fresh is deliberate. A student
    whose connection drops halfway through should not lose their
    answers, and a new row per page load would also inflate every
    attempt count on the teacher's screen.

    The questions come back without the correct answers. See
    quiz_service.strip_answers for why that is not something the UI can
    be trusted to do.
    """
    quiz = await _load_quiz(session, org.org_id, quiz_id)

    open_attempt = await session.execute(
        select(QuizAttempt)
        .where(
            QuizAttempt.org_id == org.org_id,
            QuizAttempt.content_id == quiz_id,
            QuizAttempt.student_id == user.user_id,
            QuizAttempt.submitted_at.is_(None),
        )
        .order_by(QuizAttempt.started_at.desc())
        .limit(1)
    )
    attempt = open_attempt.scalars().first()

    rows = await session.execute(
        select(QuizQuestion)
        .where(QuizQuestion.org_id == org.org_id, QuizQuestion.content_id == quiz_id)
        .order_by(QuizQuestion.position)
    )
    questions = list(rows.scalars())
    if not questions:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This quiz has no questions yet.",
        )

    if attempt is None:
        attempt = QuizAttempt(
            org_id=org.org_id,
            content_id=quiz_id,
            student_id=user.user_id,
            started_at=utc_now(),
            max_score=sum(q.points for q in questions),
        )
        session.add(attempt)
        await session.flush()

    return {
        "attemptId": attempt.attempt_id,
        "quizId": quiz.content_id,
        "title": quiz.title,
        "subject": quiz.subject,
        "startedAt": attempt.started_at,
        "maxScore": attempt.max_score,
        "savedAnswers": json.loads(attempt.answers or "{}"),
        "questions": [
            quiz_service.strip_answers(
                {
                    "questionId": q.question_id,
                    "position": q.position,
                    "kind": q.kind,
                    "prompt": q.prompt,
                    "options": json.loads(q.options),
                    "points": q.points,
                    "correctIndexes": json.loads(q.correct_indexes or "[]"),
                }
            )
            for q in questions
        ],
    }


@router.post("/student/quizzes/{quiz_id}/submit", dependencies=[Depends(require_role("student"))])
async def submit_attempt(
    quiz_id: str,
    body: dict,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Mark a submission and close the attempt.

    Marked on the server against the stored answer key. The client sends
    only the chosen option indexes, so a student cannot submit their own
    score, and re-submitting a closed attempt is refused rather than
    silently overwriting the first result.
    """
    await _load_quiz(session, org.org_id, quiz_id)

    result = await session.execute(
        select(QuizAttempt).where(
            QuizAttempt.org_id == org.org_id,
            QuizAttempt.content_id == quiz_id,
            QuizAttempt.student_id == user.user_id,
            QuizAttempt.submitted_at.is_(None),
        )
    )
    attempt = result.scalars().first()
    if attempt is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="There is no attempt in progress. Start the quiz again.",
        )

    rows = await session.execute(
        select(QuizQuestion)
        .where(QuizQuestion.org_id == org.org_id, QuizQuestion.content_id == quiz_id)
        .order_by(QuizQuestion.position)
    )
    questions = list(rows.scalars())

    answers = body.get("answers") or {}
    if not isinstance(answers, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Answers must be an object."
        )

    marked = quiz_service.mark(
        [
            quiz_service.Question(
                question_id=q.question_id,
                correct_index=q.correct_index,
                correct_indexes=tuple(json.loads(q.correct_indexes or "[]")),
                points=q.points,
                kind=q.kind,
            )
            for q in questions
        ],
        answers,
    )

    attempt.answers = json.dumps(answers)
    attempt.score = marked.score
    attempt.max_score = marked.max_score
    attempt.submitted_at = utc_now()
    # A quiz of only choice questions is finished the moment it arrives.
    # One with a written answer waits for a person, and marked_at stays
    # NULL, which is exactly what the marking queue selects on.
    attempt.marked_at = None if marked.awaiting_marking else utc_now()

    return {
        "attemptId": attempt.attempt_id,
        "score": marked.score,
        "maxScore": marked.max_score,
        "percent": marked.percent,
        "band": marked.band,
        "passed": marked.passed,
        "correct": len(marked.correct_ids),
        "wrong": len(marked.wrong_ids),
        "unanswered": len(marked.unanswered_ids),
        # Written answers are not marked yet, so the score above is only
        # what the server could work out. Saying so is the difference
        # between a provisional mark and one the student thinks is final.
        "awaitingMarking": marked.awaiting_marking,
        "pending": len(marked.pending_ids),
        # The key, now that the attempt is closed and marked. Showing it
        # any earlier would be handing over the answers.
        "review": [
            {
                "questionId": q.question_id,
                "prompt": q.prompt,
                "kind": q.kind,
                "options": json.loads(q.options),
                "correctIndex": None if q.is_written else q.correct_index,
                "correctIndexes": json.loads(q.correct_indexes or "[]"),
                "chosenIndex": None if q.is_written else answers.get(q.question_id),
                "writtenAnswer": answers.get(q.question_id) if q.is_written else None,
                "awarded": marked.per_question.get(q.question_id),
                "points": q.points,
            }
            for q in questions
        ],
    }


# ----------------------------------------------------------------------
# Attendance
# ----------------------------------------------------------------------


@router.get(
    "/teacher/events/{event_id}/register",
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def read_register(
    event_id: str,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """The class list for one session, with whatever is already marked.

    Returns every student in the batch, not only those with a record, so
    the teacher gets a register to work down rather than a list that
    grows as they mark it.
    """
    event = await session.execute(
        select(Event).where(Event.event_id == event_id, Event.org_id == org.org_id)
    )
    ev = event.scalar_one_or_none()
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    roster = select(Student, User).join(User, User.user_id == Student.student_id).where(
        Student.org_id == org.org_id
    )
    if ev.batch:
        roster = roster.where(Student.batch == ev.batch)
    rows = await session.execute(roster.order_by(User.name))

    marked = await session.execute(
        select(AttendanceRecord.student_id, AttendanceRecord.status).where(
            AttendanceRecord.org_id == org.org_id, AttendanceRecord.event_id == event_id
        )
    )
    existing = dict(marked.all())

    return {
        "eventId": ev.event_id,
        "title": ev.title,
        "batch": ev.batch,
        "scheduledAt": ev.scheduled_at,
        "marked": len(existing),
        "students": [
            {
                "studentId": s.student_id,
                "name": u.name,
                "batch": s.batch,
                "group": s.group,
                "status": existing.get(s.student_id),
            }
            for s, u in rows.all()
        ],
    }


@router.post(
    "/teacher/events/{event_id}/register",
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def mark_register(
    event_id: str,
    body: dict,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Mark or correct the register for one session.

    Upserts on (org, event, student), so a teacher who scrolls back and
    changes a mark corrects the record instead of adding a second one.
    Re-marking is the normal case, not an error.

    Students are validated against this organisation before anything is
    written, so a crafted body cannot create an attendance row against
    somebody else's student.
    """
    event = await session.execute(
        select(Event.event_id).where(Event.event_id == event_id, Event.org_id == org.org_id)
    )
    if event.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    marks = body.get("marks") or {}
    if not isinstance(marks, dict) or not marks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to mark."
        )
    bad = [s for s in marks.values() if s not in ATTENDANCE_STATUSES]
    if bad:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown attendance status: {bad[0]}",
        )

    valid = await session.execute(
        select(Student.student_id).where(
            Student.org_id == org.org_id, Student.student_id.in_(list(marks))
        )
    )
    allowed = {r[0] for r in valid.all()}

    existing = await session.execute(
        select(AttendanceRecord).where(
            AttendanceRecord.org_id == org.org_id,
            AttendanceRecord.event_id == event_id,
            AttendanceRecord.student_id.in_(list(allowed)),
        )
    )
    by_student = {r.student_id: r for r in existing.scalars()}

    written = 0
    for student_id, mark in marks.items():
        if student_id not in allowed:
            continue
        row = by_student.get(student_id)
        if row is None:
            session.add(
                AttendanceRecord(
                    org_id=org.org_id,
                    event_id=event_id,
                    student_id=student_id,
                    status=mark,
                    marked_by=user.user_id,
                )
            )
        else:
            row.status = mark
            row.marked_by = user.user_id
        written += 1

    return {"marked": written, "ignored": len(marks) - written}


# ----------------------------------------------------------------------
# Content views
# ----------------------------------------------------------------------


@router.post("/student/content/{content_id}/view", dependencies=[Depends(require_role("student"))])
async def record_view(
    content_id: str,
    body: dict,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Record that a student opened a piece of content.

    Appends a row rather than updating a counter, because the dashboard
    asks when things were watched and a counter has thrown that away.
    See the note on the ContentView model.

    The denormalised Content.view_count is kept in step here so the
    library listing does not need a join to show a total.
    """
    result = await session.execute(
        select(Content).where(
            Content.content_id == content_id, Content.org_id == org.org_id
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")

    # Clamped rather than trusted. These come from a player in the
    # browser, and a negative or 400% progress would quietly poison
    # every average built on top of it.
    progress = max(0, min(100, int(body.get("progressPct") or 0)))
    seconds = max(0, int(body.get("secondsWatched") or 0))

    session.add(
        ContentView(
            org_id=org.org_id,
            content_id=content_id,
            student_id=user.user_id,
            viewed_at=utc_now(),
            progress_pct=progress,
            seconds_watched=seconds,
        )
    )
    item.view_count = (item.view_count or 0) + 1

    return {"recorded": True, "progressPct": progress}


@router.get("/student/progress", dependencies=[Depends(require_role("student"))])
async def my_progress(
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[dict]:
    """How far this student has got with each piece of content.

    The furthest point reached, not the most recent, so rewatching the
    opening of a video does not undo the progress bar.
    """
    result = await session.execute(
        select(
            ContentView.content_id,
            func.max(ContentView.progress_pct),
            func.count(ContentView.view_id),
            func.max(ContentView.viewed_at),
        )
        .where(ContentView.org_id == org.org_id, ContentView.student_id == user.user_id)
        .group_by(ContentView.content_id)
    )
    return [
        {
            "contentId": cid,
            "progressPct": pct or 0,
            "views": views,
            "lastViewedAt": last,
        }
        for cid, pct, views, last in result.all()
    ]


# ----------------------------------------------------------------------
# Quizzes, teacher side
#
# Authoring and review. The student endpoints above let somebody sit a
# quiz; without these there was no way to make one, which made the whole
# engine unreachable from the product.
# ----------------------------------------------------------------------


def _validate_questions(raw) -> list[dict]:
    """Check a submitted question set before anything is written.

    Validated as a whole rather than per row, so a quiz is never left
    half saved with three good questions and a broken fourth. The rules
    are the ones that would otherwise fail silently at marking time: an
    answer index has to point at an option that exists, or the question
    can never be got right.
    """
    if not isinstance(raw, list) or not raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A quiz needs at least one question.",
        )
    if len(raw) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A quiz can hold at most 100 questions.",
        )

    cleaned = []
    for i, q in enumerate(raw, start=1):
        prompt = str(q.get("prompt") or "").strip()
        options = q.get("options") or []
        kind = q.get("kind") or "choice"
        if kind not in QUESTION_KINDS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Question {i} has an unknown type.",
            )
        if not prompt:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Question {i} has no wording.",
            )

        if kind == "multi":
            # Several right answers, marked all or nothing. Validated
            # the same way as a single answer question plus the rule
            # that at least one option has to be correct and not all of
            # them, since "tick everything" would be a free mark.
            if not isinstance(options, list) or len(options) < 2:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Question {i} needs at least two options.",
                )
            options = [str(o).strip() for o in options]
            if any(not o for o in options):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Question {i} has an empty option.",
                )
            raw = q.get("correctIndexes") or []
            picked = sorted({int(x) for x in raw if isinstance(x, int)})
            if not picked:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Question {i} has no correct answers selected.",
                )
            if any(not 0 <= x < len(options) for x in picked):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Question {i} marks an answer that is not one of its options.",
                )
            if len(picked) == len(options):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Question {i} marks every option correct, so it cannot be got "
                        "wrong. Leave at least one incorrect."
                    ),
                )
            multi_points = int(q.get("points") or 1)
            if not 1 <= multi_points <= 20:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Question {i} must be worth between 1 and 20 marks.",
                )
            cleaned.append(
                {
                    "kind": "multi",
                    "prompt": prompt[:2000],
                    "options": options,
                    "correctIndex": picked[0],
                    "correctIndexes": picked,
                    "modelAnswer": None,
                    "points": multi_points,
                }
            )
            continue

        if kind == "written":
            # No options and no answer key. A written question is marked
            # by a person, so there is nothing to validate beyond the
            # wording and what it is worth.
            written_points = int(q.get("points") or 1)
            if not 1 <= written_points <= 20:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Question {i} must be worth between 1 and 20 marks.",
                )
            cleaned.append(
                {
                    "kind": "written",
                    "prompt": prompt[:2000],
                    "options": [],
                    "correctIndex": 0,
                    "correctIndexes": [],
                    "modelAnswer": (str(q.get("modelAnswer") or "").strip() or None),
                    "points": written_points,
                }
            )
            continue

        if not isinstance(options, list) or len(options) < 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Question {i} needs at least two options.",
            )
        options = [str(o).strip() for o in options]
        if any(not o for o in options):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Question {i} has an empty option.",
            )
        try:
            correct = int(q.get("correctIndex"))
        except (TypeError, ValueError):
            correct = -1
        if not 0 <= correct < len(options):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Question {i} does not have a correct answer selected.",
            )
        points = int(q.get("points") or 1)
        if not 1 <= points <= 20:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Question {i} must be worth between 1 and 20 marks.",
            )
        cleaned.append(
            {
                "kind": "choice",
                "prompt": prompt[:2000],
                "options": options,
                "correctIndex": correct,
                "correctIndexes": [correct],
                "modelAnswer": None,
                "points": points,
            }
        )
    return cleaned


@router.post(
    "/teacher/quizzes",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def create_quiz(
    body: dict,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Create a quiz and its questions in one call.

    One call rather than a quiz then questions, because a quiz with no
    questions is not a thing a teacher meant to make. The student start
    endpoint refuses one, so saving the shell first would only produce a
    broken item on the library screen.
    """
    title = str(body.get("title") or "").strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Give the quiz a title."
        )

    questions = _validate_questions(body.get("questions"))

    quiz = Content(
        org_id=org.org_id,
        type="quiz",
        title=title[:255],
        subject=(body.get("subject") or None),
        uploader_id=user.user_id,
    )
    session.add(quiz)
    await session.flush()

    for position, q in enumerate(questions):
        session.add(
            QuizQuestion(
                org_id=org.org_id,
                content_id=quiz.content_id,
                position=position,
                kind=q["kind"],
                prompt=q["prompt"],
                options=json.dumps(q["options"]),
                correct_index=q["correctIndex"],
                correct_indexes=json.dumps(q["correctIndexes"]),
                model_answer=q["modelAnswer"],
                points=q["points"],
            )
        )

    return {
        "quizId": quiz.content_id,
        "title": quiz.title,
        "subject": quiz.subject,
        "questions": len(questions),
        "maxScore": sum(q["points"] for q in questions),
    }


@router.get(
    "/teacher/quizzes/{quiz_id}",
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def read_quiz(
    quiz_id: str,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """The full quiz, answers included, for editing and review.

    The correct index is present here and absent from the student
    version of the same data. That difference is the whole reason the
    two endpoints exist separately rather than one being filtered in the
    UI.
    """
    quiz = await _load_quiz(session, org.org_id, quiz_id)
    rows = await session.execute(
        select(QuizQuestion)
        .where(QuizQuestion.org_id == org.org_id, QuizQuestion.content_id == quiz_id)
        .order_by(QuizQuestion.position)
    )
    questions = list(rows.scalars())

    taken = await session.execute(
        select(func.count(QuizAttempt.attempt_id)).where(
            QuizAttempt.org_id == org.org_id,
            QuizAttempt.content_id == quiz_id,
            QuizAttempt.submitted_at.is_not(None),
        )
    )

    return {
        "quizId": quiz.content_id,
        "title": quiz.title,
        "subject": quiz.subject,
        "createdAt": quiz.created_at,
        "attempts": taken.scalar_one(),
        "maxScore": sum(q.points for q in questions),
        "questions": [
            {
                "questionId": q.question_id,
                "position": q.position,
                "kind": q.kind,
                "prompt": q.prompt,
                "options": json.loads(q.options),
                "correctIndex": q.correct_index,
                "correctIndexes": json.loads(q.correct_indexes or "[]"),
                "modelAnswer": q.model_answer,
                "points": q.points,
            }
            for q in questions
        ],
    }


@router.put(
    "/teacher/quizzes/{quiz_id}",
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def update_quiz(
    quiz_id: str,
    body: dict,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Replace a quiz's questions.

    Refused once anybody has sat it. Editing a question under a marked
    attempt would silently rewrite what that student was asked, and
    their stored answers point at option indexes that may no longer mean
    the same thing. Rather than guess, this stops and says so: the
    teacher can copy the quiz and set the new version instead.
    """
    quiz = await _load_quiz(session, org.org_id, quiz_id)

    taken = await session.execute(
        select(func.count(QuizAttempt.attempt_id)).where(
            QuizAttempt.org_id == org.org_id, QuizAttempt.content_id == quiz_id
        )
    )
    attempts = taken.scalar_one()
    if attempts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{attempts} student{'s have' if attempts != 1 else ' has'} already sat this "
                "quiz, so the questions are locked. Duplicate it to make a new version."
            ),
        )

    questions = _validate_questions(body.get("questions"))
    if title := str(body.get("title") or "").strip():
        quiz.title = title[:255]
    if "subject" in body:
        quiz.subject = body.get("subject") or None

    old = await session.execute(
        select(QuizQuestion).where(
            QuizQuestion.org_id == org.org_id, QuizQuestion.content_id == quiz_id
        )
    )
    for row in old.scalars():
        await session.delete(row)
    await session.flush()

    for position, q in enumerate(questions):
        session.add(
            QuizQuestion(
                org_id=org.org_id,
                content_id=quiz_id,
                position=position,
                kind=q["kind"],
                prompt=q["prompt"],
                options=json.dumps(q["options"]),
                correct_index=q["correctIndex"],
                correct_indexes=json.dumps(q["correctIndexes"]),
                model_answer=q["modelAnswer"],
                points=q["points"],
            )
        )

    return {"quizId": quiz_id, "questions": len(questions)}


@router.get(
    "/teacher/quizzes/{quiz_id}/results",
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def quiz_results(
    quiz_id: str,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Who sat it, how they did, and which questions caught them out.

    The per question breakdown is the part a teacher can act on. A score
    list tells them who to worry about; a question everybody missed
    tells them what to teach again on Monday.
    """
    await _load_quiz(session, org.org_id, quiz_id)

    rows = await session.execute(
        select(QuizQuestion)
        .where(QuizQuestion.org_id == org.org_id, QuizQuestion.content_id == quiz_id)
        .order_by(QuizQuestion.position)
    )
    questions = list(rows.scalars())

    attempts = await session.execute(
        select(QuizAttempt, User.name)
        .join(User, User.user_id == QuizAttempt.student_id)
        .where(
            QuizAttempt.org_id == org.org_id,
            QuizAttempt.content_id == quiz_id,
            QuizAttempt.submitted_at.is_not(None),
        )
        .order_by(QuizAttempt.submitted_at.desc())
    )
    pairs = attempts.all()

    # Best attempt per student, so a retake replaces rather than
    # duplicates the student on the list.
    best: dict = {}
    for attempt, name in pairs:
        held = best.get(attempt.student_id)
        if held is None or attempt.percent > held[0].percent:
            best[attempt.student_id] = (attempt, name)

    # Re-marked per attempt rather than compared index by index, so a
    # multi answer question is judged as a set and a manual override is
    # respected. Comparing `chosen == correct_index` would call a
    # correctly answered multi question wrong.
    marker_questions = _questions_for(questions)
    per_question = {q.question_id: {"right": 0, "wrong": 0, "blank": 0} for q in questions}
    for attempt, _name in best.values():
        given = json.loads(attempt.answers or "{}")
        scored = quiz_service.mark(
            marker_questions, given, json.loads(attempt.awarded or "{}")
        )
        for q in questions:
            chosen = given.get(q.question_id)
            bucket = per_question[q.question_id]
            if chosen is None or chosen == [] or chosen == "":
                bucket["blank"] += 1
            elif scored.per_question.get(q.question_id) == q.points:
                bucket["right"] += 1
            else:
                bucket["wrong"] += 1

    graded = [
        {
            "studentId": a.student_id,
            "name": name,
            "score": a.score,
            "maxScore": a.max_score,
            "percent": a.percent,
            "band": quiz_service.band_of(a.percent),
            "submittedAt": a.submitted_at,
        }
        for a, name in sorted(best.values(), key=lambda p: -p[0].percent)
    ]
    passed = sum(1 for g in graded if g["band"] == "passed")

    return {
        "quizId": quiz_id,
        "sat": len(graded),
        "passed": passed,
        "passRate": round(passed / len(graded) * 100) if graded else None,
        "averagePercent": round(sum(g["percent"] for g in graded) / len(graded))
        if graded
        else None,
        "results": graded,
        "questions": [
            {
                "questionId": q.question_id,
                "position": q.position,
                "prompt": q.prompt,
                "options": json.loads(q.options),
                "correctIndex": q.correct_index,
                "points": q.points,
                **per_question[q.question_id],
                "correctPct": round(
                    per_question[q.question_id]["right"] / len(graded) * 100
                )
                if graded
                else None,
            }
            for q in questions
        ],
    }


# ----------------------------------------------------------------------
# Marking queue
#
# Written answers cannot be marked by the server, and any mark it did
# award can be overridden. Both go through the same endpoint, because
# they are the same act: a teacher deciding what an answer was worth.
# ----------------------------------------------------------------------


def _questions_for(rows) -> list:
    return [
        quiz_service.Question(
            question_id=q.question_id,
            points=q.points,
            kind=q.kind,
            correct_index=q.correct_index,
            correct_indexes=tuple(json.loads(q.correct_indexes or "[]")),
        )
        for q in rows
    ]


async def _remark(session: AsyncSession, org_id: str, attempt: QuizAttempt) -> None:
    """Recompute an attempt's score from its answers and awarded marks.

    Called after every change to either. Storing the total rather than
    deriving it on read keeps the dashboards a plain SUM, and this is
    the one place that total is allowed to be written.
    """
    rows = await session.execute(
        select(QuizQuestion)
        .where(
            QuizQuestion.org_id == org_id,
            QuizQuestion.content_id == attempt.content_id,
        )
        .order_by(QuizQuestion.position)
    )
    questions = list(rows.scalars())
    marked = quiz_service.mark(
        _questions_for(questions),
        json.loads(attempt.answers or "{}"),
        json.loads(attempt.awarded or "{}"),
    )
    attempt.score = marked.score
    attempt.max_score = marked.max_score
    # Nothing outstanding means the attempt is finished, whether that
    # took a person or not.
    if not marked.awaiting_marking and attempt.submitted_at is not None:
        attempt.marked_at = attempt.marked_at or utc_now()
    else:
        attempt.marked_at = None


@router.get(
    "/teacher/marking",
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def marking_queue(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[dict]:
    """Attempts waiting on a person.

    Oldest first, because a student waiting three days for a mark should
    not be behind one who submitted this morning.
    """
    result = await session.execute(
        select(QuizAttempt, Content.title, User.name)
        .join(Content, Content.content_id == QuizAttempt.content_id)
        .join(User, User.user_id == QuizAttempt.student_id)
        .where(
            QuizAttempt.org_id == org.org_id,
            QuizAttempt.submitted_at.is_not(None),
            QuizAttempt.marked_at.is_(None),
        )
        .order_by(QuizAttempt.submitted_at)
    )
    return [
        {
            "attemptId": a.attempt_id,
            "quizId": a.content_id,
            "quizTitle": title,
            "studentId": a.student_id,
            "studentName": name,
            "submittedAt": a.submitted_at,
            "provisionalScore": a.score,
            "maxScore": a.max_score,
        }
        for a, title, name in result.all()
    ]


@router.get(
    "/teacher/attempts/{attempt_id}",
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def read_attempt(
    attempt_id: str,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """One attempt in full, for marking.

    Carries the model answer and the correct index, which the student
    version of the same data does not. This is the marker's view.
    """
    result = await session.execute(
        select(QuizAttempt, Content.title, User.name)
        .join(Content, Content.content_id == QuizAttempt.content_id)
        .join(User, User.user_id == QuizAttempt.student_id)
        .where(QuizAttempt.attempt_id == attempt_id, QuizAttempt.org_id == org.org_id)
    )
    found = result.first()
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attempt not found")
    attempt, title, student = found

    rows = await session.execute(
        select(QuizQuestion)
        .where(
            QuizQuestion.org_id == org.org_id,
            QuizQuestion.content_id == attempt.content_id,
        )
        .order_by(QuizQuestion.position)
    )
    questions = list(rows.scalars())

    given = json.loads(attempt.answers or "{}")
    awarded = json.loads(attempt.awarded or "{}")
    marked = quiz_service.mark(_questions_for(questions), given, awarded)

    return {
        "attemptId": attempt.attempt_id,
        "quizId": attempt.content_id,
        "quizTitle": title,
        "studentName": student,
        "submittedAt": attempt.submitted_at,
        "markedAt": attempt.marked_at,
        "awaitingMarking": marked.awaiting_marking,
        "score": marked.score,
        "maxScore": marked.max_score,
        "percent": marked.percent,
        "questions": [
            {
                "questionId": q.question_id,
                "position": q.position,
                "kind": q.kind,
                "prompt": q.prompt,
                "options": json.loads(q.options),
                "correctIndex": None if q.kind == "written" else q.correct_index,
                "correctIndexes": json.loads(q.correct_indexes or "[]"),
                "modelAnswer": q.model_answer,
                "points": q.points,
                "answer": given.get(q.question_id),
                "awarded": marked.per_question.get(q.question_id),
                "overridden": q.question_id in marked.overridden_ids,
            }
            for q in questions
        ],
    }


@router.post(
    "/teacher/attempts/{attempt_id}/marks",
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def set_marks(
    attempt_id: str,
    body: dict,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Set or change the marks on an attempt.

    Works on any question, not only written ones. A choice question the
    server marked wrong can be given the marks anyway, which is what an
    accepted alternative answer or an ambiguous question needs, and the
    alternative is telling a student the computer disagrees with their
    teacher.

    Can be called again on an already marked attempt. Marking is a
    judgement, and judgements get revised.
    """
    result = await session.execute(
        select(QuizAttempt).where(
            QuizAttempt.attempt_id == attempt_id, QuizAttempt.org_id == org.org_id
        )
    )
    attempt = result.scalar_one_or_none()
    if attempt is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attempt not found")
    if attempt.submitted_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That attempt has not been submitted yet.",
        )

    marks = body.get("marks")
    if not isinstance(marks, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Marks must be an object."
        )

    valid = await session.execute(
        select(QuizQuestion.question_id).where(
            QuizQuestion.org_id == org.org_id,
            QuizQuestion.content_id == attempt.content_id,
        )
    )
    known = {r[0] for r in valid.all()}

    existing = json.loads(attempt.awarded or "{}")
    for qid, value in marks.items():
        if qid not in known:
            continue
        if value is None:
            # Clearing an override hands the question back to the server,
            # which is how a teacher undoes a change on a choice question.
            existing.pop(qid, None)
        else:
            existing[qid] = value
    attempt.awarded = json.dumps(existing)
    attempt.marked_by = user.user_id

    await _remark(session, org.org_id, attempt)

    return {
        "attemptId": attempt.attempt_id,
        "score": attempt.score,
        "maxScore": attempt.max_score,
        "percent": attempt.percent,
        "markedAt": attempt.marked_at,
        "awaitingMarking": attempt.marked_at is None,
    }


# ----------------------------------------------------------------------
# Batches and groups
#
# Who owns this was a real question. A batch is organisational structure,
# like a role or a plan: it outlives any one teacher, it is what the
# timetable and the register are built on, and two teachers inventing
# their own spelling of it is the failure mode. So Admin creates and
# renames them, and teachers assign students into what exists.
#
# Reading is open to teachers, because they need the list every time
# they add a student or take a register.
# ----------------------------------------------------------------------


@router.get("/batches", dependencies=[Depends(require_role("admin", "teacher"))])
async def list_batches(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
    include_archived: bool = False,
) -> list[dict]:
    """Batches in this organisation, with how many students are in each.

    The count comes from the student rows rather than a stored number,
    because a stored one goes stale the moment somebody is moved and
    there is no cheap way to notice.
    """
    stmt = select(Batch).where(Batch.org_id == org.org_id)
    if not include_archived:
        stmt = stmt.where(Batch.is_active.is_(True))
    result = await session.execute(stmt.order_by(Batch.is_active.desc(), Batch.name))
    batches = list(result.scalars())

    counts = await session.execute(
        select(Student.batch, func.count(Student.student_id))
        .where(Student.org_id == org.org_id)
        .group_by(Student.batch)
    )
    by_name = dict(counts.all())

    return [
        {
            "batchId": b.batch_id,
            "name": b.name,
            "year": b.year,
            "groups": json.loads(b.groups or "[]"),
            "isActive": b.is_active,
            "note": b.note,
            "students": by_name.get(b.name, 0),
        }
        for b in batches
    ]


@router.post(
    "/batches",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("admin"))],
)
async def create_batch(
    body: dict,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Create a batch. Admin only: this is organisational structure."""
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Give the batch a name."
        )

    clash = await session.execute(
        select(Batch.batch_id).where(Batch.org_id == org.org_id, Batch.name == name)
    )
    if clash.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"There is already a batch called {name}.",
        )

    batch = Batch(
        org_id=org.org_id,
        name=name[:60],
        year=body.get("year") or None,
        groups=json.dumps(_clean_groups(body.get("groups"))),
        note=(str(body.get("note") or "").strip() or None),
    )
    session.add(batch)
    await session.flush()
    return {
        "batchId": batch.batch_id,
        "name": batch.name,
        "groups": json.loads(batch.groups),
    }


def _clean_groups(raw) -> list[str]:
    """Group names, tidied and de-duplicated, order preserved.

    Case insensitive on the duplicate check, because "Batch A" and
    "batch a" being two groups inside one cohort is the same problem
    this table was added to solve, one level down.
    """
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for g in raw[:40]:
        name = str(g).strip()[:60]
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        out.append(name)
    return out


@router.patch("/batches/{batch_id}", dependencies=[Depends(require_role("admin"))])
async def update_batch(
    batch_id: str,
    body: dict,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Rename a batch, change its groups, or archive it.

    A rename carries the students with it. They reference the batch by
    name, so renaming the row without updating them would quietly empty
    the batch, which is the sort of thing discovered at a register.
    """
    result = await session.execute(
        select(Batch).where(Batch.batch_id == batch_id, Batch.org_id == org.org_id)
    )
    batch = result.scalar_one_or_none()
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    if "name" in body:
        new_name = str(body.get("name") or "").strip()
        if not new_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Give the batch a name."
            )
        if new_name != batch.name:
            clash = await session.execute(
                select(Batch.batch_id).where(
                    Batch.org_id == org.org_id,
                    Batch.name == new_name,
                    Batch.batch_id != batch_id,
                )
            )
            if clash.scalar_one_or_none() is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"There is already a batch called {new_name}.",
                )
            moved = await session.execute(
                select(Student).where(
                    Student.org_id == org.org_id, Student.batch == batch.name
                )
            )
            for s in moved.scalars():
                s.batch = new_name
            batch.name = new_name[:60]

    if "groups" in body:
        batch.groups = json.dumps(_clean_groups(body.get("groups")))
    if "year" in body:
        batch.year = body.get("year") or None
    if "note" in body:
        batch.note = str(body.get("note") or "").strip() or None
    if "isActive" in body:
        batch.is_active = bool(body.get("isActive"))

    return {
        "batchId": batch.batch_id,
        "name": batch.name,
        "groups": json.loads(batch.groups),
        "isActive": batch.is_active,
    }


@router.delete(
    "/batches/{batch_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_role("admin"))],
)
async def delete_batch(
    batch_id: str,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Remove a batch, but only while it is empty.

    A batch with students in it is refused rather than cascaded. Deleting
    it would leave every one of them pointing at a cohort that no longer
    exists, and their attendance and results with it. Archiving is the
    answer for a batch that has finished, and the error says so.
    """
    result = await session.execute(
        select(Batch).where(Batch.batch_id == batch_id, Batch.org_id == org.org_id)
    )
    batch = result.scalar_one_or_none()
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Batch not found")

    count = await session.execute(
        select(func.count(Student.student_id)).where(
            Student.org_id == org.org_id, Student.batch == batch.name
        )
    )
    students = count.scalar_one()
    if students:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{students} student{'s are' if students != 1 else ' is'} in this batch. "
                "Move them first, or archive the batch to keep its history."
            ),
        )
    await session.delete(batch)


# ----------------------------------------------------------------------
# Media upload and download
#
# The security notes live in app/services/storage_service.py. The short
# version for anyone reading only this file: the client never supplies a
# path, the extension is an allowlist, the content type is ours not the
# browser's, and every read resolves the row by (content_id, org_id)
# before it touches the disk.
# ----------------------------------------------------------------------


@router.post(
    "/teacher/content/{content_id}/file",
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def upload_file(
    content_id: str,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
    file: UploadFile = File(...),
) -> dict:
    """Attach a file to a content item.

    The content row is resolved by (content_id, org_id) first, so a
    crafted content id from another tenant is a 404 before a single byte
    is written anywhere.
    """
    result = await session.execute(
        select(Content).where(
            Content.content_id == content_id, Content.org_id == org.org_id
        )
    )
    item = result.scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content not found")

    extension = storage_service.extension_of(file.filename or "")
    if not extension:
        allowed = ", ".join(sorted(storage_service.ALLOWED))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"That file type is not accepted. Allowed: {allowed}",
        )

    key = storage_service.new_key(org.org_id, item.content_id, extension)
    try:
        size = await storage_service.save(file, key)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="That file is larger than 512 MB.",
        ) from None

    # Replacing a file removes the old one rather than orphaning it.
    if item.storage_key and item.storage_key != key:
        storage_service.delete(item.storage_key)

    item.storage_key = key
    item.original_name = storage_service.safe_label(file.filename or "", "upload")
    item.mime_type = storage_service.content_type_for(key)
    item.size_bytes = size

    return {
        "contentId": item.content_id,
        "originalName": item.original_name,
        "mimeType": item.mime_type,
        "sizeBytes": size,
    }


@router.get("/content/{content_id}/file")
async def download_file(
    content_id: str,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FileResponse:
    """Serve an uploaded file to anybody in the owning organisation.

    This is the route an insecure direct object reference would live on,
    so it is worth being explicit: the content id from the URL is only
    ever used together with the org id from the session. Guessing
    another tenant's content id returns 404, and the storage key is
    never accepted from the client at all.

    A student opening a file also records the view, which is what the
    engagement figures on the teacher's dashboard are counted from.
    """
    result = await session.execute(
        select(Content).where(
            Content.content_id == content_id, Content.org_id == org.org_id
        )
    )
    item = result.scalar_one_or_none()
    if item is None or not item.storage_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No file here")

    try:
        path = storage_service.path_for(item.storage_key)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No file here"
        ) from None
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The file for this item is missing.",
        )

    if user.role == "student":
        session.add(
            ContentView(
                org_id=org.org_id,
                content_id=item.content_id,
                student_id=user.user_id,
                viewed_at=utc_now(),
                progress_pct=100 if item.type == "doc" else 0,
                seconds_watched=0,
            )
        )
        item.view_count = (item.view_count or 0) + 1

    disposition = "inline" if storage_service.is_inline(item.storage_key) else "attachment"
    name = item.original_name or "file"
    return FileResponse(
        path,
        media_type=item.mime_type or storage_service.content_type_for(item.storage_key),
        headers={
            "Content-Disposition": f'{disposition}; filename="{name}"',
            # Belt and braces against a browser sniffing an upload into
            # something executable regardless of what we said it was.
            "X-Content-Type-Options": "nosniff",
        },
    )


# ----------------------------------------------------------------------
# Branding
# ----------------------------------------------------------------------

# Narrower than the content allowlist on purpose. An SVG is an XML
# document that can carry script, and a logo renders in the app's own
# chrome on every page, which is the last place to accept one.
# Cache headers for the two shapes of file route, named because which
# one a route gets is a tenant isolation decision rather than a
# performance preference.
#
# A route whose URL identifies the file may be cached. A route whose URL
# does not, because the organisation comes from the session, may not be:
# every tenant then reads a different body from the identical URL, and a
# URL is what a cache keys on.
#
# This is not hypothetical. /branding/logo carries no org id by design,
# which is exactly what stops a caller requesting somebody else's logo,
# and it was served as "private, max-age=300". A browser therefore handed
# one tenant's logo to the next tenant signing in on the same machine,
# with no request reaching the server. Only a hard refresh cleared it.
SESSION_SCOPED_FILE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store, private",
    "Vary": "Authorization",
}

# The tenant is named in the path here, so two tenants cannot collide in
# a cache. The client appends the logo version, so a replacement is a new
# URL rather than a five minute wait for the old one to expire.
ADDRESSED_FILE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=300",
    "Vary": "Authorization",
}

LOGO_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


@router.post("/admin/branding/logo", dependencies=[Depends(require_role("admin"))])
async def upload_logo(
    org: CurrentOrg,
    file: UploadFile = File(...),
) -> dict:
    """Replace the organisation's logo.

    Gated on the tier through the same feature gate the rest of branding
    uses, so a plan change takes effect without a code change.
    """
    if not has_feature(org.package_tier, "branding_logo"):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"error": "feature_not_in_plan", "feature": "branding_logo"},
        )

    extension = storage_service.extension_of(file.filename or "")
    if extension not in LOGO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A logo must be a PNG, JPG, WebP or GIF.",
        )

    key = storage_service.new_key(org.org_id, "branding", extension)
    try:
        await storage_service.save(file, key)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="That image is too large.",
        ) from None

    if org.logo_url and org.logo_url != key:
        storage_service.delete(org.logo_url)
    org.logo_url = key
    return {"logoUrl": key}


@router.get("/branding/logo")
async def get_logo(org: CurrentOrg) -> FileResponse:
    """Serve the caller's own organisation logo.

    No id in the path at all. The organisation comes from the session,
    so there is nothing here to enumerate: a caller can only ever fetch
    the logo of the tenant they are signed in to.
    """
    if not org.logo_url or not has_feature(org.package_tier, "branding_logo"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo set")
    try:
        path = storage_service.path_for(org.logo_url)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo set") from None
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo set")
    return FileResponse(
        path,
        media_type=storage_service.content_type_for(org.logo_url),
        headers=SESSION_SCOPED_FILE_HEADERS,
    )


@router.delete(
    "/admin/branding/logo",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_role("admin"))],
)
async def remove_logo(org: CurrentOrg) -> None:
    """Drop back to the initials."""
    storage_service.delete(org.logo_url)
    org.logo_url = None


@router.get(
    "/platform/branding/{org_id}",
    dependencies=[Depends(require_platform_access())],
)
async def platform_read_branding(
    org_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """One tenant's branding, for LoopLab support.

    A genuine cross tenant read, so it is guarded by
    require_platform_access rather than by the super_admin role. Holding
    the role is not on its own sufficient to reach into a customer's
    data (ARCHITECTURE.md section 8).
    """
    target = await session.get(Organization, org_id)
    if target is None or target.is_platform:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return {
        "orgId": target.org_id,
        "name": target.name,
        "slug": target.slug,
        "packageTier": target.package_tier,
        "logoText": target.logo_text,
        "primaryColor": target.primary_color,
        "secondaryColor": target.secondary_color,
        "customDomain": target.custom_domain,
        "hasLogo": bool(target.logo_url),
        "logoVersion": storage_service.version_of(target.logo_url),
    }


@router.patch(
    "/platform/branding/{org_id}",
    dependencies=[Depends(require_platform_access())],
)
async def platform_update_branding(
    org_id: str,
    body: dict,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Change a tenant's branding on their behalf.

    A support action the tenant did not perform, so it writes an audit
    row into *their* log, not only the platform's. A customer has to be
    able to see that somebody at the vendor changed their colours, and
    who did it.

    The tier gate still applies. LoopLab reaching in does not hand a
    Starter tenant a feature they have not bought: the branding would be
    stripped again on read, and the stored value and the rendered one
    would disagree.
    """
    target = await session.get(Organization, org_id)
    if target is None or target.is_platform:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    changed = []
    if "logoText" in body:
        target.logo_text = str(body["logoText"] or "").strip() or None
        changed.append("display name")
    if "primaryColor" in body:
        if not has_feature(target.package_tier, "branding_logo"):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={"error": "feature_not_in_plan", "feature": "branding_logo"},
            )
        target.primary_color = str(body["primaryColor"] or "").strip() or None
        changed.append("accent colour")
    if "secondaryColor" in body:
        if not has_feature(target.package_tier, "branding_palette"):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={"error": "feature_not_in_plan", "feature": "branding_palette"},
            )
        target.secondary_color = str(body["secondaryColor"] or "").strip() or None
        changed.append("secondary colour")

    if changed:
        session.add(
            AuditEntry(
                org_id=target.org_id,
                actor_id=user.user_id,
                actor_label=f"{user.name} (LoopLab)",
                action=f"Branding changed by LoopLab support: {', '.join(changed)}",
                target=target.slug,
                severity="warning",
                cross_tenant=True,
            )
        )

    return {"orgId": target.org_id, "changed": changed}


# ----------------------------------------------------------------------
# The company logo, and any tenant's
#
# Two identities are deliberately separate here.
#
#   The product mark is ClassConnect's. It is drawn in the app's own
#   chrome, ships with the build, and nobody uploads it: it is what the
#   software is called.
#
#   The company logo is LoopLab's, the operator. That one is uploaded,
#   because the company that runs an instance can change and the product
#   it runs cannot.
#
# Conflating them is what the read only platform branding screen got
# wrong: it showed the app's own mark as though it were the company's.
# ----------------------------------------------------------------------


@router.post(
    "/platform/branding/logo",
    dependencies=[Depends(require_role("super_admin"))],
)
async def upload_platform_logo(
    org: CurrentOrg,
    file: UploadFile = File(...),
) -> dict:
    """Upload the operating company's own logo.

    Role guarded rather than require_platform_access, because this
    writes to the caller's own organisation, not across into a tenant's.
    It refuses outright if that organisation is not the platform, so a
    stray super_admin sitting inside a tenant cannot use this path to
    bypass the tier gate on the ordinary branding route.

    No tier check. LoopLab is not a customer and does not hold a plan.
    """
    if not org.is_platform:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This route sets the operating company's logo, not a tenant's.",
        )

    extension = storage_service.extension_of(file.filename or "")
    if extension not in LOGO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A logo must be a PNG, JPG, WebP or GIF.",
        )

    key = storage_service.new_key(org.org_id, "branding", extension)
    try:
        await storage_service.save(file, key)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="That image is too large.",
        ) from None

    if org.logo_url and org.logo_url != key:
        storage_service.delete(org.logo_url)
    org.logo_url = key
    return {"logoUrl": key}


@router.delete(
    "/platform/branding/logo",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_role("super_admin"))],
)
async def remove_platform_logo(org: CurrentOrg) -> None:
    if not org.is_platform:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This route sets the operating company's logo, not a tenant's.",
        )
    storage_service.delete(org.logo_url)
    org.logo_url = None


@router.get(
    "/platform/branding/{org_id}/logo",
    dependencies=[Depends(require_platform_access())],
)
async def platform_tenant_logo(
    org_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FileResponse:
    """Any tenant's logo, so the platform screens can show it.

    A cross tenant read, so it is behind require_platform_access rather
    than the role. The tier gate is not applied on this route: an
    operator looking at a list of tenants wants to see the logo the
    tenant uploaded, whether or not their current plan still displays it
    to their own users.
    """
    target = await session.get(Organization, org_id)
    if target is None or not target.logo_url:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo set")
    try:
        path = storage_service.path_for(target.logo_url)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo set") from None
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo set")
    return FileResponse(
        path,
        media_type=storage_service.content_type_for(target.logo_url),
        headers=ADDRESSED_FILE_HEADERS,
    )
