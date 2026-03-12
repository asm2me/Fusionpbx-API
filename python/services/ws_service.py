import json
import logging
from datetime import datetime
from typing import Optional
from fastapi import WebSocket

logger = logging.getLogger(__name__)

EVENT_TYPE_MAP = {
    'CHANNEL_CREATE': 'call.created',
    'CHANNEL_ANSWER': 'call.answered',
    'CHANNEL_HOLD': 'call.held',
    'CHANNEL_UNHOLD': 'call.unheld',
    'CHANNEL_BRIDGE': 'call.bridged',
    'CHANNEL_UNBRIDGE': 'call.unbridged',
    'CHANNEL_HANGUP': 'call.hangup',
    'CHANNEL_HANGUP_COMPLETE': 'call.hangup',
    'DTMF': 'call.dtmf',
    'CHANNEL_CALLSTATE': 'channel.update',
    'CHANNEL_STATE': 'channel.update',
}


class WSClient:
    def __init__(self, ws: WebSocket, domain: Optional[str] = None):
        self.ws = ws
        self.domain = domain


class WSService:
    def __init__(self):
        self._clients: list[WSClient] = []

    async def connect(self, ws: WebSocket, domain: Optional[str] = None):
        await ws.accept()
        self._clients.append(WSClient(ws, domain))
        logger.info(f'WS client connected domain={domain} total={len(self._clients)}')

    def disconnect(self, ws: WebSocket):
        self._clients = [c for c in self._clients if c.ws is not ws]
        logger.info(f'WS client disconnected total={len(self._clients)}')

    async def broadcast_event(self, payload: dict):
        event_name = payload.get('event', '')
        event_type = EVENT_TYPE_MAP.get(event_name, 'channel.update')
        message = json.dumps({
            'type': event_type,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'data': payload,
        })
        domain = payload.get('domain')
        dead = []
        for client in self._clients:
            if client.domain and domain and client.domain != domain:
                continue
            try:
                await client.ws.send_text(message)
            except Exception:
                dead.append(client.ws)
        for ws in dead:
            self.disconnect(ws)

    async def broadcast_status(self, status: str, data: dict = None):
        message = json.dumps({
            'type': 'system.status',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'data': {'status': status, **(data or {})},
        })
        dead = []
        for client in self._clients:
            try:
                await client.ws.send_text(message)
            except Exception:
                dead.append(client.ws)
        for ws in dead:
            self.disconnect(ws)

    def get_connected_clients(self) -> list:
        return [{'domain': c.domain} for c in self._clients]


ws_service = WSService()
