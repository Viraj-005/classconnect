"""Migrations must match the models.

The failure this guards against is mundane and common: somebody adds a
column to a model, the app works locally because their database already
has it, and the migration is never written. It surfaces at deploy, on
the one database nobody can rebuild.

So the test builds a database purely from the migrations, then asks
Alembic what it would still need to change to reach the models. The
answer must be nothing.
"""

from pathlib import Path
import tempfile

from alembic import command
from alembic.autogenerate import produce_migrations
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
import pytest
from sqlalchemy import create_engine

from app.core.database import Base
import app.models  # noqa: F401  registers every model on Base.metadata

API_ROOT = Path(__file__).resolve().parent.parent


def alembic_config(url: str) -> Config:
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


@pytest.fixture
def migrated_db(tmp_path):
    """A database built only by running the migrations.

    Sync SQLite on purpose. Alembic drives its own event loop for the
    async driver, and nesting that inside pytest is noise that tests
    nothing extra: the DDL is identical either way.
    """
    db_path = tmp_path / "migration_check.db"
    url = f"sqlite:///{db_path}"
    command.upgrade(alembic_config(url), "head")
    engine = create_engine(url)
    yield engine
    engine.dispose()


def test_migrations_reach_head_from_empty(migrated_db):
    """The whole chain applies to a blank database without error."""
    with migrated_db.connect() as conn:
        context = MigrationContext.configure(conn)
        assert context.get_current_revision() is not None


def test_migrations_create_every_model_table(migrated_db):
    from sqlalchemy import inspect

    tables = set(inspect(migrated_db).get_table_names())
    for name in Base.metadata.tables:
        assert name in tables, f"{name} is in the models but no migration creates it"


def test_no_drift_between_migrations_and_models(migrated_db):
    """The important one.

    A non-empty diff means a model changed without a migration.
    """
    with migrated_db.connect() as conn:
        context = MigrationContext.configure(
            conn,
            opts={
                "compare_type": True,
                "compare_server_default": True,
                "target_metadata": Base.metadata,
            },
        )
        diffs = produce_migrations(context, Base.metadata).upgrade_ops.as_diffs()

    assert not diffs, (
        "The models and the migrations disagree. Generate a migration:\n"
        "    alembic revision --autogenerate -m 'describe the change'\n"
        f"Outstanding differences: {diffs}"
    )


def test_downgrade_removes_every_table(tmp_path):
    """Downgrade is exercised, not assumed.

    An untested downgrade is the one you find out is broken during an
    incident, which is the worst possible moment.
    """
    from sqlalchemy import inspect

    url = f"sqlite:///{tmp_path / 'roundtrip.db'}"
    cfg = alembic_config(url)

    command.upgrade(cfg, "head")
    engine = create_engine(url)
    after_upgrade = set(inspect(engine).get_table_names())
    assert len(after_upgrade) > 1

    command.downgrade(cfg, "base")
    after_downgrade = set(inspect(engine).get_table_names())
    # Alembic keeps its own bookkeeping table, everything else goes.
    assert after_downgrade <= {"alembic_version"}
    engine.dispose()


def test_revisions_form_a_single_chain():
    """No branches, and exactly one head.

    Two heads means two people generated a migration from the same
    parent, and `upgrade head` becomes ambiguous.
    """
    script = ScriptDirectory.from_config(alembic_config("sqlite://"))
    heads = script.get_heads()
    assert len(heads) == 1, f"Expected one head, found {heads}. Merge them."


def test_every_revision_has_a_downgrade():
    script = ScriptDirectory.from_config(alembic_config("sqlite://"))
    for revision in script.walk_revisions():
        source = Path(revision.path).read_text(encoding="utf-8")
        body = source.split("def downgrade()", 1)
        assert len(body) == 2, f"{revision.revision} has no downgrade()"
        # A downgrade that is only `pass` is a downgrade that does not work.
        assert "pass" not in body[1].split("\n")[1], (
            f"{revision.revision} has an empty downgrade()"
        )
