from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from ..config import MAX_UPLOAD_BYTES
from ..deps import require_super_admin
from ..services.files import ImageValidationError, prepare_id_image, temp_image_path
from ..services.id_parser import extract_id_card_fields
from ..services.ocr_engine import OcrUnavailableError, recognize_id_image

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ocr", tags=["ocr"], dependencies=[Depends(require_super_admin)])


@router.post("/id-card")
async def scan_id_card(file: UploadFile = File(...)):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="请上传图片文件")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="图片不能超过 12MB")
    try:
        token = prepare_id_image(raw)
    except ImageValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    path = temp_image_path(token)
    try:
        lines = await asyncio.wait_for(
            run_in_threadpool(recognize_id_image, path),
            timeout=45,
        )
        fields = extract_id_card_fields(lines)
        return {
            "ok": True,
            "engine": "paddleocr-local",
            "token": token,
            **fields,
        }
    except TimeoutError:
        logger.warning("OCR timeout after 45s")
        return {
            "ok": False,
            "engine": "paddleocr-local",
            "token": token,
            "name": None,
            "id_number": None,
            "gender": None,
            "birth_date": None,
            "raw_lines": [],
            "warnings": ["本地 OCR 首次加载超时，请稍后重试，或先手工填写并保存身份证照片。"],
            "error": "OCR timeout",
        }
    except OcrUnavailableError as exc:
        logger.warning("OCR unavailable: %s", exc)
        return {
            "ok": False,
            "engine": "paddleocr-local",
            "token": token,
            "name": None,
            "id_number": None,
            "gender": None,
            "birth_date": None,
            "raw_lines": [],
            "warnings": ["本地 OCR 服务暂不可用，你仍可以手工填写信息并保存身份证照片。"],
            "error": str(exc),
        }
