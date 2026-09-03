"""QR class ticket issue and validation.

Two properties matter more than anything else here:

  1. The payload is signed. A ticket is a bearer credential for physical
     class entry, so an unsigned JSON blob could be hand written by any
     student with a QR generator. Signing happens server side only.
  2. Validation checks the ticket's org against the SCANNING context.
     A ticket from another tenant is not merely invalid, it is a cross
     tenant access attempt and is logged as one (BRD section 7.3).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json

from app.core.config import settings

TICKET_VERSION = 1


@dataclass(frozen=True)
class TicketPayload:
    student_name: str
    student_id: str
    org_id: str
    batch: str
    group: str
    expiry_date: str  # ISO 8601

    def to_dict(self) -> dict[str, str]:
        # Field order is fixed so the signed bytes are reproducible.
        return {
            "v": str(TICKET_VERSION),
            "student_name": self.student_name,
            "student_id": self.student_id,
            "org_id": self.org_id,
            "batch": self.batch,
            "group": self.group,
            "expiry_date": self.expiry_date,
        }


class ValidationResult:
    """Outcome of a scan.

    The three failure modes are kept distinct rather than collapsed into
    a single invalid, because the UI presents them differently and
    because only one of them is a security event.
    """

    VALID = "valid"
    MALFORMED = "malformed"
    EXPIRED = "expired"
    FOREIGN_TENANT = "foreign_tenant"
    REVOKED = "revoked"

    def __init__(self, status: str, detail: str, payload: TicketPayload | None = None):
        self.status = status
        self.detail = detail
        self.payload = payload

    @property
    def ok(self) -> bool:
        return self.status == self.VALID

    @property
    def is_security_event(self) -> bool:
        return self.status == self.FOREIGN_TENANT


def _sign(payload: dict[str, str]) -> str:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    return hmac.new(
        settings.QR_SIGNING_SECRET.encode(), body, hashlib.sha256
    ).hexdigest()


def issue_ticket(
    *,
    student_name: str,
    student_id: str,
    org_id: str,
    batch: str | None,
    group: str | None,
    valid_days: int | None = None,
) -> tuple[str, str, datetime]:
    """Build a signed ticket.

    Returns (encoded_payload, signature, expiry). The encoded payload is
    what goes into the QR image; the signature is stored so a ticket can
    be revoked without needing the original code.
    """
    days = valid_days or settings.QR_TICKET_VALID_DAYS
    expiry = datetime.now(timezone.utc) + timedelta(days=days)

    payload = TicketPayload(
        student_name=student_name,
        student_id=student_id,
        org_id=org_id,
        batch=batch or "",
        group=group or "",
        expiry_date=expiry.isoformat(),
    )
    body = payload.to_dict()
    signature = _sign(body)
    encoded = json.dumps({**body, "sig": signature}, separators=(",", ":"))
    return encoded, signature, expiry


def validate_ticket(raw: str, *, scanning_org_id: str) -> ValidationResult:
    """Validate a scanned ticket against the scanning organisation.

    scanning_org_id comes from the scanning user's session, never from
    the scanned payload. Trusting the payload's own org_id would make
    the tenant check meaningless.
    """
    # 1. Structure.
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return ValidationResult(ValidationResult.MALFORMED, "Not a ClassConnect ticket.")

    signature = data.pop("sig", None)
    required = {"student_id", "org_id", "batch", "expiry_date"}
    if not required.issubset(data.keys()) or not signature:
        return ValidationResult(
            ValidationResult.MALFORMED, "Ticket is missing required fields."
        )

    # 2. Signature, before anything else is trusted. compare_digest is
    #    used rather than == to avoid leaking timing information.
    if not hmac.compare_digest(signature, _sign(data)):
        return ValidationResult(
            ValidationResult.MALFORMED, "Ticket signature does not verify."
        )

    payload = TicketPayload(
        student_name=data.get("student_name", ""),
        student_id=data["student_id"],
        org_id=data["org_id"],
        batch=data.get("batch", ""),
        group=data.get("group", ""),
        expiry_date=data["expiry_date"],
    )

    # 3. Tenant match. Checked before expiry so that a foreign ticket is
    #    reported as a cross tenant attempt rather than merely expired.
    if payload.org_id != scanning_org_id:
        return ValidationResult(
            ValidationResult.FOREIGN_TENANT,
            "This ticket belongs to a different organisation.",
            payload,
        )

    # 4. Expiry.
    try:
        expiry = datetime.fromisoformat(payload.expiry_date)
    except ValueError:
        return ValidationResult(ValidationResult.MALFORMED, "Unreadable expiry date.")
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expiry:
        return ValidationResult(
            ValidationResult.EXPIRED, "This ticket has expired.", payload
        )

    return ValidationResult(ValidationResult.VALID, "Access granted.", payload)
