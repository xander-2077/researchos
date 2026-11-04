"""Image uploads for Markdown fields (experiment notes, project notes).

The body is the raw image (``Content-Type: image/png`` …), not multipart, so no
extra dependency is needed. Files are content-addressed under
``<data_dir>/uploads`` and served back to authenticated clients only. SVG is
deliberately not accepted (it can carry script).
"""

from __future__ import annotations

import hashlib
import re
import uuid
from collections.abc import Callable

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse

from app.api.deps import get_actor
from app.auth.actor import Actor
from app.core.errors import NotFound, ValidationFailed

router = APIRouter(tags=["uploads"])

# extension -> (media type, magic-byte check)
FORMATS: dict[str, tuple[str, Callable[[bytes], bool]]] = {
    "png": ("image/png", lambda b: b.startswith(b"\x89PNG\r\n\x1a\n")),
    "jpg": ("image/jpeg", lambda b: b.startswith(b"\xff\xd8\xff")),
    "gif": ("image/gif", lambda b: b[:6] in (b"GIF87a", b"GIF89a")),
    "webp": ("image/webp", lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP"),
}
NAME_RE = re.compile(r"^[0-9a-f]{32}\.(png|jpg|gif|webp)$")


def _upload_dir(request: Request):
    d = request.app.state.settings.data_dir / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _detect(body: bytes) -> str | None:
    for ext, (_, check) in FORMATS.items():
        if check(body):
            return ext
    return None


@router.post("/uploads", status_code=201)
async def upload_image(request: Request, actor: Actor = Depends(get_actor)):
    actor.require_write()
    body = await request.body()
    if not body:
        raise ValidationFailed("Empty upload")
    ext = _detect(body)
    if ext is None:
        raise ValidationFailed("Only PNG, JPEG, GIF and WebP images are accepted", code="unsupported_media")
    name = f"{hashlib.sha256(body).hexdigest()[:32]}.{ext}"
    path = _upload_dir(request) / name
    if not path.exists():  # content-addressed: identical images are stored once
        tmp = path.with_suffix(f".{uuid.uuid4().hex}.part")  # unique: same image may arrive twice at once
        tmp.write_bytes(body)
        tmp.replace(path)
    return {"url": f"/api/v1/uploads/{name}", "name": name, "size": len(body), "content_type": FORMATS[ext][0]}


@router.get("/uploads/{name}")
def get_image(name: str, request: Request, actor: Actor = Depends(get_actor)):
    actor.require_read()
    if not NAME_RE.match(name):
        raise NotFound("Upload not found")
    path = _upload_dir(request) / name
    if not path.is_file():
        raise NotFound("Upload not found")
    return FileResponse(
        path, media_type=FORMATS[name.rsplit(".", 1)[1]][0],
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
