"""Tenant isolation and feature gating.

HANDOVER.md section 2, Phase 3 calls for a tenant isolation audit that
actively attempts cross tenant access. These are the first of those
tests. They are deliberately adversarial: each one tries to do the thing
the architecture forbids and asserts that it fails.

Run with: pytest apps/api/tests -v
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import (
    ACCESS,
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.services.tier_policy import (
    FEATURE_MATRIX,
    NON_BILLING_STATUSES,
    TIER_PRICE,
    SeatUsage,
    has_feature,
    monthly_revenue,
    required_tier,
)
from app.services.qr_service import ValidationResult, issue_ticket, validate_ticket

ORG_A = "org-aaaaaaaa"
ORG_B = "org-bbbbbbbb"


# ----------------------------------------------------------------------
# QR tickets, the clearest cross tenant attack surface
# ----------------------------------------------------------------------


def test_ticket_from_another_tenant_is_rejected():
    """A valid ticket issued by tenant A must not scan at tenant B."""
    payload, _sig, _exp = issue_ticket(
        student_name="Amaya Perera",
        student_id="s-01",
        org_id=ORG_A,
        batch="2026 A/L",
        group="Batch A",
    )

    same_tenant = validate_ticket(payload, scanning_org_id=ORG_A)
    assert same_tenant.ok

    other_tenant = validate_ticket(payload, scanning_org_id=ORG_B)
    assert not other_tenant.ok
    assert other_tenant.status == ValidationResult.FOREIGN_TENANT
    # It must be classed as a security event, not a routine rejection,
    # because that is what drives the audit write.
    assert other_tenant.is_security_event


def test_tampering_with_org_id_breaks_the_signature():
    """Rewriting org_id to the scanning tenant must not grant access."""
    payload, _sig, _exp = issue_ticket(
        student_name="Amaya Perera",
        student_id="s-01",
        org_id=ORG_A,
        batch="2026 A/L",
        group="Batch A",
    )
    forged = payload.replace(ORG_A, ORG_B)

    result = validate_ticket(forged, scanning_org_id=ORG_B)
    assert not result.ok
    assert result.status == ValidationResult.MALFORMED


def test_expired_ticket_is_rejected():
    payload, _sig, _exp = issue_ticket(
        student_name="Ishara Bandara",
        student_id="s-06",
        org_id=ORG_A,
        batch="2026 A/L",
        group="Batch B",
        valid_days=-1,
    )
    result = validate_ticket(payload, scanning_org_id=ORG_A)
    assert result.status == ValidationResult.EXPIRED
    # An expired ticket is not a security event, just a lapsed one.
    assert not result.is_security_event


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "not json",
        '{"student_id": "s-01"}',
        '{"student_id":"s-01","org_id":"x","batch":"b","expiry_date":"2030-01-01T00:00:00+00:00"}',
    ],
)
def test_malformed_payloads_are_rejected(raw):
    """Including a well shaped but unsigned payload."""
    result = validate_ticket(raw, scanning_org_id=ORG_A)
    assert not result.ok
    assert result.status == ValidationResult.MALFORMED


def test_ticket_expiry_defaults_to_thirty_days():
    """BRD section 11 fixes ticket validity at 30 days."""
    _payload, _sig, expiry = issue_ticket(
        student_name="Amaya Perera",
        student_id="s-01",
        org_id=ORG_A,
        batch="2026 A/L",
        group="Batch A",
    )
    delta = expiry - datetime.now(timezone.utc)
    assert timedelta(days=29) < delta <= timedelta(days=30)


# ----------------------------------------------------------------------
# Tokens carry tenancy
# ----------------------------------------------------------------------


def test_access_token_carries_org_and_role():
    token = create_access_token("usr-1", ORG_A, "teacher")
    claims = decode_token(token, expected_type=ACCESS)
    assert claims["org_id"] == ORG_A
    assert claims["role"] == "teacher"
    assert claims["sub"] == "usr-1"


def test_refresh_token_is_not_accepted_as_an_access_token():
    from app.core.security import create_refresh_token

    refresh = create_refresh_token("usr-1", ORG_A, "teacher")
    with pytest.raises(Exception):
        decode_token(refresh, expected_type=ACCESS)


def test_password_hashing_roundtrip():
    hashed = hash_password("correct horse battery staple")
    assert hashed != "correct horse battery staple"
    assert verify_password("correct horse battery staple", hashed)
    assert not verify_password("wrong password", hashed)


# ----------------------------------------------------------------------
# Feature gating
# ----------------------------------------------------------------------


def test_starter_cannot_reach_gated_features():
    assert not has_feature("starter", "qr_ticketing")
    assert not has_feature("starter", "analytics_full")
    assert not has_feature("starter", "branding_logo")


def test_growth_unlocks_ticketing_but_not_pro_only_features():
    assert has_feature("growth", "qr_ticketing")
    assert has_feature("growth", "analytics_full")
    assert not has_feature("growth", "analytics_export")
    assert not has_feature("growth", "custom_domain")
    assert not has_feature("growth", "branding_palette")


def test_pro_unlocks_everything():
    for feature in FEATURE_MATRIX:
        assert has_feature("pro", feature), feature


def test_unknown_feature_fails_closed():
    """A typo must raise, never quietly grant access."""
    with pytest.raises(KeyError):
        has_feature("pro", "not_a_real_feature")


def test_required_tier_reports_the_cheapest_tier_that_unlocks():
    assert required_tier("qr_ticketing") == "growth"
    assert required_tier("custom_domain") == "pro"


# ----------------------------------------------------------------------
# Seat caps
# ----------------------------------------------------------------------


def test_seat_cap_blocks_at_the_limit():
    usage = SeatUsage(tier="starter", used=100, kind="students")
    assert usage.at_cap
    assert usage.pct == 100


def test_seat_cap_warns_before_the_limit():
    usage = SeatUsage(tier="starter", used=82, kind="students")
    assert not usage.at_cap
    assert usage.nearing_cap


def test_pro_seats_are_uncapped():
    usage = SeatUsage(tier="pro", used=100_000, kind="students")
    assert usage.unlimited
    assert not usage.at_cap


# ----------------------------------------------------------------------
# Platform revenue
# ----------------------------------------------------------------------


def test_platform_prices_are_denominated_in_rupees():
    """LKR, and large enough that a dollar figure could not pass for one.

    This exists because the tier ladder was first written as 149 / 490 /
    1490, which are dollar shaped. Relabelling those as rupees would
    have priced the product at roughly a fiftieth of its intent without
    anything failing.
    """
    from app.services.tier_policy import FREE_TIER, PLATFORM_CURRENCY

    assert PLATFORM_CURRENCY == "LKR"

    # Free is exactly nothing, not a token amount. A "free" tier with a
    # price attached is the sort of thing that reaches a customer's card
    # statement before anybody notices.
    assert TIER_PRICE[FREE_TIER] == 0.0

    # Every paid tier is a rupee figure. A dollar shaped number is about
    # a fiftieth of the intended price and nothing else would catch it.
    paid = {t: p for t, p in TIER_PRICE.items() if t != FREE_TIER}
    assert all(price >= 1000 for price in paid.values()), paid

    # The ladder must stay ordered, whatever the founder settles on.
    assert TIER_PRICE["free"] < TIER_PRICE["starter"] < TIER_PRICE["growth"] < TIER_PRICE["pro"]


def test_a_past_due_tenant_still_counts_as_revenue():
    """It holds a live subscription in its grace period and owes the money.

    The summary and the per tenant rows disagreed about this: the
    summary counted active tenants only while a row priced a past_due
    tenant at full tier, so two totals for the same tenants appeared on
    one screen. Both go through monthly_revenue now.
    """
    assert monthly_revenue("growth", "past_due") == TIER_PRICE["growth"]
    assert monthly_revenue("growth", "active") == TIER_PRICE["growth"]


def test_cancelled_and_trialing_tenants_contribute_nothing():
    for state in NON_BILLING_STATUSES:
        assert monthly_revenue("pro", state) == 0.0


def test_an_unknown_tier_earns_nothing_rather_than_guessing():
    assert monthly_revenue("enterprise", "active") == 0.0


# ----------------------------------------------------------------------
# A response that varies by session must not be cached by the browser
# ----------------------------------------------------------------------


def test_a_session_scoped_file_is_never_stored_by_a_cache():
    """The logo route carries no org id, so its body must not be stored.

    /branding/logo resolves the organisation from the session and puts
    nothing in the URL, which is what makes it impossible to ask for
    another tenant's logo. The consequence is that every tenant reads a
    different image from one URL. Marked cacheable, the browser served
    one tenant's logo to the next tenant signing in on that machine,
    without a request reaching the server at all.

    Isolation held on the server throughout. It was the client's own
    cache that crossed the boundary, which is why only a hard refresh
    appeared to fix it.
    """
    from app.routers.learning import SESSION_SCOPED_FILE_HEADERS as h

    assert "no-store" in h["Cache-Control"]
    assert "max-age" not in h["Cache-Control"]
    assert h["Vary"] == "Authorization"


def test_a_url_addressed_file_may_be_cached_privately():
    """The platform route names the tenant, so two cannot share an entry."""
    from app.routers.learning import ADDRESSED_FILE_HEADERS as h

    assert "private" in h["Cache-Control"]
    assert "public" not in h["Cache-Control"]
    assert h["Vary"] == "Authorization"
