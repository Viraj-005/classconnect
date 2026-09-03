"""Authentication, onboarding, and session bootstrap."""

import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.rate_limit import FailureWindow, client_key
from app.core.security import (
    CHALLENGE,
    REFRESH,
    create_access_token,
    create_challenge_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.core import totp as totp_lib
from app.middleware.tenant import CurrentOrg, CurrentUser
from app.models import AuditEntry, Organization, User
from app.schemas.common import (
    LoginRequest,
    LoginResult,
    PasswordChange,
    ProfileUpdate,
    RecoveryCodesOut,
    SessionOut,
    SessionUserOut,
    SignupRequest,
    SignupResult,
    TokenPair,
    TwoFactorDisable,
    TwoFactorEnable,
    TwoFactorSetupOut,
    TwoFactorVerify,
)
from app.schemas.presenters import organisation_out as _org_out
from app.services.onboarding_service import candidate_slugs
from app.services.tier_policy import FREE_TIER
from app.services.feature_gate_service import (
    FEATURE_MATRIX,
    has_feature,
)
from app.services.host_resolver import UNBOUND, Resolution, normalise_host, resolve_host
from app.services.page_access_service import access_for_user
from app.services import storage_service

router = APIRouter(prefix="/auth", tags=["auth"])

# A real hash, computed once at import. The login path verifies against
# this when no user matched, so a missing account costs the same time as
# a wrong password and the response cannot be used to enumerate which
# emails exist at which tenant. A malformed placeholder would return
# immediately and defeat the point.
_DUMMY_HASH = hash_password("timing-equalisation-only")

# Rate limits for the two unauthenticated endpoints. A floor rather than
# the control: see the module docstring in app/core/rate_limit.py.
_login_by_account = FailureWindow(
    settings.LOGIN_FAILURES_PER_ACCOUNT, settings.LOGIN_WINDOW_SECONDS
)
_login_by_address = FailureWindow(
    settings.LOGIN_FAILURES_PER_ADDRESS, settings.LOGIN_WINDOW_SECONDS
)
_signup_by_address = FailureWindow(
    settings.SIGNUP_PER_ADDRESS, settings.SIGNUP_WINDOW_SECONDS
)


def _too_many(retry_after: int) -> HTTPException:
    """One shape for every throttled response.

    The same generic wording as a failed sign in, because saying "too
    many attempts for this account" confirms the account exists. The
    Retry-After header is the honest part: a real user needs to know how
    long, and it tells an attacker nothing they could not measure.
    """
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many attempts. Try again shortly.",
        headers={"Retry-After": str(retry_after)},
    )





async def _resolve_tenant(
    request: Request, session: AsyncSession
) -> tuple[Resolution, Organization | None]:
    """Which organisation this hostname belongs to, if any.

    The custom domain lookup is a query rather than a scan, and it runs
    only when a domain is configured at all, so the ordinary subdomain
    case costs nothing.
    """
    host = normalise_host(request.headers.get("host"))
    custom = {}
    if host:
        row = await session.execute(
            select(Organization.custom_domain, Organization.slug).where(
                Organization.custom_domain.isnot(None),
                func.lower(Organization.custom_domain) == host,
            )
        )
        custom = {d.lower(): s for d, s in row.all() if d}

    resolution = resolve_host(
        host,
        app_domain=settings.APP_DOMAIN,
        platform_host=settings.PLATFORM_HOST,
        custom_domains=custom,
    )
    if not resolution.bound:
        return resolution, None

    if resolution.kind == "platform":
        stmt = select(Organization).where(Organization.is_platform.is_(True))
    else:
        stmt = select(Organization).where(
            Organization.slug == resolution.slug,
            Organization.is_platform.is_(False),
        )
    org = (await session.execute(stmt)).scalar_one_or_none()
    # A hostname that resolves to nothing real is unbound, not an error.
    # Wildcard DNS answers for every name, so a typo reaches the app and
    # should land on a login page rather than a stack trace.
    return (resolution, org) if org else (UNBOUND, None)


