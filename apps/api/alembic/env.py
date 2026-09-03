"""Alembic environment.

Four things here are not the generated default and matter:

  1. The URL is resolved, not hardcoded. It comes from app.core.config
     by default, so the application and its migrations can never
     disagree about which database they are talking to, but an explicit
     url still wins. See resolve_url.
  2. Either driver works. The app is async, so the normal path is
     asyncpg or aiosqlite and the migration runs inside
     connection.run_sync. A sync URL is driven directly instead, because
     deploy jobs often have psycopg2 and no async stack.
  3. Batch mode is turned on for SQLite. SQLite cannot ALTER a column,
     so without it any migration that alters or drops one fails on a
     local database while passing on Postgres. Batch mode rebuilds the
     table instead. It is a no-op on Postgres.
  4. app.models is imported for its side effect. Without it
     Base.metadata is empty, autogenerate sees no tables, and the next
     migration silently drops the entire schema.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlalchemy.engine import Connection, make_url
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import settings
from app.core.database import Base

# Importing the package registers every model on Base.metadata. Without
# this, autogenerate produces an empty migration and silently drops the
# whole schema on the next upgrade.
import app.models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def resolve_url() -> str:
    """Where to migrate.

    Precedence, narrowest first:

      1. `-x db_url=...` on the command line, for a one off target.
      2. A url already set on the config object, which is how the test
         suite points migrations at a throwaway database.
      3. settings.DATABASE_URL, the normal path.

    Overwriting unconditionally with settings (the obvious version of
    this) makes migrations untestable, because a caller has no way to
    say "not the real database".
    """
    from_cli = context.get_x_argument(as_dictionary=True).get("db_url")
    if from_cli:
        return from_cli
    already_set = config.get_main_option("sqlalchemy.url", None)
    if already_set:
        return already_set
    return settings.DATABASE_URL


DATABASE_URL = resolve_url()

# The engine is built from the ini section, so the url has to go back
# onto the config object. That object is a configparser, which applies
# %-interpolation to every value it stores, and a percent encoded
# password is full of percent signs: a # encoded as %23 raises
# "invalid interpolation syntax" on the way in. Doubling them is
# configparser's own escape, and get_main_option hands back the
# original, so the engine still sees the real url.
config.set_main_option("sqlalchemy.url", DATABASE_URL.replace("%", "%%"))

target_metadata = Base.metadata

IS_SQLITE = DATABASE_URL.startswith("sqlite")


def include_object(obj, name, type_, reflected, compare_to):
    """Keep alembic's own bookkeeping table out of autogenerate."""
    if type_ == "table" and name == "alembic_version":
        return False
    return True


def _configure(connection: Connection | None = None, **kwargs) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # Detect column type changes, not just added and dropped columns.
        compare_type=True,
        # Detect server default changes too.
        compare_server_default=True,
        include_object=include_object,
        render_as_batch=IS_SQLITE,
        **kwargs,
    )


def run_migrations_offline() -> None:
    """Emit SQL to stdout without connecting.

    Used to hand a DBA the statements for a production change rather
    than letting the deploy run them directly.
    """
    _configure(
        url=DATABASE_URL,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    _configure(connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_sync_migrations() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        do_run_migrations(connection)
    connectable.dispose()


def run_migrations_online() -> None:
    """Drive migrations with whichever driver the URL names.

    The application is async, so the normal path is asyncpg or
    aiosqlite. Supporting a sync driver too is not hypothetical: a
    migration is often run by a deploy job or a DBA's container that has
    psycopg2 and no async stack, and failing there with "requires an
    async driver" would be an unhelpful surprise.
    """
    if make_url(DATABASE_URL).get_dialect().is_async:
        asyncio.run(run_async_migrations())
    else:
        run_sync_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
