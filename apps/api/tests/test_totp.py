"""Two factor authentication: the algorithm and the recovery codes.

TOTP is implemented in app/core/totp.py rather than pulled from a
package, so it owes the published test vectors. RFC 6238 Appendix B is
the whole reason writing it out is defensible: the correctness of the
login path is checkable against a specification rather than against a
maintainer's release schedule.

Run with: pytest apps/api/tests -v
"""

import base64
import time

import pytest

from app.core.totp import (
    DIGITS,
    PERIOD,
    consume_recovery_code,
    hash_recovery_code,
    hotp,
    issue_recovery_codes,
    new_recovery_code,
    new_secret,
    normalise_recovery_code,
    provisioning_uri,
    totp,
    verify,
)

# RFC 6238 Appendix B. The shared secret is the ASCII string
# "12345678901234567890", and these are the SHA1 vectors.
RFC_SECRET = base64.b32encode(b"12345678901234567890").decode("ascii")
RFC_VECTORS = [
    (59, "94287082"),
    (1111111109, "07081804"),
    (1111111111, "14050471"),
    (1234567890, "89005924"),
    (2000000000, "69279037"),
    (20000000000, "65353130"),
]


# ----------------------------------------------------------------------
# The algorithm, against the specification
# ----------------------------------------------------------------------


@pytest.mark.parametrize("at,expected", RFC_VECTORS)
def test_rfc6238_test_vectors(at, expected):
    """Eight digit SHA1 vectors, straight out of the RFC."""
    assert totp(RFC_SECRET, at=at, digits=8) == expected


def test_hotp_matches_rfc4226():
    """RFC 4226 Appendix D, the counter based vectors the above builds on."""
    expected = [
        "755224",
        "287082",
        "359152",
        "969429",
        "338314",
        "254676",
        "287922",
        "162583",
        "399871",
        "520489",
    ]
    for counter, want in enumerate(expected):
        assert hotp(RFC_SECRET, counter) == want


def test_a_code_is_stable_across_its_window():
    """Two reads inside the same period must agree.

    If they did not, a person typing a code would race the clock for no
    reason, and the failure would be intermittent and unreproducible.
    """
    base = 1_700_000_000 - (1_700_000_000 % PERIOD)
    assert totp(RFC_SECRET, at=base) == totp(RFC_SECRET, at=base + PERIOD - 1)
    assert totp(RFC_SECRET, at=base) != totp(RFC_SECRET, at=base + PERIOD)


# ----------------------------------------------------------------------
# Verification
# ----------------------------------------------------------------------


def test_verify_accepts_the_current_code():
    secret = new_secret()
    assert verify(secret, totp(secret))


def test_verify_tolerates_one_step_of_clock_drift():
    """A phone a few seconds out must not be rejected.

    This is the difference between 2FA that people keep switched on and
    2FA that generates support tickets.
    """
    secret = new_secret()
    now = time.time()
    assert verify(secret, totp(secret, at=now - PERIOD), at=now)
    assert verify(secret, totp(secret, at=now + PERIOD), at=now)


def test_verify_rejects_beyond_the_window():
    secret = new_secret()
    now = time.time()
    assert not verify(secret, totp(secret, at=now - PERIOD * 3), at=now)
    assert not verify(secret, totp(secret, at=now + PERIOD * 3), at=now)


def test_verify_tolerates_how_people_type():
    """Spaces and dashes get pasted in from an app. Accept them."""
    secret = new_secret()
    code = totp(secret)
    assert verify(secret, f"{code[:3]} {code[3:]}")
    assert verify(secret, f"{code[:3]}-{code[3:]}")
    assert verify(secret, f"  {code}  ")


@pytest.mark.parametrize("bad", ["", "abcdef", "12345", "1234567", "12 34", None])
def test_verify_returns_false_rather_than_raising(bad):
    """Malformed input is a 401, never a 500.

    This runs on unauthenticated user input at the login step, so an
    exception here would be a crash anybody could trigger.
    """
    assert verify(new_secret(), bad) is False


def test_verify_rejects_a_corrupt_secret_without_raising():
    assert verify("not base32 at all !!", "123456") is False
    assert verify("", "123456") is False


def test_a_secret_only_validates_its_own_codes():
    a, b = new_secret(), new_secret()
    assert not verify(a, totp(b))


# ----------------------------------------------------------------------
# Enrolment payload
# ----------------------------------------------------------------------


def test_new_secret_is_valid_base32_of_the_right_length():
    secret = new_secret()
    assert len(secret) == 32  # 20 bytes, base32, padding stripped
    assert set(secret) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
    assert new_secret() != new_secret()


def test_provisioning_uri_carries_what_an_app_needs():
    uri = provisioning_uri("ABC234", "dinesh@horizon.lk", "ClassConnect (Horizon)")
    assert uri.startswith("otpauth://totp/")
    assert "secret=ABC234" in uri
    assert f"digits={DIGITS}" in uri
    assert f"period={PERIOD}" in uri
    # The @ in the email has to be escaped or it breaks the label.
    assert "dinesh%40horizon.lk" in uri
    assert " " not in uri


# ----------------------------------------------------------------------
# Recovery codes
# ----------------------------------------------------------------------


def test_recovery_codes_are_issued_with_hashes_not_plaintext():
    codes, hashes = issue_recovery_codes()
    assert len(codes) == len(hashes) == 10
    assert len(set(codes)) == 10
    for code, digest in zip(codes, hashes):
        assert code not in digest
        assert len(digest) == 64  # sha256 hex


def test_a_recovery_code_works_once():
    codes, hashes = issue_recovery_codes()
    remaining = consume_recovery_code(codes[4], hashes)
    assert remaining is not None
    assert len(remaining) == 9
    # Replaying the same code against what is left must fail.
    assert consume_recovery_code(codes[4], remaining) is None


def test_consume_returns_none_rather_than_an_empty_list_on_failure():
    """The two outcomes must not be confusable.

    A caller checking truthiness would read the last successful spend,
    which returns an empty list, as a failure. Returning None for
    failure keeps "no codes left" and "wrong code" distinct.
    """
    codes, hashes = issue_recovery_codes(count=1)
    spent = consume_recovery_code(codes[0], hashes)
    assert spent == []
    assert spent is not None
    assert consume_recovery_code("wrong", hashes) is None


def test_recovery_codes_are_read_forgivingly():
    """Somebody is reading these off paper, probably in a hurry."""
    codes, hashes = issue_recovery_codes()
    for variant in (
        codes[0].upper(),
        codes[0].replace("-", ""),
        f"  {codes[0]}  ",
        codes[0].replace("-", " "),
    ):
        assert consume_recovery_code(variant, hashes) is not None


def test_recovery_alphabet_excludes_confusable_characters():
    """No l, i, o, 0 or 1, because these get transcribed by hand."""
    for _ in range(200):
        assert not (set(new_recovery_code()) & set("lio01"))


def test_hashing_is_stable_and_normalised():
    assert hash_recovery_code("ab3de-fgh4j") == hash_recovery_code("AB3DE FGH4J")
    assert normalise_recovery_code(" Ab3-dE ") == "ab3de"
