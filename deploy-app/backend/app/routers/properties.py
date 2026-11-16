from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import require_admin_access
from ..models import Lease, Property, Room, User, UtilityRecord
from ..schemas import PropertyIn, RoomIn
from ..serializers import property_payload, room_payload
from ..services.accounts import account_for_tenant, assign_room_username
from ..services.queries import active_by_room, load_active_leases

router = APIRouter(prefix="/api", tags=["properties"], dependencies=[Depends(require_admin_access)])


def _get_property(db: Session, property_id: int) -> Property:
    prop = db.scalar(
        select(Property).where(Property.id == property_id).options(selectinload(Property.rooms))
    )
    if prop is None:
        raise HTTPException(status_code=404, detail="房源不存在")
    return prop


def _get_room(db: Session, room_id: int) -> Room:
    room = db.get(Room, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="房间不存在")
    return room


def _active_lease_for_room(db: Session, room_id: int) -> Lease | None:
    return db.scalar(
        select(Lease)
        .where(Lease.room_id == room_id, Lease.status == "active")
        .order_by(Lease.start_date.desc(), Lease.id.desc())
        .limit(1)
    )


@router.get("/properties")
def list_properties(db: Session = Depends(get_db)):
    properties = db.scalars(
        select(Property).options(selectinload(Property.rooms)).order_by(Property.created_at, Property.id)
    ).all()
    leases = load_active_leases(db)
    by_room = active_by_room(leases)
    return {"properties": [property_payload(prop, by_room) for prop in properties]}


@router.post("/properties", status_code=status.HTTP_201_CREATED)
def create_property(payload: PropertyIn, db: Session = Depends(get_db)):
    prop = Property(name=payload.name, address=payload.address, note=payload.note)
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return {"property": property_payload(prop, {})}


@router.patch("/properties/{property_id}")
def update_property(property_id: int, payload: PropertyIn, db: Session = Depends(get_db)):
    prop = _get_property(db, property_id)
    prop.name = payload.name
    prop.address = payload.address
    prop.note = payload.note
    db.commit()
    leases = load_active_leases(db)
    return {"property": property_payload(prop, active_by_room(leases))}


@router.delete("/properties/{property_id}")
def delete_property(property_id: int, db: Session = Depends(get_db)):
    prop = _get_property(db, property_id)
    if prop.rooms:
        raise HTTPException(status_code=409, detail="该房屋下还有房间，无法删除")
    db.delete(prop)
    db.commit()
    return {"ok": True}


@router.post("/properties/{property_id}/rooms", status_code=status.HTTP_201_CREATED)
def create_room(property_id: int, payload: RoomIn, db: Session = Depends(get_db)):
    _get_property(db, property_id)
    if payload.status == "occupied":
        raise HTTPException(status_code=400, detail="房间需通过创建合同标记为已租")
    room = Room(
        property_id=property_id,
        name=payload.name,
        floor=payload.floor,
        area=payload.area,
        rent_cents=payload.rent_cents,
        status=payload.status,
        note=payload.note,
    )
    db.add(room)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该房屋下已有同名房间") from exc
    db.refresh(room)
    return {"room": room_payload(room)}


@router.patch("/rooms/{room_id}")
def update_room(room_id: int, payload: RoomIn, db: Session = Depends(get_db)):
    room = _get_room(db, room_id)
    active_lease = _active_lease_for_room(db, room_id)
    if active_lease and payload.status != "occupied":
        raise HTTPException(status_code=409, detail="该房间有未结束的合同，请先办理退租")
    if not active_lease and payload.status == "occupied":
        raise HTTPException(status_code=400, detail="房间需通过创建合同标记为已租")
    name_changed = payload.name != room.name
    room.name = payload.name
    room.floor = payload.floor
    room.area = payload.area
    room.rent_cents = payload.rent_cents
    room.status = payload.status
    room.note = payload.note
    if active_lease and name_changed:
        user = account_for_tenant(db, active_lease.tenant_id)
        if user is not None and user.username != room.name:
            if not assign_room_username(db, active_lease.tenant_id, room):
                db.rollback()
                raise HTTPException(status_code=409, detail="新房号已被其他登录账号占用")
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该房屋下已有同名房间") from exc
    return {"room": room_payload(room, active_lease)}


@router.delete("/rooms/{room_id}")
def delete_room(room_id: int, db: Session = Depends(get_db)):
    room = _get_room(db, room_id)
    lease_exists = db.scalar(select(Lease.id).where(Lease.room_id == room_id).limit(1))
    if lease_exists:
        raise HTTPException(status_code=409, detail="该房间已有合同记录，无法删除")
    utility_exists = db.scalar(
        select(UtilityRecord.id).where(UtilityRecord.room_id == room_id).limit(1)
    )
    if utility_exists:
        raise HTTPException(status_code=409, detail="该房间已有水电记录，无法删除")
    db.delete(room)
    db.commit()
    return {"ok": True}
