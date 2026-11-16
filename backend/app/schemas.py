from __future__ import annotations

import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .services.id_parser import id_checksum_valid


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LoginIn(ApiModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class ChangePasswordIn(ApiModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=4, max_length=200)


class PropertyIn(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    address: str = Field(default="", max_length=255)
    note: str = Field(default="", max_length=2000)


class RoomIn(ApiModel):
    name: str = Field(min_length=1, max_length=80)
    floor: str = Field(default="", max_length=32)
    area: float | None = Field(default=None, ge=0, le=100000)
    rent_cents: int = Field(default=0, ge=0)
    status: Literal["vacant", "occupied", "maintenance"] = "vacant"
    note: str = Field(default="", max_length=2000)


class TenantIn(ApiModel):
    name: str = Field(min_length=1, max_length=80)
    phone: str = Field(default="", max_length=32)
    id_number: str | None = Field(default=None, max_length=18)
    gender: str | None = Field(default=None, max_length=8)
    birth_date: date | None = None
    emergency_name: str = Field(default="", max_length=80)
    emergency_phone: str = Field(default="", max_length=32)
    note: str = Field(default="", max_length=4000)
    id_image_token: str | None = Field(default=None, max_length=64)

    @field_validator("id_number", mode="before")
    @classmethod
    def normalize_id_number(cls, value):
        if value is None:
            return None
        text = str(value).strip().upper()
        return text or None

    @field_validator("id_number")
    @classmethod
    def validate_id_number(cls, value):
        if value is not None and not id_checksum_valid(value):
            raise ValueError("身份证号校验未通过，请核对")
        return value


class TenantUpdate(ApiModel):
    name: str = Field(min_length=1, max_length=80)
    phone: str = Field(default="", max_length=32)
    id_number: str | None = Field(default=None, max_length=18)
    emergency_name: str = Field(default="", max_length=80)
    emergency_phone: str = Field(default="", max_length=32)
    note: str = Field(default="", max_length=4000)
    id_image_token: str | None = Field(default=None, max_length=64)
    remove_id_image: bool = False

    @field_validator("id_number", mode="before")
    @classmethod
    def normalize_id_number(cls, value):
        if value is None:
            return None
        text = str(value).strip().upper()
        return text or None

    @field_validator("id_number")
    @classmethod
    def validate_id_number(cls, value):
        if value is not None and not id_checksum_valid(value):
            raise ValueError("身份证号校验未通过，请核对")
        return value


class LeaseIn(ApiModel):
    tenant_id: int = Field(gt=0)
    room_id: int = Field(gt=0)
    start_date: date
    end_date: date = date(2999, 12, 31)
    rent_cents: int = Field(ge=0)
    deposit_cents: int = Field(default=0, ge=0)
    rent_due_day: int = Field(default=15, ge=1, le=31)
    signed_date: date | None = None
    note: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("合同结束日期不能早于开始日期")
        return self


class TerminateLeaseIn(ApiModel):
    end_date: date | None = None
    note: str = Field(default="", max_length=2000)


class LeaseDueDayIn(ApiModel):
    rent_due_day: int = Field(ge=1, le=31)


PERIOD_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"
MAX_READING_MILLI = 10_000_000_000  # 10,000,000.000 units
READING_FIELDS = {
    "water_prev_milli": "水表上期读数",
    "water_current_milli": "水表本期读数",
    "electricity_prev_milli": "电表上期读数",
    "electricity_current_milli": "电表本期读数",
}


def validate_reading_limits(model):
    for field, label in READING_FIELDS.items():
        value = getattr(model, field, None)
        if value is not None and value > MAX_READING_MILLI:
            raise ValueError(f"{label}不能超过 10,000,000")
    return model


class UtilitySettingsIn(ApiModel):
    water_rate_cents: int = Field(ge=0, le=10_000_000)
    electricity_rate_cents: int = Field(ge=0, le=10_000_000)


class UtilityRecordCreate(ApiModel):
    room_id: int = Field(gt=0)
    period: str = Field(pattern=PERIOD_PATTERN)
    reading_date: date
    water_prev_milli: int | None = Field(default=None, ge=0)
    water_current_milli: int = Field(ge=0)
    electricity_prev_milli: int | None = Field(default=None, ge=0)
    electricity_current_milli: int = Field(ge=0)
    water_rate_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    electricity_rate_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    is_paid: bool = False
    water_reset: bool = False
    electricity_reset: bool = False
    note: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def validate_readings(self):
        return validate_reading_limits(self)


class UtilityRecordUpdate(ApiModel):
    reading_date: date
    water_current_milli: int = Field(ge=0)
    electricity_current_milli: int = Field(ge=0)
    water_rate_cents: int = Field(ge=0, le=10_000_000)
    electricity_rate_cents: int = Field(ge=0, le=10_000_000)
    is_paid: bool = False
    water_reset: bool = False
    electricity_reset: bool = False
    note: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def validate_readings(self):
        return validate_reading_limits(self)


class UtilityBatchItem(ApiModel):
    room_id: int = Field(gt=0)
    water_prev_milli: int | None = Field(default=None, ge=0)
    water_current_milli: int = Field(ge=0)
    electricity_prev_milli: int | None = Field(default=None, ge=0)
    electricity_current_milli: int = Field(ge=0)
    note: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def validate_readings(self):
        return validate_reading_limits(self)


class UtilityBatchIn(ApiModel):
    period: str = Field(pattern=PERIOD_PATTERN)
    reading_date: date
    water_rate_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    electricity_rate_cents: int | None = Field(default=None, ge=0, le=10_000_000)
    items: list[UtilityBatchItem] = Field(min_length=1, max_length=200)


class UtilityPaidIn(ApiModel):
    is_paid: bool


class RentPaymentIn(ApiModel):
    paid_on: date
    method: Literal["wechat", "alipay", "bank", "cash", "other"] = "wechat"
    note: str = Field(default="", max_length=2000)


def _validate_login_username(value):
    value = value.strip()
    if not re.fullmatch(r"[A-Za-z0-9_.@+\-]{4,64}", value):
        raise ValueError("登录账号只能使用字母、数字、下划线、点、@、加号或减号，至少4位")
    return value


class AccountUpdateIn(ApiModel):
    username: str | None = Field(default=None, min_length=4, max_length=64)
    is_active: bool | None = None

    @field_validator("username")
    @classmethod
    def validate_username(cls, value):
        if value is None:
            return None
        return _validate_login_username(value)


class ViewerAccountIn(ApiModel):
    username: str = Field(min_length=4, max_length=64)
    password: str = Field(min_length=4, max_length=128)
    display_name: str = Field(default="只读管理员", max_length=64)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value):
        return _validate_login_username(value)
