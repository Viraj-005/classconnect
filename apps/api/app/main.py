"""ClassConnect API.

Multi-tenant SaaS LMS, operated by LoopLab.

Read app/middleware/tenant.py before adding a route. Every tenant scoped
query filters on the org resolved there, and no request schema anywhere
accepts an org_id from the client.
"""

import asyncio
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.core.database import dispose_engine, get_session_factory
from app.routers import (
    access,
    admin,
    auth,
    exports,
    learner,
    learning,
    qr,
    superadmin,
    teacher,
)

logging.basicConfig(level=logging.INFO if not settings.DEBUG else logging.DEBUG)
logger = logging.getLogger("classconnect")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s in %s", settings.APP_NAME, settings.ENV)
    yield
    await dispose_engine()


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    # The mobile team generates its client from this, so it stays on.
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    """Never leak an internal error to a tenant.

    A stack trace or a database message can disclose schema details and,
    worse, another tenant's identifiers if the error came from a badly
    scoped query. Log the detail, return a generic body.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Something went wrong. The team has been notified."},
    )


# HEAD as well as GET. Uptime checks and link previewers ask for the
# root with HEAD, and FastAPI does not add it for a plain @app.get,
# so without this they get a 405 rather than a liveness answer.
@app.api_route("/", methods=["GET", "HEAD"], tags=["ops"])
async def root() -> dict[str, str]:
    """Say what this service is to anyone who lands on the bare host.

    The API and the web app run on separate origins, so the root of the
    API is a real address a person can arrive at, usually by trimming a
    URL or by opening the port directly. A bare {"detail":"Not Found"}
    there says nothing about whether the service is broken or the
    visitor is simply in the wrong place, and the web app is the place
    they almost always want.

    Deliberately thin, because it is unauthenticated. It names the
    service and nothing about the deployment: no tenant list, no build
    or host details, no environment. The title and version it does
    return are already public in openapi.json, so repeating them here
    discloses nothing that was not already served.

    No status field on purpose. A root that always answers "ok" is a
    health check that cannot fail, which is worse than none, so this
    points at /health rather than impersonating it.
    """
    body = {
        "service": settings.APP_NAME,
        "description": "ClassConnect, the LoopLab learning management system",
        "operator": "LoopLab",
        "version": app.version,
        "api": settings.API_PREFIX,
        "health": "/health",
        "ready": "/ready",
    }
    # Only advertise the docs when they are actually mounted, so turning
    # them off in a deployment does not leave a link to a 404 behind.
    if app.docs_url:
        body["docs"] = app.docs_url
    return body


# A readiness check that can hang is worse than one that fails: the
# caller's own timeout ends up deciding, and a probe holding a connection
# while the pool is exhausted makes the outage it is reporting worse.
READINESS_TIMEOUT_SECONDS = 3


@app.api_route("/health", methods=["GET", "HEAD"], tags=["ops"])
async def health() -> dict[str, str]:
    """Liveness. Answers ok whenever the process can answer at all.

    This one is meant to be trivial, and the objection to a root that
    always says ok does not apply here. A liveness probe answers one
    question, "should this process be killed and restarted", and the
    only honest evidence for that is whether it can serve a request.

    It deliberately does not touch the database. A liveness probe that
    fails when Postgres is unreachable tells the orchestrator to restart
    the app, which does not repair Postgres and stacks a restart loop on
    top of a dependency outage. Dependencies belong in /ready, where
    failing takes the instance out of the load balancer without killing
    it, so it is still there to recover when the database comes back.
    """
    return {"status": "ok", "env": settings.ENV}


@app.api_route("/ready", methods=["GET", "HEAD"], tags=["ops"])
async def ready(response: Response) -> dict[str, str]:
    """Readiness. Reaches the database, and can genuinely fail.

    This is the check that was missing. Every useful route in this API
    needs Postgres, so an instance that cannot reach it is not ready to
    take traffic no matter how healthy the process looks.

    The failure body stays generic for the same reason the unhandled
    error handler's does: a driver message can carry the host, the
    database name and sometimes the credentials it tried. That the
    database is unreachable is all a caller needs, and all they get.
    """
    try:
        async with asyncio.timeout(READINESS_TIMEOUT_SECONDS):
            async with get_session_factory()() as session:
                await session.execute(text("SELECT 1"))
    except Exception:
        logger.warning("Readiness check failed", exc_info=True)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unavailable", "database": "unreachable"}
    return {"status": "ready", "database": "ok"}


for router in (
    auth.router,
    access.router,
    admin.router,
    superadmin.router,
    teacher.router,
    learner.student_router,
    learner.parent_router,
    learning.router,
    exports.router,
    qr.router,
):
    app.include_router(router, prefix=settings.API_PREFIX)
