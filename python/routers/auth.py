from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from deps.auth import create_token
from config import settings

router = APIRouter(prefix='/api/auth', tags=['Auth'])


class TokenRequest(BaseModel):
    api_key: str
    domain: str = None


@router.post('/token')
async def get_token(body: TokenRequest):
    if body.api_key != settings.api_key:
        raise HTTPException(status_code=401, detail='Invalid API key')
    token = create_token(body.api_key, body.domain)
    return {'token': token, 'type': 'Bearer'}
