from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from .config import KEEPALIVE_INTERVAL, KEEPALIVE_URL, OCR_WARMUP, STATIC_DIR
from .database import SessionLocal, init_db
from .routers import (
    accounts,
    auth,
    backup,
    dashboard,
    leases,
    ocr,
    properties,
    rents,
    tenant_portal,
    tenants,
    utilities,
)
from .seed import ensure_admin
from .services.accounts import ensure_missing_tenant_accounts
from .services.files import cleanup_temp_files
from .services.keepalive import start_keepalive
from .services.ocr_engine import start_background_warmup
from .services.rent_billing import rebuild_203_anchor15, repair_203_anchor15_bills

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    ensure_admin()
    ensure_missing_tenant_accounts()
    with SessionLocal() as db:
        rebuild_203_anchor15(db)
        repair_203_anchor15_bills(db)
    cleanup_temp_files()
    if OCR_WARMUP:
        start_background_warmup()
    start_keepalive(KEEPALIVE_URL, KEEPALIVE_INTERVAL)
    yield


app = FastAPI(
    title="梁寓租务",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)

app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=5)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.url.path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(properties.router)
app.include_router(tenants.router)
app.include_router(leases.router)
app.include_router(rents.router)
app.include_router(utilities.router)
app.include_router(accounts.router)
app.include_router(backup.router)
app.include_router(tenant_portal.router)
app.include_router(ocr.router)


@app.get("/api/health")
def health():
    return {"ok": True, "app": "qiyu-rental", "version": "0.1.0"}


if (STATIC_DIR / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="接口不存在")
    candidate = (STATIC_DIR / full_path).resolve()
    if STATIC_DIR.resolve() in candidate.parents and candidate.is_file():
        return FileResponse(candidate)
    index = STATIC_DIR / "index.html"
    if not index.is_file():
        return JSONResponse({"detail": "前端资源尚未构建"}, status_code=404)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
