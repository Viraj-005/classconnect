"""Local file storage for uploaded media.

S3 is configured and not implemented, so files live on disk under a
`media` directory and their metadata lives in Postgres. That split is
deliberate and survives the move to S3 later: the database is the index,
the object store is the bytes, and only the key linking them changes.

This module is where a file upload feature usually goes wrong, so the
rules are written down rather than assumed.

**The client never supplies a path.** A key is built here from the org
id, the content id and a random name. Accepting a filename and joining
it to a directory is how `../../etc/passwd` gets written or read, and no
amount of sanitising a client string is as safe as not using it.

**The org id is the first path segment.** A directory listing therefore
cannot enumerate another tenant's files, and a key that somehow leaked
still cannot be read without a session for that org, because the
download route resolves the row by (content_id, org_id) before it
touches the disk.

**Extensions are an allowlist, not a blocklist.** A blocklist is a list
of the attacks somebody thought of. The original filename is kept only
as a label in the database, never as part of the path.

**Nothing served from here is executable.** Files are returned as
attachments with a fixed content type per extension, so a .html or .svg
upload cannot run script in the app's origin.
"""

import hashlib
import os
import re
import secrets
import unicodedata
from pathlib import Path

from app.core.config import settings

# What may be uploaded, and what it is served as. The content type is
# taken from this table rather than from the browser's guess, because a
# client controlled Content-Type is how an HTML file gets served as
# text/html and runs script on the app's own origin.
ALLOWED = {
    # Documents
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".csv": "text/csv",
    # Images
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    # Video and audio
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
}

# Types a browser can play in place. Everything else downloads, so a
# document cannot be rendered inline and script cannot execute.
INLINE = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "audio/mpeg",
    "audio/mp4",
    "application/pdf",
}

MAX_BYTES = 512 * 1024 * 1024  # 512 MB, enough for a lecture recording.
# Read in chunks so a large upload does not sit in memory in one piece.
CHUNK = 1024 * 1024


def media_root() -> Path:
    """Where files live. Created on first use."""
    root = Path(getattr(settings, "MEDIA_ROOT", "media")).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def extension_of(filename: str) -> str:
    """The lowercased extension, or "" if there is not a usable one."""
    ext = os.path.splitext(filename or "")[1].lower()
    return ext if ext in ALLOWED else ""


def content_type_for(key: str) -> str:
    return ALLOWED.get(os.path.splitext(key)[1].lower(), "application/octet-stream")


def is_inline(key: str) -> bool:
    return content_type_for(key) in INLINE


def safe_label(filename: str, fallback: str = "file") -> str:
    """The original name, cleaned, for display only.

    Never used to build a path. It exists so the library can show
    "lecture 3.pdf" instead of a random key, and it is stripped of
    anything that would be awkward in a Content-Disposition header.
    """
    name = unicodedata.normalize("NFKD", filename or "").encode("ascii", "ignore").decode()
    name = os.path.basename(name.replace("\\", "/"))
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name).strip(" .")
    return (name or fallback)[:120]


def new_key(org_id: str, content_id: str, extension: str) -> str:
    """A storage key. Built here, never taken from the client.

    The random segment means two uploads of the same file do not collide
    and a key cannot be guessed from the content id alone.
    """
    if extension not in ALLOWED:
        raise ValueError(f"Refusing to store an unlisted extension: {extension!r}")
    return f"{org_id}/{content_id}/{secrets.token_hex(8)}{extension}"


def version_of(key: str | None) -> str | None:
    """A short tag that changes whenever the stored file changes.

    The browser caches a logo in memory and cannot re-read it on every
    render, so it needs something to key that cache on. Sending the
    storage key itself would work, since it carries a random segment per
    upload, but it is a path and paths are better not scattered through
    a client. A hash gives the same "changed or not" signal and says
    nothing about where the file lives.
    """
    if not key:
        return None
    return hashlib.blake2b(key.encode("utf-8"), digest_size=6).hexdigest()


def path_for(key: str) -> Path:
    """Resolve a stored key to a path inside the media root.

    The containment check is the last line of defence rather than the
    first. Keys are generated by new_key and never taken from a request,
    but a corrupt or hand edited database row must not be able to read
    outside the media directory either, and this is cheap.
    """
    root = media_root()
    candidate = (root / key).resolve()
    if not candidate.is_relative_to(root):
        raise ValueError("Storage key escapes the media root")
    return candidate


async def save(upload, key: str) -> int:
    """Stream an upload to disk, returning the size in bytes.

    Enforces the size limit while writing rather than trusting a
    Content-Length header, and removes a partial file if the limit is
    hit so a rejected upload leaves nothing behind.
    """
    target = path_for(key)
    target.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    try:
        with open(target, "wb") as out:
            while chunk := await upload.read(CHUNK):
                written += len(chunk)
                if written > MAX_BYTES:
                    raise ValueError("too-large")
                out.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return written


def delete(key: str | None) -> None:
    """Remove a stored file. Missing is not an error.

    Called when a content row is deleted. A file left behind is a slow
    leak; a crash because it was already gone is an outage.
    """
    if not key:
        return
    try:
        path = path_for(key)
    except ValueError:
        return
    path.unlink(missing_ok=True)
    # Tidy the per content directory if it is now empty.
    try:
        path.parent.rmdir()
    except OSError:
        pass
