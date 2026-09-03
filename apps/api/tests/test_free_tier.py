"""The free plan and self serve onboarding.

Free is the top of the funnel: a school signs itself up, runs on it for
nothing, and pays when it outgrows the cap. That makes two things
security relevant rather than merely commercial.

First, signup is the only unauthenticated write in the product, so the
request schema must not be able to name its own tier, its own org, or
the platform flag. Second, the slug it mints becomes the tenant's public
identity on the login picker, so it must never be able to claim the
platform's own name.

Run with: pytest apps/api/tests -v
"""

from itertools import islice

import pytest

from app.models.organization import PACKAGE_TIERS
from app.schemas.common import SignupRequest
from app.services.onboarding_service import (
    RESERVED_SLUGS,
    SLUG_MAX,
    candidate_slugs,
    is_reserved,
    slugify,
)
from app.services.tier_policy import (
    FEATURE_MATRIX,
    FREE_TIER,
    TIER_LIMITS,
    TIER_ORDER,
    TIER_PRICE,
    SeatUsage,
    features_gained,
    has_feature,
    is_free,
    is_paying,
    monthly_revenue,
    next_tier,
    upgrade_targets,
)


# ----------------------------------------------------------------------
# The plan itself
# ----------------------------------------------------------------------


def test_free_is_the_bottom_of_the_ladder():
    assert TIER_ORDER[0] == FREE_TIER
    assert is_free(FREE_TIER)
    assert next_tier(FREE_TIER) == "starter"
    assert upgrade_targets(FREE_TIER) == ("starter", "growth", "pro")


def test_free_costs_nothing_and_earns_nothing():
    assert TIER_PRICE[FREE_TIER] == 0.0
    assert not is_paying(FREE_TIER)
    # It must never show up in MRR, in any billing state.
    for state in ("active", "past_due", "trialing", "canceled"):
        assert monthly_revenue(FREE_TIER, state) == 0.0


def test_free_carries_the_whole_core_loop():
    """The cap is on scale, never on whether the product works.

    A tenant that cannot add a student, publish a lesson or record a fee
    has not tried the product, and no amount of upgrade prompting fixes
    an evaluation that never happened. Those three are ungated features,
    so the check is that they are absent from the gate matrix entirely.
    """
    gated = set(FEATURE_MATRIX)
    for core in ("students", "content", "fees", "schedule", "parent_portal"):
        assert core not in gated, f"{core} must not be tier gated"


def test_free_seats_are_enough_to_run_a_real_class():
    limits = TIER_LIMITS[FREE_TIER]
    assert limits["students"] == 25
    # More than one, so sharing a batch between colleagues is reachable.
    # A single teacher account cannot demonstrate what the product does.
    assert limits["teachers"] >= 2
    for kind in ("students", "teachers"):
        assert limits[kind] < TIER_LIMITS["starter"][kind]


def test_free_unlocks_none_of_the_paid_features():
    for feature in FEATURE_MATRIX:
        assert not has_feature(FREE_TIER, feature), feature


def test_every_tier_is_known_to_the_model_layer():
    """The Literal and the column constant have to agree with the policy.

    They are three separate lists in three files. A tier added to the
    policy alone serialises fine until an org is actually on it, at
    which point the response fails validation rather than the write.
    """
    assert set(PACKAGE_TIERS) == set(TIER_ORDER)
    assert set(TIER_LIMITS) == set(TIER_ORDER)
    assert set(TIER_PRICE) == set(TIER_ORDER)


# ----------------------------------------------------------------------
# The upgrade prompt is built from the matrix, not from prose
# ----------------------------------------------------------------------


def test_upgrading_from_free_to_starter_buys_capacity_not_features():
    """Worth asserting because it is a pricing decision, not an accident.

    Starter carries none of the gated features either, so the only thing
    it adds over Free is room. Any upgrade prompt that leads with a
    feature list would show an empty one and read as broken, which is
    why the UI has to lead with seats here.
    """
    assert features_gained(FREE_TIER, "starter") == ()
    assert TIER_LIMITS["starter"]["students"] > TIER_LIMITS[FREE_TIER]["students"]


