"""
MPLADS Sentinel — validated storage for citizen evidence uploads

The API previously had no upload route at all, even though the schema had a
``photo_url`` column and the portal presented a photo-capture flow. The result
was a field that was always NULL behind a UI that looked like it worked.

This module is the whole of the storage path. It is deliberately small and
defensive, because the files arriving here come from the public internet:

* **The client filename never touches the filesystem.** Each file is written
  under a server-generated UUID, with an extension derived from the *validated*
  content type. A crafted name such as ``../../etc/passwd`` or
  ``evil.html.png`` therefore cannot escape the upload directory or dictate its
  own extension.
* **Content type is checked, not trusted.** A declared ``image/png`` proves
  nothing, so the leading bytes are sniffed and must agree with an allowed
  image/PDF type.
* **Size is capped** by ``settings.MAX_UPLOAD_BYTES`` per file and per request.
* **Every file is hashed** (SHA-256) so the same evidence can be recognised if
  it is re-submitted, and so tampering is detectable later.

Storing bytes on the local disk is appropriate for a single-node deployment. A
multi-node deployment must replace :func:`store_uploads` with an object-store
client (S3/MinIO); the returned :class:`StoredFile` shape is what the database
layer consumes, so only this module needs to change.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterable, Sequence

from fastapi import HTTPException, UploadFile, status

from config import ENV_FILE  # noqa: F401  (ensures settings loads from the repo .env)
from config import settings

# Hard ceiling regardless of configuration, so a mis-set MAX_UPLOAD_BYTES
# cannot turn the endpoint into an unbounded disk write.
ABSOLUTE_MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_FILES_PER_REQUEST = 5

# Extension chosen from the *validated* type, never from the client's filename.
_EXTENSION_BY_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}

# Magic-number signatures. These are what actually decides whether a file is
# accepted; the browser-supplied Content-Type is only a hint.
_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"%PDF-", "application/pdf"),
)


@dataclass(frozen=True)
class StoredFile:
    """What the database layer records for one stored file."""

    original_filename: str
    storage_key: str
    content_type: str
    size_bytes: int
    sha256: str


def upload_root() -> Path:
    """Absolute path of the upload directory, created on first use."""
    configured = Path(settings.UPLOAD_DIR)
    root = configured if configured.is_absolute() else (Path(__file__).resolve().parent.parent.parent / configured)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _sniff(head: bytes) -> str | None:
    """Identify the container format from the leading bytes."""
    for signature, content_type in _MAGIC:
        if head.startswith(signature):
            return content_type
    # WebP: "RIFF" .... "WEBP"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def _safe_display_name(name: str | None, fallback: str) -> str:
    """A display-safe version of the client filename.

    Used for the ``original_filename`` column only. Path separators, control
    characters, and any remaining ``..`` run are collapsed so a stored name can
    never be re-joined into a path by a later reader of the database, and can
    never be echoed into a header or a log line in a form that reads as a path.
    """
    if not name:
        return fallback
    cleaned = re.sub(r"[\x00-\x1f\x7f/\\]+", "_", name)
    # Collapse any surviving parent-directory run, e.g. from "..%2f..", so no
    # reader can mistake the display name for a relative path.
    cleaned = re.sub(r"\.{2,}", "_", cleaned).strip(" .")
    cleaned = cleaned[:200]
    return cleaned or fallback


async def _read_chunks(stream: BinaryIO, limit: int) -> tuple[bytes, int]:
    """Read up to ``limit`` + 1 bytes so an oversized file is detectable.

    The extra byte is the signal: if we read ``limit + 1`` the file is over the
    cap, and we do not have to hold the whole thing in memory to know it.
    """
    data = stream.read(limit + 1)
    return data, len(data)


async def store_uploads(
    uploads: Sequence[UploadFile],
    *,
    owner: tuple[str, str],
) -> list[StoredFile]:
    """Validate and persist a batch of uploaded files.

    ``owner`` is ``("report", <uuid>)`` or ``("demand", <uuid>)``; it becomes
    the first path segment so one owner's files cannot be listed under another.

    Returns one :class:`StoredFile` per accepted file. An empty ``uploads`` is a
    valid, zero-length result — the request simply carried no attachments.

    Raises HTTPException on a rejected file. Partial success is not offered on
    purpose: a citizen who attached three photos should not be told two were
    saved without being told which one failed and why.
    """
    files = [u for u in uploads if u is not None and (u.filename or "").strip()]
    if not files:
        return []

    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Too many files: {len(files)}. At most {MAX_FILES_PER_REQUEST} "
                "attachments may be submitted at once."
            ),
        )

    per_file_cap = min(settings.MAX_UPLOAD_BYTES, ABSOLUTE_MAX_FILE_BYTES)
    base = upload_root() / owner[0] / owner[1]
    base.mkdir(parents=True, exist_ok=True)

    stored: list[StoredFile] = []
    total = 0

    for upload in files:
        data, size = await _read_chunks(upload.file, per_file_cap)
        if size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"'{upload.filename}' is empty (0 bytes); it was not saved.",
            )
        if size > per_file_cap:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    f"'{upload.filename}' exceeds the {per_file_cap // (1024 * 1024)} MB "
                    "per-file limit. Compress the image and try again."
                ),
            )
        total += size
        if total > per_file_cap * MAX_FILES_PER_REQUEST:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Total attachment size for this submission is too large.",
            )

        sniffed = _sniff(data[:16])
        if sniffed is None:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=(
                    f"'{upload.filename}' is not a JPEG, PNG, WebP image or a PDF. "
                    "The file's contents did not match its declared type, so it was "
                    "not saved."
                ),
            )
        if sniffed not in settings.ALLOWED_UPLOAD_TYPES:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=(
                    f"File type {sniffed} is not accepted. Allowed: "
                    f"{', '.join(settings.ALLOWED_UPLOAD_TYPES)}."
                ),
            )

        extension = _EXTENSION_BY_TYPE[sniffed]
        digest = hashlib.sha256(data).hexdigest()
        key = f"{owner[0]}/{owner[1]}/{uuid.uuid4().hex}{extension}"
        target = (upload_root() / key).resolve()

        # Belt-and-braces containment check. The key is server-generated, so this
        # should never fire; if it ever does, the path arithmetic is wrong and
        # writing is the wrong response.
        if not str(target).startswith(str(upload_root().resolve())):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Refusing to write outside the upload directory.",
            )

        target.write_bytes(data)
        try:
            upload.file.close()
        except Exception:  # noqa: BLE001 - close is best-effort
            pass

        stored.append(
            StoredFile(
                original_filename=_safe_display_name(upload.filename, f"upload{extension}"),
                storage_key=key,
                content_type=sniffed,
                size_bytes=size,
                sha256=digest,
            )
        )

    return stored


def resolve_storage_path(storage_key: str) -> Path:
    """Turn a stored key back into a path, refusing anything that escapes the root.

    Used by the download route. `storage_key` comes from the database, but a
    defence-in-depth check costs nothing and turns any future bug in key
    generation into a 400 rather than a path traversal.
    """
    root = upload_root().resolve()
    candidate = (root / storage_key).resolve()
    if not str(candidate).startswith(str(root)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid evidence path.",
        )
    return candidate


def iter_evidence_extensions() -> Iterable[str]:
    return _EXTENSION_BY_TYPE.values()
