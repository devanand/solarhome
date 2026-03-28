-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ─────────────────────────────────────────────
-- Installations
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS installations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  city                TEXT NOT NULL,
  lat                 DOUBLE PRECISION,
  lng                 DOUBLE PRECISION,
  panel_count         INT NOT NULL,
  panel_kw            DOUBLE PRECISION NOT NULL,
  battery_kwh         DOUBLE PRECISION NOT NULL,
  inverter_brand      TEXT NOT NULL,
  lease_start         DATE NOT NULL,
  monthly_lease_eur   NUMERIC(8,2) NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Users
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id     UUID NOT NULL REFERENCES installations(id),
  email               TEXT UNIQUE NOT NULL,
  password_hash       TEXT NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Raw readings (hypertable)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raw_readings (
  time                TIMESTAMPTZ NOT NULL,
  installation_id     UUID NOT NULL REFERENCES installations(id),
  solar_w             REAL,
  consumption_w       REAL,
  battery_w           REAL,
  battery_pct         REAL,
  grid_w              REAL
);

SELECT create_hypertable('raw_readings', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_raw_readings_installation_time
  ON raw_readings (installation_id, time DESC);

-- ─────────────────────────────────────────────
-- Daily aggregates
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_aggregates (
  date                    DATE NOT NULL,
  installation_id         UUID NOT NULL REFERENCES installations(id),
  solar_kwh               REAL,
  consumption_kwh         REAL,
  grid_export_kwh         REAL,
  grid_import_kwh         REAL,
  battery_cycles          REAL,
  self_sufficiency_pct    REAL,
  peak_solar_w            REAL,
  hourly_breakdown        JSONB,
  PRIMARY KEY (date, installation_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_aggregates_installation_date
  ON daily_aggregates (installation_id, date DESC);