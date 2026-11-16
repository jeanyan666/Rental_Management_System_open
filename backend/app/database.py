from __future__ import annotations

import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DATABASE_URL, DB_PATH, SQLITE_JOURNAL_MODE


class Base(DeclarativeBase):
    pass


engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute(f"PRAGMA journal_mode={SQLITE_JOURNAL_MODE.upper()}")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _apply_lightweight_migrations() -> None:
    with engine.begin() as connection:
        lease_columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info('leases')").fetchall()
        }
        if lease_columns and "rent_due_day" not in lease_columns:
            connection.exec_driver_sql(
                "ALTER TABLE leases ADD COLUMN rent_due_day INTEGER NOT NULL DEFAULT 1"
            )
        if lease_columns and "billing_cycle" not in lease_columns:
            connection.exec_driver_sql(
                "ALTER TABLE leases ADD COLUMN billing_cycle TEXT NOT NULL DEFAULT 'legacy'"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_leases_billing_cycle ON leases(billing_cycle)"
            )

        user_columns = {
            row[1]
            for row in connection.exec_driver_sql("PRAGMA table_info('users')").fetchall()
        }
        if user_columns:
            if "role" not in user_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'super_admin'"
                )
            if "tenant_id" not in user_columns:
                connection.exec_driver_sql("ALTER TABLE users ADD COLUMN tenant_id INTEGER")
            if "must_change_password" not in user_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0"
                )
            if "session_version" not in user_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0"
                )
            if "is_active" not in user_columns:
                connection.exec_driver_sql(
                    "ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1"
                )
            if "last_login_at" not in user_columns:
                connection.exec_driver_sql("ALTER TABLE users ADD COLUMN last_login_at DATETIME")
            connection.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_id "
                "ON users(tenant_id) WHERE tenant_id IS NOT NULL"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_users_role ON users(role)"
            )
            connection.exec_driver_sql(
                "CREATE INDEX IF NOT EXISTS ix_users_is_active ON users(is_active)"
            )
            # Tenant passwords are managed by the super admin; tenants no longer self-change them.
            connection.exec_driver_sql(
                "UPDATE users SET must_change_password = 0 WHERE role = 'tenant'"
            )


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _apply_lightweight_migrations()
    for suffix in ("", "-wal", "-shm"):
        path = DB_PATH.with_name(DB_PATH.name + suffix)
        if path.exists():
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
