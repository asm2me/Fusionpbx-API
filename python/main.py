"""
FusionPBX API Bridge - Python/FastAPI Edition

Startup order:
  1. Connect to FusionPBX PostgreSQL
  2. Load all api_bridge.* settings from v_default_settings
  3. Apply those settings to the runtime config object
  4. Connect to FreeSWITCH ESL (using DB-configured host/port/password)
  5. Start HTTP + WebSocket server
"""

import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from services.esl_service import esl_service
from services.db_service import db_service
from services.fusionpbx_service import fusionpbx_service
from services.ws_service import ws_service
from deps.auth import verify_ws_token
from routers import auth, calls, cdr, extensions, domains, status

logging.basicConfig(
    level=logging.DEBUG if settings.env == 'development' else logging.INFO,
    format='%(asctime)s %(levelname)s %(name)s: %(message)s',
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


async def _load_settings_from_db() -> None:
    """
    Read api_bridge.* rows from v_default_settings and apply them
    to the runtime settings object before any service connects.
    """
    try:
        async with db_service._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT default_setting_subcategory, default_setting_value
                FROM   v_default_settings
                WHERE  default_setting_category = 'api_bridge'
                  AND  default_setting_enabled  = 'true'
                """
            )
        db_cfg = {r['default_setting_subcategory']: r['default_setting_value'] for r in rows}
        settings.apply_db_settings(db_cfg)
        logger.info('Settings loaded from v_default_settings (%d entries)', len(db_cfg))
    except Exception as e:
        logger.warning('Could not load settings from DB, using defaults: %s', e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── 1. Init DB pool ───────────────────────────────────────────────────────
    try:
        await db_service.init()
        ok = await db_service.test_connection()
        if ok:
            logger.info('Database connected')
        else:
            logger.warning('Database connection test failed — CDR queries will not work')
    except Exception as e:
        logger.warning('DB init error: %s', e)

    # ── 2. Load settings from FusionPBX v_default_settings ───────────────────
    if db_service._pool:
        await _load_settings_from_db()

    # ── 3. Init FusionPBX HTTP client ─────────────────────────────────────────
    await fusionpbx_service.init()

    # ── 4. Connect ESL (now using DB-loaded ESL settings) ────────────────────
    esl_service.on_event(ws_service.broadcast_event)
    try:
        await esl_service.connect()
        logger.info('ESL connected: %s:%s', settings.esl_host, settings.esl_port)
        await ws_service.broadcast_status('connected', {'host': settings.esl_host})
    except Exception as e:
        logger.warning('ESL initial connection failed (will retry): %s', e)

    logger.info(
        '\n%s\n  FusionPBX API Bridge (Python) started\n%s\n'
        '  HTTP API:  http://0.0.0.0:%s/api\n'
        '  WebSocket: ws://0.0.0.0:%s/ws\n'
        '  Docs:      http://0.0.0.0:%s/docs\n'
        '  ESL:       %s:%s\n'
        '  DB:        %s:%s/%s\n%s',
        '━' * 52, '━' * 52,
        settings.port, settings.port, settings.port,
        settings.esl_host, settings.esl_port,
        settings.db_host, settings.db_port, settings.db_name,
        '━' * 52,
    )

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    await esl_service.disconnect()
    await db_service.close()
    await fusionpbx_service.close()
    logger.info('Server shut down')


app = FastAPI(
    title='FusionPBX API Bridge',
    version='1.0.0',
    description='REST API + WebSocket bridge for FusionPBX/FreeSWITCH — settings managed via FusionPBX Admin UI',
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

app.include_router(auth.router)
app.include_router(calls.router)
app.include_router(cdr.router)
app.include_router(extensions.router)
app.include_router(domains.router)
app.include_router(status.router)


@app.websocket('/ws')
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    domain: str = Query(None),
):
    try:
        user_info = await verify_ws_token(token)
    except Exception:
        await websocket.close(code=4001)
        return

    # Enforce domain from user's account — user-key auth cannot see other domains
    if user_info.get('source') == 'user':
        user_domain = user_info.get('domain')
        if user_domain:
            domain = user_domain

    await ws_service.connect(websocket, domain)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_service.disconnect(websocket)


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(
        'main:app',
        host='127.0.0.1',
        port=settings.port,
        reload=settings.env == 'development',
        log_level='debug' if settings.env == 'development' else 'info',
    )
