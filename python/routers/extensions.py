from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from deps.auth import require_auth
from services.db_service import db_service
from services.fusionpbx_service import fusionpbx_service

router = APIRouter(prefix='/api/extensions', tags=['Extensions'])


def _effective_domain(user: dict, requested: Optional[str] = None) -> Optional[str]:
    if user.get('source') == 'user':
        return user.get('domain')
    return requested


@router.get('/registrations')
async def get_registrations(
    domain: Optional[str] = Query(None),
    _user=Depends(require_auth),
):
    regs = await fusionpbx_service.get_registrations(_effective_domain(_user, domain))
    return {'registrations': regs}


@router.get('')
@router.get('/')
async def get_extensions(
    domain: str = Query(...),
    _user=Depends(require_auth),
):
    extensions = await db_service.get_extensions(_effective_domain(_user, domain))
    return {'extensions': extensions, 'count': len(extensions)}


@router.get('/{extension}')
async def get_extension(
    extension: str,
    domain: str = Query(...),
    _user=Depends(require_auth),
):
    ext = await db_service.get_extension_by_number(extension, _effective_domain(_user, domain))
    if not ext:
        raise HTTPException(404, 'Extension not found')
    return {'extension': ext}
