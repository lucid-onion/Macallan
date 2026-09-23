-- Roles
INSERT INTO roles (code, name, description, rank) VALUES
  ('USER',        'User',        'Basic access — no dashboard, transactions or settings', 10),
  ('ACCOUNTANT',  'Accountant',  'Dashboard, transactions, all business modules',          20),
  ('ADMIN',       'Admin',       'All modules except Settings; manages users in own teams', 30),
  ('SUPER_ADMIN', 'Super Admin', 'Full system access including Settings and all users',    40);

-- Permissions catalogue — one row per (module, action)
INSERT INTO permissions (module, action) VALUES
  ('dashboard','view'),
  ('inventory','view'),('inventory','create'),('inventory','update'),('inventory','delete'),
  ('purchases','view'),('purchases','create'),('purchases','update'),('purchases','delete'),
  ('sales','view'),('sales','create'),('sales','update'),('sales','delete'),
  ('transportation','view'),('transportation','create'),('transportation','update'),('transportation','delete'),
  ('suppliers','view'),('suppliers','create'),('suppliers','update'),('suppliers','delete'),
  ('customers','view'),('customers','create'),('customers','update'),('customers','delete'),
  ('transactions','view'),('transactions','create'),('transactions','update'),('transactions','delete'),
  ('office_expenses','view'),('office_expenses','create'),('office_expenses','update'),('office_expenses','delete'),
  ('demolition','view'),('demolition','create'),('demolition','update'),('demolition','delete'),
  ('reports','view'),
  ('settings','view'),('settings','manage'),
  ('users','view'),('users','create'),('users','update'),('users','deactivate'),
  ('teams','view'),('teams','create'),('teams','update'),('teams','delete');

-- Baseline role permissions.
-- USER: view + create/update on business modules; NO dashboard, NO transactions, NO settings, NO users/teams.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON (
  (r.code = 'USER' AND p.module IN
    ('inventory','purchases','sales','transportation','suppliers','customers','office_expenses','demolition','reports')
   AND p.action IN ('view','create','update'))
);

-- ACCOUNTANT: same as USER + dashboard:view + transactions:*
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON (
  (r.code = 'ACCOUNTANT' AND p.module IN
    ('dashboard','inventory','purchases','sales','transportation','suppliers','customers',
     'transactions','office_expenses','demolition','reports')
   AND p.action IN ('view','create','update'))
);

-- ADMIN: everything ACCOUNTANT has + delete actions, + users/teams management.
-- Explicitly EXCLUDES settings.*
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON (
  (r.code = 'ADMIN' AND p.module IN
    ('dashboard','inventory','purchases','sales','transportation','suppliers','customers',
     'transactions','office_expenses','demolition','reports','users','teams')
   AND p.action IN ('view','create','update','delete'))
  OR (r.code='ADMIN' AND p.module='users' AND p.action IN ('view','create','update','deactivate'))
);

-- SUPER_ADMIN: everything
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'SUPER_ADMIN';

-- Default teams
INSERT INTO teams (name, description) VALUES
  ('Operations', 'Yard, inventory, sales & demolition crews'),
  ('Finance',    'Accounting, transactions, reports'),
  ('Administration', 'Full admin oversight');

-- Example team permission grants
INSERT INTO team_permissions (team_id, permission_id)
SELECT t.id, p.id FROM teams t JOIN permissions p ON (
  (t.name='Operations' AND p.module IN ('inventory','purchases','sales','transportation','demolition','reports','suppliers','customers') AND p.action IN ('view','create','update'))
  OR (t.name='Finance' AND p.module IN ('dashboard','transactions','reports','office_expenses') AND p.action IN ('view','create','update'))
  OR (t.name='Administration' AND p.module IN ('users','teams') AND p.action='view')
);

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('company', '{"name":"ASN Demolition Pvt.Ltd","logo":"","openingBalance":0,"theme":"light"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Bootstrap super admin (password: ChangeMe123!) — change on first login.
-- crypt() comes from pgcrypto
INSERT INTO users (username, full_name, password_hash, role_id, team_id)
SELECT 'superadmin', 'System Owner',
       crypt('ChangeMe123!', gen_salt('bf', 12)),
       (SELECT id FROM roles WHERE code='SUPER_ADMIN'),
       (SELECT id FROM teams WHERE name='Administration')
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username='superadmin');