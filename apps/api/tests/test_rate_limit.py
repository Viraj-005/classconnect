"""Rate limiting on the unauthenticated endpoints.

Time is passed in rather than slept through, so these are fast and do
not turn flaky on a loaded machine.

The design decisions being pinned here matter more than the mechanics.
Counting successes would lock a school out of its own morning, because
the whole building shares one address. Keying the tight limit on the
account alone would let anybody lock a named victim out of their own
account, turning a brute force defence into a denial of service tool.
Reading the address from a header would let a caller choose their own
bucket and skip the limit entirely.

Run with: pytest apps/api/tests -v
"""

import pytest

from app.core.rate_limit import Decision, FailureWindow, client_key


# ----------------------------------------------------------------------
# Counting and blocking
# ----------------------------------------------------------------------


def test_allows_up_to_the_limit_then_blocks():
    w = FailureWindow(limit=3, window_seconds=60)
    for i in range(3):
        assert w.check("k", now=100) is not None
        assert w.check("k", now=100).allowed, f"attempt {i} should be allowed"
        w.record("k", now=100)
    assert not w.check("k", now=100).allowed


def test_a_blocked_key_is_told_how_long_to_wait():
    w = FailureWindow(limit=2, window_seconds=60)
    w.record("k", now=100)
    w.record("k", now=100)
    d = w.check("k", now=100)
    assert not d.allowed
    # The oldest failure leaves the window at 160.
    assert 1 <= d.retry_after <= 61


def test_keys_do_not_interfere():
    w = FailureWindow(limit=1, window_seconds=60)
    w.record("a", now=100)
    assert not w.check("a", now=100).allowed
    assert w.check("b", now=100).allowed


def test_a_success_clears_only_that_key():
    w = FailureWindow(limit=1, window_seconds=60)
    w.record("a", now=100)
    w.record("b", now=100)
    w.clear("a")
    assert w.check("a", now=100).allowed
    assert not w.check("b", now=100).allowed


# ----------------------------------------------------------------------
# The window slides
# ----------------------------------------------------------------------


def test_failures_expire_out_of_the_window():
    w = FailureWindow(limit=2, window_seconds=60)
    w.record("k", now=100)
    w.record("k", now=100)
    assert not w.check("k", now=130).allowed
    # Both are older than the window by now.
    assert w.check("k", now=161).allowed


def test_the_window_slides_rather_than_resetting():
    """A fixed window allows twice the rate across its own boundary.

    Spend the allowance late in one window and again early in the next
    and an attacker gets 2N attempts back to back, at exactly the moment
    the limit is supposed to bite. This asserts the older failures still
    count once the newer ones arrive.
    """
    w = FailureWindow(limit=3, window_seconds=60)
    for t in (50, 55, 59):
        w.record("k", now=t)
    # A fixed window starting at 60 would call this a clean slate.
    assert not w.check("k", now=61).allowed
    # Only once the first three have aged out does it open up.
    assert w.check("k", now=120).allowed


# ----------------------------------------------------------------------
# Bounds and validation
# ----------------------------------------------------------------------


def test_memory_is_bounded_against_a_flood_of_distinct_keys():
    """Distinct keys are what an attacker generates, so this cannot grow freely."""
    w = FailureWindow(limit=5, window_seconds=60, max_keys=50)
    for i in range(500):
        w.record(f"key-{i}", now=100)
    assert len(w._hits) <= 50


def test_expired_keys_are_reclaimed():
    w = FailureWindow(limit=5, window_seconds=60, max_keys=10)
    for i in range(10):
        w.record(f"old-{i}", now=100)
    # Long after the window, new traffic should not be squeezed out by
    # entries that no longer count for anything.
    for i in range(10):
        w.record(f"new-{i}", now=1000)
    assert w.check("new-0", now=1000).allowed
    assert len(w._hits) <= 10


@pytest.mark.parametrize("limit,window", [(0, 60), (-1, 60), (5, 0), (5, -1)])
def test_a_nonsense_limit_is_refused_at_construction(limit, window):
    with pytest.raises(ValueError):
        FailureWindow(limit=limit, window_seconds=window)


def test_decision_is_falsy_when_blocked():
    """The routers write `if not decision`, so this has to hold."""
    assert Decision(True)
    assert not Decision(False, 30)


# ----------------------------------------------------------------------
# The address comes from the connection, never from a header
# ----------------------------------------------------------------------


class _Client:
    def __init__(self, host):
        self.host = host


class _Request:
    def __init__(self, host=None, headers=None):
        self.client = _Client(host) if host else None
        self.headers = headers or {}


def test_the_key_is_the_connection_address():
    assert client_key(_Request(host="203.0.113.9")) == "203.0.113.9"


def test_a_forwarded_header_cannot_choose_the_bucket():
    """Otherwise a caller sets X-Forwarded-For per request and never trips.

    Uvicorn's proxy headers middleware rewrites request.client for
    upstreams you have chosen to trust, which is the right place for
    that decision. Reading the header here would apply it to everybody.
    """
    spoofed = _Request(
        host="203.0.113.9",
        headers={"X-Forwarded-For": "198.51.100.1", "X-Real-IP": "198.51.100.2"},
    )
    assert client_key(spoofed) == "203.0.113.9"


def test_a_missing_client_still_yields_a_key():
    """A limit that raises on an odd request is a way through the limit."""
    assert client_key(_Request(host=None)) == "unknown"
    assert client_key(object()) == "unknown"
