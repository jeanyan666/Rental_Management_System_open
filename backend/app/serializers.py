from __future__ import annotations

from datetime import date

from .models import Lease, Room, Tenant


def mask_id_number(id_number: str | None) -> str | None:
    if not id_number:
        return None
    if len(id_number) != 18:
        return "*" * max(0, len(id_number) - 4) + id_number[-4:]
    return f"{id_number[:3]}{'*' * 11}{id_number[-4:]}"


def lease_state(lease: Lease, today: date | None = None) -> tuple[str, int | None]:
    today = today or date.today()
    if lease.status == "ended":
        return "ended", None
    days_left = (lease.end_date - today).days
    if days_left < 0:
        return "expired", days_left
    if days_left <= 30:
        return "expiring", days_left
    return "active", days_left


def lease_payload(lease: Lease, today: date | None = None) -> dict:
    state, days_left = lease_state(lease, today)
    room = lease.room
    tenant = lease.tenant
    return {
        "id": lease.id,
        "tenant": {"id": tenant.id, "name": tenant.name, "phone": tenant.phone},
        "room": {
            "id": room.id,
            "name": room.name,
            "property_id": room.property_id,
            "property_name": room.property.name if room.property else "",
        },
        "start_date": lease.start_date.isoformat(),
        "end_date": lease.end_date.isoformat(),
        "rent_cents": lease.rent_cents,
        "deposit_cents": lease.deposit_cents,
        "rent_due_day": lease.rent_due_day,
        "billing_cycle": lease.billing_cycle,
        "signed_date": lease.signed_date.isoformat() if lease.signed_date else None,
        "status": lease.status,
        "display_status": state,
        "days_left": days_left,
        "note": lease.note,
        "created_at": lease.created_at.isoformat(timespec="seconds") if lease.created_at else None,
    }


def tenant_payload(tenant: Tenant, active_lease: Lease | None = None) -> dict:
    lease = active_lease
    return {
        "id": tenant.id,
        "name": tenant.name,
        "phone": tenant.phone,
        "id_number_masked": mask_id_number(tenant.id_number),
        "has_id_number": bool(tenant.id_number),
        "has_id_image": bool(tenant.id_image_path),
        "gender": tenant.gender,
        "birth_date": tenant.birth_date.isoformat() if tenant.birth_date else None,
        "emergency_name": tenant.emergency_name,
        "emergency_phone": tenant.emergency_phone,
        "note": tenant.note,
        "created_at": tenant.created_at.isoformat(timespec="seconds") if tenant.created_at else None,
        "active_lease": (
            {
                "id": lease.id,
                "room_id": lease.room_id,
                "room_name": lease.room.name if lease.room else "",
                "property_name": lease.room.property.name if lease.room and lease.room.property else "",
                "end_date": lease.end_date.isoformat(),
                "display_status": lease_state(lease)[0],
            }
            if lease
            else None
        ),
    }


def room_payload(room: Room, active_lease: Lease | None = None) -> dict:
    lease = active_lease
    return {
        "id": room.id,
        "property_id": room.property_id,
        "property_name": room.property.name if room.property else "",
        "name": room.name,
        "floor": room.floor,
        "area": room.area,
        "rent_cents": room.rent_cents,
        "status": room.status,
        "note": room.note,
        "current_lease": (
            {
                "id": lease.id,
                "tenant_id": lease.tenant_id,
                "tenant_name": lease.tenant.name if lease.tenant else "",
                "start_date": lease.start_date.isoformat(),
                "end_date": lease.end_date.isoformat(),
                "display_status": lease_state(lease)[0],
            }
            if lease
            else None
        ),
    }


def property_payload(prop, active_by_room: dict[int, Lease]) -> dict:
    rooms = [room_payload(room, active_by_room.get(room.id)) for room in prop.rooms]
    return {
        "id": prop.id,
        "name": prop.name,
        "address": prop.address,
        "note": prop.note,
        "rooms": rooms,
        "room_count": len(rooms),
        "occupied_count": sum(1 for room in rooms if room["status"] == "occupied"),
        "vacant_count": sum(1 for room in rooms if room["status"] == "vacant"),
    }
