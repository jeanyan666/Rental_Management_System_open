#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -x ".venv/bin/uvicorn" ]]; then
  echo "未找到 Python 环境，请先按 README.md 安装依赖。" >&2
  exit 1
fi

if [[ ! -f "frontend/dist/index.html" ]]; then
  echo "未找到前端构建产物，正在构建……"
  (cd frontend && npm install && npm run build)
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

exec .venv/bin/uvicorn backend.app.main:app --host "$HOST" --port "$PORT"
