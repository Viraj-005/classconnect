"""Create the schema and seed three tenants worth of data.

    python -m scripts.seed          create if empty
    python -m scripts.seed --reset  drop everything first

Seeds the same three organisations the design work was built against,
because each one exercises a different part of the product:

    Horizon Tutoring    Growth, active, custom teal branding
    Northfield College  Pro, active, full palette and custom domain
    Brightpath Academy  Starter, PAST DUE, no branding

The past due tenant is not an accident. Without it the grace banner and
the seat cap warning have nowhere to appear, and a demo where everything
is healthy hides every state worth reviewing.

The schema is built by running the real Alembic migrations, not by
create_all, so a local database is built exactly the way production is
and a broken migration fails here rather than at deploy.
"""

import argparse
import asyncio
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import select

from app.core.database import dispose_engine, get_engine, get_session_factory
from app.core.security import hash_password
from app.models import (
    Batch,
    AttendanceRecord,
    ContentView,
    QuizAttempt,
    QuizQuestion,
    ClassTicket,
    Content,
    Event,
    Organization,
    Student,
    StudentPayment,
    Subscription,
    Teacher,
    User,
)
from app.services.qr_service import issue_ticket

NOW = datetime.now(timezone.utc)
PASSWORD = "demo1234"


def ago(days: float, hour: int = 10) -> datetime:
    return (NOW - timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)


def ahead(days: float, hour: int = 10) -> datetime:
    return (NOW + timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0)


ORGS = [
    {
        "slug": "horizon",
        "name": "Horizon Tutoring",
        "tier": "growth",
        "billing": "active",
        "primary": "#2f6f6b",
        "secondary": None,
        "domain": None,
        "students": 386,
        "teachers": 14,
        "created": ago(420),
    },
    {
        "slug": "northfield",
        "name": "Northfield College",
        "tier": "pro",
        "billing": "active",
        "primary": "#1f4f8f",
        "secondary": "#b8722a",
        "domain": "learn.northfield.edu",
        "students": 1840,
        "teachers": 96,
        "created": ago(700),
    },
    {
        "slug": "brightpath",
        "name": "Brightpath Academy",
        "tier": "starter",
        "billing": "past_due",
        "primary": None,
        "secondary": None,
        "domain": None,
        "students": 88,
        "teachers": 4,
        "created": ago(96),
    },
]

TEACHERS = [
    ("Dinesh Ratnayake", "dinesh", "Combined Maths, Physics"),
    ("Shanika Fernando", "shanika", "Chemistry, ICT"),
    ("Malithi Jayawardena", "malithi", "Biology, Chemistry"),
]

STUDENT_SEED = [
    ("Amaya Perera", "amaya", "2026 A/L", "Batch A", "paid"),
    ("Kavindu Jayasuriya", "kavindu", "2026 A/L", "Batch A", "paid"),
    ("Tharushi Wickramasinghe", "tharushi", "2026 A/L", "Batch B", "unpaid"),
    ("Sahan Gunaratne", "sahan", "2026 A/L", "Batch A", "paid"),
    ("Nethmi Rajapaksa", "nethmi", "2027 A/L", "Batch C", "pending_review"),
    ("Ishara Bandara", "ishara", "2026 A/L", "Batch B", "overdue"),
    ("Dilan Weerasinghe", "dilan", "2027 A/L", "Batch C", "paid"),
    ("Hasini Alwis", "hasini", "2026 A/L", "Batch A", "paid"),
    ("Ravindu Senanayake", "ravindu", "2027 A/L", "Batch C", "unpaid"),
    ("Chamodi Ekanayake", "chamodi", "2026 A/L", "Batch B", "paid"),
    ("Yasiru Mendis", "yasiru", "2026 A/L", "Batch A", "paid"),
    ("Oshadi Karunaratne", "oshadi", "2027 A/L", "Batch C", "overdue"),
]

