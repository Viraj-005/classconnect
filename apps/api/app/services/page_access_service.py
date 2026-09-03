"""Reading and writing page access overrides."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.middleware.tenant import Principal, get_principal
from app.models import Organization, PageAccess
from app.services.page_registry import (
    PAGES_BY_KEY,
    is_known,
    resolve_access,
)
from app.services.tier_policy import FEATURE_MATRIX, has_feature


async def _overrides(session: AsyncSession, org_id: str | None, role: str | None = None):
    """Overrides for a scope. org_id None means the platform defaults."""
    stmt = select(PageAccess).where(
        PageAccess.org_id.is_(None) if org_id is None else PageAccess.org_id == org_id
    )
    if role is not None:
        stmt = stmt.where(PageAccess.role == role)
    result = await session.execute(stmt)
    return {row.page_key: row.allowed for row in result.scalars()}


def tier_features(org: Organization) -> set[str]:
    return {f for f in FEATURE_MATRIX if has_feature(org.package_tier, f)}


async def access_for_user(
    session: AsyncSession, org: Organization, role: str
) -> dict[str, bool]:
    """Effective page access map for one user's role.

    This is what the session endpoint returns and what the frontend uses
    to build the nav. It is also re-checked server side on every guarded
    route, because a client can simply not ask.
    """
    platform = await _overrides(session, None, role)
    org_level = await _overrides(session, org.org_id, role)
    return resolve_access(
        role=role,
        tier_features=tier_features(org),
        platform_overrides=platform,
        org_overrides=org_level,
    )


async def access_matrix(
    session: AsyncSession, org: Organization | None, roles: list[str]
) -> dict[str, dict[str, bool]]:
    """Role to page map, for the access control screens.

    org None builds the platform view (Super Admin editing the ceiling),
    otherwise the tenant view.
    """
    out: dict[str, dict[str, bool]] = {}
    for role in roles:
        platform = await _overrides(session, None, role)
        if org is None:
            # Platform view: show the ceiling itself, with no tenant
            # tier applied, since it spans tenants on different tiers.
            out[role] = resolve_access(
                role=role,
                tier_features=set(FEATURE_MATRIX),
                platform_overrides=platform,
                org_overrides={},
            )
        else:
            org_level = await _overrides(session, org.org_id, role)
            out[role] = resolve_access(
                role=role,
                tier_features=tier_features(org),
                platform_overrides=platform,
                org_overrides=org_level,
            )
    return out


async def set_access(
    session: AsyncSession,
    *,
    org_id: str | None,
    role: str,
    page_key: str,
    allowed: bool,
    actor_id: str | None,
) -> None:
    """Upsert one override.

    A locked page is refused outright rather than silently ignored, so
    the UI cannot show a saved state for a change that did not happen.
    """
    if not is_known(page_key):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown page: {page_key}"
        )

    page = PAGES_BY_KEY[page_key]
    if page.locked:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{page.label} cannot be switched off. It is the screen that governs "
                "the others, and disabling it would lock the organisation out."
            ),
        )
    if role not in page.roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{page.label} does not belong to the {role} role.",
        )

    existing = await session.execute(
        select(PageAccess).where(
            PageAccess.org_id.is_(None) if org_id is None else PageAccess.org_id == org_id,
            PageAccess.role == role,
            PageAccess.page_key == page_key,
        )
    )
    row = existing.scalar_one_or_none()

    if row is None:
        session.add(
            PageAccess(
                org_id=org_id,
                role=role,
                page_key=page_key,
                allowed=allowed,
                updated_by=actor_id,
            )
        )
    else:
        row.allowed = allowed
        row.updated_by = actor_id


async def reset_scope(session: AsyncSession, org_id: str | None) -> None:
    """Clear every override in a scope, returning it to the defaults."""
    await session.execute(
        delete(PageAccess).where(
            PageAccess.org_id.is_(None) if org_id is None else PageAccess.org_id == org_id
        )
    )


def require_page(page_key: str):
    """Guard a route on page access.

    The client hides a blocked page from the nav, but hiding is not
    enforcement. Any route backing a governed page carries this, so
    typing the URL directly fails the same way.
    """
    if not is_known(page_key):
        raise KeyError(f"Unknown page key: {page_key}")

    async def guard(
        principal: Annotated[Principal, Depends(get_principal)],
        session: Annotated[AsyncSession, Depends(get_session)],
    ) -> None:
        org = await session.get(Organization, principal.org_id)
        if org is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Organisation not found"
            )
        access = await access_for_user(session, org, principal.role)
        if not access.get(page_key, False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "error": "page_not_permitted",
                    "page": page_key,
                    "hint": "An administrator has turned this page off for your role.",
                },
            )

    return guard
