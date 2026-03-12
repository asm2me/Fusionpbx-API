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


def _verify_api_key(key: str) -> dict:
    if key != settings.api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid API key')
    return {'sub': key}


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
        return _verify_api_key(api_key)
    if bearer:
        return _verify_jwt(bearer.credentials)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Authentication required')


def verify_ws_token(token: str) -> dict:
    """Verify WebSocket token (API key or JWT)."""
    if token == settings.api_key:
        return {'sub': token}
    return _verify_jwt(token)
