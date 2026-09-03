"""Tenant Admin. Scoped to the caller's own organisation."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.middleware.tenant import CurrentOrg, CurrentUser, require_role
from app.models import AuditEntry
from app.schemas.common import AuditOut, BrandingUpdate, OrganizationOut
from app.schemas.presenters import organisation_out
from app.services.feature_gate_service import (
    has_feature,
    strip_branding_for_tier,
)

router = APIRouter(
    prefix="/admin", tags=["admin"], dependencies=[Depends(require_role("admin"))]
)


@router.patch("/branding", response_model=OrganizationOut)
async def update_branding(
    body: BrandingUpdate,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OrganizationOut:
    """Update branding, within the tier's allowance.

    Each field is gated separately rather than the endpoint as a whole,
    because logo, palette and domain unlock at different tiers. A field
    the tenant is not entitled to is rejected outright rather than
    silently dropped, so the UI cannot show a saved state for something
    that was ignored.
    """
    if body.logo_text is not None:
        org.logo_text = body.logo_text

    if body.primary_color is not None:
        if not has_feature(org.package_tier, "branding_logo"):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={"error": "feature_not_in_plan", "feature": "branding_logo"},
            )
        org.primary_color = _normalise_hex(body.primary_color)

    if body.secondary_color is not None:
        if not has_feature(org.package_tier, "branding_palette"):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={"error": "feature_not_in_plan", "feature": "branding_palette"},
            )
        org.secondary_color = _normalise_hex(body.secondary_color)

    if body.custom_domain is not None:
        if not has_feature(org.package_tier, "custom_domain"):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={"error": "feature_not_in_plan", "feature": "custom_domain"},
            )
        org.custom_domain = body.custom_domain or None

    session.add(
        AuditEntry(
            org_id=org.org_id,
            actor_id=user.user_id,
            actor_label=user.name,
            action="Updated organisation branding",
            target=org.name,
            severity="info",
        )
    )
    # Rendered rather than returned raw. OrganizationOut carries
    # branding and seats, which are assembled and are not attributes on
    # the row, so response_model coercion of the ORM object fails.
    return organisation_out(org)


def _normalise_hex(value: str) -> str:
    v = value.strip()
    return v if v.startswith("#") else f"#{v}"


@router.get("/audit", response_model=list[AuditOut])
async def tenant_audit(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: int = 100,
) -> list[AuditEntry]:
    """This organisation's audit log.

    Filtered on the session's org_id, so an admin cannot read another
    tenant's events. Cross tenant rows written by LoopLab support carry
    this org_id deliberately, so the tenant can see when their data was
    accessed.
    """
    result = await session.execute(
        select(AuditEntry)
        .where(AuditEntry.org_id == org.org_id)
        .order_by(AuditEntry.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars())


@router.get("/overview")
async def overview(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Operational, not academic.

    Seats, people, billing and anything odd in the log. Teaching metrics
    belong to the teacher portal and are deliberately not repeated here,
    which is what keeps the two roles distinguishable.
    """
    from sqlalchemy import func

    from app.models import User
    from app.services.analytics_service import payment_totals
    from app.services.feature_gate_service import seat_usage
    from app.services.tier_policy import TIER_PRICE

    by_role = await session.execute(
        select(User.role, func.count(User.user_id))
        .where(User.org_id == org.org_id, User.is_active.is_(True))
        .group_by(User.role)
    )
    roles = dict(by_role.all())

    flagged = await session.execute(
        select(func.count(AuditEntry.id)).where(
            AuditEntry.org_id == org.org_id, AuditEntry.severity != "info"
        )
    )

    students = seat_usage(org, "students")
    teachers = seat_usage(org, "teachers")
    payments = await payment_totals(session, org.org_id)

    return {
        "org": {
            "name": org.name,
            "slug": org.slug,
            "packageTier": org.package_tier,
            "billingStatus": org.billing_status,
            "customDomain": org.custom_domain,
            "createdAt": org.created_at,
        },
        "seats": {
            "students": {
                "used": org.student_count,
                "cap": None if students.unlimited else students.cap,
                "pct": students.pct,
                "nearingCap": students.nearing_cap,
                "atCap": students.at_cap,
            },
            "teachers": {
                "used": org.teacher_count,
                "cap": None if teachers.unlimited else teachers.cap,
                "pct": teachers.pct,
                "nearingCap": teachers.nearing_cap,
                "atCap": teachers.at_cap,
            },
        },
        "people": {"byRole": roles, "total": sum(roles.values())},
        "flaggedEvents": flagged.scalar_one(),
        "planCost": TIER_PRICE.get(org.package_tier, 0),
        "payments": payments,
    }


@router.get("/people")
async def people(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
    role: str | None = None,
    q: str | None = None,
) -> list[dict]:
    from app.models import Teacher, User

    stmt = select(User).where(User.org_id == org.org_id).order_by(User.name)
    if role:
        stmt = stmt.where(User.role == role)
    if q:
        stmt = stmt.where(User.name.ilike(f"%{q}%") | User.email.ilike(f"%{q}%"))

    users = list((await session.execute(stmt)).scalars())

    subjects_result = await session.execute(
        select(Teacher.teacher_id, Teacher.subjects_taught).where(
            Teacher.org_id == org.org_id
        )
    )
    subjects = dict(subjects_result.all())

    return [
        {
            "id": u.user_id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "status": "active" if u.is_active else "disabled",
            "lastSeen": u.last_seen_at,
            "subjects": subjects.get(u.user_id) or "",
        }
        for u in users
    ]


@router.patch("/people/{user_id}/role")
async def change_role(
    user_id: str,
    body: dict,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Change a user's role within this organisation.

    The org filter in the WHERE clause is what stops a guessed user_id
    from another tenant being editable.
    """
    from app.models import ROLES, User as UserModel

    new_role = body.get("role")
    if new_role not in ROLES or new_role == "super_admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Not a valid tenant role."
        )

    result = await session.execute(
        select(UserModel).where(
            UserModel.user_id == user_id, UserModel.org_id == org.org_id
        )
    )
    target = result.scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Removing the last admin would leave the organisation unable to
    # manage itself, so it is refused rather than warned about.
    if target.role == "admin" and new_role != "admin":
        from sqlalchemy import func

        remaining = await session.execute(
            select(func.count(UserModel.user_id)).where(
                UserModel.org_id == org.org_id,
                UserModel.role == "admin",
                UserModel.is_active.is_(True),
                UserModel.user_id != user_id,
            )
        )
        if remaining.scalar_one() == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This is the only administrator. Promote someone else first.",
            )

    previous = target.role
    target.role = new_role
    session.add(
        AuditEntry(
            org_id=org.org_id,
            actor_id=user.user_id,
            actor_label=user.name,
            action=f"Changed user role, {previous} to {new_role}",
            target=target.email,
            severity="critical",
        )
    )
    return {"id": target.user_id, "role": target.role}


@router.get("/branding", response_model=dict)
async def read_branding(org: CurrentOrg) -> dict:
    """Effective branding, after the tier filter.

    A downgraded tenant still has its colours stored so an upgrade
    restores them, but this returns what is actually applied.
    """
    return strip_branding_for_tier(org)
