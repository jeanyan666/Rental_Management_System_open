from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("RENTAL_DATA_DIR", PROJECT_ROOT / "app-data")).resolve()
UPLOAD_DIR = Path(os.environ.get("RENTAL_UPLOAD_DIR", PROJECT_ROOT / "app-data" / "uploads")).resolve()
STATIC_DIR = Path(os.environ.get("RENTAL_STATIC_DIR", PROJECT_ROOT / "frontend" / "dist")).resolve()
BACKUP_DIR = Path(os.environ.get("RENTAL_BACKUP_DIR", DATA_DIR / "backups")).resolve()

DB_PATH = DATA_DIR / "rental.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"
SQLITE_JOURNAL_MODE = os.environ.get("RENTAL_SQLITE_JOURNAL", "wal").lower()
if SQLITE_JOURNAL_MODE not in {"wal", "memory", "delete"}:
    SQLITE_JOURNAL_MODE = "wal"

SECRET_FILE = DATA_DIR / ".secret_key"
COOKIE_NAME = "qiyu_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 7
COOKIE_SECURE = os.environ.get("RENTAL_COOKIE_SECURE", "false").lower() in {"1", "true", "yes"}
OCR_WARMUP = os.environ.get("RENTAL_OCR_WARMUP", "true").lower() in {"1", "true", "yes"}
OCR_ENGINE = os.environ.get("RENTAL_OCR_ENGINE", "paddleocr").lower()
if OCR_ENGINE not in {"paddleocr", "rapidocr"}:
    OCR_ENGINE = "paddleocr"
KEEPALIVE_URL = os.environ.get("RENTAL_KEEPALIVE_URL", "").strip()
try:
    KEEPALIVE_INTERVAL = int(os.environ.get("RENTAL_KEEPALIVE_INTERVAL", "240"))
except ValueError:
    KEEPALIVE_INTERVAL = 240

ADMIN_USERNAME = os.environ.get("RENTAL_ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("RENTAL_ADMIN_PASSWORD", "change-me")
ADMIN_DISPLAY_NAME = os.environ.get("RENTAL_ADMIN_NAME", "房东")

MAX_UPLOAD_BYTES = 12 * 1024 * 1024

for directory in (DATA_DIR, UPLOAD_DIR, UPLOAD_DIR / "tmp", UPLOAD_DIR / "id-cards", BACKUP_DIR):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
