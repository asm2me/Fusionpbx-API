from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from datetime import datetime, timedelta
from config import settings

api_key_header = APIKeyHeader(name='X-API-Key', auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)


def create_token(api_key: str, domain: str = None) -> str:
    payload = {
        'sub': api_key,
        'domain': domain,
        'exp': datetime.utcnow() + timedelta(hours=settings.jwt_expire_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm='HS256')


async def _lookup_user_by_api_key(key: str) -> dict | None:
    """Check v_users.user_api_key — returns user info or None."""
    try:
        from services.db_service import db_service
        return await db_service.get_user_by_api_key(key)
    except Exception:
        return None


async def _verify_api_key(key: str) -> dict:
    # 1. Match global API key from v_default_settings
    if settings.api_key and key == settings.api_key:
        return {'sub': key, 'source': 'global'}
    # 2. Match per-user API key from v_users
    user = await _lookup_user_by_api_key(key)
    if user:
        return {
            'sub': key,
            'source': 'user',
            'username': user['username'],
            'domain': user['domain'],
            'user_uuid': user['user_uuid'],
        }
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid API key')


def _verify_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=['HS256'])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid or expired token')


async def require_auth(
    api_key: str = Security(api_key_header),
    bearer: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> dict:
    if api_key:
        return await _verify_api_key(api_key)
    if bearer:
        return _verify_jwt(bearer.credentials)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Authentication required')


async def verify_ws_token(token: str) -> dict:
    """Verify WebSocket token (global API key, user API key, or JWT)."""
    if settings.api_key and token == settings.api_key:
        return {'sub': token, 'source': 'global'}
    user = await _lookup_user_by_api_key(token)
    if user:
        return {'sub': token, 'source': 'user', 'username': user['username']}
    return _verify_jwt(token)
