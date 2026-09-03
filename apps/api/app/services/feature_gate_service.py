"""FastAPI dependencies that enforce package tier policy.

The rules themselves live in app/services/tier_policy.py, which has no
framework or database imports so it can be tested on its own. This
module is only the wiring.

This is the enforcement point for the API. The frontend mirror in
apps/web/src/lib/tiers.js exists to render upgrade states, and decides
nothing.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.middleware.tenant import CurrentOrg
from app.models import Organization
from app.services import storage_service
from app.services.tier_policy import (
    FEATURE_MATRIX,
    TIER_LIMITS,
    TIER_ORDER,
    PLATFORM_CURRENCY,
    TIER_PRICE,
    SeatUsage,
    effective_branding,
    has_feature,
    next_tier,
    required_tier,
)

__all__ = [
    "FEATURE_MATRIX",
    "TIER_LIMITS",
    "TIER_ORDER",
    "PLATFORM_CURRENCY",
    "TIER_PRICE",
    "RequireFullAnalytics",
    "RequirePaymentGateway",
    "RequireQrTicketing",
    "SeatUsage",
    "assert_seat_available",
    "has_feature",
    "require_feature",
    "required_tier",
    "seat_usage",
    "strip_branding_for_tier",
]


def require_feature(feature: str):
    """Gate a whole router or a single route on the tenant's tier.

    Usage:
        router = APIRouter(
            dependencies=[Depends(require_feature("qr_ticketing"))]
        )

    Gating at the router keeps a later endpoint from forgetting it.
    """
    # Validated at import time, so a typo fails startup rather than a
    # production request.
    if feature not in FEATURE_MATRIX:
        raise KeyError(f"Unknown feature key: {feature}")

    async def guard(org: CurrentOrg) -> Organization:
        if not has_feature(org.package_tier, feature):
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "error": "feature_not_in_plan",
                    "feature": feature,
                    "current_tier": org.package_tier,
                    "required_tier": required_tier(feature),
                },
            )
        return org

    return guard


def seat_usage(org: Organization, kind: str) -> SeatUsage:
    used = org.student_count if kind == "students" else org.teacher_count
    return SeatUsage(tier=org.package_tier, used=used, kind=kind)


def assert_seat_available(org: Organization, kind: str) -> None:
    """Call before creating a student or a teacher.

    Checked at creation time rather than on a sweep, so the tenant is
    told at the moment they try to exceed the cap and can be shown a
    concrete upgrade prompt (ARCHITECTURE.md section 4).
    """
    usage = seat_usage(org, kind)
    if usage.at_cap:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "seat_limit_reached",
                "kind": kind,
                "cap": usage.cap,
                "current_tier": org.package_tier,
                "required_tier": next_tier(org.package_tier),
            },
        )


def strip_branding_for_tier(org: Organization) -> dict[str, str | None]:
    """Branding a tenant is entitled to on its plan.

    LoopLab is exempt. It carries a package_tier only because the column
    is not nullable, and gating the operator's own logo on a plan it
    does not buy would mean the company logo vanished if that
    placeholder were ever changed.
    """
    if org.is_platform:
        branding = {
            "logoUrl": org.logo_url,
            "logoText": org.logo_text or org.name,
            "primaryColor": org.primary_color,
            "secondaryColor": org.secondary_color,
            "customDomain": org.custom_domain,
        }
    else:
        branding = effective_branding(
            tier=org.package_tier,
            logo_url=org.logo_url,
            logo_text=org.logo_text,
            name=org.name,
            primary_color=org.primary_color,
            secondary_color=org.secondary_color,
            custom_domain=org.custom_domain,
        )
    # Derived from the logo that survived the strip, not from the stored
    # one, so a tenant whose plan hides their logo does not get a version
    # for a file they are not being shown.
    branding["logoVersion"] = storage_service.version_of(branding.get("logoUrl"))
    return branding


RequireQrTicketing = Annotated[Organization, Depends(require_feature("qr_ticketing"))]
RequireFullAnalytics = Annotated[Organization, Depends(require_feature("analytics_full"))]
RequirePaymentGateway = Annotated[
    Organization, Depends(require_feature("payment_gateway"))
]
