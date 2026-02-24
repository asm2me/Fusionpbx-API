-- ============================================================
-- FusionPBX API Bridge – API Keys Table
-- Run this once on your FusionPBX PostgreSQL database:
--   psql -U fusionpbx -d fusionpbx -f migrations/001_create_api_keys.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS v_api_keys (
    -- Primary key
    api_key_uuid        UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to FusionPBX user (cascade delete when user is removed)
    user_uuid           UUID                        NOT NULL
                            REFERENCES v_users(user_uuid) ON DELETE CASCADE,

    -- Link to FusionPBX domain (cascade delete when domain is removed)
    domain_uuid         UUID                        NOT NULL
                            REFERENCES v_domains(domain_uuid) ON DELETE CASCADE,

    -- Denormalized for fast lookup without joins
    domain_name         VARCHAR(255)                NOT NULL,
    username            VARCHAR(255)                NOT NULL,

    -- SHA-256 hex digest of the plain-text API key (never store plain key)
    api_key_hash        VARCHAR(64)                 NOT NULL UNIQUE,

    -- First 12 chars of the plain key — shown in listings for identification
    key_prefix          VARCHAR(12)                 NOT NULL,

    -- Human-readable label (e.g. "CRM Production", "Zoho Integration")
    description         VARCHAR(255),

    -- Admin keys bypass the domain lock and can access all domains
    is_admin            BOOLEAN                     NOT NULL DEFAULT FALSE,

    -- Soft-disable without deleting
    enabled             BOOLEAN                     NOT NULL DEFAULT TRUE,

    -- Audit fields
    last_used_at        TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE    NOT NULL DEFAULT NOW(),

    -- Optional hard expiry (NULL = never expires)
    expires_at          TIMESTAMP WITH TIME ZONE
);

-- Fast lookup by hash on every API request
CREATE UNIQUE INDEX IF NOT EXISTS idx_v_api_keys_hash
    ON v_api_keys (api_key_hash)
    WHERE enabled = TRUE;

-- List keys per domain
CREATE INDEX IF NOT EXISTS idx_v_api_keys_domain
    ON v_api_keys (domain_name);

-- List keys per user
CREATE INDEX IF NOT EXISTS idx_v_api_keys_user
    ON v_api_keys (user_uuid);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_api_key_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_api_keys_updated_at ON v_api_keys;
CREATE TRIGGER trg_api_keys_updated_at
    BEFORE UPDATE ON v_api_keys
    FOR EACH ROW EXECUTE FUNCTION update_api_key_timestamp();

-- ============================================================
-- Grant access to the fusionpbx DB user
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON v_api_keys TO fusionpbx;
