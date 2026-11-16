from __future__ import annotations

import logging

from sqlalchemy import select

from .config import ADMIN_DISPLAY_NAME, ADMIN_PASSWORD, ADMIN_USERNAME
from .database import SessionLocal
from .models import User
from .security import hash_password

logger = logging.getLogger(__name__)


def ensure_admin() -> None:
    with SessionLocal() as db:
        existing = db.scalar(select(User).limit(1))
        if existing is not None:
            return
        admin = User(
            username=ADMIN_USERNAME,
            password_hash=hash_password(ADMIN_PASSWORD),
            display_name=ADMIN_DISPLAY_NAME,
            role="super_admin",
            is_active=True,
        )
        db.add(admin)
        db.commit()
        logger.info("已创建初始管理员账号：%s", ADMIN_USERNAME)
