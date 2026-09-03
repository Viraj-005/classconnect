"""File storage rules.

Upload is the feature that most often ships a path traversal, an
unrestricted file type, or a stored XSS. These tests are the record of
which of those are closed and how.

Run with: pytest apps/api/tests -v
"""

import pytest

from app.services import storage_service as store


# ----------------------------------------------------------------------
# The client never supplies a path
# ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "hostile",
    [
        "../../../../etc/passwd",
        r"..\..\windows\system32\config\sam",
        "/etc/shadow",
        r"C:\Windows\win.ini",
        "....//....//secret",
        "a/../../b",
    ],
)
def test_a_hostile_filename_cannot_become_a_path(hostile):
    """Keys are built here, never taken from the request.

    The filename only ever reaches safe_label, which is a display
    string. This asserts it cannot contain a separator afterwards, so
    even a caller that misused it could not traverse.
    """
    label = store.safe_label(hostile)
    assert "/" not in label
    assert "\\" not in label
    assert not label.startswith(".")


def test_a_key_outside_the_media_root_is_refused():
    """The containment check, as the last line of defence.

    Keys come from new_key and never from a request, but a corrupt or
    hand edited database row must not be able to read /etc/passwd
    either.
    """
    with pytest.raises(ValueError):
        store.path_for("../../../etc/passwd")
    with pytest.raises(ValueError):
        store.path_for("horizon/../../../../etc/passwd")


def test_a_generated_key_stays_inside_the_media_root():
    key = store.new_key("org-123", "content-456", ".pdf")
    path = store.path_for(key)
    assert path.is_relative_to(store.media_root())


def test_the_key_is_prefixed_with_the_org():
    """So a directory listing cannot enumerate another tenant's files."""
    key = store.new_key("org-abc", "content-1", ".png")
    assert key.startswith("org-abc/")


def test_two_uploads_of_the_same_file_do_not_collide():
    a = store.new_key("o", "c", ".pdf")
    b = store.new_key("o", "c", ".pdf")
    assert a != b


# ----------------------------------------------------------------------
# Extensions are an allowlist
# ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        "shell.php",
        "run.exe",
        "script.js",
        "page.html",
        "vector.svg",
        "config.env",
        "notes",
        "archive.zip",
        "thing.PHP",
        "double.pdf.exe",
    ],
)
def test_an_unlisted_extension_is_rejected(name):
    """A blocklist is a list of the attacks somebody thought of.

    .html and .svg are on this list deliberately: both can carry script
    and would run on the app's own origin if served inline.
    """
    assert store.extension_of(name) == ""


@pytest.mark.parametrize("name", ["notes.pdf", "SLIDES.PPTX", "clip.MP4", "photo.jpeg"])
def test_a_listed_extension_is_accepted_case_insensitively(name):
    assert store.extension_of(name) != ""


def test_new_key_refuses_an_unlisted_extension_outright():
    with pytest.raises(ValueError):
        store.new_key("o", "c", ".php")


def test_a_double_extension_is_judged_on_the_last_one():
    """`report.pdf.exe` is an executable, not a PDF."""
    assert store.extension_of("report.pdf.exe") == ""
    assert store.extension_of("report.exe.pdf") == ".pdf"


# ----------------------------------------------------------------------
# The content type is ours, not the browser's
# ----------------------------------------------------------------------


def test_the_content_type_comes_from_the_extension():
    assert store.content_type_for("o/c/x.pdf") == "application/pdf"
    assert store.content_type_for("o/c/x.mp4") == "video/mp4"


def test_an_unknown_key_serves_as_a_stream_not_as_html():
    """Never text/html, which would run script on our own origin."""
    assert store.content_type_for("o/c/x.unknown") == "application/octet-stream"


def test_only_safe_types_render_in_place():
    assert store.is_inline("a.png")
    assert store.is_inline("a.mp4")
    assert store.is_inline("a.pdf")
    # A document downloads rather than rendering.
    assert not store.is_inline("a.docx")
    assert not store.is_inline("a.csv")


# ----------------------------------------------------------------------
# Labels
# ----------------------------------------------------------------------


def test_a_label_cannot_break_a_content_disposition_header():
    """It is interpolated into a quoted header value.

    A quote or a newline in the name would let an upload set another
    header entirely.
    """
    label = store.safe_label('evil".pdf\r\nX-Injected: yes')
    assert '"' not in label
    assert "\r" not in label and "\n" not in label


def test_an_empty_or_unusable_name_falls_back():
    assert store.safe_label("") == "file"
    assert store.safe_label("...") == "file"
    assert store.safe_label("../..", "upload") == "upload"


def test_a_long_name_is_truncated():
    assert len(store.safe_label("x" * 500 + ".pdf")) <= 120


# ----------------------------------------------------------------------
# A logo version identifies the file, so a cache can key on it
# ----------------------------------------------------------------------


def test_the_version_changes_whenever_the_stored_file_changes():
    """Two uploads never share a version, so a replacement is never stale.

    new_key puts a random segment in every key, so this holds across a
    replace within one organisation as well as between organisations.
    """
    a = store.new_key("org-a", "branding", ".png")
    b = store.new_key("org-a", "branding", ".png")
    assert store.version_of(a) != store.version_of(b)


def test_two_organisations_never_share_a_version():
    """The org id is the first path segment, so it is inside the hash."""
    a = store.new_key("org-a", "branding", ".png")
    b = store.new_key("org-b", "branding", ".png")
    assert store.version_of(a) != store.version_of(b)


def test_the_version_is_stable_and_leaks_no_path():
    """Same key, same version, and nothing of the path in the output.

    The version travels to the browser. A tenant learning the storage
    layout from it would be a small leak, but a needless one.
    """
    key = "org-a/branding/deadbeefdeadbeef.png"
    assert store.version_of(key) == store.version_of(key)
    assert "org-a" not in store.version_of(key)
    assert "branding" not in store.version_of(key)
    assert "deadbeef" not in store.version_of(key)


def test_no_logo_has_no_version():
    assert store.version_of(None) is None
    assert store.version_of("") is None
