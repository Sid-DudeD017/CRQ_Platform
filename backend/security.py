"""
Auth for /api/audit (and anything else that later needs to know which exec
is making a request).

Minimal by design: a fixed set of demo exec accounts, JWT bearer tokens, no
signup/roles. The blueprint's actual requirement here is "the request is
authenticated by the API" before it's allowed to trigger the blockchain
webhook - not a production identity system. Swap DEMO_USERS for a real
user table before this goes anywhere near production.

Uses plain os.getenv (matching database.py's style in this scaffold)
rather than a pydantic-settings config object, to keep this consistent
with how the rest of this specific folder already reads configuration.
"""
import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

# username -> password. Plaintext and hardcoded on purpose - see module
# docstring. Never do this once there's a real user table.
DEMO_USERS = {
    "ciso": "demo-ciso-pass",
    "cfo": "demo-cfo-pass",
}

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def authenticate_demo_user(username: str, password: str) -> bool:
    return DEMO_USERS.get(username) == password


def hash_password(password: str) -> str:
    """bcrypt-hash a plaintext password for storage in User.hashed_password."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """Constant-time compare of a login attempt against a stored bcrypt hash."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": subject, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    """FastAPI dependency: verifies the bearer token, returns the exec's
    username. POST /api/audit is unreachable without a valid token."""
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise credentials_error
    username = payload.get("sub")
    if username is None:
        raise credentials_error
    return username