CONTENT_SEED = [
    ("video", "Integration by parts, worked problems", "Combined Maths", 1, 48, 412_000_000),
    ("quiz", "Thermodynamics unit test", "Physics", 2, None, None),
    ("doc", "Organic reaction pathways, summary sheet", "Chemistry", 3, None, 2_400_000),
    ("video", "Projectile motion, past paper walkthrough", "Physics", 5, 62, 528_000_000),
    ("doc", "2025 model paper, Combined Maths II", "Combined Maths", 6, None, 1_100_000),
    ("quiz", "Cell biology rapid check", "Biology", 8, None, None),
    ("video", "Database normalisation explained", "ICT", 11, 35, 298_000_000),
    ("doc", "Electrochemistry formula reference", "Chemistry", 14, None, 860_000),
]

EVENT_SEED = [
    ("Physics revision, projectiles", "class", 1, 15, 120, "2026 A/L"),
    ("Combined Maths, term test II", "exam", 2, 9, 180, "2026 A/L"),
    ("Parent evening, Batch A", "meeting", 4, 17, 90, "2026 A/L"),
    ("Chemistry practical session", "class", 6, 10, 150, "2027 A/L"),
    ("ICT project checkpoint", "meeting", 9, 14, 60, "2027 A/L"),
]


async def seed_org(session, spec: dict) -> Organization:
    org = Organization(
        name=spec["name"],
        slug=spec["slug"],
        package_tier=spec["tier"],
        billing_status=spec["billing"],
        logo_text=spec["name"].split()[0],
        primary_color=spec["primary"],
        secondary_color=spec["secondary"],
        custom_domain=spec["domain"],
        student_count=spec["students"],
        teacher_count=spec["teachers"],
        created_at=spec["created"],
        grace_period_ends_at=ahead(6) if spec["billing"] == "past_due" else None,
    )
    session.add(org)
    await session.flush()

    session.add(
        Subscription(
            org_id=org.org_id,
            plan=spec["tier"],
            status=spec["billing"],
            current_period_end=ahead(26),
            is_current=True,
            stripe_customer_id=f"cus_demo_{spec['slug']}",
        )
    )

    domain = spec["slug"]

    # Admin
    admin = User(
        org_id=org.org_id,
        role="admin",
        name="Ruwan Silva" if spec["slug"] == "horizon" else f"{spec['name']} Admin",
        email=f"admin@{domain}.lk",
        password_hash=hash_password(PASSWORD),
        last_seen_at=ago(0, 9),
    )
    session.add(admin)

    # Teachers
    teacher_users = []
    for name, handle, subjects in TEACHERS[: min(3, spec["teachers"])]:
        u = User(
            org_id=org.org_id,
            role="teacher",
            name=name,
            email=f"{handle}@{domain}.lk",
            password_hash=hash_password(PASSWORD),
            last_seen_at=ago(len(teacher_users), 8),
        )
        session.add(u)
        await session.flush()
        session.add(
            Teacher(teacher_id=u.user_id, org_id=org.org_id, subjects_taught=subjects)
        )
        teacher_users.append(u)

    # One parent, linked to the first student below.
    parent = User(
        org_id=org.org_id,
        role="parent",
        name="Nilanthi Perera",
        email=f"parent@{domain}.lk",
        password_hash=hash_password(PASSWORD),
        last_seen_at=ago(2, 20),
    )
    session.add(parent)
    await session.flush()

    # Students
    student_rows = []
    for i, (name, handle, batch, group, status) in enumerate(STUDENT_SEED):
        u = User(
            org_id=org.org_id,
            role="student",
            name=name,
            email=f"{handle}@{domain}.lk",
            password_hash=hash_password(PASSWORD),
            last_seen_at=ago((i % 6) + 1, 12),
        )
        session.add(u)
        await session.flush()
        s = Student(
            student_id=u.user_id,
            org_id=org.org_id,
            batch=batch,
            group=group,
            # The first student is the demo parent's child.
            parent_id=parent.user_id if i == 0 else None,
        )
        session.add(s)
        student_rows.append((s, u, status))

    # Batches.
    #
    # Created from the batches the seeded students are in, because until
    # now a batch existed only as a string typed onto a student record.
    # This makes the implicit list explicit, which is the whole point of
    # the table.
    for batch_name in sorted({s.batch for s, _u, _st in student_rows if s.batch}):
        groups = sorted(
            {s.group for s, _u, _st in student_rows if s.batch == batch_name and s.group}
        )
        year = None
        for token in batch_name.split():
            if token.isdigit() and len(token) == 4:
                year = int(token)
        session.add(
            Batch(
                org_id=org.org_id,
                name=batch_name,
                year=year,
                groups=json.dumps(groups),
                is_active=True,
            )
        )
    await session.flush()

    # Content
    for ctype, title, subject, days, mins, size in CONTENT_SEED:
        session.add(
            Content(
                org_id=org.org_id,
                type=ctype,
                title=title,
                subject=subject,
                uploader_id=teacher_users[days % len(teacher_users)].user_id,
                duration_mins=mins,
                size_bytes=size,
                view_count=120 + days * 17,
                created_at=ago(days, 9),
            )
        )

    # Payments, one per student, with the seeded status.
    for i, (student, _user, status) in enumerate(student_rows):
        paid = status == "paid"
        session.add(
            StudentPayment(
                org_id=org.org_id,
                student_id=student.student_id,
                amount=8500,
                currency="LKR",
                status=status,
                method="stripe" if i % 3 == 0 else "slip" if status == "pending_review" else "cash",
                created_at=ago(1 + i, 17),
                expiry_date=ahead(30 - i * 2) if paid else ago(i),
                slip_storage_key=(
                    f"{org.org_id}/slips/boc-deposit-{i}.jpg"
                    if status == "pending_review"
                    else None
                ),
            )
        )

        # Tickets only exist where the tier includes them.
        if paid and spec["tier"] in ("growth", "pro"):
            _payload, signature, expiry = issue_ticket(
                student_name=_user.name,
                student_id=student.student_id,
                org_id=org.org_id,
                batch=student.batch,
                group=student.group,
            )
            session.add(
                ClassTicket(
                    org_id=org.org_id,
                    student_id=student.student_id,
                    signature=signature,
                    expiry_date=expiry,
                    scan_count=3 + i,
                )
            )

    # Events
    for title, etype, days, hour, mins, batch in EVENT_SEED:
        session.add(
            Event(
                org_id=org.org_id,
                title=title,
                type=etype,
                scheduled_at=ahead(days, hour),
                duration_mins=mins,
                batch=batch,
                created_by=teacher_users[days % len(teacher_users)].user_id,
            )
        )

    await session.flush()

    # Records of what students actually did. Everything the dashboards
    # used to invent is counted from these.
    await seed_learning_records(
        session,
        org,
        teacher_users,
        student_rows,
        # Seeded per organisation, so each tenant looks different from
        # the next but any one of them looks the same on every re-seed.
        random.Random(f"classconnect-{org.slug}"),
    )

    return org


