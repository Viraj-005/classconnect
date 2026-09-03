"""Tenant scoped entities.

Every model here carries org_id through TenantMixin, and every query
against them must filter on the org_id resolved by get_current_org.

Composite indexes are (org_id, <lookup column>) rather than the lookup
column alone. A single column index on, say, email would be scanned
across all tenants before the org filter applied, which gets slow as
soon as the platform has real tenant count.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TenantMixin, TimestampMixin, new_id

ROLES = ("super_admin", "admin", "teacher", "student", "parent")
CONTENT_TYPES = ("video", "doc", "quiz")
PAYMENT_STATUSES = ("paid", "unpaid", "pending_review", "overdue")
EVENT_TYPES = ("exam", "meeting", "class")


class User(Base, TenantMixin, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (
        # Email is unique per organisation, not globally. The same person
        # may legitimately hold accounts at two different tenants.
        UniqueConstraint("org_id", "email", name="uq_users_org_email"),
        Index("ix_users_org_role", "org_id", "role"),
    )

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Two factor authentication.
    #
    # The secret and the confirmation are separate columns on purpose,
    # and that separation is the whole state machine. A secret with no
    # confirmation means enrolment was started and never finished: the
    # person scanned the QR code, closed the tab, and must NOT be
    # challenged at the next login. Only totp_confirmed_at turns the
    # requirement on, and it is only ever set after the server has seen
    # a valid code from that secret. Without this you can lock somebody
    # out of their account by abandoning a form.
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # SHA-256 hashes of the single use recovery codes, as a JSON array.
    # See app/core/totp.py for why these are not bcrypt.
    recovery_codes: Mapped[str | None] = mapped_column(Text, nullable=True)

    @property
    def has_two_factor(self) -> bool:
        return self.totp_confirmed_at is not None

    def __repr__(self) -> str:
        return f"<User {self.email} role={self.role} org={self.org_id}>"


class Teacher(Base, TenantMixin, TimestampMixin):
    __tablename__ = "teachers"

    teacher_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True
    )
    subjects_taught: Mapped[str | None] = mapped_column(Text, nullable=True)


class Batch(Base, TenantMixin, TimestampMixin):
    """A cohort, and the groups inside it.

    Until now a batch existed only because somebody typed it into a
    student record. The filter list was built by collecting the distinct
    strings already on the roll, which means "2026 A/L" and "2026 A/l"
    were two different batches and nobody found out until a register
    came up half empty.

    Making it a row fixes three things at once: the name is spelled one
    way, a batch can exist before it has any students in it, and it can
    carry the things a cohort actually has, like a year and whether it
    is still running.

    Groups live on the batch rather than in their own table. A group is
    only ever meaningful inside one, "Batch A" of the 2026 A/L cohort
    has nothing to do with "Batch A" of 2027, and a separate table would
    invite exactly that confusion.
    """

    __tablename__ = "batches"
    __table_args__ = (
        # One name per organisation. This is the constraint that stops
        # the near duplicate problem at the database rather than trusting
        # every screen to check first.
        UniqueConstraint("org_id", "name", name="uq_batches_org_name"),
        Index("ix_batches_org_active", "org_id", "is_active"),
    )

    batch_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # JSON array of group names, ordered as the teacher wants them.
    groups: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    # Archived rather than deleted. A batch that has finished still owns
    # its attendance and its results, and removing it would orphan them.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Student(Base, TenantMixin, TimestampMixin):
    __tablename__ = "students"
    __table_args__ = (Index("ix_students_org_batch", "org_id", "batch"),)

    student_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True
    )
    batch: Mapped[str | None] = mapped_column(String(60), nullable=True)
    group: Mapped[str | None] = mapped_column(String(60), nullable=True)
    # A parent is a User in the same organisation. The FK cannot enforce
    # the same-org part, so the service layer checks it on assignment.
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    payments: Mapped[list["StudentPayment"]] = relationship(
        back_populates="student", cascade="all, delete-orphan"
    )


class Content(Base, TenantMixin, TimestampMixin):
    __tablename__ = "content"
    __table_args__ = (
        Index("ix_content_org_subject", "org_id", "subject"),
        Index("ix_content_org_created", "org_id", "created_at"),
    )

    content_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    type: Mapped[str] = mapped_column(String(12), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str | None] = mapped_column(String(120), nullable=True)
    uploader_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    # S3 keys are prefixed with the org id, so a misconfigured bucket
    # listing still cannot enumerate another tenant's files by name.
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # The name the teacher uploaded, kept for display only. It is never
    # used to build a path: see storage_service for why.
    original_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    duration_mins: Mapped[int | None] = mapped_column(Integer, nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class StudentPayment(Base, TenantMixin, TimestampMixin):
    """A tenant collecting a class fee from its own student.

    Renamed from the original BRD's Payment so it can never be confused
    with Subscription, which is LoopLab billing the tenant.
    """

    __tablename__ = "student_payments"
    __table_args__ = (
        Index("ix_payments_org_status", "org_id", "status"),
        Index("ix_payments_org_student", "org_id", "student_id"),
    )

    payment_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    student_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("students.student_id", ondelete="CASCADE"), nullable=False
    )
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="LKR", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="unpaid", nullable=False)
    method: Mapped[str] = mapped_column(String(16), default="cash", nullable=False)

    # Gateway reference. Card data itself never reaches this database,
    # the gateway holds the PCI-DSS scope (ARCHITECTURE.md section 8).
    gateway_reference: Mapped[str | None] = mapped_column(String(160), nullable=True)
    slip_storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(36), nullable=True)

    expiry_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    student: Mapped[Student] = relationship(back_populates="payments")


class ClassTicket(Base, TenantMixin, TimestampMixin):
    """A QR class ticket, issued on payment confirmation.

    The payload is signed server side. A client generated code would be
    trivially forgeable, so ticket creation never happens on the client.
    """

    __tablename__ = "class_tickets"
    __table_args__ = (Index("ix_tickets_org_student", "org_id", "student_id"),)

    ticket_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    student_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("students.student_id", ondelete="CASCADE"), nullable=False
    )
    payment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    signature: Mapped[str] = mapped_column(String(128), nullable=False)
    expiry_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    scan_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class Event(Base, TenantMixin, TimestampMixin):
    __tablename__ = "events"
    __table_args__ = (Index("ix_events_org_scheduled", "org_id", "scheduled_at"),)

    event_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(12), nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_mins: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    batch: Mapped[str | None] = mapped_column(String(60), nullable=True)
    created_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )


class PageAccess(Base, TimestampMixin):
    """Per role page access override.

    org_id is nullable on purpose and the nullability carries meaning:

        org_id IS NULL   platform default, set by LoopLab Super Admin.
                         This is the ceiling for every tenant.
        org_id = <id>    that tenant's own override, set by their Admin.
                         May only narrow what the platform allows.

    See app/services/page_registry.py for how the two combine.
    """

    __tablename__ = "page_access"
    __table_args__ = (
        UniqueConstraint("org_id", "role", "page_key", name="uq_page_access_scope"),
        Index("ix_page_access_org_role", "org_id", "role"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    org_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    page_key: Mapped[str] = mapped_column(String(64), nullable=False)
    allowed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Who last changed it, so the audit trail has a name to point at.
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class AuditEntry(Base, TimestampMixin):
    """Audit log.

    org_id is nullable because platform level events (a Super Admin
    action, a Stripe Billing webhook) belong to no single tenant. Those
    rows are what the platform access log reads, and a cross tenant
    access writes a row visible to BOTH the platform log and the
    tenant's own log.
    """

    __tablename__ = "audit_entries"
    __table_args__ = (Index("ix_audit_org_created", "org_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    org_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    actor_label: Mapped[str] = mapped_column(String(160), default="system", nullable=False)
    action: Mapped[str] = mapped_column(String(255), nullable=False)
    target: Mapped[str | None] = mapped_column(String(255), nullable=True)
    severity: Mapped[str] = mapped_column(String(12), default="info", nullable=False)
    # True when a LoopLab operator reached into a tenant's own data.
    cross_tenant: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


# ----------------------------------------------------------------------
# Learning records
#
# These four tables are the source tables the analytics service has been
# apologising for. Until now engagement, attendance and quiz results had
# nowhere to come from, so the API generated them and flagged the
# response `synthetic: true`. Everything below exists so those numbers
# can be counted instead of invented.
# ----------------------------------------------------------------------


ATTENDANCE_STATUSES = ("present", "absent", "late", "excused")

# How a question is answered, and therefore how it is marked.
#
#   choice   one option out of several, marked by the server
#   multi    several options, all or nothing, marked by the server
#   written  free text, marked by a person
#
# The distinction is not cosmetic: a quiz containing a single written
# question cannot produce a final score until a teacher has read it, and
# that changes the state machine for the whole attempt.
QUESTION_KINDS = ("choice", "multi", "written")


class QuizQuestion(Base, TenantMixin, TimestampMixin):
    """One question on a quiz.

    A quiz is a Content row of type "quiz"; the questions hang off it.
    Keeping them in their own table rather than as JSON on the content
    row is what makes "which question does everyone get wrong" a query
    rather than a script.

    Options are JSON because they are a short ordered list that is only
    ever read as a whole. The correct answer is an index into that list,
    so reordering options without updating the index would silently mark
    the wrong one right. Anything that edits options must edit both.
    """

    __tablename__ = "quiz_questions"
    __table_args__ = (
        Index("ix_quiz_questions_org_content", "org_id", "content_id", "position"),
    )

    question_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    content_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("content.content_id", ondelete="CASCADE"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    # server_default as well as default, and they have to agree.
    #
    # The Python default only fires on an ORM insert, so the migration
    # needed a database level one to backfill existing rows when this
    # column was added. Declaring it here too keeps the model and the
    # migration in step, which is what the drift test checks.
    kind: Mapped[str] = mapped_column(
        String(12), default="choice", server_default="choice", nullable=False
    )
    # JSON array of answer strings. Empty for a written question, which
    # has no options to choose between.
    options: Mapped[str] = mapped_column(Text, nullable=False)
    # Meaningless on a written question, where there is no index to
    # point at. Kept non nullable so the choice path cannot forget it.
    correct_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # What a good answer looks like, shown to whoever marks it. Guidance
    # for a person, never shown to a student and never compared against
    # automatically: marking free text by string match is how a correct
    # answer phrased differently gets a zero.
    model_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSON array of the correct option indexes, for a multi answer
    # question. correct_index above stays authoritative for a single
    # answer one, so existing rows keep meaning what they meant.
    correct_indexes: Mapped[str | None] = mapped_column(Text, nullable=True)
    points: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    @property
    def is_written(self) -> bool:
        return self.kind == "written"

    @property
    def is_multi(self) -> bool:
        return self.kind == "multi"


class QuizAttempt(Base, TenantMixin, TimestampMixin):
    """One student's run at one quiz.

    Retakes are allowed, so this is not unique on (student, quiz). A
    pass rate therefore has to say which attempt it counts, and the
    analytics service uses the best score per student, which is the
    figure a teacher means when they ask what proportion passed.

    submitted_at NULL means still in progress. That distinction matters
    for the pass rate: an abandoned attempt is not a fail, and counting
    it as one would make every quiz look harder than it is.
    """

    __tablename__ = "quiz_attempts"
    __table_args__ = (
        Index("ix_quiz_attempts_org_content", "org_id", "content_id"),
        Index("ix_quiz_attempts_org_student", "org_id", "student_id"),
    )

    attempt_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    content_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("content.content_id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # JSON object of question_id -> answer. An option index for a choice
    # question, a string for a written one.
    answers: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Marking, for attempts holding written answers.
    #
    # submitted_at means the student has finished. marked_at means a
    # person has finished. An attempt with written answers sits between
    # the two, which is the state the marking queue lists. An attempt of
    # only choice questions gets both stamps at once, because the server
    # marked it the moment it arrived.
    marked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    marked_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    # JSON object of question_id -> marks awarded, for written answers.
    awarded: Mapped[str | None] = mapped_column(Text, nullable=True)

    @property
    def awaiting_marking(self) -> bool:
        return self.submitted_at is not None and self.marked_at is None

    @property
    def percent(self) -> int:
        """The score so far, out of the whole quiz.

        Provisional while marking is outstanding, because the written
        marks are not in yet. Callers that need a final figure check
        awaiting_marking first, and the analytics rollup excludes
        unmarked attempts entirely rather than counting them low.
        """
        return round(self.score / self.max_score * 100) if self.max_score else 0


class AttendanceRecord(Base, TenantMixin, TimestampMixin):
    """Whether one student was at one class.

    Unique on (org, event, student) so marking a register twice corrects
    the record rather than doubling it. A teacher who scrolls back and
    changes their mind is the normal case, not an error.

    Attendance hangs off an Event rather than off a date, because a
    batch can have two classes in a day and "present on Tuesday" is not
    a fact about either of them.
    """

    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("org_id", "event_id", "student_id", name="uq_attendance_once"),
        Index("ix_attendance_org_student", "org_id", "student_id"),
        Index("ix_attendance_org_event", "org_id", "event_id"),
    )

    record_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    event_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("events.event_id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(12), nullable=False)
    marked_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ContentView(Base, TenantMixin, TimestampMixin):
    """One student opening one piece of content, appended per session.

    An event log rather than a per student counter, because the counter
    cannot answer the question the dashboard actually asks. "Engagement
    over the last seven days" needs to know when things were watched,
    and a row that only remembers the most recent view has thrown that
    away.

    Everything the analytics service used to invent comes from here:
    reach is the distinct students per content, the engagement series is
    a count per day, watch time is a sum, and a student's resume point
    is the newest row for that pair.

    Rows are small and never updated. This is the one table that grows
    with usage rather than with roster size, so it wants a retention
    policy before it is years old: keep the raw rows for a term, roll
    older ones into daily totals. Nothing depends on that yet.
    """

    __tablename__ = "content_views"
    __table_args__ = (
        Index("ix_content_views_org_content", "org_id", "content_id"),
        Index("ix_content_views_org_student", "org_id", "student_id", "content_id"),
        Index("ix_content_views_org_viewed", "org_id", "viewed_at"),
    )

    view_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    content_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("content.content_id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False
    )
    viewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    seconds_watched: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # How far through, 0 to 100. Documents jump straight to 100.
    progress_pct: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