@router.get("/tenant")
async def tenant_for_host(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """The organisation this hostname belongs to, for the login screen.

    A tenant reaches ClassConnect at its own address, so the sign in page
    shows that one school, branded, with no picker. A parent at Horizon
    should not have to find their school in a list of strangers, and
    publishing that list hands anyone who loads the page a full customer
    roster.

    Unbound on a development host, where the caller falls back to the
    picker and the demo shortcuts.

    The hostname decides which form to paint and nothing else. It never
    sets the organisation for an authenticated request: that still comes
    from the session. See the note in services/host_resolver.py, since
    the Host header is written by the client.
    """
    resolution, org = await _resolve_tenant(request, session)
    if org is None:
        return {"bound": False, "isPlatform": False, "organisation": None}
    return {
        "bound": True,
        "isPlatform": bool(org.is_platform),
        "organisation": {
            "slug": org.slug,
            "name": org.logo_text or org.name,
            "primaryColor": org.primary_color,
            "hasLogo": bool(org.logo_url),
            "logoVersion": storage_service.version_of(org.logo_url),
        },
    }


@router.get("/organisations")
async def public_organisations(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[dict]:
    """Organisations offered on the sign in screen.

    Unauthenticated on purpose: the picker has to render before anyone
    has credentials. Only the name, slug and accent colour are exposed,
    which are the things a tenant already publishes on its own login
    page. No counts, no tier, no billing standing, nothing that would
    let one school profile another.

    The platform organisation is left out outside development. LoopLab's
    console is reached through the same code path as any tenant, which
    is correct and stays that way, but listing it on every tenant's login
    screen advertises the operator's door to everyone who can load the
    page. require_platform_access already guards what the console can
    actually read, so this is depth rather than the control itself.

    It stays visible in development because the demo sign in shortcuts
    are built from this list, and a console nobody can reach locally is
    its own kind of broken.

    When the hostname names an organisation, this returns that one and
    only that one. The full list is what a tenant enumeration attack
    wants, so it survives only where no hostname binds, which in practice
    means a development machine. Closing it here as well as in /tenant
    matters: a caller who skips the newer endpoint must not be handed the
    roster as a consolation prize.
    """
    resolution, bound = await _resolve_tenant(request, session)
    if bound is not None:
        return [
            {
                "slug": bound.slug,
                "name": f"{bound.name} (platform)" if bound.is_platform else bound.name,
                "primaryColor": bound.primary_color,
            }
        ]

    # Outside development the full list is never returned, bound or not.
    # Every real entry point in production carries a hostname that
    # resolves, so an unbound request is a typo, a bare IP, or somebody
    # probing. None of those deserve the roster as a fallback, and
    # answering with it would undo the whole point of resolving by host.
    if settings.ENV != "development":
        return []

    stmt = select(Organization).order_by(Organization.is_platform, Organization.name)
    result = await session.execute(stmt)
    return [
        {
            "slug": o.slug,
            "name": f"{o.name} (platform)" if o.is_platform else o.name,
            "primaryColor": o.primary_color,
        }
        for o in result.scalars()
    ]


@router.post("/login", response_model=LoginResult)
async def login(
    body: LoginRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> LoginResult:
    """Sign in to a specific organisation.

    The org is selected by slug because one email may hold accounts at
    several tenants. The lookup is (org, email), so a valid password for
    tenant A never authenticates against tenant B.

    Returns one of two shapes: a session, or a demand for a second
    factor. Which one is only decided after the password has been
    verified. Answering "does this account use 2FA" before that would
    tell an attacker which accounts are worth their time.
    """
    # Checked before any database work, so a throttled caller costs a
    # dictionary lookup rather than two queries and a bcrypt verify.
    address = client_key(request)
    account = f"{address}|{body.org_slug}|{body.email.lower()}"
    for window, key in ((_login_by_account, account), (_login_by_address, address)):
        decision = window.check(key)
        if not decision:
            raise _too_many(decision.retry_after)

    org_result = await session.execute(
        select(Organization).where(Organization.slug == body.org_slug)
    )
    org = org_result.scalar_one_or_none()

    user = None
    if org is not None:
        user_result = await session.execute(
            select(User).where(
                User.org_id == org.org_id,
                User.email == body.email,
                User.is_active.is_(True),
            )
        )
        user = user_result.scalar_one_or_none()

    # One generic failure for every path, and the password is verified
    # even when the user was not found, so response timing does not
    # reveal whether an address exists at a given tenant.
    password_ok = verify_password(
        body.password, user.password_hash if user else _DUMMY_HASH
    )

    if user is None or not password_ok:
        # Only failures are counted. Counting every attempt would lock a
        # school out of its own morning, since the whole building shares
        # one address.
        _login_by_account.record(account)
        _login_by_address.record(address)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email or password is incorrect.",
        )

    # The password was right, so this address is not guessing at this
    # account. The address wide counter is deliberately left alone: one
    # correct login should not wipe the evidence of a spray across other
    # accounts from the same place.
    _login_by_account.clear(account)

    if user.has_two_factor:
        # No session yet, and last_seen_at is deliberately not touched:
        # the password alone is not a sign in.
        return LoginResult(
            two_factor_required=True,
            challenge_token=create_challenge_token(user.user_id, user.org_id),
        )

    user.last_seen_at = datetime.now(timezone.utc)

    return LoginResult(
        access_token=create_access_token(user.user_id, user.org_id, user.role),
        refresh_token=create_refresh_token(user.user_id, user.org_id, user.role),
        expires_in=settings.ACCESS_TOKEN_MINUTES * 60,
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    refresh_token: str,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TokenPair:
    import jwt

    try:
        payload = decode_token(refresh_token, expected_type=REFRESH)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        ) from exc

    # Re-read the user rather than trusting the claims, so a disabled
    # account cannot refresh its way to a fresh access token.
    result = await session.execute(
        select(User).where(
            User.user_id == payload["sub"],
            User.org_id == payload["org_id"],
            User.is_active.is_(True),
        )
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is no longer active"
        )

    return TokenPair(
        access_token=create_access_token(user.user_id, user.org_id, user.role),
        refresh_token=create_refresh_token(user.user_id, user.org_id, user.role),
        expires_in=settings.ACCESS_TOKEN_MINUTES * 60,
    )


@router.get("/session", response_model=SessionOut)
async def current_session(
    user: CurrentUser,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SessionOut:
    """Everything the frontend needs on load.

    Entitlements and page access are both resolved server side and sent
    flat. The client never derives them from the tier or the role, so
    changing either takes effect without a frontend release, and a
    client that skips the check still fails at the route guard.
    """
    features = [f for f in FEATURE_MATRIX if has_feature(org.package_tier, f)]
    page_access = await access_for_user(session, org, user.role)
    return SessionOut(
        user=SessionUserOut(
            user_id=user.user_id,
            org_id=user.org_id,
            role=user.role,
            name=user.name,
            email=user.email,
            two_factor_enabled=user.has_two_factor,
        ),
        org=_org_out(org),
        features=features,
        page_access=page_access,
    )


@router.patch("/me", response_model=SessionUserOut)
async def update_profile(
    body: ProfileUpdate,
    user: CurrentUser,
) -> SessionUserOut:
    """Update your own account.

    Scoped to the caller. There is deliberately no user_id parameter,
    so this route cannot be pointed at somebody else's record. Changing
    another person's details is an Admin action and lives on the admin
    router with its own role guard.
    """
    user.name = body.name.strip()
    return SessionUserOut(
        user_id=user.user_id,
        org_id=user.org_id,
        role=user.role,
        name=user.name,
        email=user.email,
        two_factor_enabled=user.has_two_factor,
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: PasswordChange,
    user: CurrentUser,
) -> None:
    """Change your own password.

    The current password is required and verified even though the caller
    already holds a valid token. A token can be a forgotten session on a
    shared classroom machine, and re-entering the password is what stops
    a passer by from locking the real owner out.
    """
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That is not your current password.",
        )
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The new password is the same as the current one.",
        )
    user.password_hash = hash_password(body.new_password)


# ----------------------------------------------------------------------
# Self serve onboarding
# ----------------------------------------------------------------------


@router.post("/signup", response_model=SignupResult, status_code=status.HTTP_201_CREATED)
async def signup(
    body: SignupRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SignupResult:
    """Create a tenant on the free plan and sign its first admin in.

    Unauthenticated by design: this is how a school becomes a customer.
    Three things are forced server side and are absent from the request
    schema, because a client able to set them could provision itself
    onto a paid tier, impersonate the platform, or join a tenant that is
    not its own:

      package_tier   always free
      is_platform    always False
      org_id         minted here, never accepted

    Rate limited per address, because this is the only unauthenticated
    write in the product and without a limit a script can fill the
    organisations table and the public login picker. Unlike login, every
    attempt counts, not only failures: a successful signup is exactly
    the thing being flooded.

    Still put a per IP limit in front of the app before launch. The one
    here lives in a single process's memory, so it resets on restart and
    each worker counts separately.
    """
    address = client_key(request)
    decision = _signup_by_address.check(address)
    if not decision:
        raise _too_many(decision.retry_after)
    _signup_by_address.record(address)

    # The first slug nobody holds. candidate_slugs refuses reserved
    # names outright, so this cannot mint a tenant called "looplab".
    slug = None
    for candidate in candidate_slugs(body.org_name):
        taken = await session.execute(
            select(Organization.org_id).where(Organization.slug == candidate)
        )
        if taken.scalar_one_or_none() is None:
            slug = candidate
            break

    org = Organization(
        name=body.org_name.strip(),
        slug=slug,
        package_tier=FREE_TIER,
        billing_status="active",
        logo_text=body.org_name.strip()[:60],
        is_platform=False,
        student_count=0,
        teacher_count=0,
    )
    session.add(org)
    await session.flush()

    admin = User(
        org_id=org.org_id,
        role="admin",
        name=body.admin_name.strip(),
        email=body.email,
        password_hash=hash_password(body.password),
        last_seen_at=datetime.now(timezone.utc),
    )
    session.add(admin)
    await session.flush()

    session.add(
        AuditEntry(
            org_id=org.org_id,
            actor_id=admin.user_id,
            actor_label=admin.name,
            action="Organisation created on the free plan",
            target=org.slug,
            severity="info",
        )
    )

    return SignupResult(
        org_slug=org.slug,
        org_name=org.name,
        tokens=TokenPair(
            access_token=create_access_token(admin.user_id, org.org_id, admin.role),
            refresh_token=create_refresh_token(admin.user_id, org.org_id, admin.role),
            expires_in=settings.ACCESS_TOKEN_MINUTES * 60,
        ),
    )


# ----------------------------------------------------------------------
# Two factor authentication
# ----------------------------------------------------------------------


@router.post("/2fa/setup", response_model=TwoFactorSetupOut)
async def two_factor_setup(user: CurrentUser, org: CurrentOrg) -> TwoFactorSetupOut:
    """Start enrolment: mint a secret and hand back the QR payload.

    The secret is stored immediately but stays inactive, because
    totp_confirmed_at is what the login path reads. Somebody who scans
    the code and then closes the tab is not locked out, and calling this
    again simply replaces the unused secret.

    An already enrolled user is refused rather than quietly re-issued.
    Overwriting a working secret on a stray request would strand the
    authenticator app they have already set up.
    """
    if user.has_two_factor:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Two factor authentication is already on. Turn it off first to re-enrol.",
        )

    user.totp_secret = totp_lib.new_secret()
    uri = totp_lib.provisioning_uri(
        user.totp_secret,
        account=user.email,
        issuer=f"ClassConnect ({org.name})",
    )
    return TwoFactorSetupOut(
        secret=user.totp_secret,
        otpauth_uri=uri,
        qr_svg=totp_lib.qr_svg(uri),
    )


@router.post("/2fa/enable", response_model=RecoveryCodesOut)
async def two_factor_enable(
    body: TwoFactorEnable,
    user: CurrentUser,
) -> RecoveryCodesOut:
    """Finish enrolment by proving the app is set up.

    Requiring a working code before switching it on is the entire point.
    Enabling on trust would let a mistyped secret lock the account at
    the next login with no way back in.

    The recovery codes are returned once and never again. Only their
    hashes are stored, so a later request could not show them even if it
    wanted to, and this is the one moment they can be written down.
    """
    if user.has_two_factor:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Two factor authentication is already on.",
        )
    if not user.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Start the setup first.",
        )
    if not totp_lib.verify(user.totp_secret, body.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code is not right. Check your authenticator app and try again.",
        )

    codes, hashes = totp_lib.issue_recovery_codes()
    user.recovery_codes = json.dumps(hashes)
    user.totp_confirmed_at = datetime.now(timezone.utc)
    return RecoveryCodesOut(codes=codes)


