"""Password hashing and JWT issue/verify.

Tokens carry org_id and role claims (ARCHITECTURE.md section 8). Those
claims are the only accepted source of tenant identity on a request.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import settings

ACCESS = "access"
REFRESH = "refresh"

# Issued when a password is correct but a second factor is still owed.
#
# It is a distinct type, not a short lived access token, because
# decode_token checks the type and every protected route asks for
# ACCESS. That means a challenge token cannot be replayed against the
# API to read data: the only route that accepts it is the one that
# completes the second factor. Getting this wrong would make 2FA
# decorative.
CHALLENGE = "challenge"

# bcrypt hashes at most 72 bytes and raises on anything longer. passlib
# used to paper over this, but it has been unmaintained since 2020 and
# its backend probe is broken against bcrypt 4.x, so bcrypt is used
# directly and the limit is handled here explicitly.
#
# Truncating rather than rejecting is deliberate: a long passphrase is
# good practice and should not fail to register. Note that bcrypt
# therefore only considers the first 72 bytes, which is a property of
# the algorithm rather than of this code.
BCRYPT_MAX_BYTES = 72

_ROUNDS = 12


def _prepare(plain: str) -> bytes:
    return plain.encode("utf-8")[:BCRYPT_MAX_BYTES]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_prepare(plain), bcrypt.gensalt(rounds=_ROUNDS)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Constant time check that never raises on a malformed stored hash.

    A corrupt or placeholder hash must return False rather than throw,
    because the login path deliberately verifies against a dummy hash
    when no user was found in order to keep response timing flat.
    """
    try:
        return bcrypt.checkpw(_prepare(plain), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _encode(payload: dict[str, Any], expires: timedelta, token_type: str) -> str:
    now = datetime.now(timezone.utc)
    body = {
        **payload,
        "iat": now,
        "exp": now + expires,
        "type": token_type,
    }
    return jwt.encode(body, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_access_token(user_id: str, org_id: str, role: str) -> str:
    """org_id is baked into the token deliberately.

    It means a request cannot assert a different tenant than the one the
    session was issued for, without forging a signature.
    """
    return _encode(
        {"sub": user_id, "org_id": org_id, "role": role},
        timedelta(minutes=settings.ACCESS_TOKEN_MINUTES),
        ACCESS,
    )


def create_refresh_token(user_id: str, org_id: str, role: str) -> str:
    return _encode(
        {"sub": user_id, "org_id": org_id, "role": role},
        timedelta(days=settings.REFRESH_TOKEN_DAYS),
        REFRESH,
    )


def decode_token(token: str, expected_type: str = ACCESS) -> dict[str, Any]:
    """Raises jwt exceptions on anything malformed, expired or mistyped."""
    payload = jwt.decode(
        token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
    )
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Unexpected token type")
    return payload


def create_challenge_token(user_id: str, org_id: str) -> str:
    """A short lived token that proves the password step only.

    No role claim, because it grants no access to anything that checks a
    role. Five minutes is enough to open an authenticator app and type
    six digits, and short enough that a token left in a proxy log is not
    a standing invitation.
    """
    return _encode(
        {"sub": user_id, "org_id": org_id},
        timedelta(minutes=5),
        CHALLENGE,
    )
