"""In process rate limiting for the unauthenticated endpoints.

This is a floor, not the real control, and it is important to be honest
about which. It lives in one process's memory, so it resets on restart
and each worker counts separately: four workers means four times the
limit. The right layer is a per IP limit in front of the app, where the
count is shared and the traffic never reaches Python at all.

It is here anyway because "we will put it in the proxy" is how an
endpoint ends up with no limit whatsoever, and because a single process
is exactly how this runs in development and in a small deployment.

Two design decisions worth stating.

**Failures are counted, successes are not.** A school signs in every
morning from one building, and counting successful logins would lock the
whole school out by lunchtime.

**The tight key is (address, email), not email alone.** Keying on the
account would let anybody lock a named victim out of their own account
by failing against it repeatedly, which turns a brute force defence into
a denial of service tool. The looser per address counter is what catches
somebody spraying one password across many accounts, and it is set high
enough that a school behind a single NAT address is not caught by it.
"""

from collections import deque
import time

__all__ = ["FailureWindow", "Decision", "client_key"]


class Decision:
    """Whether to allow the attempt, and how long to wait if not."""

    __slots__ = ("allowed", "retry_after")

    def __init__(self, allowed: bool, retry_after: int = 0):
        self.allowed = allowed
        self.retry_after = retry_after

    def __bool__(self) -> bool:
        return self.allowed

    def __repr__(self) -> str:
        return f"Decision(allowed={self.allowed}, retry_after={self.retry_after})"


class FailureWindow:
    """A sliding window of recent failures, per key.

    Sliding rather than fixed. A fixed window lets an attacker spend the
    whole allowance at the end of one window and again at the start of
    the next, which is twice the intended rate at the moment it matters
    most.
    """

    def __init__(self, limit: int, window_seconds: int, max_keys: int = 10_000):
        if limit < 1 or window_seconds < 1:
            raise ValueError("A limit and a window must both be positive")
        self.limit = limit
        self.window = window_seconds
        # Bounded so that a flood of distinct keys, which is exactly what
        # an attacker generates, cannot grow this without limit. The cap
        # is the memory ceiling, not a security boundary.
        self.max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}

    def _now(self) -> float:
        # Monotonic, so a clock adjustment cannot retire the window early
        # or freeze somebody out for hours.
        return time.monotonic()

    def _trim(self, key: str, now: float) -> deque[float]:
        seen = self._hits.get(key)
        if seen is None:
            seen = deque()
            self._hits[key] = seen
        cutoff = now - self.window
        while seen and seen[0] <= cutoff:
            seen.popleft()
        if not seen:
            self._hits.pop(key, None)
        return seen

    def check(self, key: str, now: float | None = None) -> Decision:
        """Allowed to attempt? Records nothing."""
        now = self._now() if now is None else now
        seen = self._trim(key, now)
        if len(seen) < self.limit:
            return Decision(True)
        # Wait until the oldest failure leaves the window.
        retry_after = max(1, int(seen[0] + self.window - now) + 1)
        return Decision(False, retry_after)

    def record(self, key: str, now: float | None = None) -> None:
        """Note one failure."""
        now = self._now() if now is None else now
        if key not in self._hits and len(self._hits) >= self.max_keys:
            self._evict(now)
        seen = self._trim(key, now)
        seen.append(now)
        self._hits[key] = seen

    def clear(self, key: str) -> None:
        """Forget a key's failures, on a success."""
        self._hits.pop(key, None)

    def _evict(self, now: float) -> None:
        """Drop expired keys, and if that is not enough, the oldest.

        Called only when the cap is reached, so the usual path does no
        scanning at all.
        """
        for key in [k for k, v in self._hits.items() if not v or v[-1] <= now - self.window]:
            self._hits.pop(key, None)
        while len(self._hits) >= self.max_keys:
            oldest = min(self._hits, key=lambda k: self._hits[k][-1])
            self._hits.pop(oldest, None)

    def reset(self) -> None:
        self._hits.clear()


def client_key(request) -> str:
    """The caller's address, for keying a limit on.

    Taken from the connection, never from a header. X-Forwarded-For is
    attacker controlled unless a proxy you trust has overwritten it, and
    reading it here would let anyone pick their own bucket and sidestep
    the limit entirely. Uvicorn's proxy headers middleware rewrites
    request.client for trusted upstreams, which is the correct place for
    that decision to be made.
    """
    client = getattr(request, "client", None)
    return getattr(client, "host", None) or "unknown"
