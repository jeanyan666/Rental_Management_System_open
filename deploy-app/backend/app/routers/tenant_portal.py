from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import require_tenant_ready
from ..models import Lease, RentBill, Room, Tenant, User, UtilityRecord
from ..serializers import lease_state, mask_id_number
from ..services.rent_billing import (
    bill_payload,
    bill_status,
    ensure_bills_for_period,
    rent_summary,
)

router = APIRouter(prefix="/api/tenant-portal", tags=["tenant-portal"])


def _month_add(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def _ensure_recent_bills(db: Session, leases: list[Lease]) -> None:
    today = date.today()
    start_limit_year, start_limit_month = _month_add(today.year, today.month, -5)
    start_limit = date(start_limit_year, start_limit_month, 1)
    for lease in leases:
        if lease.end_date < start_limit or lease.start_date > today:
            continue
        start = max(date(lease.start_date.year, lease.start_date.month, 1), start_limit)
        end = min(lease.end_date, today)
        year, month = start.year, start.month
        while (year, month) <= (end.year, end.month):
            period = f"{year:04d}-{month:02d}"
            ensure_bills_for_period(db, period)
            year, month = _month_add(year, month, 1)


def _tenant_utility_payload(record: UtilityRecord) -> dict:
    return {
        "id": record.id,
        "period": record.period,
        "reading_date": record.reading_date.isoformat(),
        "room_name": record.room.name if record.room else "",
        "property_name": (
            record.room.property.name if record.room and record.room.property else ""
        ),
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
        "total_cents": record.water_amount_cents + record.electricity_amount_cents,
        "is_paid": record.is_paid,
        "paid_at": record.paid_at.isoformat(timespec="seconds") if record.paid_at else None,
        "note": record.note,
    }


@router.get("/overview")
def tenant_overview(
    user: User = Depends(require_tenant_ready),
    db: Session = Depends(get_db),
):
    tenant = db.get(Tenant, user.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="租客资料不存在")
    leases = list(
        db.scalars(
            select(Lease)
            .where(Lease.tenant_id == tenant.id)
            .options(
                selectinload(Lease.room).selectinload(Room.property),
            )
            .order_by(Lease.start_date.desc(), Lease.id.desc())
        ).all()
    )
    active_lease = next((lease for lease in leases if lease.status == "active"), None)
    _ensure_recent_bills(db, leases)
    today = date.today()
    current_period = today.strftime("%Y-%m")
    next_year, next_month = _month_add(today.year, today.month, 1)
    next_period = f"{next_year:04d}-{next_month:02d}"
    ensure_bills_for_period(db, next_period)
    utility_year, utility_month = _month_add(today.year, today.month, -1)
    utility_display_period = f"{utility_year:04d}-{utility_month:02d}"

    all_bills = list(
        db.scalars(
            select(RentBill)
            .where(RentBill.tenant_id == tenant.id)
            .options(
                selectinload(RentBill.payment),
                selectinload(RentBill.lease),
            )
            .order_by(RentBill.period.desc(), RentBill.id.desc())
        ).all()
    )
    bills = [
        bill
        for bill in all_bills
        if bill.period == next_period
        or (bill.period <= current_period and bill_status(bill, today)[0] != "paid")
    ]
    all_utilities = list(
        db.scalars(
            select(UtilityRecord)
            .where(UtilityRecord.tenant_id == tenant.id)
            .options(selectinload(UtilityRecord.room).selectinload(Room.property))
            .order_by(UtilityRecord.period.desc(), UtilityRecord.id.desc())
        ).all()
    )
    utilities = [
        record
        for record in all_utilities
        if utility_display_period <= record.period <= current_period
    ]
    current_bill = next((bill for bill in all_bills if bill.period == current_period), None)
    rent = rent_summary(all_bills, today)
    utility_unpaid = sum(
        utility.water_amount_cents + utility.electricity_amount_cents
        for utility in all_utilities
        if not utility.is_paid
    )
    utility_current = [
        utility for utility in all_utilities if utility.period == current_period
    ]
    utility_current_cents = sum(
        utility.water_amount_cents + utility.electricity_amount_cents
        for utility in utility_current
    )
    current_rent_cents = current_bill.amount_cents if current_bill else 0
    current_rent_paid = (
        current_bill.payment.amount_cents
        if current_bill is not None and current_bill.payment is not None
        else 0
    )
    current_utility_unpaid = sum(
        utility.water_amount_cents + utility.electricity_amount_cents
        for utility in utility_current
        if not utility.is_paid
    )
    current_payable = current_rent_cents + utility_current_cents
    current_unpaid = max(0, current_rent_cents - current_rent_paid) + current_utility_unpaid
    current_payment_status = (
        "none" if current_payable == 0 else ("paid" if current_unpaid == 0 else "unpaid")
    )
    active_state = lease_state(active_lease, today)[0] if active_lease else None

    return {
        "tenant": {
            "id": tenant.id,
            "name": tenant.name,
            "phone": tenant.phone,
            "id_number_masked": mask_id_number(tenant.id_number),
            "gender": tenant.gender,
            "birth_date": tenant.birth_date.isoformat() if tenant.birth_date else None,
        },
        "active_lease": (
            {
                "id": active_lease.id,
                "property_name": active_lease.room.property.name
                if active_lease.room and active_lease.room.property
                else "",
                "room_name": active_lease.room.name if active_lease.room else "",
                "start_date": active_lease.start_date.isoformat(),
                "end_date": active_lease.end_date.isoformat(),
                "rent_cents": active_lease.rent_cents,
                "deposit_cents": active_lease.deposit_cents,
                "rent_due_day": active_lease.rent_due_day,
                "status": active_state,
            }
            if active_lease
            else None
        ),
        "summary": {
            "rent_expected_cents": rent["expected_cents"],
            "rent_received_cents": rent["received_cents"],
            "rent_outstanding_cents": rent["outstanding_cents"],
            "rent_overdue_cents": rent["overdue_cents"],
            "current_rent_cents": current_rent_cents,
            "utility_unpaid_cents": utility_unpaid,
            "utility_current_cents": utility_current_cents,
            "current_payable_cents": current_payable,
            "current_unpaid_cents": current_unpaid,
            "current_payment_status": current_payment_status,
        },
        "rent_bills": [bill_payload(bill, today) for bill in bills],
        "utilities": [_tenant_utility_payload(record) for record in utilities],
    }
