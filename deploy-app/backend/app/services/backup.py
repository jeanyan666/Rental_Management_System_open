from __future__ import annotations

import io
import json
import os
import re
import zipfile
from datetime import date, datetime
from pathlib import PurePosixPath

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import BACKUP_DIR
from ..models import (
    Lease,
    Property,
    RentBill,
    RentPayment,
    Room,
    Tenant,
    User,
    UtilityRecord,
    UtilitySettings,
)
from .accounts import ensure_missing_tenant_accounts
from .files import absolute_upload_path, commit_temp_image, delete_relative_file, prepare_id_image

BACKUP_FORMAT = "qiyu-rental-backup"
BACKUP_VERSION = 1
REQUIRED_KEYS = {
    "properties",
    "rooms",
    "tenants",
    "leases",
    "utility_settings",
    "utility_records",
    "rent_bills",
    "rent_payments",
    "tenant_users",
}


class BackupError(ValueError):
    pass


def _json_value(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _row_dict(obj) -> dict:
    return {column.name: _json_value(getattr(obj, column.name)) for column in obj.__table__.columns}


def _rows(db: Session, model, query=None) -> list[dict]:
    statement = query or select(model).order_by(model.id)
    return [_row_dict(row) for row in db.scalars(statement).all()]


def build_backup_bytes(db: Session) -> bytes:
    tenant_rows = _rows(db, Tenant)
    for tenant in tenant_rows:
        relative_path = tenant.get("id_image_path")
        if relative_path:
            try:
                absolute_upload_path(relative_path)
            except FileNotFoundError:
                tenant["id_image_path"] = None
    data = {
        "properties": _rows(db, Property),
        "rooms": _rows(db, Room),
        "tenants": tenant_rows,
        "leases": _rows(db, Lease),
        "utility_settings": _rows(db, UtilitySettings),
        "utility_records": _rows(db, UtilityRecord),
        "rent_bills": _rows(db, RentBill),
        "rent_payments": _rows(db, RentPayment),
        "tenant_users": [
            {
                "username": user.username,
                "password_hash": user.password_hash,
                "display_name": user.display_name,
                "tenant_id": user.tenant_id,
                "must_change_password": user.must_change_password,
                "is_active": user.is_active,
                "last_login_at": _json_value(user.last_login_at),
                "created_at": _json_value(user.created_at),
            }
            for user in db.scalars(
                select(User).where(User.role == "tenant").order_by(User.id)
            ).all()
        ],
        "viewer_users": [
            {
                "username": user.username,
                "password_hash": user.password_hash,
                "display_name": user.display_name,
                "is_active": user.is_active,
                "last_login_at": _json_value(user.last_login_at),
                "created_at": _json_value(user.created_at),
            }
            for user in db.scalars(
                select(User).where(User.role == "viewer").order_by(User.id)
            ).all()
        ],
    }
    image_paths = sorted(
        {
            tenant["id_image_path"]
            for tenant in data["tenants"]
            if tenant.get("id_image_path")
        }
    )
    manifest = {
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "counts": {key: len(value) for key, value in data.items()},
        "images": image_paths,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"),
        )
        archive.writestr(
            "data.json",
            json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        )
        for relative_path in image_paths:
            try:
                path = absolute_upload_path(relative_path)
            except FileNotFoundError:
                continue
            archive.write(path, f"uploads/{relative_path}")
    return buffer.getvalue()


def _save_safety_backup(db: Session) -> str:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"pre-import-{stamp}.zip"
    path = BACKUP_DIR / filename
    suffix = 2
    while path.exists():
        filename = f"pre-import-{stamp}-{suffix}.zip"
        path = BACKUP_DIR / filename
        suffix += 1
    payload = build_backup_bytes(db)
    path.write_bytes(payload)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return filename


def _parse_date(value, field: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise BackupError(f"{field} 日期格式错误") from exc


def _parse_datetime(value, field: str):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError as exc:
        raise BackupError(f"{field} 时间格式错误") from exc


def _required_dict(value, name: str) -> dict:
    if not isinstance(value, dict):
        raise BackupError(f"{name} 格式错误")
    return value


def _required_list(data: dict, key: str) -> list[dict]:
    value = data.get(key)
    if not isinstance(value, list):
        raise BackupError(f"备份缺少 {key} 数据")
    if not all(isinstance(item, dict) for item in value):
        raise BackupError(f"{key} 数据格式错误")
    return value


def _safe_zip_files(archive: zipfile.ZipFile) -> dict[str, bytes]:
    infos = archive.infolist()
    if len(infos) > 5000:
        raise BackupError("备份文件包含过多文件")
    total = sum(info.file_size for info in infos)
    if total > 300 * 1024 * 1024:
        raise BackupError("备份解压后超过 300MB")
    allowed = {"manifest.json", "data.json"}
    files: dict[str, bytes] = {}
    for info in infos:
        name = info.filename
        if name.endswith("/"):
            continue
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts:
            raise BackupError("备份包含非法文件路径")
        if name not in allowed and not (
            len(path.parts) >= 2 and path.parts[0] == "uploads"
        ):
            raise BackupError("备份包含未知文件")
        if info.file_size > 60 * 1024 * 1024:
            raise BackupError("备份中的单个文件过大")
        files[name] = archive.read(info)
    return files


def import_backup(db: Session, raw: bytes) -> dict:
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise BackupError("不是有效的 ZIP 备份文件") from exc
    files = _safe_zip_files(archive)
    if "manifest.json" not in files or "data.json" not in files:
        raise BackupError("备份缺少 manifest.json 或 data.json")
    try:
        manifest = json.loads(files["manifest.json"].decode("utf-8"))
        data = json.loads(files["data.json"].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BackupError("备份内容无法解析") from exc
    if not isinstance(manifest, dict) or manifest.get("format") != BACKUP_FORMAT:
        raise BackupError("不是梁寓租务的备份文件")
    if manifest.get("version") != BACKUP_VERSION:
        raise BackupError("备份版本与当前系统不兼容")
    if not isinstance(data, dict):
        raise BackupError("备份数据结构错误")
    missing = REQUIRED_KEYS - set(data.keys())
    if missing:
        raise BackupError(f"备份缺少数据表：{', '.join(sorted(missing))}")

    properties = _required_list(data, "properties")
    rooms = _required_list(data, "rooms")
    tenants = _required_list(data, "tenants")
    leases = _required_list(data, "leases")
    settings = _required_list(data, "utility_settings")
    utility_records = _required_list(data, "utility_records")
    rent_bills = _required_list(data, "rent_bills")
    rent_payments = _required_list(data, "rent_payments")
    tenant_users = _required_list(data, "tenant_users")
    viewer_users = data.get("viewer_users", [])
    if not isinstance(viewer_users, list) or not all(
        isinstance(row, dict) for row in viewer_users
    ):
        raise BackupError("只读管理员账号格式错误")
    if len(viewer_users) > 1:
        raise BackupError("备份中包含多个只读管理员账号")

    property_ids = {int(row["id"]) for row in properties}
    room_ids = {int(row["id"]) for row in rooms}
    tenant_ids = {int(row["id"]) for row in tenants}
    lease_ids = {int(row["id"]) for row in leases}
    bill_ids = {int(row["id"]) for row in rent_bills}
    if len(property_ids) != len(properties) or len(room_ids) != len(rooms):
        raise BackupError("备份中存在重复 ID")
    if len(tenant_ids) != len(tenants) or len(lease_ids) != len(leases):
        raise BackupError("备份中存在重复 ID")
    if len(bill_ids) != len(rent_bills):
        raise BackupError("备份中存在重复账单 ID")
    if any(int(row["property_id"]) not in property_ids for row in rooms):
        raise BackupError("房间引用了不存在的房屋")
    if any(int(row["room_id"]) not in room_ids for row in leases):
        raise BackupError("合同引用了不存在的房间")
    if any(int(row["tenant_id"]) not in tenant_ids for row in leases):
        raise BackupError("合同引用了不存在的租客")
    if any(int(row["room_id"]) not in room_ids for row in utility_records):
        raise BackupError("水电记录引用了不存在的房间")
    if any(int(row["lease_id"]) not in lease_ids for row in rent_bills):
        raise BackupError("租金账单引用了不存在的合同")
    if any(int(row["bill_id"]) not in bill_ids for row in rent_payments):
        raise BackupError("收款记录引用了不存在的账单")
    if any(
        row.get("tenant_id") is None or int(row["tenant_id"]) not in tenant_ids
        for row in tenant_users
    ):
        raise BackupError("租客账号缺少有效的租客关联")
    if any(not str(row.get("password_hash", "")).strip() for row in tenant_users):
        raise BackupError("租客账号缺少密码信息")
    tenant_account_tenants = [int(row["tenant_id"]) for row in tenant_users]
    if len(set(tenant_account_tenants)) != len(tenant_account_tenants):
        raise BackupError("备份中存在重复的租客账号")
    if any(
        row.get("tenant_id") is not None and int(row["tenant_id"]) not in tenant_ids
        for row in utility_records
    ):
        raise BackupError("水电记录引用了不存在的租客")
    if any(
        row.get("tenant_id") is not None and int(row["tenant_id"]) not in tenant_ids
        for row in rent_bills
    ):
        raise BackupError("租金账单引用了不存在的租客")
    if any(
        row.get("room_id") is not None and int(row["room_id"]) not in room_ids
        for row in rent_bills
    ):
        raise BackupError("租金账单引用了不存在的房间")

    safety_filename = _save_safety_backup(db)

    staged_images: list[str] = []
    image_overrides: dict[int, str | None] = {}
    try:
        for tenant in tenants:
            tenant_id = int(tenant["id"])
            original = tenant.get("id_image_path")
            if not original:
                image_overrides[tenant_id] = None
                continue
            zip_name = f"uploads/{original}"
            if zip_name not in files:
                raise BackupError(f"备份缺少租客 {tenant.get('name', '')} 的身份证照片")
            token = prepare_id_image(files[zip_name])
            new_path = commit_temp_image(token)
            staged_images.append(new_path)
            image_overrides[tenant_id] = new_path

        db.execute(delete(RentPayment))
        db.execute(delete(RentBill))
        db.execute(delete(UtilityRecord))
        db.execute(delete(Lease))
        db.execute(delete(User).where(User.role == "tenant"))
        if "viewer_users" in data:
            db.execute(delete(User).where(User.role == "viewer"))
        db.execute(delete(Tenant))
        db.execute(delete(Room))
        db.execute(delete(Property))
        db.execute(delete(UtilitySettings))
        db.flush()

        for row in properties:
            db.add(
                Property(
                    id=int(row["id"]),
                    name=str(row.get("name", "")),
                    address=str(row.get("address", "")),
                    note=str(row.get("note", "")),
                    created_at=_parse_datetime(row.get("created_at"), "房屋创建时间") or datetime.now(),
                    updated_at=_parse_datetime(row.get("updated_at"), "房屋更新时间") or datetime.now(),
                )
            )
        db.flush()
        for row in rooms:
            db.add(
                Room(
                    id=int(row["id"]),
                    property_id=int(row["property_id"]),
                    name=str(row.get("name", "")),
                    floor=str(row.get("floor", "")),
                    area=float(row["area"]) if row.get("area") is not None else None,
                    rent_cents=int(row.get("rent_cents", 0)),
                    status=str(row.get("status", "vacant")),
                    note=str(row.get("note", "")),
                    created_at=_parse_datetime(row.get("created_at"), "房间创建时间") or datetime.now(),
                    updated_at=_parse_datetime(row.get("updated_at"), "房间更新时间") or datetime.now(),
                )
            )
        db.flush()
        for row in tenants:
            tenant_id = int(row["id"])
            db.add(
                Tenant(
                    id=tenant_id,
                    name=str(row.get("name", "")),
                    phone=str(row.get("phone", "")),
                    id_number=row.get("id_number"),
                    gender=row.get("gender"),
                    birth_date=_parse_date(row["birth_date"], "租客出生日期")
                    if row.get("birth_date")
                    else None,
                    emergency_name=str(row.get("emergency_name", "")),
                    emergency_phone=str(row.get("emergency_phone", "")),
                    note=str(row.get("note", "")),
                    id_image_path=image_overrides.get(tenant_id),
                    created_at=_parse_datetime(row.get("created_at"), "租客创建时间") or datetime.now(),
                    updated_at=_parse_datetime(row.get("updated_at"), "租客更新时间") or datetime.now(),
                )
            )
        db.flush()
        for row in leases:
            db.add(
                Lease(
                    id=int(row["id"]),
                    tenant_id=int(row["tenant_id"]),
                    room_id=int(row["room_id"]),
                    start_date=_parse_date(row["start_date"], "合同开始日期"),
                    end_date=_parse_date(row["end_date"], "合同结束日期"),
                    rent_cents=int(row.get("rent_cents", 0)),
                    deposit_cents=int(row.get("deposit_cents", 0)),
                    rent_due_day=int(row.get("rent_due_day", 1)),
                    billing_cycle=str(row.get("billing_cycle", "legacy")),
                    signed_date=_parse_date(row["signed_date"], "签约日期")
                    if row.get("signed_date")
                    else None,
                    status=str(row.get("status", "active")),
                    note=str(row.get("note", "")),
                    created_at=_parse_datetime(row.get("created_at"), "合同创建时间") or datetime.now(),
                    updated_at=_parse_datetime(row.get("updated_at"), "合同更新时间") or datetime.now(),
                )
            )
        db.flush()
        for row in settings:
            db.add(
                UtilitySettings(
                    id=int(row.get("id", 1)),
                    water_rate_cents=int(row.get("water_rate_cents", 0)),
                    electricity_rate_cents=int(row.get("electricity_rate_cents", 0)),
                    updated_at=_parse_datetime(row.get("updated_at"), "水电设置时间") or datetime.now(),
                )
            )
        for row in utility_records:
            db.add(
                UtilityRecord(
                    id=int(row["id"]),
                    room_id=int(row["room_id"]),
                    tenant_id=int(row["tenant_id"]) if row.get("tenant_id") is not None else None,
                    tenant_name=str(row.get("tenant_name", "")),
                    period=str(row["period"]),
                    reading_date=_parse_date(row["reading_date"], "抄表日期"),
                    water_prev_milli=int(row.get("water_prev_milli", 0)),
                    water_current_milli=int(row.get("water_current_milli", 0)),
                    water_usage_milli=int(row.get("water_usage_milli", 0)),
                    water_rate_cents=int(row.get("water_rate_cents", 0)),
                    water_amount_cents=int(row.get("water_amount_cents", 0)),
                    water_reset=bool(row.get("water_reset", False)),
                    electricity_prev_milli=int(row.get("electricity_prev_milli", 0)),
                    electricity_current_milli=int(row.get("electricity_current_milli", 0)),
                    electricity_usage_milli=int(row.get("electricity_usage_milli", 0)),
                    electricity_rate_cents=int(row.get("electricity_rate_cents", 0)),
                    electricity_amount_cents=int(row.get("electricity_amount_cents", 0)),
                    electricity_reset=bool(row.get("electricity_reset", False)),
                    payer_type="tenant",
                    is_paid=bool(row.get("is_paid", False)),
                    paid_at=_parse_datetime(row.get("paid_at"), "水电收款时间"),
                    note=str(row.get("note", "")),
                    created_at=_parse_datetime(row.get("created_at"), "水电创建时间") or datetime.now(),
                    updated_at=_parse_datetime(row.get("updated_at"), "水电更新时间") or datetime.now(),
                )
            )
        db.flush()
        for row in rent_bills:
            db.add(
                RentBill(
                    id=int(row["id"]),
                    lease_id=int(row["lease_id"]),
                    tenant_id=int(row["tenant_id"]) if row.get("tenant_id") is not None else None,
                    room_id=int(row["room_id"]) if row.get("room_id") is not None else None,
                    tenant_name=str(row.get("tenant_name", "")),
                    room_name=str(row.get("room_name", "")),
                    property_name=str(row.get("property_name", "")),
                    period=str(row["period"]),
                    period_start=_parse_date(row["period_start"], "账单开始日期"),
                    period_end=_parse_date(row["period_end"], "账单结束日期"),
                    days=int(row.get("days", 1)),
                    days_in_month=int(row.get("days_in_month", 1)),
                    monthly_rent_cents=int(row.get("monthly_rent_cents", 0)),
                    amount_cents=int(row.get("amount_cents", 0)),
                    due_date=_parse_date(row["due_date"], "账单到期日"),
                    is_prorated=bool(row.get("is_prorated", False)),
                    created_at=_parse_datetime(row.get("created_at"), "账单创建时间") or datetime.now(),
                    updated_at=_parse_datetime(row.get("updated_at"), "账单更新时间") or datetime.now(),
                )
            )
        db.flush()
        for row in rent_payments:
            db.add(
                RentPayment(
                    id=int(row["id"]),
                    bill_id=int(row["bill_id"]),
                    amount_cents=int(row.get("amount_cents", 0)),
                    paid_on=_parse_date(row["paid_on"], "交租日期"),
                    method=str(row.get("method", "wechat")),
                    note=str(row.get("note", "")),
                    created_at=_parse_datetime(row.get("created_at"), "收款创建时间") or datetime.now(),
                )
            )
        db.flush()

        current_usernames = {
            username
            for (username,) in db.execute(select(User.username)).all()
        }
        imported_usernames: set[str] = set()
        for row in tenant_users:
            username = str(row.get("username", "")).strip()
            if not username or len(username) > 64:
                raise BackupError(f"租客账号 {username or '(空)'} 格式不正确")
            if username in imported_usernames or username in current_usernames:
                raise BackupError(f"租客账号 {username} 与现有账号冲突")
            imported_usernames.add(username)
            db.add(
                User(
                    username=username,
                    password_hash=str(row.get("password_hash", "")),
                    display_name=str(row.get("display_name", "")),
                    role="tenant",
                    tenant_id=int(row["tenant_id"]) if row.get("tenant_id") is not None else None,
                    must_change_password=False,
                    is_active=bool(row.get("is_active", True)),
                    last_login_at=_parse_datetime(row.get("last_login_at"), "最近登录时间"),
                    created_at=_parse_datetime(row.get("created_at"), "账号创建时间") or datetime.now(),
                )
            )
        for row in viewer_users:
            username = str(row.get("username", "")).strip()
            if not re.fullmatch(r"[A-Za-z0-9_.@+\-]{4,64}", username):
                raise BackupError(f"只读管理员账号 {username or '(空)'} 格式不正确")
            if username in imported_usernames or username in current_usernames:
                raise BackupError(f"只读管理员账号 {username} 与现有账号冲突")
            if not str(row.get("password_hash", "")).strip():
                raise BackupError("只读管理员账号缺少密码信息")
            imported_usernames.add(username)
            db.add(
                User(
                    username=username,
                    password_hash=str(row["password_hash"]),
                    display_name=str(row.get("display_name", "只读管理员")),
                    role="viewer",
                    tenant_id=None,
                    must_change_password=False,
                    is_active=bool(row.get("is_active", True)),
                    last_login_at=_parse_datetime(row.get("last_login_at"), "最近登录时间"),
                    created_at=_parse_datetime(row.get("created_at"), "账号创建时间") or datetime.now(),
                )
            )
        db.commit()
    except BackupError:
        db.rollback()
        for path in staged_images:
            delete_relative_file(path)
        raise
    except Exception as exc:
        db.rollback()
        for path in staged_images:
            delete_relative_file(path)
        raise BackupError(f"备份导入失败：{exc}") from exc

    try:
        ensure_missing_tenant_accounts()
    except Exception:
        # The restore itself has been committed; account backfill can be retried at next startup.
        pass
    return {
        "safety_backup": safety_filename,
        "counts": {
            "properties": len(properties),
            "rooms": len(rooms),
            "tenants": len(tenants),
            "leases": len(leases),
            "utility_records": len(utility_records),
            "rent_bills": len(rent_bills),
            "rent_payments": len(rent_payments),
            "tenant_accounts": len(tenant_users),
            "viewer_accounts": len(viewer_users),
        },
    }


def safety_backup_path(filename: str):
    if not re.fullmatch(r"pre-import-[0-9\-]+(?:-[0-9]+)?\.zip", filename or ""):
        raise BackupError("备份文件名无效")
    path = (BACKUP_DIR / filename).resolve()
    if BACKUP_DIR.resolve() not in path.parents or not path.is_file():
        raise BackupError("备份文件不存在")
    return path
