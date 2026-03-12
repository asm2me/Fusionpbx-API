from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from deps.auth import require_auth
from services.db_service import db_service
from services.fusionpbx_service import fusionpbx_service

router = APIRouter(prefix='/api/extensions', tags=['Extensions'])


@router.get('/registrations')
async def get_registrations(
    domain: Optional[str] = Query(None),
    _user=Depends(require_auth),
):
    regs = await fusionpbx_service.get_registrations(domain)
    return {'registrations': regs}


@router.get('/')
async def get_extensions(
    domain: str = Query(...),
    _user=Depends(require_auth),
):
    extensions = await db_service.get_extensions(domain)
    return {'extensions': extensions, 'count': len(extensions)}


@router.get('/{extension}')
async def get_extension(
    extension: str,
    domain: str = Query(...),
    _user=Depends(require_auth),
):
    ext = await db_service.get_extension_by_number(extension, domain)
    if not ext:
        raise HTTPException(404, 'Extension not found')
    return {'extension': ext}
