# Axistra Compliance + Accounting Portal — PRD

## Problem Statement
Internal admin web portal for **Axistra Technologies FZCO** (UAE / IFZA, Corporate TRN 105415374500001) to manage customer recharges, crypto-to-AED conversions, OKX records, Wio bank deposits, expenses, P&L, and compliance logs. Connected with MagnusBilling.

**Main business rule** — every payment follows the audit chain:
`Customer → Invoice → Crypto TX Hash → Magnus Credit → OKX Conversion → Wio Bank Deposit`

## Architecture
- **Backend**: NestJS 10 (Node.js 20) on port 9001 (internal). PostgreSQL 15 via TypeORM. JWT auth.
- **Proxy**: FastAPI (`/app/backend/server.py`) on port 8001 (supervisor-managed) forwards `/api/*` to NestJS. PostgreSQL is auto-started by the proxy.
- **Frontend**: React 19 + Tailwind + shadcn primitives + Phosphor icons + Recharts + Sonner toasts.
- **DB**: PostgreSQL database `axistra_db`, user `axistra`.
- **Brand**: Light theme only — Axistra Green `#0A5C3E` + Gold `#D4AF37`, IBM Plex Sans + Cabinet Grotesk + IBM Plex Mono.

## User Personas
- **Admin** — full portal access, manages all modules, creates admin users.
- **Accountant** — focuses on Recharges, Invoices, Expenses, Reports, P&L.
- **Auditor** — read-only across Audit Logs, Compliance, Treasury reconciliation.

## Seed Admin
- `admin@axistratech.com` / `admin123` (idempotent on every NestJS startup)

## Core Modules (Implemented)
- **Auth** — JWT login, current user, 2FA placeholder, admin user list/create
- **Customers** — CRUD, code `AXC-NNNNN`, risk levels, KYC status, signup IP capture
- **Recharges** — CRUD, code `RCH-YYYY-NNNNN`, auto-creates Invoice + Treasury record, 9-state status flow
- **Invoices** — auto-generated `AX-YYYY-NNNNN`, Puppeteer PDF (HTML fallback), Axistra FZCO footer
- **Crypto Treasury** — per-recharge movement (USDT receive → OKX → AED → Wio bank ref + date)
- **Expenses** — CRUD, 10 categories, USDT-paid expense support with AED equivalent rate
- **Profit & Loss** — yearly P&L with UAE Corp Tax estimate (9% above AED 375K), monthly chart
- **Reports** — 10 reports (monthly/quarterly/yearly P&L, customer recharge, crypto→AED, bank reconciliation, VAT threshold, corp tax, expenses, suspicious), CSV + Excel export
- **Compliance** — mark high risk, request KYC, block user, refund, suspicious note actions
- **Magnus Sync** — placeholder mode (Magnus API not wired yet), status + sync logs
- **Audit Logs** — every privileged action logged with actor + IP
- **Dashboard** — KPIs (daily/monthly/yearly sales, crypto received, AED converted, Wio deposits, reconciliation, customers, expenses), 12-month sales chart, UAE VAT 375K tracker
- **Settings** — Axistra company identity + compliance constants
- **Audit Chain Stepper** — 6-step horizontal stepper as hero on every recharge detail page

## What's Been Implemented (22 May 2026)
- Full NestJS + PostgreSQL backend with 12 entities and 11 modules
- FastAPI proxy bridging Emergent supervisor → NestJS
- 13-page React admin portal with sidebar, login screen, audit chain visualization
- PDF/Excel/CSV report exports
- Magnus mismatch detection (invoice amount vs Magnus credit amount, 0.01 tolerance)
- Auto-advancing recharge status based on treasury movement state
- 46/46 backend tests passing, frontend end-to-end verified

## Phase 2 — Implemented (22 May 2026)
- **KYC document upload** (local filesystem at `/app/uploads/kyc/{customer_id}/`)
  - Multer-based multipart upload, 10 MB limit, PDF/PNG/JPG/JPEG/WEBP only
  - Admin review (approve/reject with comment), customer kyc_status auto-propagation
  - Per-customer download endpoint
- **MagnusBilling LIVE integration** — HMAC-SHA512 signed REST client matching official PHP wrapper
  - getUser, addCredit (auto-resolves id_user), getCDR, getBalance
  - Every call written to `magnus_sync_logs` with status
  - Live upstream `cyberxcalls.com/mbilling` reachable from environment
- **Deployment package** in `/app/deploy/`:
  - `backup.sh` + `backup.env.example` — encrypted pg_dump → gzip → gpg AES256, retention + offsite upload
  - `nginx.conf` — production reverse proxy with Cloudflare real-IP, HSTS, security headers
  - `docker-compose.yml` + Dockerfiles (backend with Chromium for Puppeteer, frontend on nginx)
  - `cloudflare-setup.md` — DNS, SSL/TLS, WAF rules, origin lockdown, rate limits
  - `DEPLOYMENT.md` — full Ubuntu 22.04 step-by-step deployment guide
- 13/13 new tests + 46/46 prior tests still passing

## Backlog (P1)
- **MagnusBilling live wiring** — replace placeholder with real API calls (user provides production credentials)
- **2FA enforcement** — currently placeholder
- **KYC document upload** — entity exists, upload UI pending
- **Encrypted backups** — PostgreSQL nightly dump with gpg encryption
- **IP login history page** — last_login_ip is captured, UI surface pending

## Backlog (P2)
- Cloudflare front + nginx reverse proxy template for VPS deployment
- File upload encryption for KYC docs
- Live FX feed (CoinGecko) for AED conversion at payment time
- Refund-to-customer-wallet workflow with TX hash recording
- Auditor read-only role enforcement
- Yearly P&L PDF rendered with Puppeteer

## Key Conventions
- All backend routes prefixed `/api`
- All UI buttons/inputs carry kebab-case `data-testid`
- All MongoDB-style `_id` fields excluded — TypeORM uses `id` (UUID)
- All datetimes stored as `timestamptz`, returned ISO-8601
- Currency stored as decimal strings; UI uses `parseFloat()` for math