async def seed_super_admin(session) -> None:
    """LoopLab staff.

    Given a synthetic org_id rather than belonging to a tenant. Super
    Admin is a platform role and must not sit inside anyone's tenant.
    """
    existing = await session.execute(
        select(User).where(User.email == "viraj@looplab.io")
    )
    if existing.scalar_one_or_none() is not None:
        return

    platform = Organization(
        org_id="looplab",
        name="LoopLab",
        slug="looplab",
        package_tier="pro",
        billing_status="active",
        logo_text="LoopLab",
        primary_color="#613380",
        is_platform=True,
        student_count=0,
        teacher_count=0,
    )
    session.add(platform)
    await session.flush()

    session.add(
        User(
            org_id="looplab",
            role="super_admin",
            name="Viraj Induruwa",
            email="viraj@looplab.io",
            password_hash=hash_password(PASSWORD),
            last_seen_at=NOW,
        )
    )


def _alembic_config() -> Config:
    """Alembic config resolved relative to this file.

    Built by path rather than by assuming a working directory, so the
    seed works whether it is run from apps/api or from the repo root.
    """
    root = Path(__file__).resolve().parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    return cfg


# Slugs this script creates. Anything else in the organisations table
# arrived through signup, which means a real person made it.
SEED_SLUGS = {spec["slug"] for spec in ORGS} | {"looplab"}


