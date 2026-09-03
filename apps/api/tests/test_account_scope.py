"""The self service account endpoints, and the scope they must keep.

`PATCH /auth/me` and `POST /auth/change-password` are the only routes in
the product that let somebody change a user record without holding an
admin role. That is safe for exactly one reason: they can only ever act
on the caller. There is no user_id in either signature and no org_id in
either schema, so the routes cannot be pointed at a second person.

These tests assert that shape directly rather than through HTTP, in the
same spirit as the rest of the suite. A future edit that adds a
"convenient" user_id parameter fails here, at the point the mistake is
made, rather than in a penetration test later.

Run with: pytest apps/api/tests -v
"""

import inspect

import pytest
from pydantic import ValidationError

from app.core.security import BCRYPT_MAX_BYTES, hash_password, verify_password
from app.routers.auth import change_password, update_profile
from app.schemas.common import PasswordChange, ProfileUpdate

# Anything in here would let one request name a different victim.
FORBIDDEN_TARGET_FIELDS = {
    "org_id",
    "orgId",
    "user_id",
    "userId",
    "email",
    "role",
    "password_hash",
    "is_active",
}


# ----------------------------------------------------------------------
# Scope: these routes act on the caller and nobody else
# ----------------------------------------------------------------------


@pytest.mark.parametrize("schema", [ProfileUpdate, PasswordChange])
def test_schema_cannot_name_another_user(schema):
    """No request field may identify a user or a tenant."""
    declared = set(schema.model_fields)
    assert not (declared & FORBIDDEN_TARGET_FIELDS), (
        f"{schema.__name__} accepts a field that names somebody else: "
        f"{sorted(declared & FORBIDDEN_TARGET_FIELDS)}"
    )


@pytest.mark.parametrize("handler", [update_profile, change_password])
def test_handler_takes_no_target_parameter(handler):
    """No path or query parameter may select which account to change.

    The caller comes from CurrentUser, which is resolved from the token.
    A user_id parameter here would turn a self service route into an
    administrative one without any of the guards that go with that.
    """
    params = set(inspect.signature(handler).parameters)
    assert not (params & FORBIDDEN_TARGET_FIELDS), (
        f"{handler.__name__} takes a parameter naming another account: "
        f"{sorted(params & FORBIDDEN_TARGET_FIELDS)}"
    )
    assert "user" in params, f"{handler.__name__} must resolve the caller from the session"


def test_extra_fields_in_the_body_are_discarded():
    """Sending org_id or role alongside a valid body must change nothing.

    Pydantic drops unknown keys rather than raising, so the request
    succeeds. What matters is that the value never reaches the model.
    """
    body = ProfileUpdate.model_validate(
        {"name": "Amaya Perera", "orgId": "org-somebody-else", "role": "admin"}
    )
    assert body.name == "Amaya Perera"
    assert not hasattr(body, "org_id")
    assert not hasattr(body, "role")


# ----------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------


def test_profile_name_cannot_be_blank():
    with pytest.raises(ValidationError):
        ProfileUpdate.model_validate({"name": ""})


def test_profile_name_is_length_capped():
    """Matches the column, so a long name fails validation not the insert."""
    with pytest.raises(ValidationError):
        ProfileUpdate.model_validate({"name": "x" * 161})


def test_profile_accepts_the_camel_case_wire_name():
    """The frontend sends camelCase. Both spellings must parse."""
    assert ProfileUpdate.model_validate({"name": "Dinesh"}).name == "Dinesh"


def test_password_change_requires_both_halves():
    with pytest.raises(ValidationError):
        PasswordChange.model_validate({"newPassword": "longenough1"})
    with pytest.raises(ValidationError):
        PasswordChange.model_validate({"currentPassword": "demo1234"})


def test_new_password_has_a_floor_but_no_composition_rule():
    """Eight characters, and nothing about symbols.

    A complexity rule pushes people toward "Passw0rd!" and away from the
    long passphrase that is actually worth encouraging.
    """
    with pytest.raises(ValidationError):
        PasswordChange.model_validate({"currentPassword": "demo1234", "newPassword": "short7c"})

    ok = PasswordChange.model_validate(
        {"currentPassword": "demo1234", "newPassword": "correct horse battery staple"}
    )
    assert ok.new_password == "correct horse battery staple"


def test_password_change_uses_the_camel_case_wire_names():
    body = PasswordChange.model_validate(
        {"currentPassword": "demo1234", "newPassword": "brandnew123"}
    )
    assert body.current_password == "demo1234"
    assert body.new_password == "brandnew123"


# ----------------------------------------------------------------------
# The hashing the endpoint relies on
# ----------------------------------------------------------------------


def test_changing_a_password_invalidates_the_old_one():
    """The property the endpoint depends on, asserted once here."""
    old_hash = hash_password("demo1234")
    assert verify_password("demo1234", old_hash)

    new_hash = hash_password("brandnew123")
    assert verify_password("brandnew123", new_hash)
    assert not verify_password("demo1234", new_hash)
    # Salted, so the same password twice must not produce the same hash.
    assert hash_password("demo1234") != old_hash


def test_a_long_passphrase_registers_rather_than_failing():
    """The new password field allows 200 characters, bcrypt reads 72.

    Truncating rather than rejecting is the deliberate choice in
    security.py: a long passphrase is good practice and should not fail
    to register. The consequence, asserted here so it is not a surprise,
    is that everything past the 72nd byte is not part of the check.
    """
    long_one = "a very long passphrase " * 10
    assert len(long_one.encode("utf-8")) > BCRYPT_MAX_BYTES

    stored = hash_password(long_one)
    assert verify_password(long_one, stored)

    # Same first 72 bytes, different tail. bcrypt cannot tell them apart.
    assert verify_password(long_one + " and then some more", stored)

    # A difference inside the first 72 bytes is caught as normal.
    assert not verify_password("A very long passphrase " + long_one[23:], stored)
