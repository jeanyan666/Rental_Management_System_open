from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import require_admin_access
from ..models import Lease, Room, Tenant
from ..schemas import LeaseDueDayIn, LeaseIn, TerminateLeaseIn
from ..serializers import lease_payload, lease_state
from ..services.accounts import disable_tenant_account, ensure_tenant_account
from ..services.queries import load_active_leases
from ..services.rent_billing import (
    ensure_initial_anchor15_bill,
    reconcile_lease_termination,
    update_unpaid_due_dates,
)

router = APIRouter(prefix="/api/leases", tags=["leases"], dependencies=[Depends(require_admin_access)])


def _lease_query():
    return select(Lease).options(
        selectinload(Lease.tenant),
        selectinload(Lease.room).selectinload(Room.property),
    )


def _load_lease(db: Session, lease_id: int) -> Lease:
    lease = db.scalar(_lease_query().where(Lease.id == lease_id))
    if lease is None:
        raise HTTPException(status_code=404, detail="合同不存在")
    return lease


@router.get("")
def list_leases(status_filter: str = "all", db: Session = Depends(get_db)):
    leases = list(db.scalars(_lease_query().order_by(Lease.start_date.desc(), Lease.id.desc())).all())
    active_count = sum(1 for lease in leases if lease.status == "active")
    ended_count = sum(1 for lease in leases if lease.status == "ended")
    attention_count = sum(
        1 for lease in leases if lease.status == "active" and lease_state(lease)[0] in {"expiring", "expired"}
    )
    all_count = len(leases)
    if status_filter == "active":
        leases = [lease for lease in leases if lease.status == "active"]
    elif status_filter == "ended":
        leases = [lease for lease in leases if lease.status == "ended"]
    return {
        "leases": [lease_payload(lease) for lease in leases],
        "summary": {
            "all": all_count,
            "active": active_count,
            "ended": ended_count,
            "attention": attention_count,
        },
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_lease(payload: LeaseIn, db: Session = Depends(get_db)):
    if payload.rent_due_day != 15:
        raise HTTPException(status_code=400, detail="新合同收租日固定为每月15日")
    tenant = db.get(Tenant, payload.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="租客不存在")
    room = db.scalar(select(Room).options(selectinload(Room.property)).where(Room.id == payload.room_id))
    if room is None:
        raise HTTPException(status_code=404, detail="房间不存在")
    if room.status == "maintenance":
        raise HTTPException(status_code=409, detail="该房间正在维修，无法签约")
    if room.status == "occupied":
        raise HTTPException(status_code=409, detail="该房间已有未结束的合同")

    existing_room_lease = db.scalar(
        select(Lease.id).where(Lease.room_id == payload.room_id, Lease.status == "active").limit(1)
    )
    if existing_room_lease:
        raise HTTPException(status_code=409, detail="该房间已有未结束的合同")
    existing_tenant_lease = db.scalar(
        select(Lease.id).where(Lease.tenant_id == payload.tenant_id, Lease.status == "active").limit(1)
    )
    if existing_tenant_lease:
        raise HTTPException(status_code=409, detail="该租客已有未结束的合同，请先办理退租")

    lease = Lease(
        tenant_id=payload.tenant_id,
        room_id=payload.room_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        rent_cents=payload.rent_cents,
        deposit_cents=payload.deposit_cents,
        rent_due_day=15,
        billing_cycle="anchor15",
        signed_date=payload.signed_date or date.today(),
        note=payload.note,
        status="active",
    )
    room.status = "occupied"
    db.add(lease)
    ensure_tenant_account(db, tenant, room, activate=True)
    try:
        db.flush()
        ensure_initial_anchor15_bill(db, lease)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="合同与现有租约冲突，请刷新后重试") from exc
    return {"lease": lease_payload(_load_lease(db, lease.id))}


@router.patch("/{lease_id}/due-day")
def update_due_day(lease_id: int, payload: LeaseDueDayIn, db: Session = Depends(get_db)):
    lease = _load_lease(db, lease_id)
    if lease.billing_cycle == "anchor15":
        raise HTTPException(status_code=400, detail="该合同固定每月15日收租")
    lease.rent_due_day = payload.rent_due_day
    update_unpaid_due_dates(db, lease)
    db.commit()
    return {"lease": lease_payload(_load_lease(db, lease.id))}


@router.post("/{lease_id}/terminate")
def terminate_lease(lease_id: int, payload: TerminateLeaseIn, db: Session = Depends(get_db)):
    lease = _load_lease(db, lease_id)
    if lease.status != "active":
        raise HTTPException(status_code=409, detail="该合同已结束")
    actual_end = payload.end_date or date.today()
    if actual_end < lease.start_date:
        raise HTTPException(status_code=400, detail="退租日期不能早于合同开始日期")
    lease.end_date = actual_end
    lease.status = "ended"
    if payload.note:
        lease.note = f"{lease.note}\n{payload.note}".strip() if lease.note else payload.note
    room = db.get(Room, lease.room_id)
    if room is not None and room.status == "occupied":
        room.status = "vacant"
    settlement = reconcile_lease_termination(db, lease)
    disable_tenant_account(db, lease.tenant_id, room, actual_end)
    db.commit()
    return {
        "lease": lease_payload(_load_lease(db, lease.id)),
        "settlement": settlement,
    }
