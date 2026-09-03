"""Platform level entities: Organization and Subscription."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, new_id

# Mirrors TIER_ORDER in services/tier_policy.py, which is the authority.
PACKAGE_TIERS = ("free", "starter", "growth", "pro")
BILLING_STATUSES = ("active", "past_due", "canceled", "trialing")


class Organization(Base, TimestampMixin):
    """A tenant. One customer of LoopLab.

    Not tenant scoped itself, this IS the tenant.
    """

    __tablename__ = "organizations"

    org_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)

    # Source of truth for feature gating. Nothing else may decide what a
    # tenant can reach (ARCHITECTURE.md section 4).
    package_tier: Mapped[str] = mapped_column(String(16), default="starter", nullable=False)
    billing_status: Mapped[str] = mapped_column(String(16), default="trialing", nullable=False)

    # Branding, applied by the frontend theme provider. Stored as
    # discrete columns rather than JSON so a tier downgrade can null the
    # fields it no longer permits without rewriting a blob.
    logo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    logo_text: Mapped[str | None] = mapped_column(String(60), nullable=True)
    primary_color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    secondary_color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    custom_domain: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)

    # Denormalised counters, kept current by the seat service. Counting
    # rows on every seat check would be a table scan per request on the
    # largest tables in the database.
    student_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    teacher_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    grace_period_ends_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # LoopLab's own record. It exists so Super Admin users have somewhere
    # to belong without sitting inside a customer's tenant, but it is not
    # a customer and must never appear in tenant counts or revenue.
    is_platform: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    subscriptions: Mapped[list["Subscription"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Organization {self.slug} tier={self.package_tier}>"


class Subscription(Base, TimestampMixin):
    """LoopLab's charge to a tenant, via Stripe Billing.

    Not to be confused with StudentPayment, which is a tenant charging
    its own students. Different money, different stakeholders, and by
    rule they never share a code path (HANDOVER.md section 4).
    """

    __tablename__ = "subscriptions"

    subscription_id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=new_id
    )
    org_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.org_id", ondelete="CASCADE"), index=True
    )

    stripe_subscription_id: Mapped[str | None] = mapped_column(
        String(120), unique=True, nullable=True
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(String(120), nullable=True)

    plan: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="trialing", nullable=False)
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Historical subscriptions are retained for billing history, so the
    # active one is flagged rather than the others deleted.
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    organization: Mapped[Organization] = relationship(back_populates="subscriptions")

    def __repr__(self) -> str:
        return f"<Subscription org={self.org_id} plan={self.plan} status={self.status}>"
