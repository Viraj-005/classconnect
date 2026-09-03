"""Time based one time passwords, RFC 6238.

Written out rather than pulled in, for the same reason bcrypt is used
directly instead of through passlib: the algorithm is thirty lines, the
specification has published test vectors, and a dependency that wraps it
is a dependency that can break the login path when it stops being
maintained.

The whole module is pure. It takes a secret and a timestamp and returns
a string, so the rules can be tested against the RFC vectors without a
database, a request, or a clock that has to be frozen.

Two properties that matter more than the maths:

  1. Verification accepts a window of one step either side. Phone clocks
     drift, and a person typing a code at the boundary of a thirty
     second window would otherwise fail for no reason they can see.
  2. Comparison is constant time. A byte by byte comparison that returns
     early leaks how much of the code was right, which turns a one in a
     million guess into six guesses of one in ten.
"""

import base64
import binascii
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

# Six digits over thirty seconds, which is what every authenticator app
# assumes when a QR code does not say otherwise.
DIGITS = 6
PERIOD = 30

# One step either side of now. Three windows total, so a code is usable
# for at most ninety seconds. Wider than this starts to matter: a code
# read over someone's shoulder stays valid for longer.
DEFAULT_SKEW = 1

# 160 bits, the SHA1 block size, which is what RFC 4226 recommends and
# what authenticator apps expect.
SECRET_BYTES = 20


def new_secret() -> str:
    """A fresh base32 secret, unpadded, as authenticator apps expect."""
    return base64.b32encode(secrets.token_bytes(SECRET_BYTES)).decode("ascii").rstrip("=")


def _decode(secret: str) -> bytes:
    """Base32 decode, tolerating missing padding and lower case.

    People retype these by hand off a screen. Rejecting a secret because
    it lost its padding in transit would be a bad way to fail.
    """
    clean = secret.strip().replace(" ", "").upper()
    pad = (-len(clean)) % 8
    return base64.b32decode(clean + "=" * pad)


def hotp(secret: str, counter: int, digits: int = DIGITS) -> str:
    """RFC 4226 counter based one time password."""
    mac = hmac.new(_decode(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    # Dynamic truncation: the low nibble of the last byte picks where to
    # read four bytes from, so the code depends on the whole digest.
    offset = mac[-1] & 0x0F
    code = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10**digits)).zfill(digits)


