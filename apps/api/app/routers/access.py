"""Page access control.

Two scopes, one screen shape.

    /access/platform      Super Admin. Sets the ceiling for every tenant.
    /access/organisation  Tenant Admin. Narrows within that ceiling.

An Admin can never grant their organisation a page LoopLab has switched
off, and neither can switch off a page marked locked in the registry.
Both rules are enforced in page_access_service, not here, so they hold
for any future caller too.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.middleware.tenant import (
    CurrentOrg,
    CurrentUser,
    require_platform_access,
    require_role,
)
from app.models import AuditEntry, Organization
from app.services.page_access_service import (
    access_matrix,
    reset_scope,
    set_access,
)
from app.services.page_registry import PAGES_BY_KEY, page_catalogue

router = APIRouter(prefix="/access", tags=["access"])

# Roles a tenant Admin may govern. Deliberately excludes admin itself
# and super_admin: an admin editing their own row is how an
# organisation locks itself out, and super_admin is not a tenant role.
TENANT_ROLES = ["teacher", "student", "parent"]
PLATFORM_ROLES = ["admin", "teacher", "student", "parent"]


class AccessChange(BaseModel):
    role: str
    page_key: str
    allowed: bool


class AccessBulkChange(BaseModel):
    changes: list[AccessChange]


@router.get("/catalogue")
async def catalogue() -> list[dict]:
    """The page registry, so the UI renders whatever the server knows."""
    return page_catalogue()


# ----------------------------------------------------------------------
# Tenant scope, for the organisation's own Admin
# ----------------------------------------------------------------------


@router.get("/organisation", dependencies=[Depends(require_role("admin"))])
async def read_org_access(
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    matrix = await access_matrix(session, org, TENANT_ROLES)
    return {
        "scope": "organisation",
        "orgId": org.org_id,
        "orgName": org.name,
        "roles": TENANT_ROLES,
        "matrix": matrix,
        "catalogue": page_catalogue(),
        "packageTier": org.package_tier,
    }


@router.patch("/organisation", dependencies=[Depends(require_role("admin"))])
async def update_org_access(
    body: AccessBulkChange,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    for change in body.changes:
        if change.role not in TENANT_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"An administrator cannot change access for the {change.role} role. "
                    "Contact LoopLab support."
                ),
            )
        await set_access(
            session,
            org_id=org.org_id,
            role=change.role,
            page_key=change.page_key,
            allowed=change.allowed,
            actor_id=user.user_id,
        )

    if body.changes:
        labels = ", ".join(
            f"{PAGES_BY_KEY[c.page_key].label} for {c.role}" for c in body.changes[:3]
        )
        session.add(
            AuditEntry(
                org_id=org.org_id,
                actor_id=user.user_id,
                actor_label=user.name,
                action=f"Changed page access ({len(body.changes)} changes)",
                target=labels,
                severity="warning",
            )
        )

    matrix = await access_matrix(session, org, TENANT_ROLES)
    return {"matrix": matrix}


@router.post("/organisation/reset", dependencies=[Depends(require_role("admin"))])
async def reset_org_access(
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    await reset_scope(session, org.org_id)
    session.add(
        AuditEntry(
            org_id=org.org_id,
            actor_id=user.user_id,
            actor_label=user.name,
            action="Reset page access to defaults",
            target=org.name,
            severity="warning",
        )
    )
    matrix = await access_matrix(session, org, TENANT_ROLES)
    return {"matrix": matrix}


# ----------------------------------------------------------------------
# Platform scope, LoopLab only
# ----------------------------------------------------------------------


@router.get("/platform", dependencies=[Depends(require_platform_access())])
async def read_platform_access(
    session: Annotated[AsyncSession, Depends(get_session)],
    org_id: str | None = None,
) -> dict:
    """Platform defaults, or one tenant's effective access.

    Passing org_id here is safe and is not a tenant isolation hole: this
    route already requires platform access, which is the one role
    permitted to look across tenants.
    """
    target: Organization | None = None
    if org_id:
        target = await session.get(Organization, org_id)
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found"
            )

    roles = PLATFORM_ROLES
    matrix = await access_matrix(session, target, roles)
    return {
        "scope": "tenant" if target else "platform",
        "orgId": target.org_id if target else None,
        "orgName": target.name if target else "All tenants",
        "roles": roles,
        "matrix": matrix,
        "catalogue": page_catalogue(),
        "packageTier": target.package_tier if target else None,
    }


@router.patch("/platform", dependencies=[Depends(require_platform_access())])
async def update_platform_access(
    body: AccessBulkChange,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    org_id: str | None = None,
) -> dict:
    target: Organization | None = None
    if org_id:
        target = await session.get(Organization, org_id)
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found"
            )

    for change in body.changes:
        await set_access(
            session,
            org_id=target.org_id if target else None,
            role=change.role,
            page_key=change.page_key,
            allowed=change.allowed,
            actor_id=user.user_id,
        )

    if body.changes:
        # A platform change is recorded against the tenant when it
        # targets one, so their admin can see it in their own log.
        session.add(
            AuditEntry(
                org_id=target.org_id if target else None,
                actor_id=user.user_id,
                actor_label="LoopLab operator",
                action=f"Changed page access ({len(body.changes)} changes)",
                target=target.name if target else "platform defaults",
                severity="warning",
                cross_tenant=target is not None,
            )
        )

    matrix = await access_matrix(session, target, PLATFORM_ROLES)
    return {"matrix": matrix}


@router.post("/platform/reset", dependencies=[Depends(require_platform_access())])
async def reset_platform_access(
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    org_id: str | None = None,
) -> dict:
    await reset_scope(session, org_id)
    session.add(
        AuditEntry(
            org_id=org_id,
            actor_id=user.user_id,
            actor_label="LoopLab operator",
            action="Reset page access to defaults",
            target=org_id or "platform defaults",
            severity="warning",
            cross_tenant=org_id is not None,
        )
    )
    target = await session.get(Organization, org_id) if org_id else None
    matrix = await access_matrix(session, target, PLATFORM_ROLES)
    return {"matrix": matrix}
