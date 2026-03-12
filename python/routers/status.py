from datetime import datetime
from fastapi import APIRouter, Depends
from deps.auth import require_auth
from services.esl_service import esl_service
from services.db_service import db_service
from services.ws_service import ws_service

router = APIRouter(prefix='/api/status', tags=['Status'])


@router.get('/')
async def status():
    return {
        'status': 'ok',
        'service': 'FusionPBX API Bridge',
        'version': '1.0.0',
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    }


@router.get('/detailed')
async def status_detailed(_user=Depends(require_auth)):
    db_ok = await db_service.test_connection()
    esl_status = esl_service.get_status()
    ws_clients = ws_service.get_connected_clients()
    return {
        'status': 'ok',
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'services': {
            'esl': esl_status,
            'database': {'connected': db_ok},
            'websocket': {'connectedClients': len(ws_clients), 'clients': ws_clients},
        },
    }
