from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..config import COOKIE_NAME, COOKIE_SECURE
from ..database import get_db
from ..deps import require_super_admin
from ..models import User
from ..security import issue_session, rotate_secret, session_ttl_for_role
from ..services.backup import BackupError, build_backup_bytes, import_backup, safety_backup_path

router = APIRouter(prefix="/api/backup", tags=["backup"])
MAX_BACKUP_BYTES = 300 * 1024 * 1024


@router.get("/export")
def export_backup(
    _user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    payload = build_backup_bytes(db)
    filename = f"qiyu-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_backup_file(
    response: Response,
    file: UploadFile = File(...),
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    raw = await file.read(MAX_BACKUP_BYTES + 1)
    if len(raw) > MAX_BACKUP_BYTES:
        raise HTTPException(status_code=413, detail="备份文件不能超过 300MB")
    try:
        result = import_backup(db, raw)
    except BackupError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    rotate_secret()
    current_user = db.get(User, user.id) or user
    max_age = session_ttl_for_role(current_user.role)
    response.set_cookie(
        key=COOKIE_NAME,
        value=issue_session(current_user.id, current_user.session_version, max_age),
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )
    return {"ok": True, **result}


@router.get("/safety/{filename}")
def download_safety_backup(
    filename: str,
    _user: User = Depends(require_super_admin),
):
    try:
        path = safety_backup_path(filename)
    except BackupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="application/zip",
        filename=filename,
        headers={"Cache-Control": "private, no-store"},
    )
