"""Liveness and readiness.

These two endpoints look alike and mean opposite things, so the tests
are mostly here to stop them drifting into each other.

    /health  answers "should this process be restarted". It must keep
             answering ok while the database is down, because restarting
             the app does not repair Postgres.

    /ready   answers "should this instance receive traffic". It must
             fail while the database is down, because every useful route
             in this API needs it.

The database is never reached. app.main calls get_session_factory by
name, so substituting that name is enough, and the cached engine global
in app.core.database is left alone. That matters: a test that pointed
the real engine at a dead address would leak that engine into whatever
ran next in the same process.

Run with: pytest apps/api/tests -v
"""

import asyncio
import time

import pytest
from fastapi import Response

from app import main


class _FakeSession:
    """Stands in for an AsyncSession, doing whatever the test needs.

    `async with factory() as session` means the object the factory
    returns is itself the context manager, hence __aenter__ returning
    self rather than a separate session object.
    """

    def __init__(self, on_execute):
        self._on_execute = on_execute

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, *args, **kwargs):
        return await self._on_execute()


def _factory_that(on_execute):
    """A stand in for get_session_factory, one layer of call deep."""
    return lambda: (lambda: _FakeSession(on_execute))


def _run(coro):
    """pytest-asyncio is not installed, so drive the coroutine directly."""
    return asyncio.run(coro)


# ----------------------------------------------------------------------
# Readiness fails when the database does
# ----------------------------------------------------------------------


def test_ready_is_ok_when_the_database_answers(monkeypatch):
    async def fine():
        return None

    monkeypatch.setattr(main, "get_session_factory", _factory_that(fine))
    response = Response()
    body = _run(main.ready(response))

    assert body == {"status": "ready", "database": "ok"}
    assert response.status_code == 200


def test_ready_returns_503_when_the_database_is_unreachable(monkeypatch):
    """The check has to be able to fail, or it is not a check.

    This is the case that was missing. A readiness endpoint that always
    answers ok keeps a broken instance in the load balancer.
    """

    async def refused():
        raise OSError("connection refused")

    monkeypatch.setattr(main, "get_session_factory", _factory_that(refused))
    response = Response()
    body = _run(main.ready(response))

    assert response.status_code == 503
    assert body["status"] == "unavailable"
    assert body["database"] == "unreachable"


def test_ready_does_not_leak_connection_details(monkeypatch):
    """A driver error names the host, the database and sometimes the password.

    Same rule as the unhandled exception handler: log the detail, return
    a generic body. /ready is unauthenticated, so this one is read by
    anybody who can reach the port.
    """

    async def chatty():
        raise OSError(
            'could not connect to server at "db.internal" port 5432, '
            'database "classconnect", user "postgres", password "hunter2"'
        )

    monkeypatch.setattr(main, "get_session_factory", _factory_that(chatty))
    response = Response()
    body = _run(main.ready(response))

    assert response.status_code == 503
    leaked = " ".join(str(v) for v in body.values())
    for secret in ("db.internal", "5432", "classconnect", "postgres", "hunter2"):
        assert secret not in leaked


# ----------------------------------------------------------------------
# Readiness cannot hang
# ----------------------------------------------------------------------


def test_ready_gives_up_rather_than_hanging(monkeypatch):
    """A probe that hangs is worse than one that fails.

    The caller's own timeout ends up deciding instead, and meanwhile the
    probe is holding a connection out of a pool that is already in
    trouble. This asserts the timeout fires, not merely that it is set.
    """

    async def never_answers():
        await asyncio.sleep(30)

    monkeypatch.setattr(main, "get_session_factory", _factory_that(never_answers))
    monkeypatch.setattr(main, "READINESS_TIMEOUT_SECONDS", 0.05)

    response = Response()
    started = time.monotonic()
    body = _run(main.ready(response))
    elapsed = time.monotonic() - started

    assert response.status_code == 503
    assert body["status"] == "unavailable"
    assert elapsed < 5, "the timeout did not fire, /ready hung on the database"


def test_the_readiness_timeout_is_short_enough_to_be_useful():
    """Longer than a probe interval and the timeout never gets to fire."""
    assert 0 < main.READINESS_TIMEOUT_SECONDS <= 10


# ----------------------------------------------------------------------
# Liveness must not depend on the database
# ----------------------------------------------------------------------


def test_health_stays_ok_while_the_database_is_unreachable(monkeypatch):
    """The whole reason these are two endpoints.

    If liveness failed on a database outage, the orchestrator would kill
    every instance, which does not repair the database and leaves
    nothing running to recover when it comes back. This asserts /health
    does not consult the database at all: the factory raises the moment
    it is touched.
    """

    def explodes():
        raise AssertionError("/health must not reach for the database")

    monkeypatch.setattr(main, "get_session_factory", explodes)
    body = _run(main.health())

    assert body["status"] == "ok"


def test_the_two_endpoints_have_not_been_merged():
    """A guard against the obvious future edit.

    Making /health check the database would look like a tightening and
    would be a regression, so the distinction is asserted rather than
    left to the docstrings.
    """
    import inspect

    health_src = inspect.getsource(main.health)
    ready_src = inspect.getsource(main.ready)

    assert "get_session_factory" not in health_src
    assert "get_session_factory" in ready_src


# ----------------------------------------------------------------------
# The root says what the service is, and nothing about the deployment
# ----------------------------------------------------------------------


def test_root_names_the_service_without_describing_the_deployment():
    body = _run(main.root())

    assert body["operator"] == "LoopLab"
    assert "ClassConnect" in body["description"]
    # Unauthenticated, so it must not carry the environment the way
    # /health does, nor anything about the host it runs on.
    assert "env" not in body
    assert not any("localhost" in str(v) or "postgres" in str(v).lower() for v in body.values())


def test_root_makes_no_health_claim():
    """A root that always answers ok is a health check that cannot fail.

    It points at the endpoints that can fail instead of impersonating
    them.
    """
    body = _run(main.root())

    assert "status" not in body
    assert body["health"] == "/health"
    assert body["ready"] == "/ready"


@pytest.mark.parametrize("path", ["/", "/health", "/ready"])
def test_ops_endpoints_answer_head_as_well_as_get(path):
    """Uptime checks and link previewers use HEAD, and FastAPI does not
    add it for a plain @app.get."""
    routes = [r for r in main.app.routes if getattr(r, "path", None) == path]
    assert routes, f"no route registered for {path}"
    assert {"GET", "HEAD"} <= routes[0].methods