async def tenants_this_script_did_not_create() -> list[Organization]:
    """Organisations a reset would destroy that no reseed brings back.

    --reset rolls every migration back, which drops every table. The
    three demo tenants come back on the next run and anything created
    through signup does not, so a reset quietly deletes real customers
    and leaves the database looking fine.

    That is not hypothetical. A free tier tenant somebody had signed up
    to try the product was lost to exactly this, and nothing in the
    output said so.
    """
    try:
        factory = get_session_factory()
        async with factory() as session:
            result = await session.execute(
                select(Organization).order_by(Organization.created_at)
            )
            return [o for o in result.scalars() if o.slug not in SEED_SLUGS]
    except Exception:
        # No database, or no tables yet. Nothing to lose either way, and
        # a first run must not be blocked by a check meant to protect
        # data that does not exist.
        return []
    finally:
        # The engine is cached globally and bound to this event loop.
        # Leaving it behind would hand the seed step a dead connection
        # pool once this loop closes.
        await dispose_engine()


def refuse_if_it_would_destroy_real_tenants(force: bool) -> None:
    strangers = asyncio.run(tenants_this_script_did_not_create())
    if not strangers:
        return

    print()
    print(f"  --reset would permanently delete {len(strangers)} organisation(s)")
    print("  that this script did not create and cannot recreate:")
    print()
    for o in strangers:
        print(
            f"    {o.name}  (slug {o.slug}, {o.package_tier}, "
            f"created {o.created_at:%Y-%m-%d})"
        )
    print()
    if force:
        print("  --delete-real-tenants was given, so continuing.")
        print()
        return
    print("  Refusing. The demo tenants come back on the next seed and these")
    print("  do not. If you meant it, run again with --delete-real-tenants.")
    print()
    sys.exit(1)


def migrate(reset: bool) -> None:
    """Bring the schema to head through Alembic.

    This used to call Base.metadata.create_all, which builds the schema
    straight from the models and never touches a migration. That is
    convenient and quietly dangerous: it means local databases are built
    one way and production another, so a broken migration would not
    surface until deploy. Running the real migrations here is the whole
    point of having them.
    """
    cfg = _alembic_config()
    if reset:
        print("Rolling every migration back")
        command.downgrade(cfg, "base")
    print("Applying migrations")
    command.upgrade(cfg, "head")


async def seed(reset: bool) -> None:
    """Insert the demo data. The schema must already be at head."""
    engine = get_engine()
    factory = get_session_factory()
    async with factory() as session:
        existing = await session.execute(select(Organization).limit(1))
        if existing.scalar_one_or_none() is not None and not reset:
            print("Database already has data. Use --reset to rebuild it.")
            return

        for spec in ORGS:
            org = await seed_org(session, spec)
            print(f"  seeded {org.name} ({org.package_tier}, {org.billing_status})")

        await seed_super_admin(session)
        await session.commit()

    await engine.dispose()

    print("\nDone. Sign in with any of these, password:", PASSWORD)
    print("  Super Admin  viraj@looplab.io          org: looplab")
    for spec in ORGS:
        print(f"  Admin        admin@{spec['slug']}.lk".ljust(46) + f"org: {spec['slug']}")
        print(f"  Teacher      dinesh@{spec['slug']}.lk".ljust(46) + f"org: {spec['slug']}")
        print(f"  Student      amaya@{spec['slug']}.lk".ljust(46) + f"org: {spec['slug']}")
        print(f"  Parent       parent@{spec['slug']}.lk".ljust(46) + f"org: {spec['slug']}")


# ----------------------------------------------------------------------
# Learning records
# ----------------------------------------------------------------------