@router.post("/2fa/disable", status_code=status.HTTP_204_NO_CONTENT)
async def two_factor_disable(
    body: TwoFactorDisable,
    user: CurrentUser,
) -> None:
    """Turn it off. Needs the password, not merely a live session.

    A live session is exactly what somebody has when they sit down at an
    unlocked machine, and surviving that is what the second factor is
    for. Asking for the password here is what stops removing it being
    the easiest step in that attack.
    """
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That is not your password.",
        )
    user.totp_secret = None
    user.totp_confirmed_at = None
    user.recovery_codes = None


@router.post("/2fa/recovery-codes", response_model=RecoveryCodesOut)
async def regenerate_recovery_codes(
    body: TwoFactorDisable,
    user: CurrentUser,
) -> RecoveryCodesOut:
    """Issue a fresh set, invalidating every code issued before.

    Same password requirement as disabling, for the same reason, and it
    takes the same body deliberately: they are the same authorisation.
    """
    if not user.has_two_factor:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Two factor authentication is not on.",
        )
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That is not your password.",
        )
    codes, hashes = totp_lib.issue_recovery_codes()
    user.recovery_codes = json.dumps(hashes)
    return RecoveryCodesOut(codes=codes)


@router.post("/2fa/verify", response_model=TokenPair)
async def two_factor_verify(
    body: TwoFactorVerify,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TokenPair:
    """Complete a login by presenting the second factor.

    Takes a challenge token, not an access token. That token carries no
    role claim and every protected route demands an access token, so it
    cannot be replayed to read anything: it opens this door only.
    """
    import jwt

    try:
        payload = decode_token(body.challenge_token, expected_type=CHALLENGE)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="That took too long. Sign in again.",
        ) from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid sign in attempt."
        ) from exc

    result = await session.execute(
        select(User).where(
            User.user_id == payload["sub"],
            User.org_id == payload["org_id"],
            User.is_active.is_(True),
        )
    )
    user = result.scalar_one_or_none()
    if user is None or not user.has_two_factor:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid sign in attempt."
        )

    if body.code:
        accepted = totp_lib.verify(user.totp_secret, body.code)
    elif body.recovery_code:
        stored = json.loads(user.recovery_codes or "[]")
        remaining = totp_lib.consume_recovery_code(body.recovery_code, stored)
        accepted = remaining is not None
        if accepted:
            # Spent, so it cannot be replayed.
            user.recovery_codes = json.dumps(remaining)
            # A recovery code means somebody lost their second factor,
            # which is worth a line in the log whether or not it was
            # them. Counting what is left tells the reader how close the
            # account is to having no way back in.
            session.add(
                AuditEntry(
                    org_id=user.org_id,
                    actor_id=user.user_id,
                    actor_label=user.name,
                    action=f"Signed in with a recovery code, {len(remaining)} left",
                    target=user.email,
                    severity="warning",
                )
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Enter the code from your authenticator app, or a recovery code.",
        )

    if not accepted:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="That code is not right.",
        )

    user.last_seen_at = datetime.now(timezone.utc)
    return TokenPair(
        access_token=create_access_token(user.user_id, user.org_id, user.role),
        refresh_token=create_refresh_token(user.user_id, user.org_id, user.role),
        expires_in=settings.ACCESS_TOKEN_MINUTES * 60,
    )
