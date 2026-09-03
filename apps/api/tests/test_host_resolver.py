"""Mapping a hostname to an organisation.

The rules here decide which login page a visitor sees, so a mistake
shows a school somebody else's branding, or shows the whole customer
list where it should show one name.

What the hostname must never do is decide whose data an authenticated
request can read. That still comes from the session. The Host header is
written by the client, so anyone can claim to be any tenant, and the
worst that may achieve is being shown that tenant's login form.

Run with: pytest apps/api/tests -v
"""

import pytest

from app.services.host_resolver import (
    Resolution,
    normalise_host,
    resolve_host,
)

DOMAIN = "classconnect.app"
CONSOLE = "console.looplab.io"


def r(host, **kw):
    kw.setdefault("app_domain", DOMAIN)
    kw.setdefault("platform_host", CONSOLE)
    return resolve_host(host, **kw)


# ----------------------------------------------------------------------
# Normalising what arrives in the header
# ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Horizon.ClassConnect.App", "horizon.classconnect.app"),
        ("  horizon.classconnect.app  ", "horizon.classconnect.app"),
        # A trailing dot is a legal fully qualified name and would
        # otherwise fail every comparison.
        ("horizon.classconnect.app.", "horizon.classconnect.app"),
        ("horizon.classconnect.app:8000", "horizon.classconnect.app"),
        ("localhost:5173", "localhost"),
        ("[::1]:8000", "::1"),
        ("[::1]", "::1"),
        (None, ""),
        ("", ""),
    ],
)
def test_hosts_are_normalised(raw, expected):
    assert normalise_host(raw) == expected


def test_an_ipv6_literal_is_not_split_on_its_own_colons():
    """Stripping "the bit after the colon" would mangle every IPv6 address."""
    assert normalise_host("fe80::1") == "fe80::1"


# ----------------------------------------------------------------------
# Tenants
# ----------------------------------------------------------------------


def test_a_subdomain_names_a_tenant():
    assert r("horizon.classconnect.app") == Resolution("tenant", "horizon")


def test_a_custom_domain_wins_over_everything():
    """The most specific claim, and the one a Pro tenant paid for."""
    got = r("learn.northfield.edu", custom_domains={"learn.northfield.edu": "northfield"})
    assert got == Resolution("tenant", "northfield")


def test_a_custom_domain_is_matched_case_insensitively():
    got = r("Learn.Northfield.EDU", custom_domains={"learn.northfield.edu": "northfield"})
    assert got.slug == "northfield"


def test_a_nested_subdomain_is_not_a_tenant():
    """`a.b.classconnect.app` must not resolve to a tenant called "a.b".

    Anyone holding a wildcard certificate for the domain could otherwise
    invent nested names, and a slug with a dot in it is not a slug the
    onboarding service can ever mint.
    """
    assert not r("a.b.classconnect.app").bound


@pytest.mark.parametrize("label", ["www", "api", "app", "admin", "console", "static", "cdn"])
def test_infrastructure_subdomains_are_not_tenants(label):
    assert not r(f"{label}.{DOMAIN}").bound


def test_the_bare_app_domain_is_not_a_tenant():
    assert not r(DOMAIN).bound


def test_an_unrelated_domain_is_unbound():
    assert not r("example.com").bound


def test_a_domain_that_merely_ends_in_the_app_domain_is_not_a_tenant():
    """`evilclassconnect.app` must not be read as a subdomain.

    Suffix matching without the dot is the classic version of this bug,
    and it hands an attacker a hostname that looks like yours.
    """
    assert not r("evilclassconnect.app").bound
    assert not r("notclassconnect.app").bound


# ----------------------------------------------------------------------
# The platform console
# ----------------------------------------------------------------------


def test_the_console_host_resolves_to_the_platform():
    assert r(CONSOLE) == Resolution("platform")


def test_the_console_is_not_reachable_as_a_tenant_subdomain():
    """`console.classconnect.app` is infrastructure, not LoopLab's console."""
    assert not r("console.classconnect.app").bound


def test_a_tenant_cannot_claim_the_console_host_by_custom_domain():
    """A custom domain is checked first, so this is worth stating.

    In practice the platform host is not one an admin can set on
    themselves, but the ordering means the check belongs here rather
    than in a comment.
    """
    got = r(CONSOLE, custom_domains={CONSOLE: "horizon"})
    assert got == Resolution("tenant", "horizon"), (
        "custom domains do win, so the platform host must never be settable "
        "as one: validate it on the way in"
    )


# ----------------------------------------------------------------------
# Development
# ----------------------------------------------------------------------


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "::1", "localhost:5173", "[::1]:8000"])
def test_development_hosts_are_unbound(host):
    """Unbound means the picker and the demo shortcuts still work."""
    assert not r(host).bound


def test_everything_is_unbound_when_no_domain_is_configured():
    """The development default: no APP_DOMAIN, no PLATFORM_HOST.

    Without this a fresh checkout with no settings would try to read a
    tenant out of whatever hostname it was reached by.
    """
    assert not resolve_host("horizon.classconnect.app").bound
    assert not resolve_host("anything.example.com").bound
