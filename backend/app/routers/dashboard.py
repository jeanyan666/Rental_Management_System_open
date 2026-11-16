from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import require_admin_access
from ..models import Lease, Property, Room, Tenant
from ..serializers import lease_payload, room_payload, tenant_payload
from ..services.queries import active_by_room, active_by_tenant, load_active_leases
from ..services.rent_billing import ensure_bills_for_period, rent_summary

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(require_admin_access)])


@router.get("")
def dashboard(db: Session = Depends(get_db)):
    today = date.today()
    properties_count = db.scalar(select(func.count(Property.id))) or 0
    room_counts = dict(
        db.execute(select(Room.status, func.count(Room.id)).group_by(Room.status)).all()
    )
    rooms_count = sum(room_counts.values())
    tenant_count = db.scalar(select(func.count(Tenant.id))) or 0

    active_leases = load_active_leases(db)
    current_leases = [lease for lease in active_leases if lease.end_date >= today]
    attention = sorted(
        [
            lease
            for lease in active_leases
            if lease.end_date <= today + timedelta(days=30)
        ],
        key=lambda lease: lease.end_date,
    )

    recent_tenants = db.scalars(
        select(Tenant).order_by(Tenant.created_at.desc(), Tenant.id.desc()).limit(5)
    ).all()
    by_tenant = active_by_tenant(active_leases)

    vacant_rooms = db.scalars(
        select(Room)
        .where(Room.status == "vacant")
        .options(selectinload(Room.property))
        .order_by(Room.updated_at.desc(), Room.id.desc())
        .limit(5)
    ).all()
    by_room = active_by_room(active_leases)

    occupied_count = room_counts.get("occupied", 0)
    occupancy_rate = round((occupied_count / rooms_count) * 100) if rooms_count else 0
    monthly_rent_cents = sum(lease.rent_cents for lease in current_leases)
    rent_period = today.strftime("%Y-%m")
    rent_bills = ensure_bills_for_period(db, rent_period)

    return {
        "today": today.isoformat(),
        "stats": {
            "properties": properties_count,
            "rooms": rooms_count,
            "occupied_rooms": occupied_count,
            "vacant_rooms": room_counts.get("vacant", 0),
            "maintenance_rooms": room_counts.get("maintenance", 0),
            "tenants": tenant_count,
            "active_leases": len(current_leases),
            "attention_leases": len(attention),
            "monthly_rent_cents": monthly_rent_cents,
            "occupancy_rate": occupancy_rate,
        },
        "attention_leases": [lease_payload(lease, today) for lease in attention[:6]],
        "vacant_rooms": [room_payload(room, by_room.get(room.id)) for room in vacant_rooms],
        "recent_tenants": [
            tenant_payload(tenant, by_tenant.get(tenant.id)) for tenant in recent_tenants
        ],
        "rent": {"period": rent_period, **rent_summary(rent_bills, today)},
    }
