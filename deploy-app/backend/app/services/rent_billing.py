from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import Lease, RentBill, RentPayment, Room


def period_bounds(period: str) -> tuple[date, date]:
    year, month = (int(part) for part in period.split("-"))
    return date(year, month, 1), date(year, month, monthrange(year, month)[1])


def prorated_amount(monthly_rent_cents: int, days: int, days_in_month: int) -> int:
    if days >= days_in_month:
        return monthly_rent_cents
    # Round half up to the nearest cent without floating point arithmetic.
    return (2 * monthly_rent_cents * days + days_in_month) // (2 * days_in_month)


def prorated_amount_30(monthly_rent_cents: int, days: int) -> int:
    return (2 * monthly_rent_cents * max(0, days) + 30) // 60


def add_months(value: date, months: int) -> date:
    index = value.year * 12 + (value.month - 1) + months
    year, month_index = divmod(index, 12)
    month = month_index + 1
    day = min(value.day, monthrange(year, month)[1])
    return date(year, month, day)


def month_date(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, monthrange(year, month)[1]))


def period_month(period: str) -> date:
    year, month = (int(part) for part in period.split("-"))
    return date(year, month, 1)


def anchor15_initial_end(start_date: date) -> date:
    return add_months(start_date, 1) - timedelta(days=1)


def anchor15_bill_spec(lease: Lease, period: str) -> dict | None:
    """Return coverage and amount for an anchor-15 lease in a due month.

    The move-in bill covers one calendar month. The first 15th bill charges the
    catch-up days before the cycle start (if any) plus one month; later bills
    cover the 15th through the 14th of the following month as one full month.
    """
    due_month = period_month(period)
    start_month = date(lease.start_date.year, lease.start_date.month, 1)
    initial_end = anchor15_initial_end(lease.start_date)
    first_cycle_month = date(
        add_months(lease.start_date, 1).year,
        add_months(lease.start_date, 1).month,
        1,
    )

    if due_month == start_month:
        coverage_start = lease.start_date
        coverage_end = min(initial_end, lease.end_date)
        due_date = lease.start_date
        if coverage_end < coverage_start:
            return None
        days = (coverage_end - coverage_start).days + 1
        full = coverage_end == initial_end
        return {
            "coverage_start": coverage_start,
            "coverage_end": coverage_end,
            "days": days,
            "due_date": due_date,
            "amount_cents": lease.rent_cents if full else prorated_amount_30(lease.rent_cents, days),
            "is_prorated": not full,
            "is_initial": True,
        }

    if due_month < first_cycle_month:
        return None

    cycle_end = month_date(
        add_months(due_month, 1).year,
        add_months(due_month, 1).month,
        14,
    )
    due_date = month_date(due_month.year, due_month.month, 15)

    if due_month == first_cycle_month:
        coverage_start = add_months(lease.start_date, 1)
        coverage_end = min(cycle_end, lease.end_date)
        if coverage_end < coverage_start:
            return None
        pre_days = 0
        if coverage_start < due_date:
            pre_end = min(coverage_end + timedelta(days=1), due_date)
            pre_days = max(0, (pre_end - coverage_start).days)
        post_start = max(coverage_start, due_date)
        post_days = (
            (coverage_end - post_start).days + 1 if coverage_end >= post_start else 0
        )
        full_post = coverage_end == cycle_end and post_start <= due_date
        amount = prorated_amount_30(lease.rent_cents, pre_days)
        if post_days:
            amount += (
                lease.rent_cents
                if full_post
                else prorated_amount_30(lease.rent_cents, post_days)
            )
        return {
            "coverage_start": coverage_start,
            "coverage_end": coverage_end,
            "days": (coverage_end - coverage_start).days + 1,
            "due_date": due_date,
            "amount_cents": amount,
            "is_prorated": pre_days > 0 or not full_post,
            "is_initial": False,
        }

    coverage_start = due_date
    coverage_end = min(cycle_end, lease.end_date)
    if coverage_end < coverage_start:
        return None
    days = (coverage_end - coverage_start).days + 1
    full = coverage_end == cycle_end
    return {
        "coverage_start": coverage_start,
        "coverage_end": coverage_end,
        "days": days,
        "due_date": due_date,
        "amount_cents": lease.rent_cents if full else prorated_amount_30(lease.rent_cents, days),
        "is_prorated": not full,
        "is_initial": False,
    }


