"""Which organisation a request's hostname belongs to.

A tenant reaches ClassConnect at its own address, either
`<slug>.classconnect.app` or, on Pro, a domain of its own. The login
screen then shows that one school, branded, with no picker, because a
parent at Horizon should never have to find their school in a list of
strangers. Publishing that list also hands anyone who can load the page
a complete customer roster, which is competitive intelligence and a
ready made phishing target list.

**What the hostname decides, and what it must never decide.**

It decides which login form to paint, and nothing else. It does not
grant access to anything, and it never sets the organisation for an
authenticated request: that still comes from the session, resolved in
app/middleware/tenant.py, exactly as before.

The distinction matters because the Host header is written by the
client. Anyone can send `Host: horizon.classconnect.app`, and the worst
that achieves is seeing Horizon's login page, which is also what
visiting Horizon's URL achieves. If the hostname ever started deciding
whose data a request could read, that same header would become a way to
ask for somebody else's, which is the bug this whole architecture is
built to make impossible.

Host still deserves validation at the edge, so that only names you
actually serve reach the app at all. That belongs in the proxy, or in
Starlette's TrustedHostMiddleware, and is about cache poisoning and
absolute URL generation rather than about tenancy.

Pure and framework free, so the matching rules can be tested without a
request, a database, or a running server.
"""

__all__ = ["Resolution", "resolve_host", "normalise_host"]


class Resolution:
    """What a hostname turned out to mean.

    kind is one of:

      "tenant"    a specific organisation, named by `slug`
      "platform"  LoopLab's own console
      "unbound"   no organisation, so fall back to the picker
    """

    __slots__ = ("kind", "slug")

    def __init__(self, kind: str, slug: str | None = None):
        self.kind = kind
        self.slug = slug

    @property
    def bound(self) -> bool:
        return self.kind != "unbound"

    def __eq__(self, other) -> bool:
        return (
            isinstance(other, Resolution)
            and self.kind == other.kind
            and self.slug == other.slug
        )

    def __repr__(self) -> str:
        return f"Resolution(kind={self.kind!r}, slug={self.slug!r})"


UNBOUND = Resolution("unbound")

# Hostnames that mean "this is a development machine, show the picker".
# A bare name with no dot is included because that is what a container or
# a hosts file entry looks like.
DEV_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0", "testserver"})

# Subdomains of the app domain that are not tenants. A tenant cannot
# hold one of these anyway: onboarding_service refuses them as slugs.
NON_TENANT_SUBDOMAINS = frozenset({"www", "api", "app", "admin", "console", "static", "cdn"})


def normalise_host(host: str | None) -> str:
    """Lowercase, no port, no trailing dot, no surrounding whitespace.

    A port is present on every development request and on anything
    behind a proxy that does not rewrite it. An IPv6 literal arrives
    bracketed, and the brackets have to survive so it can still be
    recognised as a literal rather than split on its own colons.
    """
    if not host:
        return ""
    host = host.strip().lower().rstrip(".")
    if host.startswith("["):
        # [::1]:8000 or [::1]
        end = host.find("]")
        if end != -1:
            return host[1:end]
        return host
    # Split off the port, but only when what follows is actually a port.
    # A bare IPv6 literal has several colons and no port at all.
    if host.count(":") == 1:
        name, _, port = host.partition(":")
        if port.isdigit():
            return name
    return host


def resolve_host(
    host: str | None,
    app_domain: str = "",
    platform_host: str = "",
    custom_domains: dict[str, str] | None = None,
) -> Resolution:
    """Map a hostname to an organisation.

    Checked in order of specificity: a custom domain is the most
    specific claim, then the platform's own host, then a subdomain of
    the app domain. Anything else is unbound.

    `custom_domains` maps hostname to slug, and the caller supplies it
    because that lookup is a database read and this module does none.
    """
    name = normalise_host(host)
    if not name:
        return UNBOUND

    if custom_domains:
        slug = custom_domains.get(name)
        if slug:
            return Resolution("tenant", slug)

    platform = normalise_host(platform_host)
    if platform and name == platform:
        return Resolution("platform")

    if name in DEV_HOSTS:
        return UNBOUND

    domain = normalise_host(app_domain)
    if domain and name.endswith("." + domain):
        label = name[: -(len(domain) + 1)]
        # Exactly one label. `a.b.classconnect.app` is not tenant "a.b",
        # and treating it as one would let a wildcard certificate holder
        # invent nested names.
        if label and "." not in label and label not in NON_TENANT_SUBDOMAINS:
            return Resolution("tenant", label)

    return UNBOUND
