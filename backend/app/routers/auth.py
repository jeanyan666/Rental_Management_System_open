from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import COOKIE_NAME, COOKIE_SECURE
from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import ChangePasswordIn, LoginIn
from ..security import hash_password, issue_session, session_ttl_for_role, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "tenant_id": user.tenant_id,
        "must_change_password": user.must_change_password,
        "is_active": user.is_active,
    }


@router.post("/login")
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == payload.username))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码不正确")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已停用，请联系管理员")
    user.last_login_at = datetime.now()
    db.commit()
    max_age = session_ttl_for_role(user.role)
    token = issue_session(user.id, user.session_version, max_age)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )
    return {"user": user_payload(user)}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"user": user_payload(user)}


@router.post("/change-password")
def change_password(
    payload: ChangePasswordIn,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role == "tenant":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="租客账号不支持自行修改密码，请联系房东重置",
        )
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不正确")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    user.session_version += 1
    db.commit()
    db.refresh(user)
    max_age = session_ttl_for_role(user.role)
    response.set_cookie(
        key=COOKIE_NAME,
        value=issue_session(user.id, user.session_version, max_age),
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )
    return {"ok": True, "user": user_payload(user)}
