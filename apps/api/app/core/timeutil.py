"""Timezone normalisation for values read back from the database.

Every datetime column in this schema is declared `DateTime(timezone=True)`,
which on Postgres round trips as timezone aware. SQLite has no timezone
type, so the same column comes back **naive**, and comparing a naive
value against `datetime.now(timezone.utc)` raises:

    TypeError: can't compare offset-naive and offset-aware datetimes

That divergence is nasty because it is invisible in the model, invisible
in the tests that use fresh objects, and only fires on a row that has
been through a round trip. It took down the whole past due tenant: login
worked, then the session endpoint raised and the client showed a generic
"cannot reach the API".

So any datetime that came from the database goes through `as_utc()`
before it is compared to or subtracted from `now()`. Naive values are
assumed UTC, which is correct here because everything is written as UTC.
"""

from datetime import datetime, timezone


def as_utc(value: datetime | None) -> datetime | None:
    """Return an aware UTC datetime, or None.

    A naive input is assumed to already be UTC and is labelled as such
    rather than converted, because that is what the write path stores.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def is_past(value: datetime | None, *, default: bool = False) -> bool:
    """Whether a stored timestamp is in the past. None gives `default`."""
    aware = as_utc(value)
    if aware is None:
        return default
    return aware < utc_now()


def days_until(value: datetime | None) -> int | None:
    """Whole days from now until a stored timestamp, floored at zero."""
    aware = as_utc(value)
    if aware is None:
        return None
    return max(0, (aware - utc_now()).days)


def as_date(value):
    """A plain date, whatever the driver handed back.

    `func.date(...)` returns a `datetime.date` on Postgres and a string
    on SQLite, and grouping a series by day breaks silently on one of
    them if the caller assumes either. Datetimes are normalised to UTC
    first, so a row stored at 23:30 in Colombo does not land on the
    wrong day.
    """
    from datetime import date, datetime

    if value is None:
        return None
    if isinstance(value, datetime):
        return as_utc(value).date()
    if isinstance(value, date):
        return value
    # SQLite's date() gives "YYYY-MM-DD"; take the date part of anything
    # longer, which covers a full timestamp string too.
    return date.fromisoformat(str(value)[:10])
