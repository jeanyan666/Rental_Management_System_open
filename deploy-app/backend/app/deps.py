from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .config import COOKIE_NAME
from .database import get_db
from .models import User
from .security import read_session


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    session = read_session(request.cookies.get(COOKIE_NAME))
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    user_id, session_version = session
    user = db.get(User, user_id)
    if user is None or user.session_version != session_version:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已失效，请重新登录")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已停用，请联系管理员")
    return user


def require_super_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="没有管理员权限")
    return user


def require_admin_access(request: Request, user: User = Depends(get_current_user)) -> User:
    if user.role not in {"super_admin", "viewer"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="没有管理员权限")
    if user.role == "viewer" and request.method not in {"GET", "HEAD", "OPTIONS"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只读管理员不能修改数据")
    return user


def require_tenant(user: User = Depends(get_current_user)) -> User:
    if user.role != "tenant" or user.tenant_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="没有租客账号权限")
    return user


def require_tenant_ready(user: User = Depends(require_tenant)) -> User:
    # Tenant passwords are reset by the super admin; no forced first-login change.
    return user
