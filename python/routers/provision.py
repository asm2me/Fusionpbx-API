"""
Provisioning link generator.

POST /api/provision/generate
  — Admin sends an extension number; we look up all SIP settings from the DB,
    sign them into a time-limited JWT, and return a click-to-configure URL.

The resulting URL (https://voipat.com/provision?t=<jwt>) can be pasted
into WhatsApp / SMS.  Clicking it:
  • Opens the VOIP@ Dialer if already installed (voipat:// deep-link).
  • Falls back to the download page if the app is not installed.
  • The app decodes the JWT payload and auto-applies all settings.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from jose import jwt
from pydantic import BaseModel

from config import settings
from deps.auth import require_auth
from services.db_service import db_service

router = APIRouter(prefix='/api/provision', tags=['Provisioning'])

PROVISION_BASE_URL = 'https://voipat.com/provision'


# ── Request / Response models ─────────────────────────────────────────────────

class ProvisionRequest(BaseModel):
    extension: str
    domain: str
    # All fields below are optional — defaults are auto-derived from the domain
    wss_url: Optional[str] = None          # e.g. wss://sip.company.com:7443
    stun: Optional[str] = 'stun:stun.l.google.com:19302'
    turn: Optional[str] = None             # e.g. turn:turn.company.com:3478
    turn_username: Optional[str] = None
    turn_password: Optional[str] = None
    codec: Optional[str] = 'PCMU (G.711 µ-law)'
    expires_hours: Optional[int] = 48


class ProvisionResponse(BaseModel):
    token: str
    url: str
    extension: str
    display_name: str
    expires_at: str


# ── Helper ────────────────────────────────────────────────────────────────────

def _effective_domain(user: dict, requested: str) -> str:
    """User-scoped API keys can only provision their own domain."""
    if user.get('source') == 'user':
        return user.get('domain', requested)
    return requested


def _auto_wss(domain: str) -> str:
    """Derive the standard FusionPBX WSS endpoint from the SIP domain."""
    return f'wss://{domain}:7443'


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post('/generate', response_model=ProvisionResponse)
async def generate_provision_link(
    req: ProvisionRequest,
    user=Depends(require_auth),
):
    domain = _effective_domain(user, req.domain)

    ext = await db_service.get_extension_for_provision(req.extension, domain)
    if not ext:
        raise HTTPException(404, f'Extension {req.extension} not found in domain {domain}')

    if not ext.get('password'):
        raise HTTPException(422, 'Extension has no SIP password set — configure it in FusionPBX first')

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(hours=req.expires_hours or 48)

    payload = {
        'type':    'provision',
        'ext':     ext['extension'],
        'pass':    ext['password'],
        'domain':  domain,
        'display': ext.get('effective_caller_id_name') or ext['extension'],
        'wss':     req.wss_url or _auto_wss(domain),
        'stun':    req.stun or 'stun:stun.l.google.com:19302',
        'codec':   req.codec or 'PCMU (G.711 µ-law)',
        'iat':     int(now.timestamp()),
        'exp':     int(expires_at.timestamp()),
    }
    if req.turn:          payload['turn']       = req.turn
    if req.turn_username: payload['turn_user']  = req.turn_username
    if req.turn_password: payload['turn_pass']  = req.turn_password

    token = jwt.encode(payload, settings.jwt_secret, algorithm='HS256')
    url = f'{PROVISION_BASE_URL}?t={token}'

    return ProvisionResponse(
        token=token,
        url=url,
        extension=ext['extension'],
        display_name=payload['display'],
        expires_at=expires_at.isoformat(),
    )
