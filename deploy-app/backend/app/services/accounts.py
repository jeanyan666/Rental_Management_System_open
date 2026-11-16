from __future__ import annotations

import logging
import re
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import Lease, Room, Tenant, User
from ..security import hash_password

logger = logging.getLogger(__name__)


def _phone_digits(phone: str | None) -> str:
    return re.sub(r"\D", "", phone or "")


def default_password(tenant: Tenant, room: Room | None) -> str:
    suffix = ""
    if tenant.id_number and len(tenant.id_number) >= 4:
        suffix = tenant.id_number[-4:].upper()
    elif _phone_digits(tenant.phone):
        suffix = _phone_digits(tenant.phone)[-4:]
    else:
        suffix = secrets.token_hex(3).upper()
    room_part = re.sub(r"\s+", "", room.name) if room else ""
    return f"{room_part}{suffix}" if room_part else f"QY{suffix}"


def _available_username(db: Session, candidate: str, user_id: int | None = None) -> bool:
    query = select(User.id).where(User.username == candidate)
    if user_id is not None:
        query = query.where(User.id != user_id)
    return db.scalar(query.limit(1)) is None


def room_username(room: Room | None) -> str:
    return re.sub(r"\s+", "", room.name) if room and room.name else ""


def username_for_tenant(
    db: Session,
    tenant: Tenant,
    room: Room | None,
    user_id: int | None = None,
) -> str:
    preferred = room_username(room)
    if preferred and _available_username(db, preferred, user_id):
        return preferred
    fallback = f"{preferred or 'room'}-{tenant.id}"
    if _available_username(db, fallback, user_id):
        return fallback
    suffix = 2
    while not _available_username(db, f"{fallback}-{suffix}", user_id):
        suffix += 1
    return f"{fallback}-{suffix}"


def assign_room_username(db: Session, tenant_id: int, room: Room | None) -> bool:
    user = account_for_tenant(db, tenant_id)
    preferred = room_username(room)
    if user is None or not preferred:
        return False
    if user.username == preferred:
        return False
    if _available_username(db, preferred, user.id):
        user.username = preferred
        return True
    return False


def active_room_for_tenant(db: Session, tenant_id: int) -> Room | None:
    lease = db.scalar(
        select(Lease)
        .where(Lease.tenant_id == tenant_id, Lease.status == "active")
        .options(selectinload(Lease.room))
        .order_by(Lease.start_date.desc(), Lease.id.desc())
        .limit(1)
    )
    return lease.room if lease else None


def account_for_tenant(db: Session, tenant_id: int) -> User | None:
    return db.scalar(select(User).where(User.tenant_id == tenant_id, User.role == "tenant"))


def ensure_tenant_account(
    db: Session,
    tenant: Tenant,
    room: Room | None = None,
    *,
    activate: bool = True,
    reset_password: bool = False,
) -> tuple[User, str | None]:
    room = room or active_room_for_tenant(db, tenant.id)
    user = account_for_tenant(db, tenant.id)
    temporary_password: str | None = None
    if user is None:
        temporary_password = default_password(tenant, room)
        user = User(
            username=username_for_tenant(db, tenant, room),
            password_hash=hash_password(temporary_password),
            display_name=tenant.name,
            role="tenant",
            tenant_id=tenant.id,
            must_change_password=False,
            is_active=True,
        )
        db.add(user)
        return user, temporary_password

    user.display_name = tenant.name
    if room is not None:
        assign_room_username(db, tenant.id, room)
    if activate:
        user.is_active = True
    if reset_password:
        temporary_password = default_password(tenant, room)
        user.password_hash = hash_password(temporary_password)
        user.must_change_password = False
    return user, temporary_password


def disable_tenant_account(
    db: Session,
    tenant_id: int,
    room: Room | None = None,
    ended_on=None,
) -> None:
    user = account_for_tenant(db, tenant_id)
    if user is None:
        return
    base = room_username(room)
    if base:
        base = f"{base}-{ended_on:%Y%m%d}" if ended_on else f"{base}-archived"
        candidate = base
        suffix = 2
        while not _available_username(db, candidate, user.id):
            candidate = f"{base}-{suffix}"
            suffix += 1
        user.username = candidate
    user.is_active = False
    user.session_version += 1


def sync_tenant_account_profile(db: Session, tenant: Tenant) -> None:
    user = account_for_tenant(db, tenant.id)
    if user is not None:
        user.display_name = tenant.name


def ensure_missing_tenant_accounts() -> None:
    from ..database import SessionLocal

    with SessionLocal() as db:
        leases = db.scalars(
            select(Lease)
            .where(Lease.status == "active")
            .options(selectinload(Lease.tenant), selectinload(Lease.room))
        ).all()
        created = 0
        updated = 0
        for lease in leases:
            if lease.tenant is None or lease.room is None:
                continue
            if account_for_tenant(db, lease.tenant_id) is not None:
                if assign_room_username(db, lease.tenant_id, lease.room):
                    updated += 1
                continue
            ensure_tenant_account(db, lease.tenant, lease.room)
            created += 1
        if created or updated:
            db.commit()
            if created:
                logger.info("已为 %s 位在租租客补建登录账号", created)
            if updated:
                logger.info("已同步 %s 位在租租客的登录名为房号", updated)
