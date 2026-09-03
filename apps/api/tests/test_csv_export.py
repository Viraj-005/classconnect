"""CSV export safety.

A CSV that opens in Excel is a document that can execute. That makes the
one interesting rule in this module a security rule rather than a
formatting one, and worth testing on its own.

Run with: pytest apps/api/tests -v
"""

import csv
import io
from datetime import datetime, timezone

import pytest

from app.services.csv_service import as_bom_utf8, filename, neutralise, write


@pytest.mark.parametrize(
    "payload",
    [
        "=cmd|'/c calc'!A1",
        "+1+1",
        "@SUM(A1:A9)",
        "=HYPERLINK(\"http://evil\",\"click\")",
        "\tinjected",
        "\rinjected",
    ],
)
def test_a_formula_is_defused(payload):
    """A cell starting =, +, - or @ runs when the file is opened.

    A student called `=cmd|'/c calc'!A1` becomes code the moment an
    administrator opens the export. Prefixing with a quote makes the
    spreadsheet treat it as text, and the value is unchanged for
    anything reading the file as data.
    """
    out = neutralise(payload)
    assert out.startswith("'"), out
    assert out[1:] == payload


def test_a_negative_number_is_left_alone():
    """It legitimately starts with a minus.

    Quoting it would turn every refund in a fees export into text and
    break the sum at the bottom of the column.
    """
    assert neutralise("-250") == "-250"
    assert neutralise("-12.5") == "-12.5"
    assert neutralise(-250) == "-250"


def test_ordinary_values_pass_through_untouched():
    for value in ["Amaya Perera", "amaya@horizon.lk", "2026-09-03", "paid", 42, 0]:
        assert neutralise(value) == str(value)


def test_none_becomes_an_empty_cell_not_the_word_none():
    assert neutralise(None) == ""


def test_the_document_round_trips_through_a_csv_reader():
    text = write(
        ["Name", "Note"],
        [["Amaya Perera", "Said \"hello\", then left"], ["Nimal, Jr", "Line\nbreak"]],
    )
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0] == ["Name", "Note"]
    assert rows[1] == ["Amaya Perera", 'Said "hello", then left']
    # A comma in a name and a newline in a note must not split the row.
    assert rows[2] == ["Nimal, Jr", "Line\nbreak"]


def test_line_endings_are_crlf():
    """RFC 4180, and what Excel on Windows expects."""
    assert write(["a"], [["b"]]) == "a\r\nb\r\n"


def test_the_file_carries_a_byte_order_mark():
    """Without it Excel reads UTF-8 as the system codepage.

    Every Sinhala or Tamil name in the export becomes mojibake, which is
    most of the names in this product's market.
    """
    raw = as_bom_utf8("Name\r\nකමල්\r\n")
    assert raw.startswith(b"\xef\xbb\xbf")
    assert raw.decode("utf-8-sig").startswith("Name")


def test_the_filename_says_which_tenant_and_when():
    name = filename("horizon", "audit-log", datetime(2026, 9, 3, tzinfo=timezone.utc))
    assert name == "horizon-audit-log-2026-09-03.csv"


def test_a_hostile_slug_cannot_escape_the_filename():
    """The slug reaches a Content-Disposition header.

    A slug containing a quote or a slash could otherwise break out of
    the filename and set another header value.
    """
    name = filename('../../etc/passwd"', "people", datetime(2026, 9, 3, tzinfo=timezone.utc))
    assert "/" not in name
    assert '"' not in name
    assert ".." not in name
