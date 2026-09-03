"""Application settings.

Environment variable names follow the LoopLab-IMS convention so ops
stays consistent across LoopLab products (see HANDOVER.md section 4).
"""

from functools import lru_cache
from urllib.parse import quote

from pydantic import Field, model_validator

# The value the development defaults carry. Named so the guard below
# can recognise it, and so nobody is tempted to treat it as a secret.
DEV_SECRET = "change-me-in-production"
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Application
    APP_NAME: str = "ClassConnect API"
    ENV: str = "development"
    DEBUG: bool = True
    API_PREFIX: str = "/api/v1"

    # Database. One Postgres instance, shared schema, org_id on every
    # tenant scoped table (ARCHITECTURE.md section 3.1).
    #
    # Two ways to point at it, resolved in build_database_url below:
    #
    #   DATABASE_URL   a full SQLAlchemy URL. Wins when set, because
    #                  that is what a host injects and what CI overrides.
    #   DB_NAME etc    the five part form, matching the LoopLab-IMS
    #                  convention the rest of this file follows.
    #
    # Falling back to SQLite keeps the app runnable without a Postgres
    # install, but that is a development convenience and a real
    # deviation from ARCHITECTURE.md section 2. Two things need the real
    # thing: the Row Level Security layer planned for Phase 3, and case
    # insensitive ILIKE search, which SQLite silently treats as LIKE.
    DATABASE_URL: str = ""
    DB_NAME: str = ""
    DB_USER: str = ""
    DB_PASSWORD: str = ""
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432

    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    # Auth
    JWT_SECRET: str = Field(default=DEV_SECRET)
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 30
    REFRESH_TOKEN_DAYS: int = 14

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    # Storage.
    #
    # Files are on local disk under MEDIA_ROOT, with their metadata in
    # Postgres. S3 stays configured for later; the split survives the
    # move because the database is the index and the object store is
    # only the bytes.
    #
    # Objects are keyed with an org_id prefix either way, so a directory
    # listing or a misconfigured bucket cannot enumerate another
    # tenant's filenames.
    MEDIA_ROOT: str = "media"
    AWS_REGION: str = "ap-south-1"
    S3_BUCKET: str = "classconnect-media"

    # Student fee payments, tenant to its own students.
    STRIPE_API_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    PAYPAL_CLIENT_ID: str = ""
    PAYPAL_CLIENT_SECRET: str = ""

    # Platform billing, LoopLab to tenant. Deliberately separate
    # credentials from the fee gateway above so the two money flows
    # cannot be confused at the configuration level either.
    STRIPE_BILLING_API_KEY: str = ""
    STRIPE_BILLING_WEBHOOK_SECRET: str = ""

    # QR tickets
    QR_TICKET_VALID_DAYS: int = 30
    QR_SIGNING_SECRET: str = Field(default=DEV_SECRET)

    # Where tenants live.
    #
    # APP_DOMAIN turns <slug>.classconnect.app into a tenant. PLATFORM_HOST
    # is LoopLab's own console, which is not a tenant and is never listed
    # anywhere. Both empty means every hostname is unbound and the login
    # picker is shown, which is the development default.
    APP_DOMAIN: str = ""
    PLATFORM_HOST: str = ""

    # Rate limits on the unauthenticated endpoints.
    #
    # Counted per process, so these are a floor rather than the control.
    # See app/core/rate_limit.py. A per IP limit in front of the app is
    # the layer that actually holds under more than one worker.
    #
    # The per address login figure is deliberately generous: a school
    # signs in from one building through one NAT address, so a tight
    # limit there locks out the customer rather than the attacker. The
    # narrow limit is per address AND account, which is where a brute
    # force actually shows up.
    LOGIN_FAILURES_PER_ACCOUNT: int = 8
    LOGIN_FAILURES_PER_ADDRESS: int = 60
    LOGIN_WINDOW_SECONDS: int = 900
    SIGNUP_PER_ADDRESS: int = 5
    SIGNUP_WINDOW_SECONDS: int = 3600


    @model_validator(mode="after")
    def build_database_url(self) -> "Settings":
        """Assemble DATABASE_URL from the parts when it is not set.

        The password is percent encoded. SQLAlchemy's own parser happens
        to tolerate a raw # or @, so this is not what makes the app work
        today. It is what stops the assembled URL breaking the moment it
        leaves SQLAlchemy: a strict RFC parser cuts everything from the
        # onward as a fragment, so `postgresql://u:hunter#2@host/db`
        reaches libpq, psql, pgAdmin or a container env as user u with
        password hunter and no host. Encoding once, here, means the URL is
        correct wherever it is read.

        In the .env file itself an unquoted # is fine as long as nothing
        precedes it with a space, since python-dotenv only treats " #"
        as starting a comment. Quoting the value costs nothing and
        removes the question.
        """
        if self.DATABASE_URL:
            return self
        if self.DB_NAME and self.DB_USER:
            auth = quote(self.DB_USER, safe="")
            if self.DB_PASSWORD:
                auth += ":" + quote(self.DB_PASSWORD, safe="")
            self.DATABASE_URL = (
                f"postgresql+asyncpg://{auth}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
            )
        else:
            self.DATABASE_URL = "sqlite+aiosqlite:///./classconnect.db"
        return self


    @model_validator(mode="after")
    def refuse_default_secrets_outside_development(self) -> "Settings":
        """Fail to start rather than run on a secret from the repository.

        JWT_SECRET signs every session token and QR_SIGNING_SECRET signs
        every class ticket. Both have a development default that is in
        the source, so anybody who has read this file could mint a valid
        token for any account at any tenant, or forge a ticket.

        A warning in a log is not enough: the whole point of a default
        is that it works, so a deploy that forgot to set these would
        come up healthy and stay that way. Refusing to boot is the only
        signal that cannot be missed.

        Development is exempt so the app still runs from a clean
        checkout with no .env at all.
        """
        if self.ENV == "development":
            return self

        weak = [
            name
            for name in ("JWT_SECRET", "QR_SIGNING_SECRET")
            if getattr(self, name) in ("", DEV_SECRET) or len(getattr(self, name)) < 32
        ]
        if weak:
            raise ValueError(
                f"{', '.join(weak)} must be set to a strong value when ENV is "
                f"{self.ENV!r}. Generate one with: "
                "python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