# Four questions per quiz. Short on purpose: the point of the seed is a
# working demo of the marking and the dashboards, not a real paper.
QUIZ_BANK = {
    "Thermodynamics unit test": [
        (
            "Which law introduces the concept of entropy?",
            ["Zeroth law", "First law", "Second law", "Third law"],
            2,
            1,
        ),
        (
            "In an adiabatic process, which quantity stays zero?",
            ["Work done", "Heat exchanged", "Internal energy", "Pressure"],
            1,
            1,
        ),
        (
            "The efficiency of a Carnot engine depends only on",
            ["The working substance", "The two temperatures", "The pressure", "The volume"],
            1,
            2,
        ),
        (
            "Internal energy of an ideal gas depends only on",
            ["Volume", "Pressure", "Temperature", "Entropy"],
            2,
            1,
        ),
    ],
    "Cell biology rapid check": [
        (
            "Which organelle produces most of a cell's ATP?",
            ["Ribosome", "Mitochondrion", "Golgi body", "Lysosome"],
            1,
            1,
        ),
        (
            "Plant cell walls are mainly made of",
            ["Chitin", "Cellulose", "Peptidoglycan", "Keratin"],
            1,
            1,
        ),
        (
            "Which stage of mitosis separates sister chromatids?",
            ["Prophase", "Metaphase", "Anaphase", "Telophase"],
            2,
            2,
        ),
        (
            "The fluid mosaic model describes the",
            ["Nucleus", "Cell membrane", "Cytoskeleton", "Chloroplast"],
            1,
            1,
        ),
    ],
}

# Past class sessions, for the attendance register to hang off. The
# seeded EVENT_SEED entries are all in the future, which is right for a
# schedule and useless for a register.
PAST_CLASS_WEEKS = 12


