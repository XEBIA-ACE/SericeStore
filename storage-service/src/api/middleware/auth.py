"""
Authentication middleware placeholder.
Currently implements a simple Bearer token check via a shared secret.
Replace with your real auth provider (OAuth2, OIDC, API key service, etc.).
"""
from typing import Optional

import structlog
from fastapi import HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.core.config import get_settings

logger = structlog.get_logger(__name__)

_security = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Security(_security),
) -> Optional[dict]:
    """
    Dependency that validates the Bearer token.

    If auth is disabled in settings (default for dev), returns a dummy user.
    If auth is enabled, validates the token against the configured secret.

    Returns:
        Dict representing the authenticated user, or None if auth is disabled.

    Raises:
        HTTPException 401 if auth is enabled and credentials are invalid.
    """
    settings = get_settings()

    if not settings.auth_enabled:
        # Auth disabled — allow all traffic (dev/staging without auth)
        return {"sub": "anonymous", "roles": ["admin"]}

    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # ---------------------------------------------------------
    # Replace this block with real JWT validation using:
    #   import jwt
    #   payload = jwt.decode(credentials.credentials, settings.auth_secret_key, ...)
    # ---------------------------------------------------------
    if credentials.credentials != settings.auth_secret_key:
        logger.warning("auth_invalid_token", client=request.client.host if request.client else "?")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {"sub": "authenticated_user", "roles": ["admin"]}
