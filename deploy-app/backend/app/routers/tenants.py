from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import require_admin_access
from ..models import Lease, Room, Tenant, UtilityRecord
from ..schemas import TenantIn, TenantUpdate
from ..serializers import lease_payload, tenant_payload
from ..services.accounts import account_for_tenant, sync_tenant_account_profile
from ..services.files import (
    absolute_upload_path,
    commit_temp_image,
    delete_relative_file,
    temp_image_path,
)
from ..services.id_parser import parse_id_identity
from ..services.queries import active_by_tenant, load_active_leases

router = APIRouter(prefix="/api/tenants", tags=["tenants"], dependencies=[Depends(require_admin_access)])


def _get_tenant(db: Session, tenant_id: int) -> Tenant:
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="租客不存在")
    return tenant


def _tenant_leases(db: Session, tenant_id: int) -> list[Lease]:
    return list(
        db.scalars(
            select(Lease)
            .where(Lease.tenant_id == tenant_id)
            .options(
                selectinload(Lease.tenant),
                selectinload(Lease.room).selectinload(Room.property),
            )
            .order_by(Lease.start_date.desc(), Lease.id.desc())
        ).all()
    )


@router.get("")
def list_tenants(search: str = "", db: Session = Depends(get_db)):
    statement = select(Tenant).order_by(Tenant.created_at.desc(), Tenant.id.desc())
    term = search.strip()
    if term:
        statement = statement.where(
            or_(
                Tenant.name.ilike(f"%{term}%"),
                Tenant.phone.ilike(f"%{term}%"),
                Tenant.id_number.ilike(f"%{term}%"),
            )
        )
    tenants = db.scalars(statement).all()
    leases = load_active_leases(db)
    by_tenant = active_by_tenant(leases)
    return {"tenants": [tenant_payload(tenant, by_tenant.get(tenant.id)) for tenant in tenants]}


@router.get("/{tenant_id}")
def get_tenant(tenant_id: int, db: Session = Depends(get_db)):
    tenant = _get_tenant(db, tenant_id)
    leases = _tenant_leases(db, tenant_id)
    active = next((lease for lease in leases if lease.status == "active"), None)
    payload = tenant_payload(tenant, active)
    payload["leases"] = [lease_payload(lease) for lease in leases]
    return {"tenant": payload}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_tenant(payload: TenantIn, db: Session = Depends(get_db)):
    new_file = None
    if payload.id_image_token:
        try:
            temp_image_path(payload.id_image_token)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    gender, birth_date = parse_id_identity(payload.id_number) if payload.id_number else (None, None)
    tenant = Tenant(
        name=payload.name,
        phone=payload.phone,
        id_number=payload.id_number,
        gender=gender,
        birth_date=birth_date,
        emergency_name=payload.emergency_name,
        emergency_phone=payload.emergency_phone,
        note=payload.note,
    )

    if payload.id_image_token:
        new_file = commit_temp_image(payload.id_image_token)
        tenant.id_image_path = new_file

    db.add(tenant)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        delete_relative_file(new_file)
        raise HTTPException(status_code=409, detail="该身份证号已存在，请检查是否重复录入") from exc
    db.refresh(tenant)

    active = next((lease for lease in _tenant_leases(db, tenant.id) if lease.status == "active"), None)
    return {"tenant": tenant_payload(tenant, active)}


@router.patch("/{tenant_id}")
def update_tenant(tenant_id: int, payload: TenantUpdate, db: Session = Depends(get_db)):
    tenant = _get_tenant(db, tenant_id)
    if payload.id_image_token and payload.remove_id_image:
        raise HTTPException(status_code=400, detail="不能同时更换和删除身份证照片")

    new_file = None
    previous_file = tenant.id_image_path
    if payload.id_image_token:
        try:
            temp_image_path(payload.id_image_token)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        new_file = commit_temp_image(payload.id_image_token)
        tenant.id_image_path = new_file
    elif payload.remove_id_image:
        tenant.id_image_path = None

    tenant.name = payload.name
    tenant.phone = payload.phone
    tenant.emergency_name = payload.emergency_name
    tenant.emergency_phone = payload.emergency_phone
    tenant.note = payload.note
    if "id_number" in payload.model_fields_set and payload.id_number:
        tenant.id_number = payload.id_number
        tenant.gender, tenant.birth_date = parse_id_identity(payload.id_number)
    sync_tenant_account_profile(db, tenant)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if new_file:
            delete_relative_file(new_file)
        raise HTTPException(status_code=409, detail="该身份证号已存在，请检查是否重复") from exc

    if previous_file and previous_file != tenant.id_image_path:
        delete_relative_file(previous_file)

    leases = _tenant_leases(db, tenant_id)
    active = next((lease for lease in leases if lease.status == "active"), None)
    return {"tenant": tenant_payload(tenant, active)}


@router.delete("/{tenant_id}")
def delete_tenant(tenant_id: int, db: Session = Depends(get_db)):
    tenant = _get_tenant(db, tenant_id)
    lease_exists = db.scalar(select(Lease.id).where(Lease.tenant_id == tenant_id).limit(1))
    if lease_exists:
        raise HTTPException(status_code=409, detail="该租客已有合同记录，无法删除")
    utility_exists = db.scalar(
        select(UtilityRecord.id).where(UtilityRecord.tenant_id == tenant_id).limit(1)
    )
    if utility_exists:
        raise HTTPException(status_code=409, detail="该租客已有水电记录，无法删除")
    image_path = tenant.id_image_path
    account = account_for_tenant(db, tenant_id)
    if account is not None:
        db.delete(account)
    db.delete(tenant)
    db.commit()
    delete_relative_file(image_path)
    return {"ok": True}


@router.get("/{tenant_id}/id-image")
def get_id_image(tenant_id: int, db: Session = Depends(get_db)):
    tenant = _get_tenant(db, tenant_id)
    if not tenant.id_image_path:
        raise HTTPException(status_code=404, detail="未上传身份证照片")
    try:
        path = absolute_upload_path(tenant.id_image_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, no-store, max-age=0"},
    )
