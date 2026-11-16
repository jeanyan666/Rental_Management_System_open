#!/usr/bin/env bash
set -euo pipefail

# 机密配置：参考 .env.example 创建 .env.local 并填入真实值（该文件不入库）
if [ -f "$PWD/.env.local" ]; then
  # shellcheck disable=SC1091
  . "$PWD/.env.local"
fi

export RENTAL_DATA_DIR="$PWD/app-data"
export RENTAL_UPLOAD_DIR="$PWD/app-data/uploads"
export RENTAL_BACKUP_DIR="$PWD/app-data/backups"
export RENTAL_STATIC_DIR="$PWD/web"
export RENTAL_ADMIN_USERNAME="${RENTAL_ADMIN_USERNAME:-admin}"
export RENTAL_ADMIN_PASSWORD="${RENTAL_ADMIN_PASSWORD:-change-me-before-deploy}"
export RENTAL_COOKIE_SECURE="true"
export RENTAL_OCR_WARMUP="true"
export RENTAL_OCR_ENGINE="rapidocr"
export RENTAL_KEEPALIVE_URL="${RENTAL_KEEPALIVE_URL:-}"
export RENTAL_KEEPALIVE_INTERVAL="60"
export PYTHONUNBUFFERED="1"
exec python -m uvicorn backend.app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
