from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date

ID_WEIGHTS = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
ID_CHECK_CODES = "10X98765432"
ID_PATTERN = re.compile(r"(?<![0-9])([1-9][0-9]{16}[0-9Xx])(?![0-9Xx])")
NAME_WITH_LABEL = re.compile(r"姓\s*名[：:]?\s*([\u4e00-\u9fa5·]{2,10})")
CHINESE_NAME = re.compile(r"^[\u4e00-\u9fa5·]{2,10}$")
ADDRESS_WORDS = ("省", "市", "区", "县", "镇", "村", "路", "街", "道", "号", "楼", "室", "巷")
LABEL_WORDS = ("姓名", "性别", "民族", "出生", "住址", "公民身份号码", "签发机关", "有效期限")


@dataclass
class OcrLine:
    text: str
    score: float
    bbox: tuple[float, float, float, float]


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(text or ""))
    return normalized.replace("\u3000", " ").strip()


def id_checksum_valid(id_number: str) -> bool:
    value = id_number.strip().upper()
    if not re.fullmatch(r"[1-9][0-9]{16}[0-9X]", value):
        return False
    try:
        birth = date(int(value[6:10]), int(value[10:12]), int(value[12:14]))
    except ValueError:
        return False
    if birth > date.today() or birth.year < 1900:
        return False
    checksum = sum(int(digit) * weight for digit, weight in zip(value[:17], ID_WEIGHTS)) % 11
    return value[-1] == ID_CHECK_CODES[checksum]


def parse_id_identity(id_number: str) -> tuple[str | None, date | None]:
    value = id_number.strip().upper()
    if not re.fullmatch(r"[1-9][0-9]{16}[0-9X]", value):
        return None, None
    try:
        birth = date(int(value[6:10]), int(value[10:12]), int(value[12:14]))
    except ValueError:
        return None, None
    gender = "男" if int(value[16]) % 2 == 1 else "女"
    return gender, birth


def _compact_id_text(text: str) -> str:
    normalized = normalize_text(text)
    # OCR sometimes separates ID digits into groups. Keep only relevant separators.
    return re.sub(r"(?<=[0-9Xx])[\s\-]+(?=[0-9Xx])", "", normalized)


def _find_id_candidates(lines: list[OcrLine]) -> list[tuple[str, float]]:
    candidates: list[tuple[str, float]] = []
    for line in lines:
        compact = _compact_id_text(line.text)
        for match in ID_PATTERN.finditer(compact):
            candidates.append((match.group(1).upper(), line.score))
    joined = _compact_id_text("".join(line.text for line in lines))
    for match in ID_PATTERN.finditer(joined):
        candidates.append((match.group(1).upper(), max((line.score for line in lines), default=0.0)))
    # Also inspect all possible 18-character windows if OCR inserted unusual separators.
    digits_only = re.sub(r"[^0-9Xx]", "", joined).upper()
    for index in range(0, max(0, len(digits_only) - 17)):
        candidate = digits_only[index : index + 18]
        if ID_PATTERN.fullmatch(candidate):
            candidates.append((candidate, max((line.score for line in lines), default=0.0)))
    unique: dict[str, float] = {}
    for candidate, score in candidates:
        unique[candidate] = max(unique.get(candidate, 0.0), score)
    return sorted(unique.items(), key=lambda item: (id_checksum_valid(item[0]), item[1]), reverse=True)


def _valid_name(value: str) -> bool:
    if not CHINESE_NAME.fullmatch(value):
        return False
    if value in LABEL_WORDS:
        return False
    if any(word in value for word in ADDRESS_WORDS):
        return False
    return True


def _center(bbox: tuple[float, float, float, float]) -> tuple[float, float]:
    return ((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)


def _find_name(lines: list[OcrLine]) -> tuple[str, float] | None:
    for line in lines:
        match = NAME_WITH_LABEL.search(normalize_text(line.text))
        if match and _valid_name(match.group(1)):
            return match.group(1), line.score

    label_lines = [line for line in lines if "姓名" in line.text]
    candidates = [
        line
        for line in lines
        if _valid_name(normalize_text(line.text)) and "姓名" not in line.text
    ]
    if not label_lines or not candidates:
        return None
    best: tuple[float, OcrLine] | None = None
    for label in label_lines:
        lx0, ly0, lx1, ly1 = label.bbox
        label_height = max(1.0, ly1 - ly0)
        label_center_y = (ly0 + ly1) / 2
        for candidate in candidates:
            cx, cy = _center(candidate.bbox)
            if cx <= lx1 - 4:
                continue
            vertical_distance = abs(cy - label_center_y)
            if vertical_distance > label_height * 1.8:
                continue
            horizontal_distance = max(0.0, candidate.bbox[0] - lx1)
            distance = horizontal_distance + vertical_distance * 2
            if best is None or distance < best[0]:
                best = (distance, candidate)
    if best:
        text = normalize_text(best[1].text)
        return text, best[1].score
    return None


def extract_id_card_fields(lines: list[OcrLine]) -> dict:
    warnings: list[str] = []
    id_candidates = _find_id_candidates(lines)
    selected_id: str | None = None
    id_score = 0.0
    checksum_valid = False
    if id_candidates:
        selected_id, id_score = id_candidates[0]
        checksum_valid = id_checksum_valid(selected_id)
        if not checksum_valid:
            warnings.append("身份证号校验未通过，请仔细核对后修改。")
        if id_score < 0.82:
            warnings.append("身份证号识别置信度偏低，请逐位核对。")
    else:
        warnings.append("未从图片中识别到身份证号，请手工填写。")

    name_result = _find_name(lines)
    if name_result is None:
        warnings.append("未识别到姓名，请手工填写。")
    elif name_result[1] < 0.82:
        warnings.append("姓名识别置信度偏低，请核对。")

    gender = None
    birth_date = None
    if selected_id and checksum_valid:
        gender, birth_date = parse_id_identity(selected_id)

    return {
        "name": {"value": name_result[0], "confidence": round(name_result[1], 4)} if name_result else None,
        "id_number": {
            "value": selected_id,
            "confidence": round(id_score, 4),
            "checksum_valid": checksum_valid,
        }
        if selected_id
        else None,
        "gender": gender,
        "birth_date": birth_date.isoformat() if birth_date else None,
        "raw_lines": [
            {"text": normalize_text(line.text), "score": round(line.score, 4)} for line in lines if line.text.strip()
        ],
        "warnings": warnings,
    }
