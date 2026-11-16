from __future__ import annotations

import re
from calendar import monthrange
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import require_admin_access
from ..models import Lease, Room, UtilityRecord, UtilitySettings
from ..schemas import (
    UtilityBatchIn,
    UtilityPaidIn,
    UtilityRecordCreate,
    UtilityRecordUpdate,
    UtilitySettingsIn,
)

router = APIRouter(prefix="/api/utilities", tags=["utilities"], dependencies=[Depends(require_admin_access)])


def _period_bounds(period: str) -> tuple[date, date]:
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period or ""):
        raise HTTPException(status_code=422, detail="月份格式应为 YYYY-MM")
    year, month = (int(part) for part in period.split("-"))
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def _current_period() -> str:
    return date.today().strftime("%Y-%m")


def _settings(db: Session) -> UtilitySettings:
    settings = db.get(UtilitySettings, 1)
    if settings is None:
        settings = UtilitySettings(id=1, water_rate_cents=0, electricity_rate_cents=0)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _settings_payload(settings: UtilitySettings) -> dict:
    return {
        "water_rate_cents": settings.water_rate_cents,
        "electricity_rate_cents": settings.electricity_rate_cents,
    }


def _leases_for_period(db: Session, start: date, end: date) -> dict[int, Lease]:
    leases = db.scalars(
        select(Lease)
        .where(Lease.status == "active", Lease.start_date <= end, Lease.end_date >= start)
        .options(selectinload(Lease.tenant))
        .order_by(Lease.start_date.desc(), Lease.id.desc())
    ).all()
    mapping: dict[int, Lease] = {}
    for lease in leases:
        mapping.setdefault(lease.room_id, lease)
    return mapping


def _lease_for_period(db: Session, room_id: int, start: date, end: date) -> Lease | None:
    return db.scalar(
        select(Lease)
        .where(
            Lease.room_id == room_id,
            Lease.status == "active",
            Lease.start_date <= end,
            Lease.end_date >= start,
        )
        .options(selectinload(Lease.tenant))
        .order_by(Lease.start_date.desc(), Lease.id.desc())
        .limit(1)
    )


def _latest_before_map(db: Session, period: str) -> dict[int, UtilityRecord]:
    records = db.scalars(
        select(UtilityRecord)
        .where(UtilityRecord.period < period)
        .order_by(UtilityRecord.period.desc(), UtilityRecord.id.desc())
    ).all()
    mapping: dict[int, UtilityRecord] = {}
    for record in records:
        mapping.setdefault(record.room_id, record)
    return mapping


def _latest_before_record(db: Session, room_id: int, period: str) -> UtilityRecord | None:
    return db.scalar(
        select(UtilityRecord)
        .where(UtilityRecord.room_id == room_id, UtilityRecord.period < period)
        .order_by(UtilityRecord.period.desc(), UtilityRecord.id.desc())
        .limit(1)
    )


def _amount_cents(usage_milli: int, rate_cents: int) -> int:
    return (max(0, usage_milli) * max(0, rate_cents) + 500) // 1000


def _usage_milli(current: int, previous: int, reset: bool, label: str, note: str) -> int:
    if current < previous:
        if not reset:
            raise HTTPException(
                status_code=400,
                detail=f"{label}本期读数小于上期，如已换表或清零，请勾选换表并填写备注",
            )
        if not note.strip():
            raise HTTPException(status_code=400, detail=f"{label}换表或清零时必须填写备注")
        return current
    return current - previous


def _record_payload(record: UtilityRecord) -> dict:
    return {
        "id": record.id,
        "room_id": record.room_id,
        "tenant_id": record.tenant_id,
        "tenant_name": record.tenant_name,
        "period": record.period,
        "reading_date": record.reading_date.isoformat(),
        "water_prev_milli": record.water_prev_milli,
        "water_current_milli": record.water_current_milli,
        "water_usage_milli": record.water_usage_milli,
        "water_rate_cents": record.water_rate_cents,
        "water_amount_cents": record.water_amount_cents,
        "water_reset": record.water_reset,
        "electricity_prev_milli": record.electricity_prev_milli,
        "electricity_current_milli": record.electricity_current_milli,
        "electricity_usage_milli": record.electricity_usage_milli,
        "electricity_rate_cents": record.electricity_rate_cents,
        "electricity_amount_cents": record.electricity_amount_cents,
        "electricity_reset": record.electricity_reset,
        "is_paid": record.is_paid,
        "paid_at": record.paid_at.isoformat(timespec="seconds") if record.paid_at else None,
        "total_cents": record.water_amount_cents + record.electricity_amount_cents,
        "note": record.note,
        "created_at": record.created_at.isoformat(timespec="seconds") if record.created_at else None,
        "updated_at": record.updated_at.isoformat(timespec="seconds") if record.updated_at else None,
    }


