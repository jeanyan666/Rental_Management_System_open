from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def now_local() -> datetime:
    return datetime.now()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(64), default="房东")
    role: Mapped[str] = mapped_column(String(20), default="super_admin", index=True)
    tenant_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenants.id", ondelete="SET NULL"), unique=True, nullable=True, index=True
    )
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    session_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str] = mapped_column(String(255), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_local, onupdate=now_local)

    rooms: Mapped[list["Room"]] = relationship(
        back_populates="property", cascade="all, delete-orphan", order_by="Room.name"
    )


class Room(Base):
    __tablename__ = "rooms"
    __table_args__ = (UniqueConstraint("property_id", "name", name="uq_room_property_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    floor: Mapped[str] = mapped_column(String(32), default="")
    area: Mapped[float | None] = mapped_column(nullable=True)
    rent_cents: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="vacant", index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_local, onupdate=now_local)

    property: Mapped[Property] = relationship(back_populates="rooms")
    leases: Mapped[list["Lease"]] = relationship(back_populates="room")
    utility_records: Mapped[list["UtilityRecord"]] = relationship(back_populates="room")


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), index=True)
    phone: Mapped[str] = mapped_column(String(32), index=True, default="")
    id_number: Mapped[str | None] = mapped_column(String(18), unique=True, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(8), nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    emergency_name: Mapped[str] = mapped_column(String(80), default="")
    emergency_phone: Mapped[str] = mapped_column(String(32), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    id_image_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_local, onupdate=now_local)

    leases: Mapped[list["Lease"]] = relationship(back_populates="tenant")
    utility_records: Mapped[list["UtilityRecord"]] = relationship(back_populates="tenant")


class Lease(Base):
    __tablename__ = "leases"
    __table_args__ = (
        Index("ix_lease_room_status", "room_id", "status"),
        Index(
            "uq_active_lease_room",
            "room_id",
            unique=True,
            sqlite_where=text("status = 'active'"),
        ),
        Index(
            "uq_active_lease_tenant",
            "tenant_id",
            unique=True,
            sqlite_where=text("status = 'active'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="RESTRICT"), index=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="RESTRICT"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    rent_cents: Mapped[int] = mapped_column(Integer, default=0)
    deposit_cents: Mapped[int] = mapped_column(Integer, default=0)
    rent_due_day: Mapped[int] = mapped_column(Integer, default=1)
    billing_cycle: Mapped[str] = mapped_column(String(20), default="legacy", index=True)
    signed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_local, onupdate=now_local)

    tenant: Mapped[Tenant] = relationship(back_populates="leases")
    room: Mapped[Room] = relationship(back_populates="leases")
    rent_bills: Mapped[list["RentBill"]] = relationship(back_populates="lease")


class UtilitySettings(Base):
    __tablename__ = "utility_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    water_rate_cents: Mapped[int] = mapped_column(Integer, default=0)
    electricity_rate_cents: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_local, onupdate=now_local)


class UtilityRecord(Base):
    __tablename__ = "utility_records"
    __table_args__ = (
        UniqueConstraint("room_id", "period", name="uq_utility_room_period"),
        Index("ix_utility_period", "period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="RESTRICT"), index=True)
    tenant_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tenant_name: Mapped[str] = mapped_column(String(80), default="")
    period: Mapped[str] = mapped_column(String(7))
    reading_date: Mapped[date] = mapped_column(Date)
    water_prev_milli: Mapped[int] = mapped_column(Integer, default=0)
    water_current_milli: Mapped[int] = mapped_column(Integer, default=0)
    water_usage_milli: Mapped[int] = mapped_column(Integer, default=0)
    water_rate_cents: Mapped[int] = mapped_column(Integer, default=0)
    water_amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    water_reset: Mapped[bool] = mapped_column(Boolean, default=False)
    electricity_prev_milli: Mapped[int] = mapped_column(Integer, default=0)
    electricity_current_milli: Mapped[int] = mapped_column(Integer, default=0)
    electricity_usage_milli: Mapped[int] = mapped_column(Integer, default=0)
    electricity_rate_cents: Mapped[int] = mapped_column(Integer, default=0)
    electricity_amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    electricity_reset: Mapped[bool] = mapped_column(Boolean, default=False)
    payer_type: Mapped[str] = mapped_column(String(20), default="tenant", index=True)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_local, onupdate=now_local)

    room: Mapped[Room] = relationship(back_populates="utility_records")
    tenant: Mapped[Tenant | None] = relationship(back_populates="utility_records")


class RentBill(Base):
    __tablename__ = "rent_bills"
    __table_args__ = (
        UniqueConstraint("lease_id", "period", name="uq_rent_bill_lease_period"),
        Index("ix_rent_bill_period", "period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    lease_id: Mapped[int] = mapped_column(ForeignKey("leases.id", ondelete="RESTRICT"), index=True)
    tenant_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True, index=True
    )
    room_id: Mapped[int | None] = mapped_column(
        ForeignKey("rooms.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tenant_name: Mapped[str] = mapped_column(String(80), default="")
    room_name: Mapped[str] = mapped_column(String(80), default="")
    property_name: Mapped[str] = mapped_column(String(120), default="")
    period: Mapped[str] = mapped_column(String(7))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    days: Mapped[int] = mapped_column(Integer, default=1)
    days_in_month: Mapped[int] = mapped_column(Integer, default=1)
    monthly_rent_cents: Mapped[int] = mapped_column(Integer, default=0)
    amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    due_date: Mapped[date] = mapped_column(Date, index=True)
    is_prorated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_local, onupdate=now_local)

    lease: Mapped[Lease] = relationship(back_populates="rent_bills")
    payment: Mapped["RentPayment | None"] = relationship(
        back_populates="bill", uselist=False, cascade="all, delete-orphan"
    )


class RentPayment(Base):
    __tablename__ = "rent_payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    bill_id: Mapped[int] = mapped_column(
        ForeignKey("rent_bills.id", ondelete="CASCADE"), unique=True, index=True
    )
    amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    paid_on: Mapped[date] = mapped_column(Date)
    method: Mapped[str] = mapped_column(String(20), default="wechat")
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_local)

    bill: Mapped[RentBill] = relationship(back_populates="payment")
