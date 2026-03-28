from fastapi import APIRouter, Depends
from deps.auth import require_auth
from services.db_service import db_service

router = APIRouter(prefix='/api/domains', tags=['Domains'])


@router.get('/')
async def get_domains(_user=Depends(require_auth)):
    # User-key auth can only see their own domain
    if _user.get('source') == 'user':
        user_domain = _user.get('domain')
        if user_domain:
            return {'domains': [{'domain_name': user_domain}], 'count': 1}
    domains = await db_service.get_domains()
    return {'domains': domains, 'count': len(domains)}
