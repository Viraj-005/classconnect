"""Database engine, session factory and the declarative base.

Shared database, shared schema multi-tenancy. Every tenant scoped table
carries org_id and every such column is indexed, which ARCHITECTURE.md
section 9 makes mandatory rather than optional.
"""

from collections.abc import AsyncGenerator
from datetime import datetime, timezone
import uuid

from sqlalchemy import DateTime, String, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.config import settings

"""Engine construction is deferred until first use.

Creating it at import time makes importing any module in the app pull in
the database driver and resolve the connection URL, which couples pure
logic (the tier policy, the QR signing) to infrastructure that is not
needed to exercise it. Building it lazily keeps `import app.services.*`
cheap and side effect free.
"""

_engine = None
_session_factory = None


def get_engine():
    global _engine
    if _engine is None:
        kwargs = {"echo": settings.DB_ECHO}
        # SQLite uses a different pool class and rejects the pool sizing
        # arguments entirely, so they are only passed to real servers.
        if not settings.DATABASE_URL.startswith("sqlite"):
            kwargs.update(
                pool_size=settings.DB_POOL_SIZE,
                max_overflow=settings.DB_MAX_OVERFLOW,
                pool_pre_ping=True,
            )
        _engine = create_async_engine(settings.DATABASE_URL, **kwargs)
    return _engine


def get_session_factory():
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(), class_=AsyncSession, expire_on_commit=False, autoflush=False
        )
    return _session_factory


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None


class Base(DeclarativeBase):
    pass


def new_id() -> str:
    return str(uuid.uuid4())


class TimestampMixin:
    """created_at and updated_at on everything, for audit and support."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class TenantMixin:
    """Marks a table as tenant scoped.

    Any model using this mixin MUST be queried through a statement that
    filters on org_id. Do not add a relationship or a query helper that
    bypasses that. The tenant guard in app/middleware/tenant.py is the
    only supported source of the value.
    """

    org_id: Mapped[str] = mapped_column(
        String(36), index=True, nullable=False, doc="Owning organisation"
    )


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a session, rolled back on error."""
    async with get_session_factory()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
