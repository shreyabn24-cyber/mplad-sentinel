"""
Tests for evidence upload handling and path containment.

These exercise the validation logic against the filesystem directly, so they
run without PostgreSQL and without the API.

Run:  python -m pytest backend/tests -q
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterator

BACKEND = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND.parent
for candidate in (str(BACKEND), str(REPO_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

import pytest  # noqa: E402
from fastapi import HTTPException, UploadFile  # noqa: E402
from starlette.datastructures import Headers  # noqa: E402

import services.uploads as uploads  # noqa: E402


@pytest.fixture
def upload_root(tmp_path, monkeypatch) -> Iterator[Path]:
    root = tmp_path / "evidence"
    root.mkdir()
    monkeypatch.setattr(uploads, "upload_root", lambda: root)
    monkeypatch.setattr(
        uploads.settings, "UPLOAD_DIR", str(root), raising=False
    )
    yield root


def _png_bytes() -> bytes:
    """A minimal but real PNG: 8-byte signature plus an IHDR chunk."""
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\r"
        + b"IHDR"
        + b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        + b"\x00\x00\x00\x0cIDATx\x9cc```"
        + b"\x00\x00\x00\x00\x00\x00"
    )


def _upload(name: str, data: bytes, content_type: str = "image/png") -> UploadFile:
    return UploadFile(
        file=__import__("io").BytesIO(data),
        filename=name,
        headers=Headers({"content-type": content_type}),
    )


async def _store(files, root):
    return await uploads.store_uploads(files, owner=("report", "test-parent"))


# ── Happy path ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_valid_png_is_stored_and_recorded(upload_root):
    stored = await _store([_upload("photo.png", _png_bytes())], upload_root)
    assert len(stored) == 1
    record = stored[0]

    written = upload_root / record.storage_key
    assert written.is_file()
    assert written.read_bytes() == _png_bytes()
    assert record.sha256 and len(record.sha256) == 64
    assert record.size_bytes == len(_png_bytes())


@pytest.mark.asyncio
async def test_stored_key_is_server_generated_not_the_client_filename(upload_root):
    """The client-supplied name must never become the path."""
    nasty = "../../../etc/passwd"
    stored = await _store([_upload(nasty, _png_bytes())], upload_root)
    key = stored[0].storage_key
    assert ".." not in key
    assert not Path(key).is_absolute()
    # The original name is retained for display only.
    # The display name is sanitised too, so it cannot later be echoed into a
    # header or a log line unmodified.
    display = stored[0].original_filename
    assert display != nasty
    assert ".." not in display
    assert not Path(display).is_absolute()


@pytest.mark.asyncio
async def test_two_identical_files_get_distinct_keys(upload_root):
    stored = await _store(
        [_upload("a.png", _png_bytes()), _upload("b.png", _png_bytes())], upload_root
    )
    assert stored[0].storage_key != stored[1].storage_key
    assert stored[0].sha256 == stored[1].sha256, "content hash should match"


# ── Content validation ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extension_is_not_trusted_for_content_type(upload_root):
    """A .png that is really a script must be refused on its bytes, not its name."""
    payload = b"<?php system($_GET['c']); ?>"
    with pytest.raises(HTTPException) as excinfo:
        await _store([_upload("evil.png", payload, "image/png")], upload_root)
    assert excinfo.value.status_code == 415


@pytest.mark.asyncio
async def test_disallowed_extension_is_refused(upload_root):
    with pytest.raises(HTTPException) as excinfo:
        await _store([_upload("payload.exe", b"MZ\x90\x00")], upload_root)
    assert excinfo.value.status_code == 415


@pytest.mark.asyncio
async def test_empty_file_is_refused(upload_root):
    with pytest.raises(HTTPException) as excinfo:
        await _store([_upload("empty.png", b"")], upload_root)
    assert excinfo.value.status_code == 400


# ── Limits ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_too_many_files_is_refused(upload_root):
    files = [_upload(f"f{i}.png", _png_bytes()) for i in range(20)]
    with pytest.raises(HTTPException) as excinfo:
        await _store(files, upload_root)
    assert excinfo.value.status_code in (400, 413)


@pytest.mark.asyncio
async def test_oversized_file_is_refused(upload_root, monkeypatch):
    monkeypatch.setattr(uploads.settings, "MAX_UPLOAD_BYTES", 8)
    with pytest.raises(HTTPException) as excinfo:
        await _store([_upload("big.png", _png_bytes())], upload_root)
    assert excinfo.value.status_code == 413


# ── Path containment on the way back out ─────────────────────────────────────

def test_resolve_storage_path_returns_a_path_inside_the_root(upload_root):
    target = upload_root / "a" / "b.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(_png_bytes())
    resolved = uploads.resolve_storage_path("a/b.png")
    assert resolved == target.resolve()


@pytest.mark.parametrize(
    "key",
    [
        "../secrets.txt",
        "../../.env",
        "a/../../../etc/passwd",
    ],
)
def test_resolve_storage_path_refuses_traversal(upload_root, key):
    """A stored key that escapes the root must be rejected, not followed."""
    with pytest.raises(HTTPException) as excinfo:
        uploads.resolve_storage_path(key)
    assert excinfo.value.status_code == 400
