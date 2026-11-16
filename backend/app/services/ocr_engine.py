from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

from ..config import OCR_ENGINE
from .id_parser import OcrLine

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

logger = logging.getLogger(__name__)


class OcrUnavailableError(RuntimeError):
    pass


_engine = None
_engine_lock = threading.Lock()
_inference_lock = threading.Lock()


def _load_engine():
    global _engine
    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is not None:
            return _engine
        try:
            if OCR_ENGINE == "rapidocr":
                from rapidocr_onnxruntime import RapidOCR

                logger.info("正在加载 RapidOCR 模型")
                _engine = RapidOCR()
                logger.info("RapidOCR 模型加载完成")
            else:
                from paddleocr import PaddleOCR

                logger.info("正在加载 PaddleOCR 模型")
                _engine = PaddleOCR(
                    lang="ch",
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                )
                logger.info("PaddleOCR 模型加载完成")
        except Exception as exc:  # pragma: no cover - depends on local runtime
            logger.exception("OCR 初始化失败")
            raise OcrUnavailableError(f"本地 OCR 服务初始化失败：{exc}") from exc
    return _engine


def _find_result_payload(value: Any, depth: int = 0) -> dict | None:
    if depth > 5:
        return None
    if isinstance(value, dict):
        if isinstance(value.get("rec_texts"), (list, tuple)):
            return value
        for nested in value.values():
            found = _find_result_payload(nested, depth + 1)
            if found is not None:
                return found
    elif isinstance(value, (list, tuple)):
        for nested in value:
            found = _find_result_payload(nested, depth + 1)
            if found is not None:
                return found
    return None


def _bbox_from_poly(poly: Any) -> tuple[float, float, float, float]:
    try:
        points = [(float(point[0]), float(point[1])) for point in poly]
    except (TypeError, ValueError, IndexError):
        return (0.0, 0.0, 0.0, 0.0)
    if not points:
        return (0.0, 0.0, 0.0, 0.0)
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return (min(xs), min(ys), max(xs), max(ys))


def _parse_modern_result(result: Any) -> list[OcrLine]:
    payload = None
    if isinstance(result, dict):
        payload = _find_result_payload(result)
    else:
        try:
            json_value = getattr(result, "json", None)
            if callable(json_value):
                json_value = json_value()
            payload = _find_result_payload(json_value)
        except Exception:
            payload = None
        if payload is None and hasattr(result, "keys"):
            try:
                payload = _find_result_payload(dict(result))
            except Exception:
                payload = None
    if payload is None:
        return []

    texts = payload.get("rec_texts") or []
    scores = payload.get("rec_scores") or []
    polygons = payload.get("rec_polys")
    boxes = payload.get("rec_boxes")
    lines: list[OcrLine] = []
    for index, raw_text in enumerate(texts):
        text = str(raw_text or "").strip()
        if not text:
            continue
        try:
            score = float(scores[index]) if index < len(scores) else 0.0
        except (TypeError, ValueError):
            score = 0.0
        bbox = (0.0, 0.0, 0.0, 0.0)
        if polygons is not None and index < len(polygons):
            bbox = _bbox_from_poly(polygons[index])
        elif boxes is not None and index < len(boxes):
            try:
                box = boxes[index]
                bbox = (float(box[0]), float(box[1]), float(box[2]), float(box[3]))
            except (TypeError, ValueError, IndexError):
                pass
        lines.append(OcrLine(text=text, score=score, bbox=bbox))
    return lines


def _parse_legacy_result(results: Any) -> list[OcrLine]:
    lines: list[OcrLine] = []
    if not isinstance(results, (list, tuple)):
        return lines
    for page in results:
        if not isinstance(page, (list, tuple)):
            continue
        for item in page:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            bbox_data, recognition = item[0], item[1]
            if isinstance(recognition, (list, tuple)) and recognition:
                text = str(recognition[0])
                try:
                    score = float(recognition[1])
                except (TypeError, ValueError, IndexError):
                    score = 0.0
            else:
                text = str(recognition)
                score = 0.0
            if text.strip():
                lines.append(OcrLine(text=text.strip(), score=score, bbox=_bbox_from_poly(bbox_data)))
    return lines


def start_background_warmup() -> None:
    def warm_up():
        try:
            _load_engine()
            logger.info("OCR 预热完成")
        except OcrUnavailableError:
            logger.warning("OCR 预热失败，首次识别时会再次尝试")

    threading.Thread(target=warm_up, name="paddleocr-warmup", daemon=True).start()


def _recognize_rapid(engine, image_path: str | Path) -> list[OcrLine]:
    output = engine(str(image_path))
    if isinstance(output, tuple):
        result = output[0]
    else:
        result = output
    if result is None:
        return []
    if hasattr(result, "txts"):
        boxes = getattr(result, "boxes", []) or []
        texts = getattr(result, "txts", []) or []
        scores = getattr(result, "scores", []) or []
        lines: list[OcrLine] = []
        for index, text in enumerate(texts):
            bbox = _bbox_from_poly(boxes[index]) if index < len(boxes) else (0.0, 0.0, 0.0, 0.0)
            try:
                score = float(scores[index])
            except (TypeError, ValueError, IndexError):
                score = 0.0
            if str(text).strip():
                lines.append(OcrLine(text=str(text).strip(), score=score, bbox=bbox))
        return lines
    lines = []
    for item in result:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        try:
            text = str(item[1]).strip()
            score = float(item[2]) if len(item) > 2 else 0.0
            bbox = _bbox_from_poly(item[0])
        except (TypeError, ValueError, IndexError):
            continue
        if text:
            lines.append(OcrLine(text=text, score=score, bbox=bbox))
    return lines


def recognize_id_image(image_path: str | Path) -> list[OcrLine]:
    engine = _load_engine()
    try:
        with _inference_lock:
            if OCR_ENGINE == "rapidocr":
                return _recognize_rapid(engine, image_path)
            results = engine.predict(input=str(image_path))
    except Exception as exc:  # pragma: no cover - depends on local runtime
        logger.exception("OCR 识别失败")
        raise OcrUnavailableError(f"本地 OCR 识别失败：{exc}") from exc

    lines: list[OcrLine] = []
    for result in results:
        parsed = _parse_modern_result(result)
        if parsed:
            lines.extend(parsed)
    if not lines:
        lines = _parse_legacy_result(results)
    return lines
