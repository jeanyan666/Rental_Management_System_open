#!/usr/bin/env python3
from __future__ import annotations

import os
import sqlite3
import tarfile
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "app-data"
UPLOAD_DIR = PROJECT_ROOT / "app-data" / "uploads"
BACKUP_DIR = PROJECT_ROOT / "backups"


def main() -> None:
    source_db = DATA_DIR / "rental.db"
    if not source_db.exists():
        raise SystemExit("尚未创建数据库，无需备份。")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target_dir = BACKUP_DIR / stamp
    target_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(target_dir, 0o700)
    except OSError:
        pass

    database_copy = target_dir / "rental.db"
    with sqlite3.connect(f"file:{source_db}?mode=ro", uri=True) as source:
        with sqlite3.connect(database_copy) as destination:
            source.backup(destination)
    try:
        os.chmod(database_copy, 0o600)
    except OSError:
        pass

    if UPLOAD_DIR.exists() and any(UPLOAD_DIR.iterdir()):
        archive = target_dir / "uploads.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(UPLOAD_DIR, arcname="uploads")
        try:
            os.chmod(archive, 0o600)
        except OSError:
            pass

    print(f"备份完成：{target_dir}")


if __name__ == "__main__":
    main()
