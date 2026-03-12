from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from deps.auth import require_auth
from services.db_service import db_service

router = APIRouter(prefix='/api/cdr', tags=['CDR'])


@router.get('/stats/summary')
async def call_stats(
    domain: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    _user=Depends(require_auth),
):
    stats = await db_service.get_call_stats({'domain': domain, 'startDate': start_date, 'endDate': end_date})
    return {'stats': stats}


@router.get('/')
async def get_cdr(
    domain: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    direction: Optional[str] = Query(None),
    extension: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    _user=Depends(require_auth),
):
    filters = {
        'domain': domain, 'startDate': start_date, 'endDate': end_date,
        'direction': direction, 'extension': extension, 'searchNumber': search,
        'limit': limit, 'offset': offset,
    }
    records = await db_service.get_cdr(filters)
    total = await db_service.count_cdr(filters)
    return {'records': records, 'total': total, 'limit': limit, 'offset': offset}


@router.get('/{uuid}')
async def get_cdr_record(uuid: str, _user=Depends(require_auth)):
    record = await db_service.get_cdr_by_uuid(uuid)
    if not record:
        raise HTTPException(404, 'CDR record not found')
    return {'record': record}
