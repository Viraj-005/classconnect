"""Turning a signup form into a tenant. Pure rules, no database.

Kept framework free like tier_policy so the naming rules can be tested
on their own. The router does the inserts.

The slug matters more than it looks. It is the tenant's identity on the
login screen, it will be the subdomain, and it is effectively permanent
once anyone has bookmarked it, so it has to be derived predictably and
checked against names that would be dangerous to hand out.
"""

import re
import unicodedata

# Slugs nobody may claim by signing up.
#
# Two groups, for two different reasons. The first is the platform
# itself: a tenant that grabbed "looplab" would appear on the public
# organisation picker as the vendor, which is a phishing surface handed
# out for free. The second is the reserved words a subdomain or a route
# would collide with later.
RESERVED_SLUGS = frozenset(
    {
        # The platform, and the obvious near misses.
        "looplab",
        "loop-lab",
        "classconnect",
        "class-connect",
        "platform",
        "official",
        "support",
        "billing",
        "security",
        # Infrastructure names a subdomain would shadow.
        "www",
        "api",
        "app",
        "admin",
        "auth",
        "cdn",
        "static",
        "assets",
        "mail",
        "smtp",
        "ftp",
        "ns",
        "dns",
        "status",
        "docs",
        "help",
        "blog",
        "test",
        "staging",
        "dev",
        "demo",
    }
)

SLUG_MAX = 40
SLUG_MIN = 3


def slugify(name: str) -> str:
    """A URL safe slug from an organisation name.

    Accents are folded rather than dropped, so "Académie" becomes
    "academie" and not "acadmie". Sinhala and Tamil names fold to
    nothing under NFKD, which is why an empty result is handled by the
    caller rather than treated as a bug.
    """
    folded = unicodedata.normalize("NFKD", name)
    ascii_only = folded.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_only).strip("-").lower()
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:SLUG_MAX].strip("-")


def candidate_slugs(name: str, fallback: str = "school"):
    """Slugs to try in order, most preferred first.

    Yields forever. The caller stops at the first one the database does
    not already hold, so this never has to know what is taken.
    """
    base = slugify(name)
    if len(base) < SLUG_MIN:
        # A name that folds away to nothing, or to one or two letters.
        # Better a readable generic than a slug called "a".
        base = f"{base}-{fallback}".strip("-") if base else fallback
    base = base[:SLUG_MAX].strip("-")

    if base not in RESERVED_SLUGS:
        yield base

    n = 2
    while True:
        suffix = f"-{n}"
        candidate = f"{base[: SLUG_MAX - len(suffix)]}{suffix}".strip("-")
        if candidate not in RESERVED_SLUGS:
            yield candidate
        n += 1


def is_reserved(slug: str) -> bool:
    return slug in RESERVED_SLUGS
