from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import Lease, Room


def load_active_leases(db: Session) -> list[Lease]:
    statement = (
        select(Lease)
        .where(Lease.status == "active")
        .options(
            selectinload(Lease.tenant),
            selectinload(Lease.room).selectinload(Room.property),
        )
        .order_by(Lease.start_date.desc(), Lease.id.desc())
    )
    return list(db.scalars(statement).all())


def active_by_room(leases: list[Lease]) -> dict[int, Lease]:
    mapping: dict[int, Lease] = {}
    for lease in leases:
        mapping.setdefault(lease.room_id, lease)
    return mapping


def active_by_tenant(leases: list[Lease]) -> dict[int, Lease]:
    mapping: dict[int, Lease] = {}
    for lease in leases:
        mapping.setdefault(lease.tenant_id, lease)
    return mapping
