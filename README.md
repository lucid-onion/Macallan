# ASN Demolition — Inventory & Sales Management System

A role-based inventory, sales, and cash-ledger system for **ASN Demolition Pvt.Ltd**.
Node.js + Express + PostgreSQL backend, React + Vite + Tailwind frontend, with a team-inherited permission model.

---

## Features

### Business modules

- **Dashboard** — business overview, sales vs purchases, transportation, monthly trend, recent transactions
- **Inventory** — products with current stock and reorder levels, low-stock highlighting
- **Purchases** — supplier purchases with gross/dust/net weight model, transport costs, truck & driver detail
- **Sales** — customer sales with the same weight model plus a dust-value display
- **Transportation** — deliveries linked to sales, purchases, or standalone, with cost breakdown
- **Suppliers** — supplier registry with contacts
- **Customers** — customer registry with contacts
- **Transactions** — the company cash ledger; every payment in or out
- **Office Expenses** — day-to-day expense slips with line items
- **Demolition** — demolition jobs with a transport fee and itemised labor/expense rows
- **Reports** — 14 report types, exportable to Excel, printable as A4
- **System Settings** — company name, logo, opening balance, theme (SUPER_ADMIN only)
- **Users & Teams** — account management with role assignment and team membership

### System capabilities

- Server-side sessions with revocable cookies
- Role-based access control (RBAC) enforced on every API endpoint
- Team-inherited permissions, including recursive parent-team inheritance
- Soft deactivation of accounts (data preserved, sessions revoked)
- Audit log of every mutation
- Soft delete on every business table
- Dark mode
- Bikram Sambat (BS) and English (AD) dates stored side by side
- Excel export with formatted banner per report
- A4 print output with no app chrome

---

## Roles & Permissions

Four roles, ordered by rank. Role baselines are defined in `role_permissions` and can be extended by a user's team.

| Module | USER | ACCOUNTANT | ADMIN | SUPER_ADMIN |
|---|:--:|:--:|:--:|:--:|
| Dashboard | — | ✓ | ✓ | ✓ |
| Inventory | ✓ | ✓ | ✓ | ✓ |
| Purchases | ✓ | ✓ | ✓ | ✓ |
| Sales | ✓ | ✓ | ✓ | ✓ |
| Transportation | ✓ | ✓ | ✓ | ✓ |
| Suppliers | ✓ | ✓ | ✓ | ✓ |
| Customers | ✓ | ✓ | ✓ | ✓ |
| Transactions | — | ✓ | ✓ | ✓ |
| Office Expenses | ✓ | ✓ | ✓ | ✓ |
| Demolition | ✓ | ✓ | ✓ | ✓ |
| Reports | ✓ | ✓ | ✓ | ✓ |
| Users | — | — | ✓ | ✓ |
| Teams | — | — | ✓ | ✓ |
| System Settings | — | — | — | ✓ |

### Hierarchy rules

- **USER** — read/create/update on business modules; no dashboard, no transactions, no settings.
- **ACCOUNTANT** — adds Dashboard and Transactions; still no Settings.
- **ADMIN** — all business modules plus Users and Teams; can manage USER and ACCOUNTANT accounts **within their own team only**; **cannot** manage other ADMINs or SUPER_ADMINs; no Settings access.
- **SUPER_ADMIN** — full system access. Can create/edit/deactivate any account including other SUPER_ADMINs. Only role with access to System Settings.

### Deactivation

When a user is deactivated:

- `is_active = FALSE`, `deactivated_at = now()` — the row is preserved
- All active sessions are revoked immediately (`revoked_at = now()`)
- All historical data authored by the user remains intact
- The user cannot log in; the login endpoint returns `Account is deactivated`
- Reversible: `POST /api/users/:id/reactivate`

---


The recursive walk is done in `server/src/middleware/auth.js` using a `WITH RECURSIVE` CTE. A chain like `Field Crew → Operations → Admin Team` inherits every permission any of those three teams holds.

Use cases:

- A USER on a team that grants `transactions:view` automatically sees Transactions.
- A new department can be added, given a parent, and instantly inherits the parent's access without touching a single user record.
- Revoking team access removes it from every member at once.

Teams are managed at `/teams` in the UI (ADMIN and SUPER_ADMIN only).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20+ (ESM), Express 4 |
| Database | PostgreSQL 14+ (uses `pgcrypto`) |
| Auth | Server-side sessions, bcryptjs, cookie-based |
| Validation | Zod |
| Frontend | React 18, React Router 6 |
| Build | Vite 5 |
| Styling | Tailwind CSS 3 |
| Charts | Chart.js 4 via react-chartjs-2 |
| Excel export | SheetJS (`xlsx`) on the client |
| Rate limiting | `express-rate-limit` |

