from __future__ import annotations

import io
import os
import re
import time
import uuid
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from ..config import UPLOAD_DIR

TEMP_DIR = UPLOAD_DIR / "tmp"
ID_CARD_DIR = UPLOAD_DIR / "id-cards"
TOKEN_PATTERN = re.compile(r"^[a-f0-9]{32}\.jpg$")
MAX_IMAGE_PIXELS = 45_000_000

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


class ImageValidationError(ValueError):
    pass


def prepare_id_image(raw: bytes) -> str:
    if not raw:
        raise ImageValidationError("上传的文件为空。")
    try:
        with Image.open(io.BytesIO(raw)) as source:
            source.load()
            image = ImageOps.exif_transpose(source).convert("RGB")
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise ImageValidationError("无法读取这张图片，请上传 JPG、PNG 或 WebP 格式的照片。") from exc

    if image.width < 160 or image.height < 100:
        raise ImageValidationError("图片尺寸过小，请上传更清晰的照片。")
    image.thumbnail((2600, 2600), Image.Resampling.LANCZOS)
    token = f"{uuid.uuid4().hex}.jpg"
    destination = TEMP_DIR / token
    image.save(destination, format="JPEG", quality=92, optimize=True)
    try:
        os.chmod(destination, 0o600)
    except OSError:
        pass
    return token


def temp_image_path(token: str) -> Path:
    if not TOKEN_PATTERN.fullmatch(token):
        raise ValueError("无效的图片凭证。")
    path = TEMP_DIR / token
    if not path.exists():
        raise FileNotFoundError("图片已过期，请重新上传。")
    return path


def commit_temp_image(token: str) -> str:
    source = temp_image_path(token)
    filename = f"{uuid.uuid4().hex}.jpg"
    destination = ID_CARD_DIR / filename
    os.replace(source, destination)
    return f"id-cards/{filename}"


def delete_relative_file(relative_path: str | None) -> None:
    if not relative_path:
        return
    candidate = (UPLOAD_DIR / relative_path).resolve()
    root = UPLOAD_DIR.resolve()
    if root not in candidate.parents:
        return
    try:
        candidate.unlink(missing_ok=True)
    except OSError:
        pass


def absolute_upload_path(relative_path: str) -> Path:
    candidate = (UPLOAD_DIR / relative_path).resolve()
    root = UPLOAD_DIR.resolve()
    if root not in candidate.parents:
        raise FileNotFoundError("无效的文件路径。")
    if not candidate.is_file():
        raise FileNotFoundError("文件不存在。")
    return candidate


def cleanup_temp_files(older_than_seconds: int = 24 * 60 * 60) -> None:
    cutoff = time.time() - older_than_seconds
    for path in TEMP_DIR.glob("*.jpg"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)
        except OSError:
            continue