async def seed_learning_records(session, org, teacher_users, student_rows, rng) -> None:
    """Quiz questions and attempts, an attendance register, and views.

    Everything here is drawn from a seeded generator so a re-seed
    produces the same demo. That matters more than it sounds: a
    screenshot in a document should still match the app next week, and a
    figure that moves on every seed is one nobody can check.

    The distributions are chosen to look like a real class rather than a
    uniform one. Most students attend most of the time, a couple are
    unreliable, and quiz scores cluster above the pass mark with a tail
    below it. A dashboard built on uniform noise looks wrong in a way
    that is hard to name.
    """
    from app.models import AttendanceRecord, ContentView, QuizAttempt, QuizQuestion

    # ---------------------------------------------------------------- quizzes
    quizzes = await session.execute(
        select(Content).where(Content.org_id == org.org_id, Content.type == "quiz")
    )
    quiz_rows = list(quizzes.scalars())

    for quiz in quiz_rows:
        bank = QUIZ_BANK.get(quiz.title)
        if not bank:
            continue
        max_score = 0
        questions = []
        for position, (prompt, options, correct, points) in enumerate(bank):
            max_score += points
            q = QuizQuestion(
                org_id=org.org_id,
                content_id=quiz.content_id,
                position=position,
                prompt=prompt,
                options=json.dumps(options),
                correct_index=correct,
                points=points,
            )
            session.add(q)
            questions.append(q)

        # Flushed so the generated ids exist. The stored answers are
        # keyed by question id, exactly as the submit endpoint writes
        # them, because the review screen looks them up that way. Keying
        # by position instead would leave every seeded attempt showing
        # no chosen answer at all.
        await session.flush()

        # About four in five students have sat each quiz. A quiz where
        # everybody has a result is not what a teacher's screen looks
        # like, and the "not yet attempted" case needs to be visible.
        for student, _user, _status in student_rows:
            if rng.random() > 0.78:
                continue
            # Skill per student, so the same person tends to do well or
            # badly across quizzes rather than being re-rolled each time.
            skill = rng.gauss(0.68, 0.19)
            answers = {}
            score = 0
            for q, (_p, _o, correct, points) in zip(questions, bank):
                got_it = rng.random() < max(0.05, min(0.98, skill))
                answers[q.question_id] = correct if got_it else (correct + 1) % 4
                if got_it:
                    score += points
            attempt_at = ago(rng.randint(1, 20), rng.randint(9, 19))
            session.add(
                QuizAttempt(
                    org_id=org.org_id,
                    content_id=quiz.content_id,
                    student_id=student.student_id,
                    started_at=attempt_at,
                    submitted_at=attempt_at,
                    # Seeded quizzes are all multiple choice, so the
                    # server marked them on arrival. Leaving marked_at
                    # NULL would drop every seeded attempt into the
                    # teacher's marking queue as though it needed a
                    # person, which is exactly what it does not.
                    marked_at=attempt_at,
                    score=score,
                    max_score=max_score,
                    answers=json.dumps(answers),
                )
            )

    # ------------------------------------------------------------- attendance
    # Classes run Tuesday, Thursday and Saturday, which is the shape of
    # a Sri Lankan tuition timetable.
    batches = sorted({s.batch for s, _u, _st in student_rows if s.batch})
    for week in range(PAST_CLASS_WEEKS):
        for weekday, hour in ((1, 15), (3, 16), (5, 9)):
            days_back = (PAST_CLASS_WEEKS - week) * 7 - weekday
            if days_back <= 0:
                continue
            for batch in batches:
                ev = Event(
                    org_id=org.org_id,
                    title=f"{batch} session",
                    type="class",
                    scheduled_at=ago(days_back, hour),
                    duration_mins=120,
                    batch=batch,
                    created_by=teacher_users[week % len(teacher_users)].user_id,
                )
                session.add(ev)
                await session.flush()

                for student, _user, _status in student_rows:
                    if student.batch != batch:
                        continue
                    # A per student reliability, so the register has
                    # regulars and stragglers rather than uniform noise.
                    reliability = 0.72 + (hash(student.student_id) % 25) / 100
                    roll = rng.random()
                    if roll < reliability:
                        mark = "present"
                    elif roll < reliability + 0.08:
                        mark = "late"
                    elif roll < reliability + 0.11:
                        mark = "excused"
                    else:
                        mark = "absent"
                    session.add(
                        AttendanceRecord(
                            org_id=org.org_id,
                            event_id=ev.event_id,
                            student_id=student.student_id,
                            status=mark,
                            marked_by=teacher_users[0].user_id,
                        )
                    )

    # ----------------------------------------------------------- content views
    items = await session.execute(
        select(Content).where(Content.org_id == org.org_id, Content.type != "quiz")
    )
    content_rows = list(items.scalars())

    # Fourteen days of views, weighted so the recent week is busier than
    # the one before it. That gives the engagement comparison something
    # real to show rather than two flat lines.
    for days_back in range(14, 0, -1):
        busy = 1.35 if days_back <= 7 else 1.0
        for item in content_rows:
            watchers = [s for s, _u, _st in student_rows if rng.random() < 0.09 * busy]
            for student in watchers:
                progress = 100 if item.type == "doc" else min(100, int(rng.gauss(72, 24)))
                progress = max(5, progress)
                session.add(
                    ContentView(
                        org_id=org.org_id,
                        content_id=item.content_id,
                        student_id=student.student_id,
                        viewed_at=ago(days_back, rng.randint(7, 22)),
                        progress_pct=progress,
                        seconds_watched=(
                            0
                            if item.type == "doc"
                            else int((item.duration_mins or 30) * 60 * progress / 100)
                        ),
                    )
                )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--reset",
        action="store_true",
        help="roll every migration back before reapplying, which drops every table",
    )
    parser.add_argument(
        "--delete-real-tenants",
        action="store_true",
        help=(
            "allow --reset to destroy organisations created through signup, "
            "which no reseed brings back"
        ),
    )
    args = parser.parse_args()
    try:
        # Before anything is dropped, not after.
        if args.reset:
            refuse_if_it_would_destroy_real_tenants(args.delete_real_tenants)
        # Migrations run first and synchronously. Alembic drives its own
        # event loop for the async engine, so calling it from inside
        # asyncio.run() raises "cannot be called from a running event
        # loop". Keeping it out here is not a style choice.
        migrate(args.reset)
        asyncio.run(seed(args.reset))
    except KeyboardInterrupt:
        sys.exit(1)