def make_bill_from_spec(lease: Lease, period: str, spec: dict) -> RentBill:
    room = lease.room
    return RentBill(
        lease_id=lease.id,
        tenant_id=lease.tenant_id,
        room_id=lease.room_id,
        tenant_name=lease.tenant.name if lease.tenant else "",
        room_name=room.name if room else "",
        property_name=room.property.name if room and room.property else "",
        period=period,
        period_start=spec["coverage_start"],
        period_end=spec["coverage_end"],
        days=spec["days"],
        days_in_month=30,
        monthly_rent_cents=lease.rent_cents,
        amount_cents=spec["amount_cents"],
        due_date=spec["due_date"],
        is_prorated=spec["is_prorated"],
    )


def ensure_initial_anchor15_bill(db: Session, lease: Lease) -> RentBill | None:
    period = lease.start_date.strftime("%Y-%m")
    existing = db.scalar(
        select(RentBill).where(
            RentBill.lease_id == lease.id,
            RentBill.period == period,
        ).limit(1)
    )
    if existing is not None:
        return existing
    spec = anchor15_bill_spec(lease, period)
    if spec is None:
        return None
    bill = make_bill_from_spec(lease, period, spec)
    db.add(bill)
    db.flush()
    db.add(
        RentPayment(
            bill_id=bill.id,
            amount_cents=bill.amount_cents,
            paid_on=lease.start_date,
            method="wechat",
            note="入住首月租金",
        )
    )
    return bill


def ensure_anchor15_bill_for_period(db: Session, lease: Lease, period: str) -> bool:
    existing = db.scalar(
        select(RentBill.id).where(
            RentBill.lease_id == lease.id,
            RentBill.period == period,
        ).limit(1)
    )
    if existing is not None:
        return False
    if period == lease.start_date.strftime("%Y-%m"):
        create = ensure_initial_anchor15_bill(db, lease)
    else:
        spec = anchor15_bill_spec(lease, period)
        if spec is None:
            return False
        db.add(make_bill_from_spec(lease, period, spec))
        create = True
    return bool(create)


def coverage_for_lease(lease: Lease, month_start: date, month_end: date) -> tuple[date, date] | None:
    start = max(lease.start_date, month_start)
    end = min(lease.end_date, month_end)
    if start > end:
        return None
    return start, end


def bill_due_date(
    lease: Lease,
    coverage_start: date,
    coverage_end: date,
    month_start: date,
    month_end: date,
    days_in_month: int,
) -> date:
    if coverage_start > month_start:
        return coverage_start
    due_day = min(max(lease.rent_due_day or 1, 1), days_in_month)
    due = date(month_start.year, month_start.month, due_day)
    if coverage_end < month_end:
        due = min(due, coverage_end)
    return due


def _bill_query():
    return select(RentBill).options(
        selectinload(RentBill.payment),
        selectinload(RentBill.lease),
    )


def load_bills_for_period(db: Session, period: str) -> list[RentBill]:
    return list(
        db.scalars(
            _bill_query()
            .where(RentBill.period == period)
            .order_by(RentBill.property_name, RentBill.room_name, RentBill.id)
        ).all()
    )


def ensure_bills_for_period(db: Session, period: str) -> list[RentBill]:
    month_start, month_end = period_bounds(period)
    days_in_month = monthrange(month_start.year, month_start.month)[1]
    leases = db.scalars(
        select(Lease)
        .where(Lease.start_date <= month_end, Lease.end_date >= month_start)
        .options(
            selectinload(Lease.tenant),
            selectinload(Lease.room).selectinload(Room.property),
        )
        .order_by(Lease.start_date, Lease.id)
    ).all()
    existing = {
        bill.lease_id: bill
        for bill in db.scalars(
            select(RentBill).where(RentBill.period == period)
        ).all()
    }
    created = False
    for lease in leases:
        if lease.id in existing:
            continue
        if lease.billing_cycle == "anchor15":
            created = ensure_anchor15_bill_for_period(db, lease, period) or created
            continue
        coverage = coverage_for_lease(lease, month_start, month_end)
        if coverage is None:
            continue
        coverage_start, coverage_end = coverage
        days = (coverage_end - coverage_start).days + 1
        amount = prorated_amount(lease.rent_cents, days, days_in_month)
        due = bill_due_date(
            lease,
            coverage_start,
            coverage_end,
            month_start,
            month_end,
            days_in_month,
        )
        bill = RentBill(
            lease_id=lease.id,
            tenant_id=lease.tenant_id,
            room_id=lease.room_id,
            tenant_name=lease.tenant.name if lease.tenant else "",
            room_name=lease.room.name if lease.room else "",
            property_name=lease.room.property.name if lease.room and lease.room.property else "",
            period=period,
            period_start=coverage_start,
            period_end=coverage_end,
            days=days,
            days_in_month=days_in_month,
            monthly_rent_cents=lease.rent_cents,
            amount_cents=amount,
            due_date=due,
            is_prorated=days < days_in_month,
        )
        db.add(bill)
        created = True
    if created:
        db.commit()
    return load_bills_for_period(db, period)


