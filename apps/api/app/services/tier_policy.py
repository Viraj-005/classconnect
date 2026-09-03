"""Package tier policy. Pure logic, no framework and no database.

Deliberately free of FastAPI and SQLAlchemy imports so that the rules
which decide what a tenant can reach are testable on their own, without
standing up an engine or a request. app/services/feature_gate_service.py
wraps these in the router dependencies.

The frontend keeps a mirror of this matrix in apps/web/src/lib/tiers.js
so it can render an upgrade state rather than a dead control. That copy
decides nothing. If the two disagree, this one is correct. Keep them in
sync when a tier changes.
"""

from dataclasses import dataclass

# Feature key -> tiers that include it.
FEATURE_MATRIX: dict[str, tuple[str, ...]] = {
    "qr_ticketing": ("growth", "pro"),
    "payment_gateway": ("growth", "pro"),
    "multi_currency": ("pro",),
    "analytics_full": ("growth", "pro"),
    "analytics_export": ("pro",),
    "branding_logo": ("growth", "pro"),
    "branding_palette": ("pro",),
    "custom_domain": ("pro",),
    "priority_support": ("growth", "pro"),
}

# Free is a tier, not a trial.
#
# A time boxed trial is the wrong shape for a school: they evaluate over
# a term, not a fortnight, and a countdown pushes the decision before
# they have taught a single class on it. So Free never expires and is
# capped by size instead. A tutoring class of twenty five runs its whole
# operation on it for nothing, and pays when it outgrows it, which is
# the point at which paying is an easy decision rather than a leap.
#
# What Free is NOT is a crippled demo. It carries the entire core loop,
# students, content, fees, schedule, parent access, so the tenant can
# actually judge the product. The cap is on scale, never on whether the
# thing works.
FREE_TIER = "free"

TIER_ORDER = ("free", "starter", "growth", "pro")

# Billing states that produce no recurring revenue. A cancelled tenant
# has stopped paying and a trialing one has not started. A past due one
# is neither: it holds a live subscription inside its grace period, owes
# the money, and is reported separately as revenue at risk.
NON_BILLING_STATUSES = ("canceled", "trialing")

# What LoopLab charges a tenant, per month, in Sri Lankan rupees.
#
# LKR is the platform's only billing currency. The multi_currency Pro
# feature is about the other money flow entirely: a tenant collecting
# fees from its own students, which may be in any currency. Platform
# subscriptions are not part of that, and the two must never be added
# together (HANDOVER.md section 4).
#
# Provisional. HANDOVER.md section 5 lists final tiers and pricing as an
# open question for the founder, so this is a starting proposal: the
# same 1 : 3.3 : 10 ladder the BRD proposed, denominated natively rather
# than converted from a foreign figure at a guessed rate.
PLATFORM_CURRENCY = "LKR"
TIER_PRICE = {"free": 0.0, "starter": 7500.0, "growth": 25000.0, "pro": 75000.0}

# Infinity means uncapped on that tier.
TIER_LIMITS: dict[str, dict[str, float]] = {
    # Two teachers rather than one, because a single teacher account
    # cannot demonstrate the thing the product is for. Sharing content
    # and splitting a batch between colleagues is the workflow, and a
    # tenant that never sees it has not really tried the product.
    "free": {"students": 25, "teachers": 2},
    "starter": {"students": 100, "teachers": 5},
    "growth": {"students": 500, "teachers": 25},
    "pro": {"students": float("inf"), "teachers": float("inf")},
}


def has_feature(tier: str, feature: str) -> bool:
    allowed = FEATURE_MATRIX.get(feature)
    if allowed is None:
        # An unknown key is a bug, not a free pass. Fail closed.
        raise KeyError(f"Unknown feature key: {feature}")
    return tier in allowed


def required_tier(feature: str) -> str:
    """Cheapest tier that unlocks a feature, used to word the prompt."""
    allowed = FEATURE_MATRIX.get(feature, ())
    for tier in TIER_ORDER:
        if tier in allowed:
            return tier
    return "pro"


def next_tier(tier: str) -> str:
    idx = TIER_ORDER.index(tier)
    return TIER_ORDER[min(idx + 1, len(TIER_ORDER) - 1)]


def is_free(tier: str) -> bool:
    return tier == FREE_TIER


def is_paying(tier: str) -> bool:
    """Whether the tenant is a customer or a prospect.

    Free tenants are the top of the funnel, not customers. They must not
    appear in revenue, and they must not be counted as churn when they
    leave, but they are worth counting separately, which is why this is
    a question with a name rather than a `!= "free"` scattered around.
    """
    return TIER_PRICE.get(tier, 0.0) > 0


def upgrade_targets(tier: str) -> tuple[str, ...]:
    """Tiers above this one, cheapest first."""
    idx = TIER_ORDER.index(tier)
    return TIER_ORDER[idx + 1 :]


def features_gained(tier: str, target: str) -> tuple[str, ...]:
    """What moving from `tier` to `target` actually unlocks.

    The upgrade prompt is built from this rather than from a hand
    written list per tier, so a change to FEATURE_MATRIX cannot leave
    the sales copy promising something the gate does not give.
    """
    return tuple(
        f
        for f, tiers in FEATURE_MATRIX.items()
        if target in tiers and tier not in tiers
    )


@dataclass(frozen=True)
class SeatUsage:
    tier: str
    used: int
    kind: str

    @property
    def cap(self) -> float:
        return TIER_LIMITS[self.tier][self.kind]

    @property
    def unlimited(self) -> bool:
        return self.cap == float("inf")

    @property
    def pct(self) -> int:
        if self.unlimited:
            return 0
        return min(100, round(self.used / self.cap * 100))

    @property
    def at_cap(self) -> bool:
        return not self.unlimited and self.used >= self.cap

    @property
    def nearing_cap(self) -> bool:
        """Warn before the tenant hits the wall mid task, not at 100."""
        return not self.unlimited and self.pct >= 80

    @property
    def label(self) -> str:
        return (
            f"{self.used} of unlimited"
            if self.unlimited
            else f"{self.used} of {int(self.cap)}"
        )


def effective_branding(
    *,
    tier: str,
    logo_url: str | None,
    logo_text: str | None,
    name: str,
    primary_color: str | None,
    secondary_color: str | None,
    custom_domain: str | None,
) -> dict[str, str | None]:
    """Branding a tenant is actually entitled to on its current tier.

    A tenant that downgrades keeps its stored colours, so an upgrade
    restores them, but they must not be applied meanwhile. Filtering on
    read rather than nulling on downgrade is what makes that reversible.
    """
    may_brand = has_feature(tier, "branding_logo")
    may_palette = has_feature(tier, "branding_palette")
    may_domain = has_feature(tier, "custom_domain")
    return {
        "logoUrl": logo_url if may_brand else None,
        "logoText": logo_text or name,
        "primaryColor": primary_color if may_brand else None,
        "secondaryColor": secondary_color if may_palette else None,
        "customDomain": custom_domain if may_domain else None,
    }


def monthly_revenue(tier: str, billing_status: str) -> float:
    """What one tenant contributes to MRR.

    The single definition, deliberately. The platform summary and the
    per tenant rows used to compute this independently and disagreed:
    the summary counted only `active` tenants while a row priced a
    `past_due` tenant at full tier. On the Subscriptions screen that put
    two different totals for the same three tenants next to each other,
    because the tier breakdown sums the rows and the headline comes from
    the summary. Both now call this.
    """
    if billing_status in NON_BILLING_STATUSES:
        return 0.0
    return TIER_PRICE.get(tier, 0.0)
