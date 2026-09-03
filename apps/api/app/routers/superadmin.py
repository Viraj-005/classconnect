"""Super Admin, LoopLab platform operations.

The only router in the API that reads across tenants. Two constraints
shape it, both from ARCHITECTURE.md section 8:

  1. It returns tenant metadata (counts, tier, billing standing), never
     a tenant's students, content or payments. Reaching into a tenant's
     own data goes through the separate support access route below and
     is audited.
  2. require_platform_access is used rather than require_role, so the
     elevation check stays distinguishable from an ordinary role check.
"""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import hash_password
from app.middleware.tenant import CurrentPrincipal, require_platform_access
from app.models import AuditEntry, Organization, Subscription, User
from app.schemas.common import AuditOut, TenantCreate, TenantOut, TierChange
from app.services import storage_service
from app.services.tier_policy import TIER_ORDER, monthly_revenue

router = APIRouter(
    prefix="/platform",
    tags=["platform"],
    dependencies=[Depends(require_platform_access())],
)


def _tenant_out(org: Organization) -> TenantOut:
    mrr = monthly_revenue(org.package_tier, org.billing_status)
    return TenantOut(
        org_id=org.org_id,
        name=org.name,
        slug=org.slug,
        package_tier=org.package_tier,
        billing_status=org.billing_status,
        students=org.student_count,
        teachers=org.teacher_count,
        has_logo=bool(org.logo_url),
        logo_version=storage_service.version_of(org.logo_url),
        mrr=mrr,
        created_at=org.created_at,
    )


@router.get("/tenants", response_model=list[TenantOut])
async def list_tenants(
    session: Annotated[AsyncSession, Depends(get_session)],
    billing_status: str | None = None,
    package_tier: str | None = None,
) -> list[TenantOut]:
    stmt = (
        select(Organization)
        .where(Organization.is_platform.is_(False))
        .order_by(Organization.created_at.desc())
    )
    if billing_status:
        stmt = stmt.where(Organization.billing_status == billing_status)
    if package_tier:
        stmt = stmt.where(Organization.package_tier == package_tier)
    result = await session.execute(stmt)
    return [_tenant_out(o) for o in result.scalars()]