def update_unpaid_due_dates(db: Session, lease: Lease) -> None:
    bills = db.scalars(
        _bill_query()
        .where(RentBill.lease_id == lease.id)
        .order_by(RentBill.period)
    ).all()
    for bill in bills:
        if bill.payment is not None:
            continue
        month_start, month_end = period_bounds(bill.period)
        days_in_month = monthrange(month_start.year, month_start.month)[1]
        bill.due_date = bill_due_date(
            lease,
            bill.period_start,
            bill.period_end,
            month_start,
            month_end,
            days_in_month,
        )


def _reconcile_legacy_termination(db: Session, lease: Lease) -> None:
    bills = db.scalars(
        _bill_query()
        .where(RentBill.lease_id == lease.id)
        .order_by(RentBill.period)
    ).all()
    for bill in bills:
        if bill.payment is not None:
            continue
        month_start, month_end = period_bounds(bill.period)
        days_in_month = monthrange(month_start.year, month_start.month)[1]
        if month_start > lease.end_date:
            db.delete(bill)
            continue
        coverage = coverage_for_lease(lease, month_start, month_end)
        if coverage is None:
            db.delete(bill)
            continue
        coverage_start, coverage_end = coverage
        days = (coverage_end - coverage_start).days + 1
        bill.period_start = coverage_start
        bill.period_end = coverage_end
        bill.days = days
        bill.days_in_month = days_in_month
        bill.monthly_rent_cents = lease.rent_cents
        bill.amount_cents = prorated_amount(lease.rent_cents, days, days_in_month)
        bill.is_prorated = days < days_in_month
        bill.due_date = bill_due_date(
            lease,
            coverage_start,
            coverage_end,
            month_start,
            month_end,
            days_in_month,
        )


def _reconcile_anchor15_termination(db: Session, lease: Lease) -> dict:
    bills = db.scalars(
        _bill_query()
        .where(RentBill.lease_id == lease.id)
        .order_by(RentBill.period)
    ).all()
    refund_items: list[dict] = []
    for bill in bills:
        if bill.period_start > lease.end_date:
            if bill.payment is None:
                db.delete(bill)
            elif bill.payment.amount_cents > 0:
                refund_items.append(
                    {
                        "bill_id": bill.id,
                        "period": bill.period,
                        "paid_cents": bill.payment.amount_cents,
                        "actual_cents": 0,
                        "refund_cents": bill.payment.amount_cents,
                    }
                )
            continue
        if bill.period_end <= lease.end_date:
            continue
        if bill.payment is None:
            days = (lease.end_date - bill.period_start).days + 1
            bill.period_end = lease.end_date
            bill.days = days
            bill.days_in_month = 30
            bill.amount_cents = prorated_amount_30(lease.rent_cents, days)
            bill.is_prorated = True
            continue
        days = (lease.end_date - bill.period_start).days + 1
        earned = min(
            bill.payment.amount_cents,
            prorated_amount_30(lease.rent_cents, days),
        )
        refund = max(0, bill.payment.amount_cents - earned)
        if refund:
            refund_items.append(
                {
                    "bill_id": bill.id,
                    "period": bill.period,
                    "paid_cents": bill.payment.amount_cents,
                    "actual_cents": earned,
                    "refund_cents": refund,
                }
            )
    return {
        "refund_due_cents": sum(item["refund_cents"] for item in refund_items),
        "items": refund_items,
    }


def reconcile_lease_termination(db: Session, lease: Lease) -> dict | None:
    if lease.billing_cycle == "anchor15":
        return _reconcile_anchor15_termination(db, lease)
    _reconcile_legacy_termination(db, lease)
    return None


def repair_203_anchor15_bills(db: Session) -> bool:
    """Remove unpaid 203 anchor bills generated by the previous transition formula."""
    leases = db.scalars(
        select(Lease)
        .where(Lease.status == "active", Lease.billing_cycle == "anchor15")
        .options(
            selectinload(Lease.tenant),
            selectinload(Lease.room).selectinload(Room.property),
        )
    ).all()
    target = None
    for lease in leases:
        room = lease.room
        property_ = room.property if room else None
        tenant = lease.tenant
        if (
            room
            and property_
            and tenant
            and property_.name == "梁屋"
            and room.name == "203"
            and tenant.name == "李建江"
        ):
            target = lease
            break
    if target is None:
        return False
    changed = False
    for bill in db.scalars(_bill_query().where(RentBill.lease_id == target.id)).all():
        if bill.payment is not None:
            continue
        spec = anchor15_bill_spec(target, bill.period)
        if spec is None:
            db.delete(bill)
            changed = True
            continue
        if (
            bill.period_start != spec["coverage_start"]
            or bill.period_end != spec["coverage_end"]
            or bill.amount_cents != spec["amount_cents"]
        ):
            db.delete(bill)
            changed = True
    if changed:
        db.commit()
    return changed


