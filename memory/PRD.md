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

- **NEW (May 2026): Invoice Premium Minimal — pixel-perfect match to user-provided sample**
  - Set as the default style (was Branded Hero)
  - Manrope / Plus Jakarta Sans typography via Google Fonts
  - Logo + AXISTRA wordmark on left, company contact block with icons on right
  - Gold gradient divider; Bill To + giant green INVOICE word + gold invoice number
  - Green table header with alternating cream rows (Description with subdetail, Qty, Unit Price, Amount)
  - Payment Information bank block + Subtotal/Discount/VAT rows + dark-green TOTAL bar
  - "Amount in Words" italic green (English number-to-words for AED/USD/EUR)
  - Green footer bar: "Thank You For Your Business" + 3 features (Reliable Support, Secure Solutions, Driving Growth) + TRN/License footer
  - PAID/UNPAID/FAILED status badge in top-right corner
  - **Guaranteed single A4 page** via `@page A4` + `pageRanges:'1'` in Puppeteer
  - Endpoints: `GET /api/invoices/:id/pdf` (defaults to minimal) and `?style=branded` for the legacy Branded Hero
- **UPDATE (May 27, 2026): UI polish sweep**
  - Sidebar header: removed "AXISTRA / Compliance Portal" text → now shows the full landscape wordmark (`axistra-wordmark-darkbg.png`) on the dark green sidebar.
  - Topbar: replaced the text "Axistra Technologies FZCO | Compliance + Accounting Portal" with the landscape logo (`axistra-landscape-logo-2026.png`) and a small subtitle.
  - **Icon-text overlap on search inputs fixed**: `.input-axistra` moved into `@layer components` so Tailwind utilities (`pl-9`, `pl-10`) properly override the default left padding. Affected pages: Audit Chain Search, Recharges, Customers, Magnus Users.
  - Crypto Treasury OxaPay (and BTCPay/OKX/Binance) tab: long wallet & sender addresses now wrap inside their card (`break-all` + `max-w` on the `<td>` cell). No more overflow into the Final USDT column.
  - Landing footer: bigger landscape logo, cleaned-up Company Details column with aligned `LICENSE / REG. NO / TRN / GIBAN` labels.

- **NEW (May 27, 2026): Receiving Wallets & Vendors CRUD + Gateway Auto-Detection**
  - Settings → Receiving Wallets table (CRUD): admins register every Axistra-owned address per `{Gateway, Coin, Network, Address, Label}`. Seeds Binance BTC `129ifR1iQyY…ZZHhqfkt` + OKX BTC `bc1q3a4gsk…ksx38sjj` idempotently on boot.
  - Settings → Vendors table (CRUD): reusable payee directory (name, type, contact, default wallet, default method). Eliminates free-text vendor entry on expenses.
  - Recharge form rebuilt: **Payment Gateway BEFORE coin/network**; Manual removed (only Binance/OKX/OxaPay/BTCPay). When a saved wallet matches `{gateway, coin, network}`, the address auto-fills with a green "Saved address found" banner. Networks dropdown now includes `OFF_CHAIN` for Binance-internal transfers without an on-chain hash.
  - Recharge backend: `detectGatewayFromAddress()` resolves the receiving address to a gateway → no more `Manual / mismatch` for known wallets. `nextCode()` now uses `MAX(recharge_code)` (was `count+1`) — race condition fixed.
  - On-chain auto-verify: `OnchainService` fires non-blocking on every `addCryptoTx` / `addGatewayCryptoTx`, updates `gateway_tx_status` + `confirmations` + `sender_address`. `OFF_CHAIN` networks are auto-confirmed. Daily refresh job retries unconfirmed hashes from the last 14 days.
  - Expenses form rebuilt: **Payment Method FIRST** → conditional fields:
    - Bank Transfer / Card → Wio Bank dropdown + bank reference, debits `WIO_BANK` in AED.
    - USDT / Binance Pay → Source Wallet (BINANCE/OKX/OXAPAY/BTCPAY) + TX/TXID, debits the chosen exchange wallet in USDT.
    - Cash / Other → notes only.
  - Vendor is now a required dropdown sourced from `/api/settings/vendors`. AED Rate and standalone Bank Reference fields removed from the UI (DB columns kept for legacy data).
  - New endpoints: `GET|POST|PATCH|DELETE /api/settings/receiving-wallets`, `GET|POST|PATCH|DELETE /api/settings/vendors`
  - 14/14 backend tests + full frontend regression PASS (iteration_7.json).

- **UPDATE (May 27, 2026): Invoice = Premium Minimal ONLY**
  - Compare button and Branded/Minimal toggle removed from Invoices UI (already cleaned)
  - Backend `/api/invoices/:id/pdf` and `/html` default to the Premium Minimal renderer
  - Payment Information block now renders dynamic on-chain data: Method, Service, Coin, Network, TX Hash + per-transaction From/To addresses pulled from `crypto_transactions`
  - Digital seal (`digital-stamp.png`) rendered above footer with "Digitally certified · <date>"
  - Green footer pinned absolutely at A4 bottom; verified single-page render via Puppeteer
  - Visually validated: single A4, no overflow, seal + footer + payment info present
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
