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
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
ALGORITHM = os.getenv("ALGORITHM", "HS256")

# [API security review / secret management] Every JWT this backend
# issues is only as strong as this secret - the hardcoded fallback
# above exists so local dev works with zero setup (see .env.example),
# but a deployment that forgets to set a real SECRET_KEY would
# silently issue tokens anyone can forge (the fallback value is
# public, right here in the repo). This can't safely hard-fail startup
# - that would also break the zero-setup local/demo path this app is
# built around - so instead it's a loud, impossible-to-miss log line
# at import time, the earliest point a deploy's logs could catch it.
if SECRET_KEY == "dev-only-change-me":
    logging.getLogger("crq.security").warning(
        "SECURITY WARNING: SECRET_KEY is unset and using the public default "
        "from security.py. Every JWT issued right now is forgeable by anyone "
        "who has read this file. Set a real SECRET_KEY (`openssl rand -hex 32`) "
        "in the environment before this deployment is exposed to real users."
    )
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

# [Public demo credentials exposed - fix] Lets a real deployment turn the
# two "Login as CISO/CFO" one-click demo accounts off entirely (set
# DEMO_ACCOUNTS_ENABLED=false) - previously there was no way to disable
# them short of editing this file and redeploying. Defaults to enabled
# since this IS a demo/hackathon app and judges need one-click access, but
# a real deployment behind a real audience can flip this off.
DEMO_ACCOUNTS_ENABLED = os.getenv("DEMO_ACCOUNTS_ENABLED", "true").strip().lower() not in ("false", "0", "no")

# username -> password. Still plaintext/hardcoded (see module docstring -
# there's still no real user table for these two), but the passwords are
# now env-overridable (DEMO_CISO_PASSWORD / DEMO_CFO_PASSWORD) so a
# deployment can rotate them without a code change, and - more importantly
# - the frontend no longer needs to embed either password at all: the
# "Login as CISO/CFO" buttons now call POST /api/auth/demo-login with just
# a role name (see main.py), not a password, so these values only matter
# for someone manually POSTing to /api/auth/login the old way (e.g. via
# curl, for the API walkthrough in the Support/docs pages).
DEMO_USERS = {
    "ciso": os.getenv("DEMO_CISO_PASSWORD", "demo-ciso-pass"),
    "cfo": os.getenv("DEMO_CFO_PASSWORD", "demo-cfo-pass"),
}

# [Public demo credentials exposed - fix / RBAC] A minimal admin concept -
# just enough to gate the handful of actions that affect EVERY visitor at
# once (regenerating or wiping the shared demo fleet, wiping the shared
# ledger) behind something narrower than "any authenticated account,
# including a throwaway real signup". The two demo exec accounts count as
# admin by default (they're the accounts judges/reviewers actually use);
# ADMIN_EMAILS lets a real deployment name real accounts as admins too
# (comma-separated emails) without a code change.
ADMIN_USERS = set(DEMO_USERS.keys()) | {
    email.strip().lower() for email in os.getenv("ADMIN_EMAILS", "").split(",") if email.strip()
}


def is_admin(username: str) -> bool:
    return username in ADMIN_USERS


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
# [Cross-user data isolation] Some endpoints (assets, attack-path,
# simulate-risk) are called with EITHER data_source - the shared demo
# fleet stays intentionally open to any visitor, but the 'own' fleet must
# be scoped to whoever is logged in. auto_error=False means "no
# Authorization header at all" resolves to None instead of a hard 401, so
# a single dependency can serve both cases; the endpoint itself is what
# decides "own data_source with no current_user -> reject".
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def authenticate_demo_user(username: str, password: str) -> bool:
    if not DEMO_ACCOUNTS_ENABLED:
        return False
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


def get_current_user_optional(token: Optional[str] = Depends(oauth2_scheme_optional)) -> Optional[str]:
    """Same JWT verification as get_current_user below, but returns None
    instead of raising when there's no Authorization header at all. A
    token that IS present but invalid/expired still raises a 401, exactly
    like get_current_user - this only relaxes the "nothing was sent"
    case, so an anonymous request to the shared demo fleet still works
    while a request against 'own' data still gets a real 401 if the
    caller sends a bad token rather than silently treating it as
    anonymous."""
    if token is None:
        return None
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


def require_admin(current_user: str = Depends(get_current_user)) -> str:
    """[Public demo credentials exposed - fix / RBAC] FastAPI dependency
    for actions that affect every visitor at once - regenerating/wiping
    the shared demo fleet, wiping the shared ledger. Any authenticated
    account could previously trigger these; now only an ADMIN_USERS
    account (see above) can. Own-data actions (a user clearing THEIR OWN
    ledger rows) never go through this - those are already isolated by
    owner_email and don't need admin at all."""
    if not is_admin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action affects the shared demo state and is restricted to admin/demo accounts.",
        )
    return current_user
