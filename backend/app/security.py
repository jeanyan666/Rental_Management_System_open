from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time

from .config import SECRET_FILE, SESSION_MAX_AGE

_PBKDF2_ITERATIONS = 310_000
_DAY_SECONDS = 24 * 60 * 60
_SESSION_TTL_BY_ROLE = {
    "super_admin": SESSION_MAX_AGE,
    "viewer": 30 * _DAY_SECONDS,
    "tenant": 90 * _DAY_SECONDS,
}
_secret_cache: bytes | None = None


def session_ttl_for_role(role: str) -> int:
    return _SESSION_TTL_BY_ROLE.get(role, SESSION_MAX_AGE)


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def get_secret() -> bytes:
    global _secret_cache
    if _secret_cache is not None:
        return _secret_cache
    if SECRET_FILE.exists():
        _secret_cache = SECRET_FILE.read_bytes()
    else:
        _secret_cache = secrets.token_bytes(32)
        fd = os.open(SECRET_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(_secret_cache)
    return _secret_cache


def rotate_secret() -> None:
    """Invalidate all existing session cookies after a destructive restore."""
    global _secret_cache
    new_secret = secrets.token_bytes(32)
    SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    SECRET_FILE.write_bytes(new_secret)
    try:
        os.chmod(SECRET_FILE, 0o600)
    except OSError:
        pass
    _secret_cache = new_secret


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${_b64encode(salt)}${_b64encode(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_b64, digest_b64 = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = _b64decode(salt_b64)
        expected = _b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def issue_session(user_id: int, session_version: int, max_age: int) -> str:
    expires_at = int(time.time()) + max_age
    payload = f"{user_id}:{expires_at}:{session_version}".encode("ascii")
    signature = hmac.new(get_secret(), payload, hashlib.sha256).digest()
    return f"{_b64encode(payload)}.{_b64encode(signature)}"


def read_session(token: str | None) -> tuple[int, int] | None:
    if not token or "." not in token:
        return None
    try:
        payload_b64, signature_b64 = token.split(".", 1)
        payload = _b64decode(payload_b64)
        signature = _b64decode(signature_b64)
        expected = hmac.new(get_secret(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            return None
        parts = payload.decode("ascii").split(":")
        if len(parts) == 2:
            user_id_text, expires_text = parts
            session_version = 0
        elif len(parts) == 3:
            user_id_text, expires_text, version_text = parts
            session_version = int(version_text)
        else:
            return None
        user_id = int(user_id_text)
        expires_at = int(expires_text)
        if expires_at < int(time.time()):
            return None
        return user_id, session_version
    except (ValueError, UnicodeDecodeError, TypeError):
        return None