---

## Project Structure

```text
asn-erp/
├── package.json
├── README.md
│
├── server/
│   ├── package.json
│   ├── .env
│   ├── .env.example
│   │
│   ├── db/
│   │   └── migrations/
│   │       ├── 001_init.sql
│   │       └── 002_seed.sql
│   │
│   └── src/
│       ├── server.js
│       ├── app.js
│       │
│       ├── config/
│       │   └── db.js
│       │
│       ├── middleware/
│       │   ├── auth.js
│       │   └── rbac.js
│       │
│       ├── utils/
│       │   ├── errors.js
│       │   └── audit.js
│       │
│       └── modules/
│           ├── auth/
│           │   └── routes.js
│           ├── users/
│           │   └── routes.js
│           ├── teams/
│           │   └── routes.js
│           ├── catalog/
│           │   └── routes.js
│           ├── settings/
│           │   └── routes.js
│           └── business/
│               ├── _crud.js
│               ├── suppliers.js
│               ├── customers.js
│               ├── inventory.js
│               ├── purchases.js
│               ├── sales.js
│               ├── transportation.js
│               ├── transactions.js
│               ├── office_expenses.js
│               ├── demolition.js
│               └── reports.js
│
└── client/
    ├── package.json
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    │
    └── src/
        ├── main.jsx
        ├── index.css
        │
        ├── api/
        │   └── client.js
        │
        ├── auth/
        │   └── AuthContext.jsx
        │
        ├── router/
        │   ├── AppRouter.jsx
        │   └── ProtectedRoute.jsx
        │
        ├── layouts/
        │   └── AppLayout.jsx
        │
        ├── components/
        │   ├── ui.jsx
        │   └── DataTable.jsx
        │
        └── pages/
            ├── Login.jsx
            ├── Dashboard.jsx
            ├── Inventory.jsx
            ├── Purchases.jsx
            ├── Sales.jsx
            ├── Transportation.jsx
            ├── Suppliers.jsx
            ├── Customers.jsx
            ├── Transactions.jsx
            ├── OfficeExpenses.jsx
            ├── Demolition.jsx
            ├── Reports.jsx
            ├── Settings.jsx
            ├── Users.jsx
            └── Teams.jsx
```

## Getting Started

### Prerequisites

- **Node.js 20+** and npm 10+
- **PostgreSQL 14+** running locally (or a remote instance)
- A modern browser

### 1. Install

From the repo root:

```bash
cd asn-erp
cd server && npm install
cd ../client && npm install
```
### 2. PostgreSQL setup

```bash
sudo -u postgres createdb asn_erp
sudo -u postgres psql -d asn_erp -f server/db/migrations/001_init.sql
sudo -u postgres psql -d asn_erp -f server/db/migrations/002_seed.sql
```

- verify
```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE asn_app WITH LOGIN PASSWORD 'change-me-in-prod';
CREATE DATABASE asn_erp OWNER asn_app;
SQL

PGPASSWORD='change-in-prod' psql -h localhost -U asn_app -d asn_erp \
  -f server/db/migrations/001_init.sql

PGPASSWORD='change-in-prod' psql -h localhost -U asn_app -d asn_erp \
  -f server/db/migrations/002_seed.sql

```
- verify
```bash
sudo -u postgres psql -d asn_erp -c "\dt"
sudo -u postgres psql -d asn_erp -c "SELECT code, name, rank FROM roles ORDER BY rank;"
```

### 3. Run the backend
```bash
cd server
npm run dev
```

- Expected output
```bash
[nodemon] starting `node src/server.js`
ASN ERP API on http://localhost:4000 
```
- Smoke test;
```bash
curl -s http://localhost:4000/api/health
# → {"ok":true}

curl -s -c /tmp/asn.txt -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"superadmin","password":"ChangeMe123!"}'
# → {"user":{"id":"...","username":"superadmin","role":"SUPER_ADMIN",...}}

curl -s -b /tmp/asn.txt http://localhost:4000/api/catalog/roles
# → {"roles":[...4 roles...]}
```

### 4. Run the frontend

```bash
cd client
npm run dev
```

### 5. Default Creds...

```bash
Username:  superadmin
Password:  ChangeMe123!
```

- Change creds

```bash
sudo -u postgres psql -d asn_erp <<'SQL'
UPDATE users
   SET password_hash = crypt('your-new-strong-password', gen_salt('bf', 12)),
       updated_at = now()
 WHERE username = 'superadmin';

UPDATE sessions
   SET revoked_at = now()
 WHERE user_id = (SELECT id FROM users WHERE username = 'superadmin')
   AND revoked_at IS NULL;
SQL
```

# Sayonara!!!