def _natural_room_key(name: str):
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", name)]


def _floor_number(floor: str) -> int:
    match = re.search(r"\d+", floor or "")
    return int(match.group()) if match else 999


def _summary(records: list[UtilityRecord], total_rooms: int) -> dict:
    water_total = sum(record.water_amount_cents for record in records)
    electricity_total = sum(record.electricity_amount_cents for record in records)
    paid_records = [record for record in records if record.is_paid]
    unpaid_records = [record for record in records if not record.is_paid]
    return {
        "recorded_rooms": len(records),
        "total_rooms": total_rooms,
        "unrecorded_rooms": max(0, total_rooms - len(records)),
        "water_usage_milli": sum(record.water_usage_milli for record in records),
        "electricity_usage_milli": sum(record.electricity_usage_milli for record in records),
        "water_total_cents": water_total,
        "electricity_total_cents": electricity_total,
        "total_cents": water_total + electricity_total,
        "tenant_receivable_cents": water_total + electricity_total,
        "paid_count": len(paid_records),
        "unpaid_count": len(unpaid_records),
        "paid_cents": sum(
            record.water_amount_cents + record.electricity_amount_cents for record in paid_records
        ),
        "unpaid_cents": sum(
            record.water_amount_cents + record.electricity_amount_cents for record in unpaid_records
        ),
    }


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return {"settings": _settings_payload(_settings(db))}


@router.put("/settings")
def update_settings(payload: UtilitySettingsIn, db: Session = Depends(get_db)):
    settings = _settings(db)
    settings.water_rate_cents = payload.water_rate_cents
    settings.electricity_rate_cents = payload.electricity_rate_cents
    db.commit()
    db.refresh(settings)
    return {"settings": _settings_payload(settings)}


@router.get("")
def utility_overview(period: str | None = None, db: Session = Depends(get_db)):
    period = period or _current_period()
    start, end = _period_bounds(period)
    settings = _settings(db)
    rooms = db.scalars(
        select(Room)
        .options(selectinload(Room.property))
        .order_by(Room.property_id, Room.name)
    ).all()
    records = db.scalars(
        select(UtilityRecord).where(UtilityRecord.period == period)
    ).all()
    record_by_room = {record.room_id: record for record in records}
    previous_by_room = _latest_before_map(db, period)
    lease_by_room = _leases_for_period(db, start, end)

    rows = []
    for room in rooms:
        record = record_by_room.get(room.id)
        lease = lease_by_room.get(room.id)
        if lease is None and record is None:
            continue
        if record is not None:
            previous_water = record.water_prev_milli
            previous_electricity = record.electricity_prev_milli
            previous_editable = False
            tenant_id = record.tenant_id
            tenant_name = record.tenant_name or (lease.tenant.name if lease and lease.tenant else "")
            water_rate = record.water_rate_cents
            electricity_rate = record.electricity_rate_cents
        else:
            prior = previous_by_room.get(room.id)
            previous_water = prior.water_current_milli if prior else 0
            previous_electricity = prior.electricity_current_milli if prior else 0
            previous_editable = prior is None
            tenant_id = lease.tenant_id if lease else None
            tenant_name = lease.tenant.name if lease and lease.tenant else ""
            water_rate = settings.water_rate_cents
            electricity_rate = settings.electricity_rate_cents
        rows.append(
            {
                "room_id": room.id,
                "room_name": room.name,
                "floor": room.floor,
                "room_status": room.status,
                "property_id": room.property_id,
                "property_name": room.property.name if room.property else "",
                "tenant_id": tenant_id,
                "tenant_name": tenant_name,
                "previous_water_milli": previous_water,
                "previous_electricity_milli": previous_electricity,
                "previous_editable": previous_editable,
                "water_rate_cents": water_rate,
                "electricity_rate_cents": electricity_rate,
                "record": _record_payload(record) if record else None,
            }
        )

    rows.sort(
        key=lambda row: (
            row["property_id"],
            _floor_number(row["floor"]),
            _natural_room_key(row["room_name"]),
        )
    )
    return {
        "period": period,
        "settings": _settings_payload(settings),
        "summary": _summary(records, len(rows)),
        "rooms": rows,
    }


