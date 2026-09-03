"""Timezone normalisation.

These exist because of a live bug rather than for coverage. Every
datetime column is declared `DateTime(timezone=True)`, which round trips
as aware on Postgres and **naive** on SQLite. Comparing a naive value
against an aware `now()` raises, and that took the entire past due
tenant offline: login succeeded, then the session endpoint raised and
the client reported a generic "cannot reach the API".

The lesson worth encoding: anything read back from the database goes
through as_utc before it meets now().
"""

from datetime import datetime, timedelta, timezone

import pytest

from app.core.timeutil import as_utc, days_until, is_past, utc_now


def naive(**delta):
    """A naive timestamp, the way SQLite hands one back."""
    return (datetime.now(timezone.utc) + timedelta(**delta)).replace(tzinfo=None)


def aware(**delta):
    """An aware timestamp, the way Postgres hands one back."""
    return datetime.now(timezone.utc) + timedelta(**delta)


# ----------------------------------------------------------------------
# The failure being guarded against
# ----------------------------------------------------------------------


def test_raw_naive_comparison_is_the_bug():
    """Documents why this module exists.

    If this ever stops raising, Python changed and these helpers can be
    reconsidered. Until then, the guard is load bearing.
    """
    with pytest.raises(TypeError):
        _ = naive(days=1) < utc_now()


def test_as_utc_makes_a_naive_value_comparable():
    assert as_utc(naive(days=1)) > utc_now()
    assert as_utc(naive(days=-1)) < utc_now()


def test_as_utc_leaves_an_aware_value_correct():
    value = aware(days=1)
    assert as_utc(value) == value


def test_as_utc_converts_a_non_utc_zone():
    plus_five = timezone(timedelta(hours=5))
    value = datetime(2026, 1, 1, 12, 0, tzinfo=plus_five)
    converted = as_utc(value)
    assert converted.tzinfo == timezone.utc
    assert converted.hour == 7


def test_as_utc_passes_none_through():
    assert as_utc(None) is None


# ----------------------------------------------------------------------
# is_past, the ticket expiry check
# ----------------------------------------------------------------------


@pytest.mark.parametrize("make", [naive, aware], ids=["sqlite", "postgres"])
def test_is_past_agrees_across_drivers(make):
    """The same row must read the same way on either database."""
    assert is_past(make(days=-1)) is True
    assert is_past(make(days=1)) is False


def test_is_past_defaults_for_a_missing_value():
    assert is_past(None) is False
    assert is_past(None, default=True) is True


# ----------------------------------------------------------------------
# days_until, the grace period countdown
# ----------------------------------------------------------------------


@pytest.mark.parametrize("make", [naive, aware], ids=["sqlite", "postgres"])
def test_days_until_counts_forward(make):
    assert days_until(make(days=6, hours=1)) == 6


@pytest.mark.parametrize("make", [naive, aware], ids=["sqlite", "postgres"])
def test_days_until_floors_at_zero_once_elapsed(make):
    """A grace period that has run out reads as zero, never negative.

    The UI prints this straight into "keeps working for N more days",
    and a negative number there would be worse than useless.
    """
    assert days_until(make(days=-3)) == 0


def test_days_until_passes_none_through():
    assert days_until(None) is None
