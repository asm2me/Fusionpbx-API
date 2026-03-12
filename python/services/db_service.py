import asyncpg
import logging
from typing import Optional
from config import settings

logger = logging.getLogger(__name__)


class DBService:
    def __init__(self):
        self._pool: Optional[asyncpg.Pool] = None

    async def init(self):
        self._pool = await asyncpg.create_pool(
            host=settings.db_host,
            port=settings.db_port,
            database=settings.db_name,
            user=settings.db_user,
            password=settings.db_password,
            min_size=2,
            max_size=10,
        )
        logger.info('Database pool created')

    async def close(self):
        if self._pool:
            await self._pool.close()

    async def test_connection(self) -> bool:
        try:
            async with self._pool.acquire() as conn:
                await conn.fetchval('SELECT 1')
            return True
        except Exception as e:
            logger.error(f'DB test failed: {e}')
            return False

    async def get_user_by_api_key(self, api_key: str) -> dict | None:
        """Look up a FusionPBX user by their user_api_key from v_users."""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT u.user_uuid, u.username, d.domain_name AS domain
                FROM v_users u
                LEFT JOIN v_domains d ON d.domain_uuid = u.domain_uuid
                WHERE u.api_key = $1
                  AND u.user_enabled = 'true'
                LIMIT 1
                """,
                api_key,
            )
        return dict(row) if row else None

    async def get_domains(self) -> list:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT domain_uuid, domain_name, domain_enabled, domain_description "
                "FROM v_domains WHERE domain_enabled = 'true' ORDER BY domain_name"
            )
        return [dict(r) for r in rows]

    async def get_extensions(self, domain: str) -> list:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT e.extension_uuid, e.extension, e.number_alias,
                       e.effective_caller_id_name, e.effective_caller_id_number,
                       e.outbound_caller_id_name, e.outbound_caller_id_number,
                       e.voicemail_enabled, e.enabled, e.description,
                       d.domain_name
                FROM v_extensions e
                JOIN v_domains d ON e.domain_uuid = d.domain_uuid
                WHERE d.domain_name = $1 AND e.enabled = 'true'
                ORDER BY e.extension
                """,
                domain,
            )
        return [dict(r) for r in rows]

    async def get_extension_by_number(self, extension: str, domain: str) -> Optional[dict]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT e.extension_uuid, e.extension, e.number_alias,
                       e.effective_caller_id_name, e.effective_caller_id_number,
                       e.enabled, d.domain_name
                FROM v_extensions e
                JOIN v_domains d ON e.domain_uuid = d.domain_uuid
                WHERE d.domain_name = $1 AND (e.extension = $2 OR e.number_alias = $2)
                LIMIT 1
                """,
                domain, extension,
            )
        return dict(row) if row else None

    def _cdr_where(self, filters: dict, params: list) -> str:
        clauses = []
        if filters.get('domain'):
            params.append(filters['domain'])
            clauses.append(f'domain_name = ${len(params)}')
        if filters.get('startDate'):
            params.append(filters['startDate'])
            clauses.append(f'start_stamp >= ${len(params)}')
        if filters.get('endDate'):
            params.append(filters['endDate'])
            clauses.append(f'start_stamp <= ${len(params)}')
        if filters.get('direction'):
            params.append(filters['direction'])
            clauses.append(f'direction = ${len(params)}')
        if filters.get('extension'):
            params.append(filters['extension'])
            clauses.append(f'(caller_id_number = ${len(params)} OR destination_number = ${len(params)})')
        if filters.get('searchNumber'):
            params.append(f"%{filters['searchNumber']}%")
            clauses.append(f'(caller_id_number LIKE ${len(params)} OR destination_number LIKE ${len(params)} OR caller_id_name LIKE ${len(params)})')
        return ('WHERE ' + ' AND '.join(clauses)) if clauses else ''

    async def get_cdr(self, filters: dict) -> list:
        params = []
        where = self._cdr_where(filters, params)
        limit = int(filters.get('limit', 100))
        offset = int(filters.get('offset', 0))
        params.extend([limit, offset])
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT xml_cdr_uuid, domain_name, direction,
                       caller_id_name, caller_id_number, destination_number,
                       start_stamp, answer_stamp, end_stamp,
                       duration, billsec, hangup_cause,
                       record_path, record_name
                FROM v_xml_cdr {where}
                ORDER BY start_stamp DESC
                LIMIT ${len(params)-1} OFFSET ${len(params)}
                """,
                *params,
            )
        return [dict(r) for r in rows]

    async def count_cdr(self, filters: dict) -> int:
        params = []
        where = self._cdr_where(filters, params)
        async with self._pool.acquire() as conn:
            return await conn.fetchval(
                f'SELECT COUNT(*) FROM v_xml_cdr {where}', *params
            )

    async def get_cdr_by_uuid(self, cdr_uuid: str) -> Optional[dict]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT * FROM v_xml_cdr WHERE xml_cdr_uuid = $1', cdr_uuid
            )
        return dict(row) if row else None

    async def get_call_stats(self, filters: dict) -> dict:
        params = []
        clauses = []
        if filters.get('domain'):
            params.append(filters['domain'])
            clauses.append(f'domain_name = ${len(params)}')
        if filters.get('startDate'):
            params.append(filters['startDate'])
            clauses.append(f'start_stamp >= ${len(params)}')
        if filters.get('endDate'):
            params.append(filters['endDate'])
            clauses.append(f'start_stamp <= ${len(params)}')
        where = ('WHERE ' + ' AND '.join(clauses)) if clauses else ''
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""
                SELECT
                    COUNT(*) AS total_calls,
                    SUM(CASE WHEN billsec > 0 THEN 1 ELSE 0 END) AS answered_calls,
                    SUM(CASE WHEN billsec = 0 THEN 1 ELSE 0 END) AS missed_calls,
                    COALESCE(AVG(CASE WHEN billsec > 0 THEN billsec END), 0) AS avg_duration,
                    COALESCE(SUM(billsec), 0) AS total_duration
                FROM v_xml_cdr {where}
                """,
                *params,
            )
        return dict(row)


db_service = DBService()