@router.post("/records", status_code=status.HTTP_201_CREATED)
def create_record(payload: UtilityRecordCreate, db: Session = Depends(get_db)):
    start, end = _period_bounds(payload.period)
    room = db.get(Room, payload.room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="房间不存在")
    existing = db.scalar(
        select(UtilityRecord)
        .where(UtilityRecord.room_id == payload.room_id, UtilityRecord.period == payload.period)
        .limit(1)
    )
    if existing:
        raise HTTPException(status_code=409, detail="该房间本月已有水电记录")

    settings = _settings(db)
    prior = _latest_before_record(db, payload.room_id, payload.period)
    previous_water = prior.water_current_milli if prior else (payload.water_prev_milli or 0)
    previous_electricity = (
        prior.electricity_current_milli if prior else (payload.electricity_prev_milli or 0)
    )
    lease = _lease_for_period(db, payload.room_id, start, end)
    if lease is None:
        raise HTTPException(status_code=400, detail="该月份没有对应租客，不能录入水电")

    usage_water = _usage_milli(
        payload.water_current_milli,
        previous_water,
        payload.water_reset,
        "水表",
        payload.note,
    )
    usage_electricity = _usage_milli(
        payload.electricity_current_milli,
        previous_electricity,
        payload.electricity_reset,
        "电表",
        payload.note,
    )
    water_rate = (
        settings.water_rate_cents
        if payload.water_rate_cents is None
        else payload.water_rate_cents
    )
    electricity_rate = (
        settings.electricity_rate_cents
        if payload.electricity_rate_cents is None
        else payload.electricity_rate_cents
    )
    is_paid = payload.is_paid
    record = UtilityRecord(
        room_id=payload.room_id,
        tenant_id=lease.tenant_id if lease else None,
        tenant_name=lease.tenant.name if lease and lease.tenant else "",
        period=payload.period,
        reading_date=payload.reading_date,
        water_prev_milli=previous_water,
        water_current_milli=payload.water_current_milli,
        water_usage_milli=usage_water,
        water_rate_cents=water_rate,
        water_amount_cents=_amount_cents(usage_water, water_rate),
        water_reset=payload.water_reset,
        electricity_prev_milli=previous_electricity,
        electricity_current_milli=payload.electricity_current_milli,
        electricity_usage_milli=usage_electricity,
        electricity_rate_cents=electricity_rate,
        electricity_amount_cents=_amount_cents(usage_electricity, electricity_rate),
        electricity_reset=payload.electricity_reset,
        payer_type="tenant",
        is_paid=is_paid,
        paid_at=datetime.now() if is_paid else None,
        note=payload.note,
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该房间本月已有水电记录") from exc
    db.refresh(record)
    return {"record": _record_payload(record)}


@router.put("/records/{record_id}")
def update_record(record_id: int, payload: UtilityRecordUpdate, db: Session = Depends(get_db)):
    record = db.get(UtilityRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="水电记录不存在")
    if not record.tenant_id:
        start, end = _period_bounds(record.period)
        lease = _lease_for_period(db, record.room_id, start, end)
        if lease is None:
            raise HTTPException(status_code=400, detail="该月份没有对应租客，不能录入水电")
        record.tenant_id = lease.tenant_id
        record.tenant_name = lease.tenant.name if lease.tenant else ""

    later = db.scalar(
        select(UtilityRecord.id)
        .where(
            UtilityRecord.room_id == record.room_id,
            UtilityRecord.period > record.period,
        )
        .limit(1)
    )
    readings_changed = (
        payload.water_current_milli != record.water_current_milli
        or payload.electricity_current_milli != record.electricity_current_milli
        or payload.water_rate_cents != record.water_rate_cents
        or payload.electricity_rate_cents != record.electricity_rate_cents
        or payload.water_reset != record.water_reset
        or payload.electricity_reset != record.electricity_reset
    )
    if later and readings_changed:
        raise HTTPException(
            status_code=409,
            detail="该房间已有后续月份的记录，不能修改读数或单价；请先处理后续记录",
        )

    usage_water = _usage_milli(
        payload.water_current_milli,
        record.water_prev_milli,
        payload.water_reset,
        "水表",
        payload.note,
    )
    usage_electricity = _usage_milli(
        payload.electricity_current_milli,
        record.electricity_prev_milli,
        payload.electricity_reset,
        "电表",
        payload.note,
    )
    record.reading_date = payload.reading_date
    record.water_current_milli = payload.water_current_milli
    record.water_usage_milli = usage_water
    record.water_rate_cents = payload.water_rate_cents
    record.water_amount_cents = _amount_cents(usage_water, payload.water_rate_cents)
    record.water_reset = payload.water_reset
    record.electricity_current_milli = payload.electricity_current_milli
    record.electricity_usage_milli = usage_electricity
    record.electricity_rate_cents = payload.electricity_rate_cents
    record.electricity_amount_cents = _amount_cents(usage_electricity, payload.electricity_rate_cents)
    record.electricity_reset = payload.electricity_reset
    record.payer_type = "tenant"
    was_paid = record.is_paid
    record.is_paid = payload.is_paid
    if record.is_paid and not was_paid:
        record.paid_at = datetime.now()
    elif not record.is_paid:
        record.paid_at = None
    record.note = payload.note
    db.commit()
    db.refresh(record)
    return {"record": _record_payload(record)}


@router.post("/records/{record_id}/paid")
def mark_paid(record_id: int, payload: UtilityPaidIn, db: Session = Depends(get_db)):
    record = db.get(UtilityRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="水电记录不存在")
    record.payer_type = "tenant"
    record.is_paid = payload.is_paid
    record.paid_at = datetime.now() if payload.is_paid else None
    db.commit()
    db.refresh(record)
    return {"record": _record_payload(record)}


@router.delete("/records/{record_id}")
def delete_record(record_id: int, db: Session = Depends(get_db)):
    record = db.get(UtilityRecord, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="水电记录不存在")
    later = db.scalar(
        select(UtilityRecord.id)
        .where(
            UtilityRecord.room_id == record.room_id,
            UtilityRecord.period > record.period,
        )
        .limit(1)
    )
    if later:
        raise HTTPException(status_code=409, detail="该房间已有后续月份的记录，不能删除")
    db.delete(record)
    db.commit()
    return {"ok": True}


@router.post("/batch", status_code=status.HTTP_201_CREATED)
def batch_create(payload: UtilityBatchIn, db: Session = Depends(get_db)):
    start, end = _period_bounds(payload.period)
    room_ids = [item.room_id for item in payload.items]
    if len(set(room_ids)) != len(room_ids):
        raise HTTPException(status_code=422, detail="批量记录中存在重复房间")
    rooms = db.scalars(select(Room).where(Room.id.in_(room_ids))).all()
    if len(rooms) != len(set(room_ids)):
        raise HTTPException(status_code=404, detail="部分房间不存在")
    existing = db.scalars(
        select(UtilityRecord).where(
            UtilityRecord.room_id.in_(room_ids),
            UtilityRecord.period == payload.period,
        )
    ).all()
    if existing:
        raise HTTPException(status_code=409, detail="部分房间本月已有记录，请刷新后重试")

    settings = _settings(db)
    water_rate = (
        settings.water_rate_cents
        if payload.water_rate_cents is None
        else payload.water_rate_cents
    )
    electricity_rate = (
        settings.electricity_rate_cents
        if payload.electricity_rate_cents is None
        else payload.electricity_rate_cents
    )
    lease_by_room = _leases_for_period(db, start, end)
    prior_by_room = _latest_before_map(db, payload.period)
    records = []
    for item in payload.items:
        prior = prior_by_room.get(item.room_id)
        previous_water = prior.water_current_milli if prior else (item.water_prev_milli or 0)
        previous_electricity = (
            prior.electricity_current_milli if prior else (item.electricity_prev_milli or 0)
        )
        usage_water = _usage_milli(
            item.water_current_milli, previous_water, False, "水表", item.note
        )
        usage_electricity = _usage_milli(
            item.electricity_current_milli, previous_electricity, False, "电表", item.note
        )
        lease = lease_by_room.get(item.room_id)
        if lease is None:
            raise HTTPException(status_code=400, detail="部分房间该月份没有对应租客，不能录入水电")
        records.append(
            UtilityRecord(
                room_id=item.room_id,
                tenant_id=lease.tenant_id if lease else None,
                tenant_name=lease.tenant.name if lease and lease.tenant else "",
                period=payload.period,
                reading_date=payload.reading_date,
                water_prev_milli=previous_water,
                water_current_milli=item.water_current_milli,
                water_usage_milli=usage_water,
                water_rate_cents=water_rate,
                water_amount_cents=_amount_cents(usage_water, water_rate),
                electricity_prev_milli=previous_electricity,
                electricity_current_milli=item.electricity_current_milli,
                electricity_usage_milli=usage_electricity,
                electricity_rate_cents=electricity_rate,
                electricity_amount_cents=_amount_cents(usage_electricity, electricity_rate),
                payer_type="tenant",
                is_paid=False,
                note=item.note,
            )
        )
    db.add_all(records)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="部分房间本月已有记录，请刷新后重试") from exc
    return {"saved": len(records), "period": payload.period}


@router.get("/rooms/{room_id}/history")
def room_history(room_id: int, db: Session = Depends(get_db)):
    room = db.scalar(select(Room).options(selectinload(Room.property)).where(Room.id == room_id))
    if room is None:
        raise HTTPException(status_code=404, detail="房间不存在")
    records = db.scalars(
        select(UtilityRecord)
        .where(UtilityRecord.room_id == room_id)
        .order_by(UtilityRecord.period.desc(), UtilityRecord.id.desc())
        .limit(36)
    ).all()
    return {
        "room": {
            "id": room.id,
            "name": room.name,
            "floor": room.floor,
            "property_name": room.property.name if room.property else "",
        },
        "records": [_record_payload(record) for record in records],
    }
