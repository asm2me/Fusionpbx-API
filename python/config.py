"""
Configuration for FusionPBX API Bridge.

Bootstrap order:
  1. /etc/fusionpbx/config.conf  — auto-detected DB credentials on a FusionPBX server
  2. .env file                   — manual override / development
  3. v_default_settings table    — all other settings, managed via FusionPBX Admin UI

The DB connection is the only thing needed before the app can read the rest of
its settings from the database, so it is the only thing in .env / config.conf.
"""

import configparser
import logging
import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# ── 1. Try to read FusionPBX's own config.conf for DB credentials ─────────────
_FPBX_CONF = Path('/etc/fusionpbx/config.conf')
_fpbx_db: dict = {}

if _FPBX_CONF.exists():
    try:
        _parser = configparser.ConfigParser()
        _parser.read(_FPBX_CONF)
        _sec = 'database' if _parser.has_section('database') else _parser.sections()[0]
        _fpbx_db = {
            'DB_HOST':     _parser.get(_sec, 'host',     fallback=''),
            'DB_PORT':     _parser.get(_sec, 'port',     fallback='5432'),
            'DB_NAME':     _parser.get(_sec, 'name',     fallback='fusionpbx'),
            'DB_USER':     _parser.get(_sec, 'username', fallback='fusionpbx'),
            'DB_PASSWORD': _parser.get(_sec, 'password', fallback=''),
        }
        logger.debug('Loaded DB credentials from %s', _FPBX_CONF)
    except Exception as e:
        logger.debug('Could not read %s: %s', _FPBX_CONF, e)

# Push parsed values into env so pydantic-settings picks them up
# (only if not already overridden by the environment or .env)
for _k, _v in _fpbx_db.items():
    if _v and _k not in os.environ:
        os.environ.setdefault(_k, _v)


# ── 2. Pydantic settings (reads .env + environment) ───────────────────────────

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', case_sensitive=False)

    # Server
    port: int = 3000
    env: str = 'production'

    # Auth — loaded from v_default_settings at startup, these are defaults
    api_key: str = 'change-me'
    jwt_secret: str = 'change-me-jwt'
    jwt_expire_hours: int = 24

    # FusionPBX HTTP API (optional, used for registrations endpoint)
    fusionpbx_host: str = '127.0.0.1'
    fusionpbx_protocol: str = 'https'
    fusionpbx_username: str = 'admin'
    fusionpbx_password: str = ''

    # FreeSWITCH ESL — loaded from v_default_settings at startup
    esl_host: str = '127.0.0.1'
    esl_port: int = 8021
    esl_password: str = 'ClueCon'
    esl_reconnect_delay: int = 5
    esl_max_reconnect: int = 10

    # PostgreSQL — loaded from /etc/fusionpbx/config.conf or .env
    db_host: str = '127.0.0.1'
    db_port: int = 5432
    db_name: str = 'fusionpbx'
    db_user: str = 'fusionpbx'
    db_password: str = ''

    @property
    def fusionpbx_base_url(self) -> str:
        return f"{self.fusionpbx_protocol}://{self.fusionpbx_host}"

    def apply_db_settings(self, db_settings: dict) -> None:
        """
        Apply settings loaded from v_default_settings.
        Called from main.py after the DB pool is ready.
        """
        mapping = {
            'esl_host':            ('esl_host',            str,  None),
            'esl_port':            ('esl_port',            int,  None),
            'esl_password':        ('esl_password',        str,  None),
            'esl_reconnect_delay': ('esl_reconnect_delay', int,  None),
            'esl_max_reconnect':   ('esl_max_reconnect',   int,  None),
            'api_port':            ('port',                int,  None),
            'api_key':             ('api_key',             str,  None),
            'jwt_secret':          ('jwt_secret',          str,  None),
            'jwt_expire_hours':    ('jwt_expire_hours',    int,  None),
        }
        for db_key, (attr, cast, _) in mapping.items():
            raw = db_settings.get(db_key)
            if raw:
                try:
                    object.__setattr__(self, attr, cast(raw))
                    logger.debug('Setting %s = %s (from DB)', attr, raw if 'password' not in attr and 'secret' not in attr and 'key' not in attr else '***')
                except (ValueError, TypeError) as e:
                    logger.warning('Bad value for %s in v_default_settings: %s', db_key, e)


settings = Settings()
