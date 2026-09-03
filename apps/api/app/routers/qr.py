"""QR class tickets. Growth and Pro only.

The whole router is gated, so an endpoint added here later cannot
forget the tier check.
"""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.timeutil import as_utc, is_past
from app.middleware.tenant import CurrentOrg, CurrentUser, require_role
from app.models import AuditEntry, ClassTicket, Student, User
from app.schemas.common import TicketOut, TicketScanRequest, TicketScanResult
from app.services.feature_gate_service import require_feature
from app.services.qr_service import (
    TicketPayload,
    ValidationResult,
    issue_ticket,
    validate_ticket,
)

router = APIRouter(
    prefix="/tickets",
    tags=["tickets"],
    dependencies=[Depends(require_feature("qr_ticketing"))],
)


@router.get(
    "/current/{student_id}",
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def current_ticket(
    student_id: str,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """The student's live ticket, without minting one.

    This exists because the teacher screen previously called `issue` to
    render a preview. Displaying a credential was therefore silently
    minting a new one and revoking the old, so simply opening the page
    invalidated the code a student already had on their phone, and two
    such calls racing left two live tickets and crashed the read path.

    Reads must not mutate. Reissuing is a deliberate action and stays a
    POST.
    """
    row = await session.execute(
        select(Student, User)
        .join(User, User.user_id == Student.student_id)
        .where(Student.student_id == student_id, Student.org_id == org.org_id)
    )
    found = row.first()
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    student, user = found

    result = await session.execute(
        select(ClassTicket)
        .where(
            ClassTicket.org_id == org.org_id,
            ClassTicket.student_id == student.student_id,
            ClassTicket.revoked.is_(False),
        )
        .order_by(ClassTicket.created_at.desc())
        .limit(1)
    )
    ticket = result.scalars().first()
    if ticket is None or is_past(ticket.expiry_date):
        return {"active": False, "reason": "No active ticket for this student."}

    import json

    payload = TicketPayload(
        student_name=user.name,
        student_id=student.student_id,
        org_id=org.org_id,
        batch=student.batch or "",
        group=student.group or "",
        expiry_date=as_utc(ticket.expiry_date).isoformat(),
    ).to_dict()

    return {
        "active": True,
        "ticketId": ticket.ticket_id,
        "studentId": student.student_id,
        "payload": json.dumps({**payload, "sig": ticket.signature}, separators=(",", ":")),
        "expiryDate": ticket.expiry_date,
        "scanCount": ticket.scan_count,
        "batch": student.batch,
        "group": student.group,
    }


@router.post(
    "/issue/{student_id}",
    response_model=TicketOut,
    dependencies=[Depends(require_role("teacher", "admin"))],
)
async def issue(
    student_id: str,
    org: CurrentOrg,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TicketOut:
    """Issue a ticket for a student in the caller's organisation.

    student_id comes from the path, but it is only ever used together
    with the session's org_id in the WHERE clause. Guessing another
    tenant's student id therefore returns 404, not their data.
    """
    result = await session.execute(
        select(Student, User)
        .join(User, User.user_id == Student.student_id)
        .where(Student.student_id == student_id, Student.org_id == org.org_id)
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    student, user = row

    payload, signature, expiry = issue_ticket(
        student_name=user.name,
        student_id=student.student_id,
        org_id=org.org_id,
        batch=student.batch,
        group=student.group,
    )

    # Supersede any live ticket, so a reissue cannot leave two valid
    # codes in circulation for the same student.
    existing = await session.execute(
        select(ClassTicket).where(
            ClassTicket.org_id == org.org_id,
            ClassTicket.student_id == student.student_id,
            ClassTicket.revoked.is_(False),
        )
    )
    for old in existing.scalars():
        old.revoked = True

    ticket = ClassTicket(
        org_id=org.org_id,
        student_id=student.student_id,
        signature=signature,
        expiry_date=expiry,
    )
    session.add(ticket)
    await session.flush()

    return TicketOut(
        ticket_id=ticket.ticket_id,
        student_id=ticket.student_id,
        payload=payload,
        expiry_date=ticket.expiry_date,
        scan_count=0,
    )


@router.post("/scan", response_model=TicketScanResult)
async def scan(
    body: TicketScanRequest,
    org: CurrentOrg,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TicketScanResult:
    """Validate a scanned ticket.

    The scanning organisation is the caller's own, taken from the
    session. The request body carries only the scanned payload, so a
    caller cannot nominate which tenant to validate against.
    """
    result = validate_ticket(body.payload, scanning_org_id=org.org_id)

    # A ticket from another tenant is a security event, not a routine
    # rejection, and is recorded as one (ARCHITECTURE.md section 8).
    if result.is_security_event:
        session.add(
            AuditEntry(
                org_id=org.org_id,
                actor_id=user.user_id,
                actor_label=user.name,
                action="QR ticket rejected, belongs to another organisation",
                target=result.payload.student_id if result.payload else None,
                severity="critical",
                cross_tenant=True,
            )
        )

    if result.ok and result.payload:
        # Newest live ticket. See the note in learner.py: a scan at a
        # classroom door must not 500 because two reissues raced.
        stored = await session.execute(
            select(ClassTicket)
            .where(
                ClassTicket.org_id == org.org_id,
                ClassTicket.student_id == result.payload.student_id,
                ClassTicket.revoked.is_(False),
            )
            .order_by(ClassTicket.created_at.desc())
            .limit(1)
        )
        ticket = stored.scalars().first()
        # A signature that verifies but has no live row means the ticket
        # was revoked or reissued since it was printed.
        if ticket is None:
            return TicketScanResult(
                status=ValidationResult.REVOKED,
                detail="This ticket has been replaced by a newer one.",
                student_name=result.payload.student_name,
                student_id=result.payload.student_id,
            )
        ticket.scan_count += 1
        session.add(
            AuditEntry(
                org_id=org.org_id,
                actor_id=user.user_id,
                actor_label=user.name,
                action="Class entry granted",
                target=result.payload.student_name,
                severity="info",
            )
        )

    return TicketScanResult(
        status=result.status,
        detail=result.detail,
        student_name=result.payload.student_name if result.payload else None,
        student_id=result.payload.student_id if result.payload else None,
    )
