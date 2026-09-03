"""ORM models.

Small deviation from ARCHITECTURE.md section 5, noted deliberately.
That layout lists one module per entity. Here the models are grouped by
tenancy scope instead:

    organization.py   platform level, NOT tenant scoped
    tenant_models.py  everything carrying org_id

The grouping is the point. The single most important property of this
schema is which tables are tenant scoped and which are not, and a
reviewer can now answer that by looking at which file a model lives in
rather than by checking each class for the mixin. Import from this
package rather than from the modules directly.
"""

from app.models.organization import (
    BILLING_STATUSES,
    PACKAGE_TIERS,
    Organization,
    Subscription,
)
from app.models.tenant_models import (
    ATTENDANCE_STATUSES,
    QUESTION_KINDS,
    CONTENT_TYPES,
    EVENT_TYPES,
    PAYMENT_STATUSES,
    ROLES,
    AttendanceRecord,
    Batch,
    AuditEntry,
    ClassTicket,
    Content,
    ContentView,
    Event,
    PageAccess,
    QuizAttempt,
    QuizQuestion,
    Student,
    StudentPayment,
    Teacher,
    User,
)

__all__ = [
    "Batch",
    "QUESTION_KINDS",
    "QuizQuestion",
    "QuizAttempt",
    "ContentView",
    "AttendanceRecord",
    "ATTENDANCE_STATUSES",
    "BILLING_STATUSES",
    "CONTENT_TYPES",
    "EVENT_TYPES",
    "PACKAGE_TIERS",
    "PAYMENT_STATUSES",
    "ROLES",
    "AuditEntry",
    "ClassTicket",
    "Content",
    "Event",
    "Organization",
    "PageAccess",
    "Student",
    "StudentPayment",
    "Subscription",
    "Teacher",
    "User",
]
