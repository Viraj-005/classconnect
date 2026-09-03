"""Turning ORM rows into the shapes the client is promised.

One organisation renderer, in one place, because there were two and only
one of them was right.

`OrganizationOut` carries `branding` and `seats`, which are assembled
rather than stored: branding is filtered through the tier gate, and
seats are two counters read off the row. Neither exists as an attribute
on `Organization`, so handing the ORM object straight to FastAPI and
letting `response_model` coerce it cannot work. It raises
ResponseValidationError, and FastAPI reports that as a 500 whose message
is `<exception str() failed>`, which says nothing about the cause.

That is what `PATCH /admin/branding` did. It declared the response model
and returned the row, so saving branding always failed even though the
save itself had already succeeded, which is the confusing part: the
change landed and the response blew up on the way out.
"""

from app.core.timeutil import days_until
from app.models import Organization
from app.schemas.common import OrganizationOut
from app.services.feature_gate_service import strip_branding_for_tier


def organisation_out(org: Organization) -> OrganizationOut:
    grace = None
    if org.billing_status == "past_due":
        # days_until normalises the stored value first. Subtracting a
        # raw column from an aware now() raises on SQLite, which took
        # the whole past due tenant offline.
        grace = days_until(org.grace_period_ends_at)
    return OrganizationOut(
        org_id=org.org_id,
        name=org.name,
        slug=org.slug,
        package_tier=org.package_tier,
        billing_status=org.billing_status,
        branding=strip_branding_for_tier(org),
        seats={"students": org.student_count, "teachers": org.teacher_count},
        grace_days_left=grace,
        created_at=org.created_at,
    )