def test_features_gained_tracks_the_matrix():
    gained = features_gained(FREE_TIER, "growth")
    assert "qr_ticketing" in gained
    assert "analytics_full" in gained
    # Pro only features must not be promised by a Growth prompt.
    assert "multi_currency" not in gained
    assert "custom_domain" not in gained
    for feature in gained:
        assert has_feature("growth", feature)
        assert not has_feature(FREE_TIER, feature)


def test_nothing_is_gained_by_standing_still():
    for tier in TIER_ORDER:
        assert features_gained(tier, tier) == ()


# ----------------------------------------------------------------------
# The seat cap
# ----------------------------------------------------------------------


def test_the_cap_warns_before_it_blocks():
    """Hitting the wall mid task is the thing to avoid.

    An admin importing a class list should be told they are close before
    the twenty sixth student fails, not after.
    """
    assert not SeatUsage(tier=FREE_TIER, used=19, kind="students").nearing_cap
    assert SeatUsage(tier=FREE_TIER, used=20, kind="students").nearing_cap
    assert not SeatUsage(tier=FREE_TIER, used=24, kind="students").at_cap
    assert SeatUsage(tier=FREE_TIER, used=25, kind="students").at_cap


def test_a_tenant_over_the_cap_after_a_downgrade_is_not_broken():
    """Downgrading keeps the data. The cap blocks adding, not existing.

    Deleting students to fit a smaller plan would be a data loss bug
    dressed up as billing enforcement.
    """
    over = SeatUsage(tier=FREE_TIER, used=180, kind="students")
    assert over.at_cap
    assert over.pct == 100  # clamped, so no 720% in the UI
    assert over.label == "180 of 25"


# ----------------------------------------------------------------------
# Signup cannot ask for more than it is given
# ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "forbidden", ["package_tier", "packageTier", "org_id", "orgId", "is_platform", "role"]
)
def test_signup_cannot_name_its_own_tier_or_tenant(forbidden):
    assert forbidden not in SignupRequest.model_fields


def test_signup_ignores_a_tier_it_is_handed_anyway():
    """Pydantic drops unknown keys, so the value never reaches the model."""
    body = SignupRequest.model_validate(
        {
            "orgName": "Somewhere Academy",
            "adminName": "A Person",
            "email": "a@somewhere.lk",
            "password": "longenough1",
            "packageTier": "pro",
            "isPlatform": True,
        }
    )
    assert not hasattr(body, "package_tier")
    assert not hasattr(body, "is_platform")


def test_signup_enforces_a_password_floor():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        SignupRequest.model_validate(
            {"orgName": "A School", "adminName": "P", "email": "a@b.lk", "password": "short"}
        )


# ----------------------------------------------------------------------
# Slugs
# ----------------------------------------------------------------------


def test_the_platform_name_can_never_be_claimed():
    """A tenant slugged "looplab" would appear on the public picker as
    the vendor. That is a phishing surface handed out by the signup form.
    """
    assert is_reserved("looplab")
    assert next(candidate_slugs("LoopLab")) != "looplab"
    assert next(candidate_slugs("loop lab")) != "looplab"


@pytest.mark.parametrize("reserved", sorted(RESERVED_SLUGS))
def test_no_reserved_word_is_ever_yielded(reserved):
    assert all(c != reserved for c in islice(candidate_slugs(reserved), 5))


def test_collisions_walk_forward_predictably():
    assert list(islice(candidate_slugs("Horizon Tutoring"), 3)) == [
        "horizon-tutoring",
        "horizon-tutoring-2",
        "horizon-tutoring-3",
    ]


def test_accents_fold_rather_than_vanish():
    assert slugify("Académie Française") == "academie-francaise"


def test_a_name_with_no_latin_letters_still_gets_a_slug():
    """Sinhala and Tamil fold to nothing under NFKD.

    That is most of the target market, so an empty slug cannot be an
    error path. A readable generic beats a failed signup.
    """
    sinhala = "ලංකා පාසල"
    assert slugify(sinhala) == ""
    assert next(candidate_slugs(sinhala)) == "school"


def test_slugs_stay_within_the_column_and_stay_tidy():
    for name in ["A" * 200, "!!!", "St. Joseph's  College,, Colombo", "  spaced  out  "]:
        for slug in islice(candidate_slugs(name), 3):
            assert len(slug) <= SLUG_MAX
            assert slug == slug.strip("-")
            assert "--" not in slug
            assert slug and not slug.startswith("-")
