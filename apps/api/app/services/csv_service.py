"""CSV export. Pure, no framework and no database.

Small, but not trivial, because a CSV that opens in Excel is a document
that can execute. A cell beginning =, +, - or @ is read as a formula, so
a student named `=cmd|'/c calc'!A1` becomes code the moment an
administrator opens the export. That is CSV injection, and it is the one
thing this module exists to get right.

The defence is to prefix any such cell with a single quote, which Excel
and LibreOffice both treat as "this is text". The value is unchanged for
anything that reads the file as data.
"""

import csv
import io

# Characters that make a spreadsheet treat a cell as a formula. The tab
# and carriage return are in the list because they can be used to slip
# past a naive check on the first character alone.
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def neutralise(value) -> str:
    """One cell, safe to open in a spreadsheet.

    Only cells that would be read as a formula are touched. A negative
    number is the awkward case: it legitimately starts with a minus, so
    it is left alone when the whole cell parses as a number and quoted
    when it does not.
    """
    if value is None:
        return ""
    text = str(value)
    if not text.startswith(FORMULA_PREFIXES):
        return text
    try:
        float(text)
    except ValueError:
        return "'" + text
    return text


def write(headers: list[str], rows) -> str:
    """A CSV document as a string.

    CRLF line endings, because that is what RFC 4180 specifies and what
    Excel on Windows expects. QUOTE_MINIMAL is enough: the writer
    already escapes commas, quotes and newlines inside a field.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    writer.writerow(headers)
    for row in rows:
        writer.writerow([neutralise(cell) for cell in row])
    return buffer.getvalue()


def filename(org_slug: str, kind: str, today) -> str:
    """A filename that sorts and says where it came from.

    The tenant slug is in it because an administrator who exports from
    two organisations otherwise ends up with two files called
    audit-log.csv in one downloads folder.
    """
    stamp = today.strftime("%Y-%m-%d")
    safe = "".join(c for c in org_slug if c.isalnum() or c in "-_") or "export"
    return f"{safe}-{kind}-{stamp}.csv"


def as_bom_utf8(text: str) -> bytes:
    """UTF-8 with a byte order mark.

    Excel on Windows reads a BOM-less UTF-8 CSV as the system codepage,
    which turns every Sinhala or Tamil name in the file into mojibake.
    The BOM is three bytes that make the difference between a usable
    export and a support ticket.
    """
    return text.encode("utf-8-sig")