@router.get("/summary")
async def platform_summary(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """Counts and revenue, aggregated. No tenant content is read."""
    totals = await session.execute(
        select(
            func.count(Organization.org_id),
            func.coalesce(func.sum(Organization.student_count), 0),
            func.coalesce(func.sum(Organization.teacher_count), 0),
        ).where(Organization.is_platform.is_(False))
    )
    tenant_count, students, teachers = totals.one()

    by_tier = await session.execute(
        select(Organization.package_tier, func.count(Organization.org_id))
        .where(
            Organization.billing_status == "active",
            Organization.is_platform.is_(False),
        )
        .group_by(Organization.package_tier)
    )
    tier_counts = dict(by_tier.all())

    # Revenue is grouped by tier AND status, because the two are not the
    # same question. activeByTier above counts healthy tenants for the
    # tier split. This sum has to match what the tenant rows report, so
    # it goes through the same monthly_revenue rule they do.
    by_revenue = await session.execute(
        select(
            Organization.package_tier,
            Organization.billing_status,
            func.count(Organization.org_id),
        )
        .where(Organization.is_platform.is_(False))
        .group_by(Organization.package_tier, Organization.billing_status)
    )
    mrr = sum(monthly_revenue(tier, state) * n for tier, state, n in by_revenue.all())

    at_risk = await session.execute(
        select(func.count(Organization.org_id)).where(
            Organization.billing_status.in_(("past_due", "canceled")),
            Organization.is_platform.is_(False),
        )
    )

    return {
        "tenants": tenant_count,
        "activeByTier": tier_counts,
        "studentsPlatformWide": students,
        "teachersPlatformWide": teachers,
        "mrr": mrr,
        "arr": mrr * 12,
        "atRisk": at_risk.scalar_one(),
    }


@router.post("/tenants", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
async def onboard_tenant(
    body: TenantCreate,
    principal: CurrentPrincipal,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TenantOut:
    """Sales assisted onboarding.

    Creates the organisation, starts a trial subscription and seeds the
    tenant's first Admin. Self service signup is a later phase
    (HANDOVER.md, Future Enhancements).
    """
    clash = await session.execute(
        select(Organization).where(Organization.slug == body.slug)
    )
    if clash.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="That slug is already taken."
        )

    org = Organization(
        name=body.name,
        slug=body.slug,
        package_tier=body.package_tier,
        billing_status="trialing",
        logo_text=body.name.split()[0],
        teacher_count=0,
        student_count=0,
    )
    session.add(org)
    await session.flush()

    session.add(
        Subscription(
            org_id=org.org_id, plan=body.package_tier, status="trialing", is_current=True
        )
    )

    # The first user is that organisation's Admin, who then invites
    # teachers (ARCHITECTURE.md section 7.1). A temporary password is
    # set and must be replaced through the invite flow.
    session.add(
        User(
            org_id=org.org_id,
            role="admin",
            name=body.admin_name,
            email=body.admin_email,
            password_hash=hash_password("change-me-on-first-login"),
        )
    )

    session.add(
        AuditEntry(
            org_id=org.org_id,
            actor_id=principal.user_id,
            actor_label="LoopLab operator",
            action=f"Tenant provisioned on {body.package_tier}",
            target=org.name,
            severity="info",
        )
    )
    await session.flush()
    return _tenant_out(org)


@router.patch("/tenants/{org_id}/tier", response_model=TenantOut)
async def change_tier(
    org_id: str,
    body: TierChange,
    principal: CurrentPrincipal,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TenantOut:
    """Upgrade or downgrade a tenant.

    Feature access re-evaluates on the tenant's next request because
    every gate reads Organization.package_tier live. There is no cache
    to invalidate and no sync step (ARCHITECTURE.md section 7.4).
    """
    org = await session.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    previous = org.package_tier
    if previous == body.package_tier:
        return _tenant_out(org)

    org.package_tier = body.package_tier

    sub = await session.execute(
        select(Subscription).where(
            Subscription.org_id == org.org_id, Subscription.is_current.is_(True)
        )
    )
    current = sub.scalar_one_or_none()
    if current is not None:
        current.plan = body.package_tier

    direction = (
        "upgrade"
        if TIER_ORDER.index(body.package_tier) > TIER_ORDER.index(previous)
        else "downgrade"
    )
    # Written against the tenant's org_id, so it appears in that
    # tenant's own audit log too, not only in the platform log.
    session.add(
        AuditEntry(
            org_id=org.org_id,
            actor_id=principal.user_id,
            actor_label="LoopLab operator",
            action=f"Package {direction}, {previous} to {body.package_tier}",
            target=body.reason or org.name,
            severity="warning" if direction == "downgrade" else "info",
        )
    )
    return _tenant_out(org)


@router.post("/tenants/{org_id}/support-access", status_code=status.HTTP_202_ACCEPTED)
async def request_support_access(
    org_id: str,
    principal: CurrentPrincipal,
    session: Annotated[AsyncSession, Depends(get_session)],
    reason: str,
) -> dict:
    """Open a tenant's own data for support.

    Separated from every other route on this router because it is the
    one action that crosses the tenant boundary. The audit row is
    written before access is granted, not after, so an operation that
    fails midway is still recorded.

    TODO before launch: return a short lived scoped token rather than
    relying on the role, and notify the tenant's admin.
    """
    org = await session.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    session.add(
        AuditEntry(
            org_id=org.org_id,
            actor_id=principal.user_id,
            actor_label="LoopLab operator",
            action="Support access opened to tenant data",
            target=reason,
            severity="critical",
            cross_tenant=True,
        )
    )
    return {
        "granted": True,
        "orgId": org.org_id,
        "expiresAt": datetime.now(timezone.utc).isoformat(),
        "notice": "This access is recorded in the tenant's own audit log.",
    }


@router.get("/audit", response_model=list[AuditOut])
async def platform_audit(
    session: Annotated[AsyncSession, Depends(get_session)],
    cross_tenant_only: bool = False,
    limit: int = 100,
) -> list[AuditEntry]:
    stmt = select(AuditEntry).order_by(AuditEntry.created_at.desc()).limit(limit)
    if cross_tenant_only:
        stmt = stmt.where(AuditEntry.cross_tenant.is_(True))
    result = await session.execute(stmt)
    return list(result.scalars())
