from __future__ import annotations

import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import require_super_admin
from ..models import Lease, Room, Tenant, User
from ..schemas import AccountUpdateIn, ViewerAccountIn
from ..security import hash_password
from ..services.accounts import account_for_tenant, default_password, ensure_tenant_account

router = APIRouter(prefix="/api/accounts", tags=["accounts"], dependencies=[Depends(require_super_admin)])


def _tenant_accounts(db: Session) -> list[User]:
    return list(
        db.scalars(
            select(User)
            .where(User.role == "tenant")
            .order_by(User.created_at.desc(), User.id.desc())
        ).all()
    )


def _viewer_account(db: Session) -> User | None:
    return db.scalar(select(User).where(User.role == "viewer").order_by(User.id).limit(1))


def _random_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _active_leases(db: Session) -> dict[int, Lease]:
    leases = db.scalars(
        select(Lease)
        .where(Lease.status == "active")
        .options(selectinload(Lease.room).selectinload(Room.property))
        .order_by(Lease.start_date.desc(), Lease.id.desc())
    ).all()
    mapping: dict[int, Lease] = {}
    for lease in leases:
        mapping.setdefault(lease.tenant_id, lease)
    return mapping


def _account_payload(user: User, tenant: Tenant | None, lease: Lease | None) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "tenant_id": user.tenant_id,
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
        "last_login_at": user.last_login_at.isoformat(timespec="seconds") if user.last_login_at else None,
        "tenant": (
            {
                "id": tenant.id,
                "name": tenant.name,
                "phone": tenant.phone,
                "id_number_masked": (
                    f"{tenant.id_number[:3]}{'*' * 11}{tenant.id_number[-4:]}"
                    if tenant.id_number and len(tenant.id_number) == 18
                    else None
                ),
            }
            if tenant
            else None
        ),
        "active_lease": (
            {
                "id": lease.id,
                "room_name": lease.room.name if lease.room else "",
                "property_name": lease.room.property.name if lease.room and lease.room.property else "",
                "start_date": lease.start_date.isoformat(),
                "end_date": lease.end_date.isoformat(),
            }
            if lease
            else None
        ),
    }


@router.get("")
def list_accounts(db: Session = Depends(get_db)):
    accounts = _tenant_accounts(db)
    tenant_ids = [account.tenant_id for account in accounts if account.tenant_id is not None]
    tenants = {
        tenant.id: tenant
        for tenant in db.scalars(select(Tenant).where(Tenant.id.in_(tenant_ids))).all()
    } if tenant_ids else {}
    leases = _active_leases(db)
    viewer = _viewer_account(db)
    return {
        "accounts": [
            _account_payload(account, tenants.get(account.tenant_id), leases.get(account.tenant_id))
            for account in accounts
        ],
        "viewer": _account_payload(viewer, None, None) if viewer else None,
    }


@router.post("/viewer", status_code=status.HTTP_201_CREATED)
def create_viewer_account(payload: ViewerAccountIn, db: Session = Depends(get_db)):
    if _viewer_account(db) is not None:
        raise HTTPException(status_code=409, detail="系统只允许一个只读管理员账号")
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name or "只读管理员",
        role="viewer",
        must_change_password=False,
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="登录账号已被占用") from exc
    db.refresh(user)
    return {"viewer": _account_payload(user, None, None)}


@router.patch("/{user_id}")
def update_account(user_id: int, payload: AccountUpdateIn, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None or user.role not in {"tenant", "viewer"}:
        raise HTTPException(status_code=404, detail="账号不存在")
    if "username" in payload.model_fields_set and payload.username:
        if user.role == "tenant" and payload.username != user.username:
            raise HTTPException(status_code=400, detail="租客登录名固定为当前房号，不能手动修改")
        user.username = payload.username
    if payload.is_active is not None and payload.is_active != user.is_active:
        user.is_active = payload.is_active
        user.session_version += 1
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="登录账号已被占用") from exc
    db.refresh(user)
    tenant = db.get(Tenant, user.tenant_id) if user.tenant_id else None
    lease = _active_leases(db).get(user.tenant_id) if user.tenant_id else None
    return {"account": _account_payload(user, tenant, lease)}


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None or user.role not in {"tenant", "viewer"}:
        raise HTTPException(status_code=404, detail="账号不存在")
    tenant = None
    lease = None
    if user.role == "tenant":
        if user.tenant_id is None:
            raise HTTPException(status_code=404, detail="租客账号不存在")
        tenant = db.get(Tenant, user.tenant_id)
        if tenant is None:
            raise HTTPException(status_code=404, detail="租客资料不存在")
        lease = _active_leases(db).get(user.tenant_id)
        room = lease.room if lease else None
        temporary_password = default_password(tenant, room)
    else:
        temporary_password = _random_password()

    user.password_hash = hash_password(temporary_password)
    user.must_change_password = False
    user.session_version += 1
    user.is_active = True
    db.commit()
    db.refresh(user)
    return {
        "account": _account_payload(user, tenant, lease),
        "temporary_password": temporary_password,
    }


@router.post("/tenants/{tenant_id}/create")
def create_tenant_account(tenant_id: int, db: Session = Depends(get_db)):
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="租客不存在")
    if account_for_tenant(db, tenant_id) is not None:
        raise HTTPException(status_code=409, detail="该租客已有登录账号")
    lease = _active_leases(db).get(tenant_id)
    room = lease.room if lease else None
    user, password = ensure_tenant_account(db, tenant, room, activate=True)
    db.commit()
    db.refresh(user)
    return {"account": _account_payload(user, tenant, lease), "temporary_password": password}