def totp(secret: str, at: float | None = None, digits: int = DIGITS) -> str:
    """RFC 6238 time based one time password."""
    now = time.time() if at is None else at
    return hotp(secret, int(now // PERIOD), digits)


def verify(secret: str, code: str, at: float | None = None, skew: int = DEFAULT_SKEW) -> bool:
    """Whether `code` is valid for `secret` right now.

    Returns False rather than raising on a malformed secret or code. The
    login path calls this on user supplied input, and an exception there
    would be a 500 where a 401 belongs.
    """
    if not secret or not code:
        return False
    clean = code.strip().replace(" ", "").replace("-", "")
    if not clean.isdigit() or len(clean) != DIGITS:
        return False

    now = time.time() if at is None else at
    counter = int(now // PERIOD)
    try:
        # Every candidate is computed and compared, and the loop does not
        # break early on a match, so the time taken does not reveal which
        # window matched or whether any did.
        matched = False
        for step in range(-skew, skew + 1):
            candidate = hotp(secret, counter + step)
            matched |= hmac.compare_digest(candidate, clean)
        return matched
    except (binascii.Error, ValueError, TypeError):
        # A secret that will not decode is a corrupt row, not a wrong code.
        return False


def provisioning_uri(secret: str, account: str, issuer: str) -> str:
    """The otpauth:// URI an authenticator app reads from a QR code.

    The issuer appears twice on purpose. It goes in the label prefix for
    older apps that only parse the label, and in the query parameter for
    everything current. Apps that read both show one entry, not two.
    """
    label = quote(f"{issuer}:{account}", safe="")
    return (
        f"otpauth://totp/{label}"
        f"?secret={secret}"
        f"&issuer={quote(issuer, safe='')}"
        f"&algorithm=SHA1&digits={DIGITS}&period={PERIOD}"
    )


# ----------------------------------------------------------------------
# Recovery codes
# ----------------------------------------------------------------------

# Ten codes, which is enough that losing a couple is not a crisis and
# few enough that they fit on one printed line each.
RECOVERY_CODE_COUNT = 10
_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no l, i, o, 0, 1


def new_recovery_code() -> str:
    """A single use code, in two groups of five.

    The alphabet drops the characters people confuse when reading a code
    off paper. Someone who has lost their phone is already having a bad
    day without l versus 1.
    """
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(10))
    return f"{raw[:5]}-{raw[5:]}"


def normalise_recovery_code(code: str) -> str:
    return code.strip().lower().replace(" ", "").replace("-", "")


def hash_recovery_code(code: str) -> str:
    """Store a recovery code as a SHA-256 hex digest.

    Not bcrypt, deliberately, and the reasoning is the opposite of the
    one that applies to passwords. A password is short, human chosen and
    guessable, so it needs a slow hash to make guessing expensive. A
    recovery code here is ten characters drawn uniformly from a thirty
    one character alphabet, which is roughly fifty bits: brute forcing it
    is infeasible whatever the hash costs.

    Speed is the point. Verifying means comparing against up to ten
    stored codes, and doing that with bcrypt at twelve rounds would add
    over a second to a login by somebody who has already lost their
    phone.
    """
    return hashlib.sha256(normalise_recovery_code(code).encode("utf-8")).hexdigest()


def issue_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> tuple[list[str], list[str]]:
    """A fresh set of codes: the plaintext to show once, and the hashes.

    The plaintext is returned exactly once, at generation, and never
    stored. If the person loses it they regenerate, which invalidates the
    old set. That is the only safe shape: a recovery code the server can
    still read is a password reset waiting to be stolen.
    """
    codes = [new_recovery_code() for _ in range(count)]
    return codes, [hash_recovery_code(c) for c in codes]


def consume_recovery_code(code: str, hashes: list[str]) -> list[str] | None:
    """Spend a recovery code, returning the remaining hashes.

    Returns None when the code does not match, so a caller cannot
    mistake "no codes left" for "code accepted". Every stored hash is
    compared even after a match, so the time taken does not reveal the
    position of the code that worked.
    """
    target = hash_recovery_code(code)
    found = False
    remaining: list[str] = []
    for stored in hashes:
        if hmac.compare_digest(stored, target) and not found:
            found = True
            continue
        remaining.append(stored)
    return remaining if found else None


def qr_svg(uri: str) -> str:
    """A real, scannable QR code for the enrolment URI, as inline SVG.

    Rendered on the server because the frontend's QrCode component is
    decorative: it hashes the payload into a pattern that looks like a
    QR code and is not one. That is survivable for a class ticket, which
    is validated by pasting the payload, but it would be a broken
    feature here. Somebody enrolling in 2FA scans this exactly once, and
    if it carries nothing they cannot enrol at all.

    SVG rather than a PNG data URI so it stays sharp when printed and
    when the browser is zoomed, and so it costs a few kilobytes of text
    rather than an image.

    Error correction M, the usual choice for a screen: it tolerates
    about fifteen percent damage, which covers a camera at an angle
    without inflating the code to the point where the modules get too
    small to read.
    """
    from io import BytesIO

    import qrcode
    import qrcode.image.svg

    img = qrcode.make(
        uri,
        image_factory=qrcode.image.svg.SvgPathImage,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    buf = BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode("utf-8")
    # Drop the XML declaration so the string can be dropped straight
    # into a page rather than only served as its own document.
    return svg.split("?>", 1)[-1].strip()
