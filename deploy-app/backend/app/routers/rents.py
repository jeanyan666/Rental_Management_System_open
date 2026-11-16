from __future__ import annotations

import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import require_admin_access
from ..models import RentBill, RentPayment, UtilityRecord
from ..schemas import RentPaymentIn
from ..services.rent_billing import (
    bill_payload,
    ensure_bills_for_period,
    period_bounds,
    rent_summary,
)

router = APIRouter(prefix="/api/rents", tags=["rents"], dependencies=[Depends(require_admin_access)])


def _validate_period(period: str) -> str:
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period or ""):
        raise HTTPException(status_code=422, detail="月份格式应为 YYYY-MM")
    return period


def _load_bill(db: Session, bill_id: int) -> RentBill:
    bill = db.scalar(
        select(RentBill)
        .where(RentBill.id == bill_id)
        .options(
            selectinload(RentBill.payment),
            selectinload(RentBill.lease),
        )
    )
    if bill is None:
        raise HTTPException(status_code=404, detail="租金账单不存在")
    return bill


@router.get("")
def rent_overview(period: str | None = None, db: Session = Depends(get_db)):
    period = _validate_period(period or date.today().strftime("%Y-%m"))
    period_bounds(period)
    bills = ensure_bills_for_period(db, period)
    room_ids = {bill.room_id for bill in bills if bill.room_id is not None}
    utility_by_room: dict[int, UtilityRecord] = {}
    if room_ids:
        for record in db.scalars(
            select(UtilityRecord).where(
                UtilityRecord.period == period,
                UtilityRecord.room_id.in_(room_ids),
            )
        ).all():
            utility_by_room[record.room_id] = record

    payloads = []
    for bill in bills:
        payload = bill_payload(bill)
        utility = utility_by_room.get(bill.room_id)
        tenant_utility_cents = (
            utility.water_amount_cents + utility.electricity_amount_cents
            if utility is not None
            else 0
        )
        payload.update(
            {
                "utility_exists": utility is not None,
                "utility_total_cents": tenant_utility_cents,
                "utility_paid": bool(utility and utility.is_paid),
                "combined_total_cents": payload["amount_cents"] + tenant_utility_cents,
            }
        )
        payloads.append(payload)

    return {
        "period": period,
        "bills": payloads,
        "summary": rent_summary(bills),
    }


@router.post("/bills/{bill_id}/payment", status_code=status.HTTP_201_CREATED)
def add_payment(bill_id: int, payload: RentPaymentIn, db: Session = Depends(get_db)):
    bill = _load_bill(db, bill_id)
    if bill.payment is not None:
        raise HTTPException(status_code=409, detail="该账单已经登记过收款")
    payment = RentPayment(
        bill_id=bill.id,
        amount_cents=bill.amount_cents,
        paid_on=payload.paid_on,
        method=payload.method,
        note=payload.note,
    )
    db.add(payment)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该账单已经登记过收款") from exc
    db.expire_all()
    return {"bill": bill_payload(_load_bill(db, bill.id))}


@router.delete("/bills/{bill_id}/payment")
def delete_payment(bill_id: int, db: Session = Depends(get_db)):
    bill = _load_bill(db, bill_id)
    if bill.payment is None:
        raise HTTPException(status_code=404, detail="该账单还没有收款记录")
    db.delete(bill.payment)
    db.commit()
    db.expire_all()
    return {"bill": bill_payload(_load_bill(db, bill.id))}
