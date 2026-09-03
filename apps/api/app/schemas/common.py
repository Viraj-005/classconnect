"""Pydantic schemas.

Kept separate from the ORM models so the API contract stays stable even
if the database shape changes (ARCHITECTURE.md section 5). Field names
are camelCase on the wire to match the frontend, snake_case in Python.

Critically: no request schema in this file, or anywhere else, accepts an
org_id. Tenancy comes from the session. If you find yourself wanting to
add one, that is the bug.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from pydantic.alias_generators import to_camel

PackageTier = Literal["free", "starter", "growth", "pro"]
Role = Literal["super_admin", "admin", "teacher", "student", "parent"]
BillingStatus = Literal["active", "past_due", "canceled", "trialing"]
ContentType = Literal["video", "doc", "quiz"]
PaymentStatus = Literal["paid", "unpaid", "pending_review", "overdue"]
EventType = Literal["exam", "meeting", "class"]


class Schema(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ----------------------------------------------------------------------
# Auth
# ----------------------------------------------------------------------


class LoginRequest(Schema):
    email: EmailStr
    password: str
    # The tenant the user intends to sign in to, by slug. Needed because
    # the same email may exist at two tenants. This selects a candidate
    # account, it does not grant access to that tenant on its own.
    org_slug: str


class TokenPair(Schema):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class ProfileUpdate(Schema):
    """The parts of your own account you may change here.

    Email is absent on purpose. Changing a sign in identity needs a
    verification round trip that does not exist yet, and silently
    accepting a new address would lock people out of their own account.
    """

    name: str = Field(min_length=1, max_length=160)


class PasswordChange(Schema):
    current_password: str
    # Length only. A complexity rule pushes people toward "Passw0rd!"
    # and a long passphrase is the thing actually worth encouraging.
    new_password: str = Field(min_length=8, max_length=200)


class SignupRequest(Schema):
    """Self serve tenant onboarding.

    Note what is absent: package_tier and org_id. The tier is forced to
    free on the server, because a request that could name its own tier
    would let anybody provision themselves onto Pro for nothing. The
    org_id does not exist yet, it is minted here.
    """

    org_name: str = Field(min_length=2, max_length=160)
    admin_name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class SignupResult(Schema):
    org_slug: str
    org_name: str
    tokens: "TokenPair"


class TwoFactorSetupOut(Schema):
    """What the enrolment screen needs to draw a QR code.

    The secret is returned in the clear exactly once, here, because the
    person has to be able to type it into an app that cannot scan. It is
    not active until a code from it is verified.
    """

    secret: str
    otpauth_uri: str
    # A real, scannable QR of the URI above, rendered server side.
    qr_svg: str


class TwoFactorEnable(Schema):
    code: str = Field(min_length=6, max_length=10)


class TwoFactorDisable(Schema):
    # The password again, not just a valid session. Turning off a second
    # factor from a machine somebody walked away from is exactly the
    # attack the second factor was there to stop.
    password: str


class TwoFactorVerify(Schema):
    challenge_token: str
    # Either a six digit code from the app, or one recovery code. One of
    # the two must be present; the router enforces that rather than the
    # schema so the error reads as a sentence.
    code: str | None = None
    recovery_code: str | None = None


class RecoveryCodesOut(Schema):
    codes: list[str]


class LoginResult(Schema):
    """Either a session, or a demand for the second factor.

    One endpoint returns both shapes because the client cannot know
    which it will get until the password has been checked, and asking
    "does this account use 2FA" before authenticating would tell an
    attacker which accounts are worth attacking.
    """

    two_factor_required: bool = False
    challenge_token: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None
    expires_in: int | None = None
    token_type: str = "bearer"


class SessionUserOut(Schema):
    user_id: str
    org_id: str
    role: Role
    name: str
    email: EmailStr
    two_factor_enabled: bool = False


class BrandingOut(Schema):
    logo_url: str | None = None
    # Changes whenever the logo is replaced. The client keys its in
    # memory blob cache on this, so a new upload is a new cache entry
    # rather than something that has to be evicted by hand.
    logo_version: str | None = None
    logo_text: str
    primary_color: str | None = None
    secondary_color: str | None = None
    custom_domain: str | None = None


class SeatsOut(Schema):
    students: int
    teachers: int


class OrganizationOut(Schema):
    org_id: str
    name: str
    slug: str
    package_tier: PackageTier
    billing_status: BillingStatus
    branding: BrandingOut
    seats: SeatsOut
    grace_days_left: int | None = None
    created_at: datetime


class SessionOut(Schema):
    """What the frontend bootstraps from on load."""

    user: SessionUserOut
    org: OrganizationOut
    # Resolved server side so the client never computes entitlements.
    features: list[str]
    # Page key to reachable. Drives the nav and the route guards. The
    # server re-checks on every guarded route regardless.
    page_access: dict[str, bool] = {}


# ----------------------------------------------------------------------
# Content
# ----------------------------------------------------------------------


class ContentCreate(Schema):
    type: ContentType
    title: str = Field(min_length=1, max_length=255)
    subject: str | None = Field(default=None, max_length=120)
    duration_mins: int | None = None


class ContentOut(Schema):
    content_id: str
    type: ContentType
    title: str
    subject: str | None
    uploader_name: str | None = None
    duration_mins: int | None = None
    size_label: str | None = None
    views: int = 0
    reach_pct: int = 0
    created_at: datetime


# ----------------------------------------------------------------------
# Students and payments
# ----------------------------------------------------------------------


class StudentCreate(Schema):
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    batch: str | None = None
    group: str | None = None
    parent_email: EmailStr | None = None


class StudentOut(Schema):
    student_id: str
    name: str
    email: EmailStr
    batch: str | None
    group: str | None
    payment_status: PaymentStatus
    attendance_pct: int = 0
    avg_score: int = 0
    ticket_expiry: datetime | None = None
    last_active: datetime | None = None


class PaymentCreate(Schema):
    student_id: str
    amount: float = Field(gt=0)
    currency: str = Field(default="LKR", min_length=3, max_length=3)
    method: Literal["stripe", "paypal", "slip", "cash"]


class PaymentOut(Schema):
    payment_id: str
    student_id: str
    student_name: str | None = None
    amount: float
    currency: str
    status: PaymentStatus
    method: str
    expiry_date: datetime | None
    created_at: datetime


# ----------------------------------------------------------------------
# QR tickets
# ----------------------------------------------------------------------


class TicketOut(Schema):
    ticket_id: str
    student_id: str
    payload: str
    expiry_date: datetime
    scan_count: int = 0


class TicketScanRequest(Schema):
    """Note the absence of an org_id field.

    The scanning organisation is taken from the session. Accepting it
    here would let a caller declare which tenant they are validating
    against, which is exactly the check the scan is meant to perform.
    """

    payload: str


class TicketScanResult(Schema):
    status: Literal["valid", "malformed", "expired", "foreign_tenant", "revoked"]
    detail: str
    student_name: str | None = None
    student_id: str | None = None


# ----------------------------------------------------------------------
# Events
# ----------------------------------------------------------------------


class EventCreate(Schema):
    title: str = Field(min_length=1, max_length=255)
    type: EventType
    scheduled_at: datetime
    duration_mins: int = 60
    batch: str | None = None
    notify: bool = True


class EventOut(Schema):
    event_id: str
    title: str
    type: EventType
    scheduled_at: datetime
    duration_mins: int
    batch: str | None
    created_by_name: str | None = None
    attendees: int = 0


# ----------------------------------------------------------------------
# Organisation settings
# ----------------------------------------------------------------------


class BrandingUpdate(Schema):
    logo_text: str | None = Field(default=None, max_length=60)
    primary_color: str | None = Field(default=None, pattern=r"^#?[0-9a-fA-F]{3,6}$")
    secondary_color: str | None = Field(default=None, pattern=r"^#?[0-9a-fA-F]{3,6}$")
    custom_domain: str | None = Field(default=None, max_length=255)


# ----------------------------------------------------------------------
# Platform, Super Admin only
# ----------------------------------------------------------------------


class TenantOut(Schema):
    # Whether the tenant has uploaded a logo, so the platform screens
    # can show it instead of initials without a second request each.
    org_id: str
    name: str
    slug: str
    package_tier: PackageTier
    billing_status: BillingStatus
    students: int
    teachers: int
    mrr: float
    created_at: datetime
    has_logo: bool = False
    # Changes when the tenant replaces their logo, so the client can key
    # its in memory cache on it instead of holding a stale image.
    logo_version: str | None = None



class TenantCreate(Schema):
    name: str = Field(min_length=1, max_length=160)
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9-]+$")
    package_tier: PackageTier = "starter"
    admin_name: str
    admin_email: EmailStr


class TierChange(Schema):
    package_tier: PackageTier
    reason: str | None = None


class AuditOut(Schema):
    id: str
    actor_label: str
    action: str
    target: str | None
    severity: Literal["info", "warning", "critical"]
    cross_tenant: bool
    created_at: datetime
