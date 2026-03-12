import re
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional
from deps.auth import require_auth
from services.esl_service import esl_service

router = APIRouter(prefix='/api/calls', tags=['Calls'])

UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I
)


def valid_uuid(uuid: str) -> str:
    if not UUID_RE.match(uuid):
        raise HTTPException(400, 'Invalid UUID format')
    return uuid


def check_esl():
    if not esl_service.connected:
        raise HTTPException(503, 'ESL not connected to FreeSWITCH')


class OriginateRequest(BaseModel):
    from_ext: str = Field(alias='from')
    to: str
    domain: str
    callerId: Optional[str] = None
    callerName: Optional[str] = None
    timeout: Optional[int] = 30

    model_config = {'populate_by_name': True}


class HangupRequest(BaseModel):
    cause: Optional[str] = 'NORMAL_CLEARING'


class TransferRequest(BaseModel):
    destination: str
    domain: str
    type: Optional[str] = 'blind'


class DtmfRequest(BaseModel):
    digits: str


@router.get('/active')
async def get_active_calls(
    domain: Optional[str] = Query(None),
    _user=Depends(require_auth),
):
    calls = await esl_service.get_active_calls(domain)
    return {'calls': calls, 'count': len(calls)}


@router.get('/channels')
async def get_channels(
    domain: Optional[str] = Query(None),
    _user=Depends(require_auth),
):
    channels = await esl_service.get_active_channels(domain)
    return {'channels': channels, 'count': len(channels)}


@router.get('/esl/status')
async def esl_status(_user=Depends(require_auth)):
    return esl_service.get_status()


@router.get('/channels/{uuid}')
async def get_channel(uuid: str, _user=Depends(require_auth)):
    valid_uuid(uuid)
    channel = await esl_service.get_channel_info(uuid)
    if not channel:
        raise HTTPException(404, 'Channel not found')
    return {'channel': channel}


@router.post('/originate')
async def originate_call(body: OriginateRequest, _user=Depends(require_auth)):
    check_esl()
    if not body.from_ext or not body.to or not body.domain:
        raise HTTPException(400, 'from, to, domain are required')
    if body.timeout and not (5 <= body.timeout <= 120):
        raise HTTPException(400, 'timeout must be between 5 and 120')
    result = await esl_service.originate_call(
        from_ext=body.from_ext,
        to=body.to,
        domain=body.domain,
        caller_id=body.callerId,
        caller_name=body.callerName,
        timeout=body.timeout or 30,
    )
    return {'uuid': result['uuid'], 'message': f"Call from {body.from_ext} to {body.to} initiated"}


@router.post('/{uuid}/hangup')
async def hangup(uuid: str, body: HangupRequest = HangupRequest(), _user=Depends(require_auth)):
    valid_uuid(uuid)
    check_esl()
    await esl_service.hangup(uuid, body.cause or 'NORMAL_CLEARING')
    return {'success': True, 'message': 'Call terminated', 'uuid': uuid}


@router.post('/{uuid}/hold')
async def hold(uuid: str, _user=Depends(require_auth)):
    valid_uuid(uuid)
    check_esl()
    await esl_service.hold(uuid)
    return {'success': True, 'message': 'Call placed on hold', 'uuid': uuid}


@router.post('/{uuid}/unhold')
async def unhold(uuid: str, _user=Depends(require_auth)):
    valid_uuid(uuid)
    check_esl()
    await esl_service.unhold(uuid)
    return {'success': True, 'message': 'Call resumed from hold', 'uuid': uuid}


@router.post('/{uuid}/hold/toggle')
async def toggle_hold(uuid: str, _user=Depends(require_auth)):
    valid_uuid(uuid)
    check_esl()
    await esl_service.toggle_hold(uuid)
    return {'success': True, 'message': 'Hold toggled', 'uuid': uuid}


@router.post('/{uuid}/transfer')
async def transfer(uuid: str, body: TransferRequest, _user=Depends(require_auth)):
    valid_uuid(uuid)
    check_esl()
    if body.type not in ('blind', 'attended'):
        raise HTTPException(400, 'type must be "blind" or "attended"')
    if body.type == 'attended':
        result = await esl_service.attended_transfer(uuid, body.destination, body.domain)
        return {
            'success': True,
            'message': f'Attended transfer to {body.destination} initiated',
            'originalUuid': result['originalUuid'],
            'newUuid': result['newUuid'],
        }
    await esl_service.blind_transfer(uuid, body.destination, body.domain)
    return {'success': True, 'message': f'Blind transfer to {body.destination} executed', 'uuid': uuid}


@router.post('/{uuid}/dtmf')
async def send_dtmf(uuid: str, body: DtmfRequest, _user=Depends(require_auth)):
    valid_uuid(uuid)
    check_esl()
    if not re.match(r'^[0-9*#A-D]+$', body.digits):
        raise HTTPException(400, 'Invalid DTMF digits')
    await esl_service.send_dtmf(uuid, body.digits)
    return {'success': True, 'message': f'DTMF {body.digits} sent', 'uuid': uuid}


@router.post('/{uuid}/mute')
async def mute(uuid: str, _user=Depends(require_auth)):
    valid_uuid(uuid)
    check_esl()
    await esl_service.mute(uuid)
    return {'success': True, 'message': 'Channel muted', 'uuid': uuid}


@router.post('/{uuid}/unmute')
async def unmute(uuid: str, _user=Depends(require_auth)):
    valid_uuid(uuid)
    check_esl()
    await esl_service.unmute(uuid)
    return {'success': True, 'message': 'Channel unmuted', 'uuid': uuid}
