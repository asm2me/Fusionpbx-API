from fastapi import APIRouter, Depends
from deps.auth import require_auth
from services.db_service import db_service

router = APIRouter(prefix='/api/domains', tags=['Domains'])


@router.get('/')
async def get_domains(_user=Depends(require_auth)):
    domains = await db_service.get_domains()
    return {'domains': domains, 'count': len(domains)}
