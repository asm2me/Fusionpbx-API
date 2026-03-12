import asyncio
import json
import logging
import uuid as uuid_lib
from typing import Optional, Callable, List
from config import settings

logger = logging.getLogger(__name__)

SUBSCRIBE_EVENTS = [
    'CHANNEL_CREATE', 'CHANNEL_ANSWER', 'CHANNEL_HANGUP',
    'CHANNEL_HANGUP_COMPLETE', 'CHANNEL_BRIDGE', 'CHANNEL_UNBRIDGE',
    'CHANNEL_HOLD', 'CHANNEL_UNHOLD', 'CHANNEL_PARK', 'CHANNEL_UNPARK',
    'CHANNEL_CALLSTATE', 'CHANNEL_STATE', 'DTMF', 'CALL_UPDATE',
    'RECORD_START', 'RECORD_STOP', 'PLAYBACK_START', 'PLAYBACK_STOP',
]


class ESLMessage:
    def __init__(self, headers: dict, body: str = ''):
        self.headers = headers
        self.body = body

    def get(self, key: str, default=None):
        return self.headers.get(key, default)


class ESLService:
    def __init__(self):
        self.connected = False
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._cmd_lock = asyncio.Lock()
        self._response_queue: asyncio.Queue = asyncio.Queue()
        self._event_listeners: List[Callable] = []
        self._read_task: Optional[asyncio.Task] = None
        self._reconnect_attempts: int = 0

    # ── Connection ──────────────────────────────────────────────────────────

    async def connect(self):
        self._reader, self._writer = await asyncio.open_connection(
            settings.esl_host, settings.esl_port
        )
        # Auth handshake (before reader loop)
        msg = await self._read_message()
        if msg.get('Content-Type') != 'auth/request':
            raise ConnectionError(f"Expected auth/request, got: {msg.get('Content-Type')}")

        self._write(f'auth {settings.esl_password}')
        msg = await self._read_message()
        reply = msg.get('Reply-Text', '')
        if not reply.startswith('+OK'):
            raise ConnectionError(f'ESL auth failed: {reply}')

        # Subscribe to events
        self._write('event plain ' + ' '.join(SUBSCRIBE_EVENTS))
        msg = await self._read_message()
        if not msg.get('Reply-Text', '').startswith('+OK'):
            logger.warning(f'Event subscribe reply: {msg.get("Reply-Text")}')

        self.connected = True
        self._reconnect_attempts = 0
        logger.info(f'ESL connected to {settings.esl_host}:{settings.esl_port}')

        self._read_task = asyncio.create_task(self._reader_loop())

    def _write(self, command: str):
        self._writer.write(f'{command}\n\n'.encode())

    async def _read_message(self) -> ESLMessage:
        headers: dict = {}
        while True:
            line = await self._reader.readline()
            line = line.decode('utf-8', errors='replace').rstrip('\r\n')
            if line == '':
                break
            if ': ' in line:
                k, _, v = line.partition(': ')
                headers[k] = v
        body = ''
        length = int(headers.get('Content-Length', 0))
        if length > 0:
            data = await self._reader.readexactly(length)
            body = data.decode('utf-8', errors='replace')
        return ESLMessage(headers, body)

    async def _reader_loop(self):
        try:
            while True:
                msg = await self._read_message()
                ct = msg.get('Content-Type', '')
                if ct in ('api/response', 'command/reply'):
                    await self._response_queue.put(msg)
                elif ct == 'text/event-plain':
                    asyncio.create_task(self._dispatch_event(msg))
        except asyncio.IncompleteReadError:
            pass
        except Exception as e:
            logger.error(f'ESL reader error: {e}')
        finally:
            self.connected = False
            logger.warning('ESL connection lost, scheduling reconnect')
            asyncio.create_task(self._schedule_reconnect())

    async def _dispatch_event(self, msg: ESLMessage):
        event_headers: dict = {}
        if msg.body:
            for line in msg.body.split('\n'):
                line = line.strip()
                if ': ' in line:
                    k, _, v = line.partition(': ')
                    event_headers[k] = v
        event_name = event_headers.get('Event-Name', '')
        payload = {
            'event': event_name,
            'uuid': event_headers.get('Unique-ID'),
            'callerNumber': event_headers.get('Caller-Caller-ID-Number'),
            'calleeNumber': (event_headers.get('Caller-Callee-ID-Number')
                             or event_headers.get('variable_sip_to_user')),
            'domain': event_headers.get('variable_domain_name'),
            'channelState': event_headers.get('Channel-State'),
            'answerState': event_headers.get('Answer-State'),
            'direction': event_headers.get('Call-Direction'),
            'hangupCause': event_headers.get('Hangup-Cause'),
        }
        for listener in self._event_listeners:
            try:
                await listener(payload)
            except Exception as e:
                logger.error(f'Event listener error: {e}')

    async def _schedule_reconnect(self):
        self._reconnect_attempts += 1
        if self._reconnect_attempts > settings.esl_max_reconnect:
            logger.error('ESL max reconnect attempts reached')
            return
        delay = settings.esl_reconnect_delay
        logger.info(f'ESL reconnecting in {delay}s (attempt {self._reconnect_attempts})')
        await asyncio.sleep(delay)
        try:
            await self.connect()
        except Exception as e:
            logger.error(f'ESL reconnect failed: {e}')
            asyncio.create_task(self._schedule_reconnect())

    async def disconnect(self):
        self.connected = False
        if self._read_task:
            self._read_task.cancel()
        if self._writer:
            self._writer.close()
            try:
                await self._writer.wait_closed()
            except Exception:
                pass

    # ── ESL Commands ────────────────────────────────────────────────────────

    async def api(self, command: str) -> str:
        if not self.connected:
            raise RuntimeError('ESL not connected')
        async with self._cmd_lock:
            self._write(f'api {command}')
            msg = await asyncio.wait_for(self._response_queue.get(), timeout=10.0)
        body = msg.body or ''
        if body.startswith('-ERR'):
            raise RuntimeError(body.replace('-ERR ', '').strip())
        return body

    async def bgapi(self, command: str) -> str:
        if not self.connected:
            raise RuntimeError('ESL not connected')
        async with self._cmd_lock:
            self._write(f'bgapi {command}')
            msg = await asyncio.wait_for(self._response_queue.get(), timeout=10.0)
        return msg.get('Reply-Text', '')

    # ── Call Operations ─────────────────────────────────────────────────────

    async def originate_call(self, from_ext: str, to: str, domain: str,
                              caller_id: str = None, caller_name: str = None,
                              timeout: int = 30) -> dict:
        call_uuid = str(uuid_lib.uuid4())
        cid_num = caller_id or from_ext
        cid_name = caller_name or from_ext
        dial_vars = ','.join([
            f'origination_uuid={call_uuid}',
            f'origination_caller_id_number={cid_num}',
            f'origination_caller_id_name={cid_name}',
            f'domain_name={domain}',
            f'originate_timeout={timeout}',
        ])
        cmd = (f'originate {{{dial_vars}}}'
               f'sofia/internal/{from_ext}@{domain} '
               f'&bridge(sofia/internal/{to}@{domain})')
        logger.info(f'Originating call from={from_ext} to={to} domain={domain} uuid={call_uuid}')
        await self.bgapi(cmd)
        return {'uuid': call_uuid}

    async def hangup(self, call_uuid: str, cause: str = 'NORMAL_CLEARING') -> str:
        return await self.api(f'uuid_kill {call_uuid} {cause}')

    async def hold(self, call_uuid: str) -> str:
        return await self.api(f'uuid_hold {call_uuid}')

    async def unhold(self, call_uuid: str) -> str:
        return await self.api(f'uuid_hold off {call_uuid}')

    async def toggle_hold(self, call_uuid: str) -> str:
        return await self.api(f'uuid_hold toggle {call_uuid}')

    async def blind_transfer(self, call_uuid: str, destination: str, domain: str) -> str:
        return await self.api(f'uuid_transfer {call_uuid} {destination} XML {domain}')

    async def attended_transfer(self, call_uuid: str, destination: str, domain: str) -> dict:
        await self.hold(call_uuid)
        new_uuid = str(uuid_lib.uuid4())
        cmd = (f'originate {{origination_uuid={new_uuid},domain_name={domain}}}'
               f'sofia/internal/{destination}@{domain} &bridge({call_uuid})')
        await self.bgapi(cmd)
        return {'originalUuid': call_uuid, 'newUuid': new_uuid}

    async def send_dtmf(self, call_uuid: str, digits: str) -> str:
        return await self.api(f'uuid_send_dtmf {call_uuid} {digits}')

    async def mute(self, call_uuid: str, direction: str = 'write') -> str:
        return await self.api(f'uuid_audio {call_uuid} start {direction} mute')

    async def unmute(self, call_uuid: str, direction: str = 'write') -> str:
        return await self.api(f'uuid_audio {call_uuid} stop {direction} mute')

    async def get_active_channels(self, domain: str = None) -> list:
        raw = await self.api('show channels as json')
        try:
            data = json.loads(raw)
        except Exception:
            return []
        rows = data.get('rows', [])
        if domain:
            rows = [r for r in rows if domain in (r.get('context') or '')]
        return rows

    async def get_active_calls(self, domain: str = None) -> list:
        raw = await self.api('show calls as json')
        try:
            data = json.loads(raw)
        except Exception:
            return []
        rows = data.get('rows', [])
        if domain:
            rows = [r for r in rows if domain in (r.get('context') or '')]
        return rows

    async def get_channel_info(self, call_uuid: str) -> Optional[dict]:
        channels = await self.get_active_channels()
        return next((c for c in channels if c.get('uuid') == call_uuid), None)

    def get_status(self) -> dict:
        return {
            'connected': self.connected,
            'host': settings.esl_host,
            'port': settings.esl_port,
            'reconnectAttempts': self._reconnect_attempts,
        }

    def on_event(self, listener: Callable):
        self._event_listeners.append(listener)


esl_service = ESLService()
