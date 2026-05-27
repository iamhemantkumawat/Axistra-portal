# Axistra Compliance + Accounting Portal — PRD

## Origin
Internal admin web portal for **Axistra Technologies FZCO** (UAE / IFZA, Corporate TRN 105415374500001). Manages customer recharges, invoices, crypto-to-AED conversions, OKX records, Wio bank deposits, expenses, P&L, and compliance logs. Connected with MagnusBilling.

**Audit chain (immutable rule):**
`Customer → Invoice → Crypto TX Hash → Magnus Credit → OKX Conversion → Wio Bank Deposit`

## Architecture
- **Backend**: NestJS 10 on port 9001 (internal). PostgreSQL 15 via TypeORM. JWT auth.
- **Proxy**: FastAPI `/app/backend/server.py` on port 8001 (supervisor-managed) forwards `/api/*` to NestJS. PostgreSQL is auto-started by the proxy.
- **Frontend**: **Vite + React 18** (switched from CRA in user's fork). Tailwind + shadcn + Phosphor + Lucide icons + Recharts + Sonner.
- **DB**: PostgreSQL `axistra_db`, user `axistra`.
- **Brand**: Axistra Green `#0A5C3E` + Gold `#D4AF37`, IBM Plex Sans + Cabinet Grotesk.

## Seed Admin
- `admin@axistratech.com` / `admin123` (idempotent on NestJS startup)

## Modules

### Implemented
- Auth (JWT login, admin user list/create, 2FA placeholder)
- Customers (CRUD, code `AXC-NNNNN`, risk levels, KYC status, signup IP)
- Recharges (CRUD, code `RCH-YYYY-NNNNN`, status flow with mismatch detection)
- Invoices (auto-generated `AX-YYYY-NNNNN`, Puppeteer PDF, View + Download)
- Crypto Treasury (per-recharge movement, USDT → OKX → AED → Wio chain)
- Treasury Batches (NEW — aggregated batch view)
- Expenses (CRUD, 10 categories, payment methods: Bank/Card/USDT/Binance Pay/Cash/Other)
- Profit & Loss (yearly P&L, UAE Corp Tax 9% estimate, monthly chart)
- Reports (10 reports, PDF/CSV/Excel exports)
- Compliance (risk, KYC requests, blocks, refunds, suspicious notes)
- Magnus Sync (LIVE HMAC-SHA512 to cyberxcalls.com, logs every call)
- Magnus Users (LIVE list of MagnusBilling users with balances)
- KYC Document Upload (local filesystem `/app/uploads/kyc/{customer_id}/`)
- Audit Logs (every privileged action with actor + IP)
- Dashboard (KPIs, 12-month chart, VAT 375K tracker)
- Settings (Axistra identity + compliance constants)
- Audit Chain stepper (6-step horizontal hero on recharge detail)
- **NEW: Webhooks** — public endpoints for OxaPay, BTCPay, Telegram bot with HMAC signature verification; stored in `payment_webhooks` table; admin viewable at `/webhook-logs`
- **NEW: FX module** — live ECB EUR rates with pegged USD↔AED 3.6725; powers conversion across the app
- **NEW: Leads** — public POST `/api/leads` from the landing page contact form; admin list at `/leads`
- **NEW: Public Landing page** at `/` — Solutions, Services, Pricing, Resources, About, Contact, Sign Up modal → leads
- **NEW: Legal Page** at `/legal` — privacy + terms
- **NEW: Currency toggle** (USD/EUR/AED) — top-bar pill, client-side conversion via FX module

- **NEW: Invoice PDF A/B Templates** — two production-grade templates wired to `?style=branded|minimal`:
  - **Branded Hero** (default) — green/gold gradient hero, ornate header, dense compliance details
  - **Premium Minimal** — clean white, thin Axistra accents, large typography, structured payment-trace table, accountant-ready
  - Invoices page exposes a Branded ↔ Minimal toggle (persisted to `localStorage.axistra_invoice_style`) plus A/B compare inside the preview modal.
- **NEW: Reports — full redesign with charts**
  - KPI tiles (Total Sales, Total Expenses, Net Profit, VAT Progress)
  - Charts: Monthly Sales (area), Top 10 Customers (horizontal bar), Coin/Payment-Method split (donut), Gateway Split (pie) — powered by Recharts
  - 10 report cards each with PDF / Excel / CSV downloads
  - `GET /api/reports/dashboard/charts?year=` returns kpis + monthly_trend + top_customers + payment_method_split + gateway_split
  - Branded PDF rendering via Puppeteer (Chromium at `/usr/bin/google-chrome`)
- **NEW: Month-End ZIP Bundle** — `GET /api/reports/bundle/month-end?year=&month=` returns a 9-entry ZIP: `00-Cover.pdf` + (yearly-pl, vat-threshold, corporate-tax, bank-reconciliation) × PDF + XLSX. Cover page rendered with Axistra branding, gold gradient and TOC.
- **NEW: Manual payments + wallet routing fix** — removed `MANUAL` wallet from the system. Admins now explicitly pick the receiving exchange (BINANCE/OKX/OXAPAY/BTCPAY/WIO_BANK) when recording a manual crypto TX. The destination ledger row lands on the picked wallet. Telegram bot default gateway changed from `Manual` → `Binance`. Existing 9-ETH MANUAL row was migrated to OKX.
- **NEW: Treasury 3-step flow** — Wallet Ledger UI now labels actions explicitly: Step 1 Transfer Crypto (between wallets, same coin, no conversion), Step 2 Convert Coin (inside one wallet), Step 3 Withdraw AED to Wio. Each step has a guidance banner so users know they are independent and sequential.
  - `POST /api/wallets/:wallet/send-batch` — moves crypto between wallets (batch_out + batch_in + optional fee). Generates batch codes like `OXA-BIN-260527-XXXX` and `BPAY-2605-NNNNN`.
  - `POST /api/wallets/:wallet/convert` — same-wallet coin swap (convert_from + convert_to + fee). Persists `rate_used` for audit.
  - `POST /api/wallets/:wallet/cashout` — sells AED out of OKX/Binance and deposits into Wio Bank (cashout + bank_deposit, net = amount − bank_fee).
  - Expenses now write a negative ledger row on the matching wallet (Binance/OKX/OxaPay/Wio/Manual) and are idempotently re-flowed on PATCH/DELETE.
  - Recharges auto-write a `deposit` ledger row on `addCryptoTx` and `addGatewayCryptoTx` (deduped by tx_hash).
- **NEW: Audit Chain Search** (`/audit-chain`) — universal search by tx hash, batch code, invoice, recharge, customer or magnus user. Returns the full Customer → Invoice → Recharge → Wallet Ledger chain plus counters.
- **NEW: Daily Snapshot** (`/api/snapshot/daily`) — opening + activity + closing balances per wallet+coin for any date.
- **NEW: Onchain Verifier** (`/api/onchain/verify/:network/:hash`) — Blockstream/etherscan-style confirmations check, graceful on rate-limits.

### Skipped per user
- 2FA enforcement

## Endpoints (high level)
```
PUBLIC
  GET  /api/health
  POST /api/auth/login
  POST /api/leads
  POST /api/webhooks/oxapay    (HMAC verified)
  POST /api/webhooks/btcpay    (HMAC verified)
  POST /api/webhooks/telegram  (token gated)
  GET  /api/invoices/:id/html  (token-based viewer can be reached without JWT)

AUTHED (JWT)
  /api/auth/me, /api/auth/admins
  /api/customers (+ /:id)
  /api/recharges (+ /:id, /:id/status, /:id/crypto-tx, /:id/sync-magnus)
  /api/invoices (+ /:id, /:id/pdf, /:id/html, /generate)
  /api/treasury (+ /movement/:rechargeId, /reconciliation, /batches…)
  /api/expenses
  /api/compliance (+ /log, /request-kyc, /block-user, /mark-high-risk, /refund)
  /api/magnus/{status,users,user/:u,cdr/:u,sync-user,add-credit,logs}
  /api/fx/rates  (+ /convert)
  /api/leads (+ /:id/status)
  /api/kyc/:customerId (+ /upload, /file/:filename), /api/kyc/document/:id
  /api/reports/{monthly-sales,quarterly-sales,yearly-pl,customer-recharge,crypto-to-aed,bank-reconciliation,vat-threshold,corporate-tax,expenses,suspicious}
  /api/reports/export/{csv,excel}
  /api/audit-logs
  /api/dashboard/{kpis,chart,recent}
  /api/webhooks/logs
```

## Status
- Synced to user's GitHub fork (`iamhemantkumawat/Axistra-portal`) at commit `2b9404b` (Improve exchange treasury conversions).
- Production VPS: `178.105.203.159` running this same code under docker-compose.
- Production domain: `https://axistratech.com/`.

## Deployment
See `/app/deploy-fork/` (or `/opt/axistra/deploy` on the VPS): `backup.sh`, `nginx.conf`, `docker-compose.yml`, `cloudflare-setup.md`, `DEPLOYMENT.md`.

## Backlog
- Fix Reports and Invoice PDF design (user-requested)
- Advanced exports (VAT threshold PDF, Corporate tax PDF, Bank reconciliation PDF, Accountant-ready export)
- Wire OXAPAY_HISTORY_DELAY_MS background poller into recharge reconciliation
- Show webhook signature errors prominently in `/webhook-logs`
- Add latency analytics ("Reconciliation Health") to dashboard
- Live FX feed already wired (ECB) — extend to lock the rate per recharge at payment time
- 2FA enforcement for Admin accounts
