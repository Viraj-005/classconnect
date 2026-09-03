"""Page access resolution.

The rule under test is the precedence order:

    tier gate  AND  platform default  AND  organisation override

A tenant Admin narrowing their own organisation must never be able to
widen it past what LoopLab allows, and no scope may switch off a locked
page. Both are security properties, not conveniences, so they get
adversarial tests the same way tenant isolation does.
"""

import pytest

from app.services.page_registry import (
    PAGES,
    PAGES_BY_KEY,
    is_known,
    page_catalogue,
    pages_for_role,
    resolve_access,
)
from app.services.tier_policy import FEATURE_MATRIX, has_feature

ALL_FEATURES = set(FEATURE_MATRIX)
GROWTH_FEATURES = {f for f in FEATURE_MATRIX if has_feature("growth", f)}
STARTER_FEATURES = {f for f in FEATURE_MATRIX if has_feature("starter", f)}


def access(role, features=ALL_FEATURES, platform=None, org=None):
    return resolve_access(
        role=role,
        tier_features=features,
        platform_overrides=platform or {},
        org_overrides=org or {},
    )


# ----------------------------------------------------------------------
# Registry integrity
# ----------------------------------------------------------------------


def test_every_page_key_is_unique():
    keys = [p.key for p in PAGES]
    assert len(keys) == len(set(keys))


def test_every_page_belongs_to_at_least_one_role():
    for page in PAGES:
        assert page.roles, page.key


def test_every_portal_has_a_locked_landing_page():
    """Each portal needs one page nobody can switch off.

    Without it an administrator could remove every page from a role and
    leave those users staring at a shell with no reachable screen.
    """
    portals = {p.portal for p in PAGES}
    for portal in portals:
        locked = [p for p in PAGES if p.portal == portal and p.locked]
        assert locked, f"{portal} has no locked page"


def test_gated_pages_reference_real_features():
    for page in PAGES:
        if page.feature:
            assert page.feature in FEATURE_MATRIX, page.key


def test_catalogue_matches_the_registry():
    assert len(page_catalogue()) == len(PAGES)


def test_unknown_keys_are_rejected():
    assert is_known("teacher.content")
    assert not is_known("teacher.nope")


# ----------------------------------------------------------------------
# Defaults
# ----------------------------------------------------------------------


def test_a_role_only_sees_its_own_pages():
    teacher = access("teacher")
    assert "teacher.content" in teacher
    # A student page is not the teacher's business and is omitted.
    assert "student.quizzes" not in teacher
    assert "admin.users" not in teacher


def test_everything_is_open_by_default_on_the_top_tier():
    for page in pages_for_role("teacher"):
        assert access("teacher")[page.key] is True


# ----------------------------------------------------------------------
# Tier gate wins over everything
# ----------------------------------------------------------------------


def test_tier_gate_blocks_even_when_both_scopes_allow():
    """A Starter tenant cannot reach QR ticketing however it is set."""
    result = access(
        "teacher",
        features=STARTER_FEATURES,
        platform={"teacher.tickets": True},
        org={"teacher.tickets": True},
    )
    assert result["teacher.tickets"] is False


def test_growth_reaches_ticketing_but_not_a_pro_only_page():
    result = access("admin", features=GROWTH_FEATURES)
    # Branding unlocks at Growth.
    assert result["admin.branding"] is True

    starter = access("admin", features=STARTER_FEATURES)
    assert starter["admin.branding"] is False


# ----------------------------------------------------------------------
# Platform ceiling and organisation narrowing
# ----------------------------------------------------------------------


def test_platform_default_switches_a_page_off_for_everyone():
    result = access("teacher", platform={"teacher.content": False})
    assert result["teacher.content"] is False


def test_org_override_can_narrow():
    result = access("teacher", org={"teacher.content": False})
    assert result["teacher.content"] is False


def test_org_override_cannot_widen_past_the_platform_ceiling():
    """The central rule. An admin must not out-vote LoopLab."""
    result = access(
        "teacher",
        platform={"teacher.content": False},
        org={"teacher.content": True},
    )
    assert result["teacher.content"] is False


def test_org_override_is_independent_per_page():
    result = access("teacher", org={"teacher.fees": False})
    assert result["teacher.fees"] is False
    assert result["teacher.students"] is True


# ----------------------------------------------------------------------
# Locked pages
# ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "page_key",
    [p.key for p in PAGES if p.locked],
)
def test_locked_pages_survive_every_attempt_to_disable_them(page_key):
    page = PAGES_BY_KEY[page_key]
    role = page.roles[0]
    result = access(
        role,
        features=set(),  # even with no features at all
        platform={page_key: False},
        org={page_key: False},
    )
    assert result[page_key] is True


def test_access_control_screens_are_locked():
    """The screen that governs the others cannot govern itself off."""
    assert PAGES_BY_KEY["admin.access"].locked
    assert PAGES_BY_KEY["superadmin.access"].locked


def test_an_admin_cannot_be_left_with_no_reachable_page():
    """Switch off everything switchable and something still remains."""
    everything_off = {p.key: False for p in pages_for_role("admin")}
    result = access("admin", features=set(), platform=everything_off, org=everything_off)
    assert any(result.values()), "admin locked out of their own organisation"
