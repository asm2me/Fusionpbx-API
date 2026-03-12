import httpx
import logging
from config import settings

logger = logging.getLogger(__name__)


class FusionPBXService:
    def __init__(self):
        self._client: httpx.AsyncClient = None

    async def init(self):
        self._client = httpx.AsyncClient(
            base_url=settings.fusionpbx_base_url,
            auth=(settings.fusionpbx_username, settings.fusionpbx_password),
            verify=False,
            timeout=10.0,
            headers={'Accept': 'application/json', 'Content-Type': 'application/json'},
        )

    async def close(self):
        if self._client:
            await self._client.aclose()

    async def ping(self) -> bool:
        try:
            await self._client.get('/')
            return True
        except Exception:
            return False

    async def get_domains(self) -> dict:
        r = await self._client.get('/api/v2/domains', params={'enabled': 'true'})
        r.raise_for_status()
        return r.json()

    async def get_registrations(self, domain: str = None) -> dict:
        params = {}
        if domain:
            params['domain'] = domain
        r = await self._client.get('/api/v2/registrations', params=params)
        r.raise_for_status()
        return r.json()


fusionpbx_service = FusionPBXService()
