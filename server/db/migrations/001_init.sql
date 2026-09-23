-- ============================================================================
-- ASN Demolition ERP — core schema
-- Roles, teams, permissions, team-based permission inheritance, user accounts,
-- plus the business modules (inventory, purchases, sales, transportation,
-- suppliers, customers, transactions, office_expenses, demolition).
-- All monetary values are NUMERIC(14,2). All weights NUMERIC(14,3).
-- Soft-delete is used everywhere via `deleted_at` so nothing is ever lost.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Roles: fixed set, enforced by CHECK. Four roles as specified.
-- ----------------------------------------------------------------------------
CREATE TABLE roles (
  id          SMALLSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE
              CHECK (code IN ('USER','ACCOUNTANT','ADMIN','SUPER_ADMIN')),
  name        TEXT NOT NULL,
  description TEXT,
  rank        SMALLINT NOT NULL,          -- USER=10, ACCOUNTANT=20, ADMIN=30, SUPER_ADMIN=40
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Permissions: one row per (module, action). Seeded from a fixed catalogue.
-- ----------------------------------------------------------------------------
CREATE TABLE permissions (
  id        SERIAL PRIMARY KEY,
  module    TEXT NOT NULL,   -- 'dashboard','inventory','purchases','sales','transportation',
                             -- 'suppliers','customers','transactions','office_expenses',
                             -- 'demolition','reports','settings','users','teams'
  action    TEXT NOT NULL,   -- 'view','create','update','delete','manage'
  UNIQUE (module, action)
);

-- ----------------------------------------------------------------------------
-- Teams / departments. Users belong to exactly one team. Teams carry the
-- permissions that their members inherit. A team can also extend another team
-- (parent_team_id) to inherit its permissions too.
-- ----------------------------------------------------------------------------
CREATE TABLE teams (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  description     TEXT,
  parent_team_id  INT REFERENCES teams(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permission set granted to a team. This is what members inherit.
CREATE TABLE team_permissions (
  team_id        INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  permission_id  INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, permission_id)
);

-- Role baseline permissions — the minimum set every user with that role has,
-- regardless of team. Team grants are ADDITIVE on top of these.
CREATE TABLE role_permissions (
  role_id        SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id  INT      NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ----------------------------------------------------------------------------
-- Users. Deactivation (soft) rather than hard delete: `is_active = FALSE`
-- and `deactivated_at` is set. Data authored by the user is preserved because
-- every business table FK's to users(id) with ON DELETE RESTRICT.
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username        TEXT NOT NULL UNIQUE,
  email           TEXT UNIQUE,
  full_name       TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role_id         SMALLINT NOT NULL REFERENCES roles(id),
  team_id         INT REFERENCES teams(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  deactivated_at  TIMESTAMPTZ,
  deactivated_by  UUID REFERENCES users(id),
  last_login_at   TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_team ON users(team_id);
CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active;

-- ----------------------------------------------------------------------------
-- Sessions (server-side, so we can revoke on deactivation)
-- ----------------------------------------------------------------------------
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,             -- sha256 of the raw session token
  user_agent  TEXT,
  ip_address  INET,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);

-- ----------------------------------------------------------------------------
-- Audit log — who did what, when. Every mutating endpoint writes here.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id),
  action      TEXT NOT NULL,             -- 'user.create','user.deactivate','auth.login', ...
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  detail      JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

-- ============================================================================
-- Business modules (mirror the modules in the app)
-- ============================================================================

CREATE TABLE suppliers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  contact     TEXT,
  phone       TEXT,
  type        TEXT NOT NULL DEFAULT 'main' CHECK (type IN ('main','small')),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE customers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  contact     TEXT,
  phone       TEXT,
  type        TEXT NOT NULL DEFAULT 'main' CHECK (type IN ('main','small')),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE TABLE inventory_items (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  category      TEXT NOT NULL,
  stock_kg      NUMERIC(14,3) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Nepali (BS) date stored alongside Gregorian date.
CREATE TABLE purchases (
  id                SERIAL PRIMARY KEY,
  invoice           TEXT NOT NULL UNIQUE,
  supplier_id       INT NOT NULL REFERENCES suppliers(id),
  material          TEXT NOT NULL,
  date_bs_year      INT NOT NULL,
  date_bs_month     INT NOT NULL CHECK (date_bs_month BETWEEN 1 AND 12),
  date_bs_day       INT NOT NULL CHECK (date_bs_day BETWEEN 1 AND 32),
  date_ad           DATE NOT NULL,
  gross_qty         NUMERIC(14,3) NOT NULL,
  dust_qty          NUMERIC(14,3) NOT NULL DEFAULT 0,
  net_qty           NUMERIC(14,3) NOT NULL,
  rate              NUMERIC(14,2) NOT NULL,
  total             NUMERIC(14,2) NOT NULL,
  transport_fee     NUMERIC(14,2) NOT NULL DEFAULT 0,
  labor_charge      NUMERIC(14,2) NOT NULL DEFAULT 0,
  road_expense      NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_gbse          NUMERIC(14,2) NOT NULL DEFAULT 0,
  truck_no          TEXT,
  truck_driver      TEXT,
  truck_driver_phone TEXT,
  from_location     TEXT,
  to_location       TEXT,
  status            TEXT NOT NULL DEFAULT 'Delivered' CHECK (status IN ('Delivered','Pending')),
  company           TEXT,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

CREATE TABLE sales (
  id            SERIAL PRIMARY KEY,
  invoice       TEXT NOT NULL UNIQUE,
  customer_id   INT NOT NULL REFERENCES customers(id),
  product       TEXT NOT NULL,
  date_bs_year  INT NOT NULL,
  date_bs_month INT NOT NULL CHECK (date_bs_month BETWEEN 1 AND 12),
  date_bs_day   INT NOT NULL CHECK (date_bs_day BETWEEN 1 AND 32),
  date_ad       DATE NOT NULL,
  gross_qty     NUMERIC(14,3) NOT NULL,
  dust_qty      NUMERIC(14,3) NOT NULL DEFAULT 0,
  net_qty       NUMERIC(14,3) NOT NULL,
  rate          NUMERIC(14,2) NOT NULL,
  total         NUMERIC(14,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Delivered' CHECK (status IN ('Delivered','Pending')),
  company       TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE TABLE transportation (
  id            SERIAL PRIMARY KEY,
  sale_id       INT REFERENCES sales(id) ON DELETE SET NULL,
  purchase_id   INT REFERENCES purchases(id) ON DELETE SET NULL,
  customer_id   INT REFERENCES customers(id),
  vehicle       TEXT,
  driver        TEXT,
  driver_phone  TEXT,
  loader        TEXT,
  from_location TEXT,
  to_location   TEXT,
  load_kg       NUMERIC(14,3),
  fee           NUMERIC(14,2) NOT NULL DEFAULT 0,
  labor_charge  NUMERIC(14,2) NOT NULL DEFAULT 0,
  road_expense  NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_gbse      NUMERIC(14,2) NOT NULL DEFAULT 0,
  date_bs_year  INT NOT NULL,
  date_bs_month INT NOT NULL,
  date_bs_day   INT NOT NULL,
  date_ad       DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Delivered' CHECK (status IN ('Delivered','In Transit')),
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Unified ledger (money in / out). This is what Transactions shows.
CREATE TABLE transactions (
  id           SERIAL PRIMARY KEY,
  type         TEXT NOT NULL,            -- 'sale_payment','purchase_payment','advance_given',...
  party_type   TEXT NOT NULL CHECK (party_type IN ('customer','supplier','owner','other')),
  party_key    TEXT,
  party_label  TEXT,
  direction    TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount       NUMERIC(14,2) NOT NULL,
  method       TEXT CHECK (method IN ('Cash','Online')),
  ref_type     TEXT,                     -- 'sale','purchase','manual'
  ref_id       INT,
  date_bs_year  INT NOT NULL,
  date_bs_month INT NOT NULL,
  date_bs_day   INT NOT NULL,
  date_ad       DATE NOT NULL,
  company       TEXT,
  note          TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE TABLE office_expenses (
  id            SERIAL PRIMARY KEY,
  date_bs_year  INT NOT NULL,
  date_bs_month INT NOT NULL,
  date_bs_day   INT NOT NULL,
  date_ad       DATE NOT NULL,
  company       TEXT,
  total         NUMERIC(14,2) NOT NULL DEFAULT 0,
  note          TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE TABLE office_expense_items (
  id           SERIAL PRIMARY KEY,
  expense_id   INT NOT NULL REFERENCES office_expenses(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  amount       NUMERIC(14,2) NOT NULL
);

CREATE TABLE demolitions (
  id             SERIAL PRIMARY KEY,
  date_bs_year   INT NOT NULL,
  date_bs_month  INT NOT NULL,
  date_bs_day    INT NOT NULL,
  date_ad        DATE NOT NULL,
  company        TEXT,
  site           TEXT,
  transport_fee  NUMERIC(14,2) NOT NULL DEFAULT 0,
  expense_total  NUMERIC(14,2) NOT NULL DEFAULT 0,
  total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  note           TEXT,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE TABLE demolition_items (
  id          SERIAL PRIMARY KEY,
  demolition_id INT NOT NULL REFERENCES demolitions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity    NUMERIC(14,3) NOT NULL DEFAULT 0,
  rate        NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- System settings (company name, logo, opening balance, theme)
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);