def rebuild_203_anchor15(db: Session) -> bool:
    """One-time migration requested by the owner: move the active 203 lease to anchor-15 billing."""
    leases = db.scalars(
        select(Lease)
        .where(Lease.status == "active", Lease.billing_cycle == "legacy")
        .options(
            selectinload(Lease.tenant),
            selectinload(Lease.room).selectinload(Room.property),
        )
    ).all()
    target = None
    for lease in leases:
        room = lease.room
        property_ = room.property if room else None
        tenant = lease.tenant
        if (
            room
            and property_
            and tenant
            and property_.name == "梁屋"
            and room.name == "203"
            and tenant.name == "李建江"
        ):
            target = lease
            break
    if target is None:
        return False

    bills = db.scalars(
        _bill_query().where(RentBill.lease_id == target.id)
    ).all()
    if any(bill.payment is not None for bill in bills):
        return False
    for bill in bills:
        db.delete(bill)
    db.flush()
    target.billing_cycle = "anchor15"
    target.rent_due_day = 15
    ensure_initial_anchor15_bill(db, target)
    db.commit()
    return True


def bill_status(bill: RentBill, today: date | None = None) -> tuple[str, int, int]:
    today = today or date.today()
    paid = bill.payment.amount_cents if bill.payment else 0
    remaining = max(0, bill.amount_cents - paid)
    if remaining == 0:
        return "paid", 0, 0
    days_overdue = max(0, (today - bill.due_date).days)
    if paid > 0:
        return "partial", remaining, days_overdue
    if days_overdue > 0:
        return "overdue", remaining, days_overdue
    return "unpaid", remaining, 0


def bill_payload(bill: RentBill, today: date | None = None) -> dict:
    status, remaining, days_overdue = bill_status(bill, today)
    payment = bill.payment
    return {
        "id": bill.id,
        "lease_id": bill.lease_id,
        "period": bill.period,
        "billing_cycle": bill.lease.billing_cycle if bill.lease else "legacy",
        "period_start": bill.period_start.isoformat(),
        "period_end": bill.period_end.isoformat(),
        "days": bill.days,
        "days_in_month": bill.days_in_month,
        "monthly_rent_cents": bill.monthly_rent_cents,
        "amount_cents": bill.amount_cents,
        "due_date": bill.due_date.isoformat(),
        "is_prorated": bill.is_prorated,
        "status": status,
        "remaining_cents": remaining,
        "days_overdue": days_overdue,
        "tenant": {"id": bill.tenant_id, "name": bill.tenant_name},
        "room": {"id": bill.room_id, "name": bill.room_name},
        "property_name": bill.property_name,
        "payment": (
            {
                "id": payment.id,
                "amount_cents": payment.amount_cents,
                "paid_on": payment.paid_on.isoformat(),
                "method": payment.method,
                "note": payment.note,
            }
            if payment
            else None
        ),
        "created_at": bill.created_at.isoformat(timespec="seconds") if bill.created_at else None,
    }


def rent_summary(bills: list[RentBill], today: date | None = None) -> dict:
    today = today or date.today()
    expected = sum(bill.amount_cents for bill in bills)
    received = sum(bill.payment.amount_cents for bill in bills if bill.payment)
    outstanding = max(0, expected - received)
    overdue_bills = [
        bill for bill in bills if bill_status(bill, today)[0] in {"overdue", "partial"}
    ]
    overdue_bills = [
        bill
        for bill in overdue_bills
        if bill.amount_cents - (bill.payment.amount_cents if bill.payment else 0) > 0
        and bill.due_date < today
    ]
    return {
        "bills": len(bills),
        "expected_cents": expected,
        "received_cents": received,
        "outstanding_cents": outstanding,
        "paid_count": sum(1 for bill in bills if bill_status(bill, today)[0] == "paid"),
        "unpaid_count": sum(1 for bill in bills if bill_status(bill, today)[0] != "paid"),
        "overdue_count": len(overdue_bills),
        "overdue_cents": sum(
            bill.amount_cents - (bill.payment.amount_cents if bill.payment else 0)
            for bill in overdue_bills
        ),
    }
