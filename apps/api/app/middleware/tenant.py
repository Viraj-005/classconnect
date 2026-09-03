"""Tenant isolation and role guards.

This module is the security boundary of the product. Everything else in
the API is written on the assumption that these dependencies are the
only way a request obtains an org_id.

The rules, from ARCHITECTURE.md sections 3.1 and 8:

  1. org_id is resolved from the authenticated session, never from a
     request body, query string or path parameter. There is deliberately
     no code path here that reads org_id from client input.
  2. Every tenant scoped query filters on the resolved org_id.
  3. Postgres row level security is added later as a second layer. It
     does not replace this one, it catches bugs in it.
  4. Super Admin crossing into a tenant is a distinct, logged action and
     needs require_platform_access, not merely the super_admin role.
"""

from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import decode_token
from app.models import Organization, User

bearer = HTTPBearer(auto_error=False)

CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


@dataclass(frozen=True)
class Principal:
    """The authenticated caller.

    Frozen on purpose. A request handler must not be able to mutate the
    org_id it was given partway through a transaction.
    """

    user_id: str
    org_id: str
    role: str

    @property
    def is_super_admin(self) -> bool:
        return self.role == "super_admin"


async def get_principal(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> Principal:
    if creds is None:
        raise CREDENTIALS_ERROR
    try:
        payload = decode_token(creds.credentials)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired"
        ) from exc
    except jwt.PyJWTError as exc:
        raise CREDENTIALS_ERROR from exc

    user_id = payload.get("sub")
    org_id = payload.get("org_id")
    role = payload.get("role")
    if not user_id or not org_id or not role:
        raise CREDENTIALS_ERROR

    return Principal(user_id=user_id, org_id=org_id, role=role)


async def get_current_user(
    principal: Annotated[Principal, Depends(get_principal)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """Load the user, re-checking that they still belong to the org.

    A token stays valid until it expires, so a user removed from an
    organisation would otherwise keep access for the remainder of the
    token lifetime. This check closes that window.
    """
    result = await session.execute(
        select(User).where(
            User.user_id == principal.user_id,
            User.org_id == principal.org_id,
            User.is_active.is_(True),
        )
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise CREDENTIALS_ERROR
    return user


async def get_current_org(
    principal: Annotated[Principal, Depends(get_principal)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Organization:
    """Resolve the caller's organisation.

    This is THE tenant resolution point. Inject this dependency and use
    org.org_id in queries. Never accept an org_id parameter from the
    client for filtering.
    """
    org = await session.get(Organization, principal.org_id)
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Organisation not found"
        )
    if org.billing_status == "canceled":
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="This organisation's subscription has been cancelled.",
        )
    return org


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentOrg = Annotated[Organization, Depends(get_current_org)]
CurrentPrincipal = Annotated[Principal, Depends(get_principal)]


def require_role(*roles: str):
    """Router level role guard.

    Roles are checked here rather than inside handlers so that a new
    endpoint on an already guarded router cannot forget the check.
    """

    async def guard(principal: Annotated[Principal, Depends(get_principal)]) -> Principal:
        if principal.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {', '.join(roles)}",
            )
        return principal

    return guard


def require_platform_access():
    """Guard for cross tenant Super Admin actions.

    Deliberately separate from require_role("super_admin"). Holding the
    role is not on its own sufficient to read a tenant's data, per
    ARCHITECTURE.md section 8. Reaching into a tenant is an explicit,
    separately audited action.

    TODO before launch: require a short lived elevation grant (a support
    ticket reference plus a re-auth) rather than the role alone, and
    write an AuditEntry from here on every call.
    """

    async def guard(principal: Annotated[Principal, Depends(get_principal)]) -> Principal:
        if not principal.is_super_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Platform access required",
            )
        return principal

    return guard
