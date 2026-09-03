"""Canonical registry of every page in the product.

Pure data, no framework imports, so the access rules can be tested on
their own. The frontend mirrors the same keys in
apps/web/src/lib/pages.js, and the two must stay in step: a page that
exists in one and not the other is either unreachable or ungoverned.

Resolution order for whether a role may open a page:

    tier gate  AND  platform default  AND  organisation override

  1. tier gate        Organization.package_tier. A Starter tenant cannot
                      reach QR ticketing no matter who grants what.
  2. platform default Set by LoopLab Super Admin. This is the ceiling.
  3. org override     Set by the tenant Admin. Can only restrict further,
                      never grant beyond the platform default.

That ordering is the whole design. A tenant Admin tightening their own
organisation must never be able to widen it past what LoopLab allows.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Page:
    key: str
    portal: str
    label: str
    path: str
    # Roles that hold this page by default.
    roles: tuple[str, ...]
    # Package tier feature this page sits behind, if any.
    feature: str | None = None
    # Locked pages cannot be switched off by anyone. Without this an
    # admin could remove their own access to the access control screen
    # and lock the whole organisation out of its own settings.
    locked: bool = False
    group: str = ""
    tags: tuple[str, ...] = field(default_factory=tuple)


PAGES: tuple[Page, ...] = (
    # ---------------- Teacher ----------------
    Page("teacher.overview", "teacher", "Overview", "/teacher", ("teacher",), locked=True),
    Page("teacher.content", "teacher", "Content library", "/teacher/content", ("teacher",)),
    Page("teacher.students", "teacher", "Students", "/teacher/students", ("teacher",)),
    Page("teacher.fees", "teacher", "Fees", "/teacher/fees", ("teacher",), group="Money"),
    Page(
        "teacher.tickets",
        "teacher",
        "Class tickets",
        "/teacher/tickets",
        ("teacher",),
        feature="qr_ticketing",
        group="Money",
    ),
    Page("teacher.attendance", "teacher", "Attendance", "/teacher/attendance", ("teacher",), group="Insight"),
    Page("teacher.marking", "teacher", "Marking", "/teacher/marking", ("teacher",), group="Insight"),
    Page("teacher.schedule", "teacher", "Schedule", "/teacher/schedule", ("teacher",), group="Insight"),
    Page(
        "teacher.analytics",
        "teacher",
        "Analytics",
        "/teacher/analytics",
        ("teacher",),
        feature="analytics_full",
        group="Insight",
    ),
    # ---------------- Student ----------------
    Page("student.overview", "student", "My learning", "/student", ("student",), locked=True),
    Page("student.library", "student", "Resources", "/student/library", ("student",)),
    Page("student.quizzes", "student", "Quizzes", "/student/quizzes", ("student",)),
    Page("student.payments", "student", "Fees", "/student/payments", ("student",), group="Access"),
    Page(
        "student.ticket",
        "student",
        "Class ticket",
        "/student/ticket",
        ("student",),
        feature="qr_ticketing",
        group="Access",
    ),
    Page("student.calendar", "student", "Calendar", "/student/calendar", ("student",)),
    # ---------------- Parent ----------------
    Page("parent.overview", "parent", "Progress", "/parent", ("parent",), locked=True),
    Page("parent.attendance", "parent", "Attendance", "/parent/attendance", ("parent",)),
    Page("parent.payments", "parent", "Fees", "/parent/payments", ("parent",)),
    # ---------------- Admin ----------------
    Page("admin.overview", "admin", "Overview", "/admin", ("admin",), locked=True),
    Page("admin.users", "admin", "People", "/admin/users", ("admin",)),
    Page("admin.batches", "admin", "Batches", "/admin/batches", ("admin",)),
    Page(
        "admin.branding",
        "admin",
        "Branding",
        "/admin/branding",
        ("admin",),
        feature="branding_logo",
        group="Organisation",
    ),
    Page("admin.billing", "admin", "Plan and billing", "/admin/billing", ("admin",), group="Organisation"),
    Page("admin.logs", "admin", "Audit log", "/admin/logs", ("admin",), group="Organisation"),
    # Locked: this is the screen that governs the others.
    Page(
        "admin.access",
        "admin",
        "Access control",
        "/admin/access",
        ("admin",),
        locked=True,
        group="Organisation",
    ),
    # ---------------- Super Admin ----------------
    Page("superadmin.health", "superadmin", "Platform health", "/platform", ("super_admin",), locked=True),
    Page("superadmin.tenants", "superadmin", "Tenants", "/platform/tenants", ("super_admin",)),
    Page("superadmin.branding", "superadmin", "Branding", "/platform/branding", ("super_admin",)),
    Page("superadmin.billing", "superadmin", "Subscriptions", "/platform/billing", ("super_admin",), group="Revenue"),
    Page("superadmin.audit", "superadmin", "Access log", "/platform/audit", ("super_admin",), group="Revenue"),
    Page(
        "superadmin.access",
        "superadmin",
        "Access control",
        "/platform/access",
        ("super_admin",),
        locked=True,
        group="Revenue",
    ),
)

PAGES_BY_KEY: dict[str, Page] = {p.key: p for p in PAGES}


def pages_for_role(role: str) -> tuple[Page, ...]:
    return tuple(p for p in PAGES if role in p.roles)


def pages_for_portal(portal: str) -> tuple[Page, ...]:
    return tuple(p for p in PAGES if p.portal == portal)


def is_known(page_key: str) -> bool:
    return page_key in PAGES_BY_KEY


def resolve_access(
    *,
    role: str,
    tier_features: set[str],
    platform_overrides: dict[str, bool],
    org_overrides: dict[str, bool],
) -> dict[str, bool]:
    """Effective page access for one role in one organisation.

    Returns every page key the role could ever hold, mapped to whether
    it is currently reachable. Keys the role does not own at all are
    omitted, since they are not that role's business.
    """
    out: dict[str, bool] = {}
    for page in PAGES:
        if role not in page.roles:
            continue

        # A locked page is always reachable for its own roles. It is the
        # escape hatch that stops an organisation locking itself out.
        if page.locked:
            out[page.key] = True
            continue

        # 1. Tier gate. Nothing below can widen this.
        if page.feature and page.feature not in tier_features:
            out[page.key] = False
            continue

        # 2. Platform default, the ceiling.
        allowed = platform_overrides.get(page.key, True)

        # 3. Organisation override, may only narrow.
        if allowed:
            allowed = org_overrides.get(page.key, True)

        out[page.key] = allowed
    return out


def page_catalogue() -> list[dict]:
    """Registry as plain dicts, for the access control screens."""
    return [
        {
            "key": p.key,
            "portal": p.portal,
            "label": p.label,
            "path": p.path,
            "roles": list(p.roles),
            "feature": p.feature,
            "locked": p.locked,
            "group": p.group,
        }
        for p in PAGES
    ]
