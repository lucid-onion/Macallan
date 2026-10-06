-- ============================================================================
-- 008 — Notes: shared team reminders.
--       Anyone can view. Only ADMIN / SUPER_ADMIN can create, delete, or
--       toggle the done flag.
-- ============================================================================

CREATE TABLE IF NOT EXISTS notes (
  id            SERIAL PRIMARY KEY,
  body          TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  is_done       BOOLEAN NOT NULL DEFAULT FALSE,
  done_at       TIMESTAMPTZ,
  date_bs_year  INT NOT NULL,
  date_bs_month INT NOT NULL CHECK (date_bs_month BETWEEN 1 AND 12),
  date_bs_day   INT NOT NULL CHECK (date_bs_day BETWEEN 1 AND 32),
  date_ad       DATE NOT NULL,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notes_done ON notes(is_done) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date_ad DESC, id DESC);

-- ---------------------------------------------------------------------------
-- Permissions catalogue
-- ---------------------------------------------------------------------------
INSERT INTO permissions (module, action) VALUES
  ('notes','view'),
  ('notes','create'),
  ('notes','update'),
  ('notes','delete')
ON CONFLICT (module, action) DO NOTHING;

-- View: every role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.module = 'notes' AND p.action = 'view'
ON CONFLICT DO NOTHING;

-- Create / update / delete: ADMIN + SUPER_ADMIN only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.module = 'notes' AND p.action IN ('create','update','delete')
 WHERE r.code IN ('ADMIN', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;

-- Teams: grant view to every existing team so team-inherited users still
-- get the module in the sidebar. Create/update/delete are deliberately NOT
-- granted to teams — the baseline ADMIN role already covers it.
INSERT INTO team_permissions (team_id, permission_id)
SELECT t.id, p.id
  FROM teams t
 CROSS JOIN permissions p
 WHERE p.module = 'notes' AND p.action = 'view'
ON CONFLICT DO NOTHING;