"""Response contracts that a route can break without any test noticing.

PATCH /admin/branding declared `response_model=OrganizationOut` and
returned the `Organization` row. OrganizationOut carries `branding` and
`seats`, which are assembled rather than stored and are not attributes
on that row, so FastAPI could never coerce one into the other.

The failure mode is what makes this worth pinning. The handler ran, the
branding was saved, and the request then died on the way out with a 500
whose message is `<exception str() failed>`. Nothing points at the
response model, and the symptom (saving branding appears to fail) is one
step removed from the cause (rendering the reply fails).

Run with: pytest apps/api/tests -v
"""

from datetime import datetime, timezone
import inspect

from app.models import Organization
from app.schemas.common import OrganizationOut
from app.schemas.presenters import organisation_out


def _org(**over) -> Organization:
    fields = {
        "org_id": "org-test",
        "name": "Test Academy",
        "slug": "test",
        "package_tier": "growth",
        "billing_status": "active",
        "student_count": 12,
        "teacher_count": 3,
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
    }
    fields.update(over)
    return Organization(**fields)


# ----------------------------------------------------------------------
# The renderer produces something the schema accepts
# ----------------------------------------------------------------------


def test_organisation_out_builds_the_assembled_fields():
    out = organisation_out(_org())

    assert out.seats.students == 12
    assert out.seats.teachers == 3
    # Present because the renderer assembles it, not because the row has it.
    assert out.branding.logo_text == "Test Academy"


def test_the_row_alone_cannot_satisfy_the_schema():
    """The mistake this module exists to catch, asserted directly.

    If this ever starts passing, `branding` and `seats` have become real
    attributes and the renderer is no longer load bearing.
    """
    row = _org()
    assert not hasattr(row, "branding")
    assert not hasattr(row, "seats")

    try:
        OrganizationOut.model_validate(row, from_attributes=True)
    except Exception as exc:
        missing = {e["loc"][0] for e in exc.errors()}
        assert {"branding", "seats"} <= missing
    else:
        raise AssertionError(
            "Coercing the ORM row succeeded, so the renderer may be redundant"
        )


def test_a_past_due_org_reports_its_grace_window():
    out = organisation_out(_org(billing_status="past_due", grace_period_ends_at=None))
    assert out.grace_days_left is None


# ----------------------------------------------------------------------
# No route may return the row while promising the rendered shape
# ----------------------------------------------------------------------


def test_no_route_returns_the_orm_row_as_an_organisation_out():
    """Catches the original bug wherever somebody repeats it.

    Checked against the live route table rather than by grep, so a new
    handler is covered the moment it is registered.
    """
    from app.main import app

    offenders = []
    for route in app.routes:
        if getattr(route, "response_model", None) is not OrganizationOut:
            continue
        endpoint = getattr(route, "endpoint", None)
        if endpoint is None:
            continue
        returns = inspect.signature(endpoint).return_annotation
        if returns is Organization:
            offenders.append(f"{route.path} returns the Organization row")

    assert not offenders, (
        "These handlers promise OrganizationOut but hand back the ORM row, "
        "which raises ResponseValidationError at runtime: " + "; ".join(offenders)
    )
