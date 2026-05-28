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

- **HOTFIX (May 28, 2026 v5): Production login fixed + one-command deploys**
  - **Root cause of "wrong credentials" on production**: the frontend Docker image had been built WITHOUT the `REACT_APP_BACKEND_URL` build-arg. Vite bakes that variable into the static JS at build time, so the bundle fell back to `http://localhost:9001`. The browser then issued login POSTs to `localhost:9001` which were CORS-blocked by Chrome's loopback-address policy — login looked like "wrong credentials" but was actually network-failed. Direct curl to `https://axistratech.com/api/auth/login` always worked.
  - **Fix in `deploy/docker-compose.yml`**: added `build.args.REACT_APP_BACKEND_URL: ${REACT_APP_BACKEND_URL}` under the `frontend` service so the production URL is forwarded at build time. **Live VPS already patched** — rebuilt the frontend container in place with `--project-directory /opt/axistra`, verified the new bundle now contains `https://axistratech.com` (no more `localhost`), and the browser login goes through `POST https://axistratech.com/api/auth/login → 200` and lands on the dashboard with all 68 customers + 12 recharges intact.
  - **`deploy/update.sh` overhauled for one-command deploys**:
    - Defaults now match the real VPS layout: `REPO_DIR=/opt/axistra`, `COMPOSE_FILE=deploy/docker-compose.yml`, `ENV_FILE=.env`.
    - **Self-updating**: step 0 fetches the latest `deploy/update.sh` from origin/emergent and re-execs itself. After a single one-time install, the user never has to copy update.sh again — even if I improve the script later, the next `bash /opt/axistra/update.sh` invocation transparently updates itself first.
    - **Doctor extended** to also flag:
      - `.env` missing `REACT_APP_BACKEND_URL` (so deploys fail before producing a broken bundle).
      - `docker-compose.yml` not forwarding `REACT_APP_BACKEND_URL` as a build arg.
    - **Post-deploy verification** now smoke-tests the public `${REACT_APP_BACKEND_URL}/api/health` so a misconfigured nginx / DNS / build arg is reported immediately.
    - Uses `--project-directory $REPO_DIR` on every `docker compose` call (matches the existing /opt/axistra layout where backend-nest/ + frontend/ live one level up from deploy/).

- **HOTFIX (May 28, 2026 v4): VPS deployment unblocked — yarn.lock now tracked + Dockerfiles fixed**
  - **Root cause of "new branch doesn't include a frontend/package-lock.json"**: the old Dockerfiles invoked `npm ci` which REQUIRES a `package-lock.json`, but the repo is yarn-managed (`yarn.lock` only). Worse — `frontend/yarn.lock` and `backend-nest/yarn.lock` had **never been committed to git**, so every "Save to Github" push produced a branch with NO lockfile of either flavor. The VPS docker build then died trying to run `npm ci` with no lockfile.
  - **Fixes shipped**:
    - `frontend/Dockerfile` + `backend-nest/Dockerfile` rewritten to use `corepack enable` + `yarn install --frozen-lockfile` (build stage) and again in the backend runtime stage with `--production`.
    - Stale `backend-nest/package-lock.json` deleted from the repo (kept conflicting with yarn.lock).
    - Both `yarn.lock` files force-added to git (`git add -f`) so future GitHub pushes carry them. They will be in the next "Save to Github" commit.
    - New `frontend/.dockerignore` + `backend-nest/.dockerignore` exclude `node_modules`, `dist`, `.env*` from the build context — faster builds, smaller images.
  - **`deploy/update.sh` pre-deploy doctor** added: validates BOTH services have `yarn.lock`, NEITHER service has a stale `package-lock.json`, and NEITHER Dockerfile uses `npm ci/install` — exits with a clear error BEFORE Docker is ever invoked. Verified working by deliberately breaking the tree (renaming yarn.lock + adding a fake package-lock.json) — doctor catches it; restored — doctor passes.
  - **End-to-end install verified** with the real lockfiles in `/tmp`: `yarn install --frozen-lockfile` succeeds in 37s for frontend and 11s for backend-nest, and resolves the new `@nestjs/schedule` dependency correctly.

- **UPDATE (May 28, 2026 v3): Treasury ↔ Wallet Ledger auto-sync + OxaPay history cron + coin-aware UI**
  - **P0 — Treasury → Wallet Ledger fan-out (the headline)**. Every `TreasuryService.upsertMovement(...)` now mirrors the 3 boolean stages into double-entry wallet_ledger pairs via a new `WalletsService.syncMovementStep({ step, enabled, ... })` helper. Idempotency is guaranteed by a deterministic `external_ref = 'movement-<recharge_id>-step-<okx|aed|wio>'` — every upsert deletes the prior pair before re-inserting, so re-saves or step toggles never duplicate rows. Verified with iteration_9 tests (9/9 pass): a $100 OxaPay → OKX → AED → Wio chain produces exactly 6 ledger rows that net to **+367 AED in WIO_BANK** with every intermediate balance == 0.
  - **Cascade delete extended**: `RechargesService.delete()` now also calls `wallets.dropMovementLedger(id)` so deleting a recharge removes the 3 movement-step pairs (no orphan ledger rows).
  - **`sourceWalletFor()` hardening**: defaults to `BINANCE` (never `MANUAL`) so the fan-out always targets a real WalletCode — caught by the testing agent's RCA.
  - **P1 — OxaPay history auto-sync**. New `OxaPaySyncService` (`/app/backend-nest/src/webhooks/oxapay-sync.service.ts`) with two entry points:
    - `@Cron(EVERY_30_MINUTES)` — silent background sync.
    - `POST /api/webhooks/oxapay/sync-history` (JWT-guarded) — manual admin trigger; returns `{ scanned, matched, errors, by_key }`.
    - Uses BOTH `OXAPAY_PORTAL_MERCHANT_KEY` and `OXAPAY_CALLS_BOT_MERCHANT_KEY`. Fetches `/payment/list` (fallback `/payment`) with each key, matches incoming rows by `tx_hash` or `track_id`, and back-fills `original_coin`/`original_amount`/`final_usdt_amount` on existing wallet_ledger rows whose data is missing. Skips already-populated rows.
    - Added `@nestjs/schedule` to package.json and `ScheduleModule.forRoot()` to WebhooksModule.
  - **P1 — Coin-aware Wallet Ledger UI**. Each wallet card now renders its full allowed-coins grid:
    - OxaPay → 1 row (USDT) — "auto-converted to USDT"
    - BTCPay → 1 row (BTC) — "BTC only"
    - Binance & OKX → 4 rows (USDT / BTC / ETH / AED) — "multi-coin + AED"
    - Wio Bank → 1 row (AED)
    - The **Convert Coin** button is now disabled (opacity-40, with tooltip explaining why) for single-coin wallets (OXAPAY / BTCPAY / WIO_BANK) and enabled for Binance / OKX, mirroring the user's mental model.
  - **VPS update script & docs**: `/app/deploy/update.sh` (idempotent pg_dump + git pull + `docker compose build` of changed services + health-check + image prune) and `/app/deploy/README.md` (one-time install + day-to-day usage + rollback).
  - **Testing**: iteration_9 — 9/9 backend pytest passes; 5/5 frontend wallet UI / Convert-button assertions pass. Regression suite at `/app/backend/tests/test_treasury_fanout.py`.

- **UPDATE (May 28, 2026 v2): VPS update script + OxaPay Final USDT columns + auto-refresh fix**
  - **`/app/deploy/update.sh`** — production update script. Single command on the VPS:
    ```bash
    bash /opt/axistra/update.sh
    ```
    Pulls origin/emergent, takes a pre-update `pg_dump` (gzip'd into `/opt/axistra/backups/pre-update-*.dump.gz`), detects which images changed, rebuilds only those, rolls containers with `--no-deps`, health-checks `/api/health`, prunes dangling images. Idempotent — exits immediately if `git rev-parse` matches origin. Docs at `/app/deploy/README.md` with one-time install + rollback instructions.
  - **OxaPay "Final USDT" + "Original Coin" columns on Wallet Ledger.**
    - `wallet_ledgers` entity gained two nullable columns: `original_coin` (varchar 12) + `original_amount` (decimal 30,10). The main `coin`/`amount` still reflect what actually hit the wallet balance (USDT for OxaPay) — original_coin/amount are the audit trail of what the customer paid in BEFORE OxaPay auto-converted.
    - `recordRechargeDeposit()` accepts `original_coin` + `original_amount` and persists them.
    - `RechargesService.addCryptoTx()` (manual entry path) and the gateway-payment path BOTH now detect auto-conversion (`tx.final_usdt_amount && coin !== 'USDT'`) and record `coin=USDT, amount=final_usdt_amount, original_coin=<paid coin>, original_amount=<paid amount>`. Verified end-to-end: paying 0.001 BTC with `final_usdt_amount=105.50` writes a single row showing **`+105.5 USDT`** main + `0.001 BTC → converted` in the new "Customer Paid" column.
    - `WalletLedger.jsx` shows the new "Customer Paid" column **only** when active wallet is `OXAPAY` (BTCPay rows stay BTC-only). Web app verified — KPI "Total USDT" correctly tallies converted rows.
    - The webhook path (`webhooks.service.ts`) already extracted `payCurrency`/`payAmount`/`final_usdt_amount` from OxaPay payloads via `normalizeOxaPayTxs`; the flow now carries those forward into the ledger row through `recordRechargeDeposit`.
  - **Auto-refresh bug fixed.** The `/auth/me` heartbeat in `auth.jsx` was calling `logout()` on ANY error (network blip, 502/503 during backend restart). Combined with the axios 401 interceptor's `window.location.href` hard reload, any API stutter looked like an "auto-refresh" to the preview URL. Now the heartbeat only logs out on **explicit 401**, and the 401 interceptor skips reloads for `/auth/me`.
  - **Body scroll-lock when a modal is open** — added `document.body.style.overflow = 'hidden'` while any Modal is mounted, so the page content below the dim overlay can no longer scroll up into the modal view (root cause of the "Vendors overlapping the wallet modal" screenshot the user reported).
  - **PostgreSQL note** — the sandbox container was rebooted today, wiping the local Postgres. Reinstalled `postgresql-15`, re-created `axistra/axistra_db`, and re-seeded admin + receiving wallets. **VPS data is independent and untouched.**

- **UPDATE (May 28, 2026): Cleanup tools + critical Modal positioning bug fix**
  - **Modal positioning RCA + fix** — `Add Receiving Wallet` / `Add Vendor` modals (and any other) were appearing offset toward the bottom of the page with their Save buttons clipped. Root cause: `.card-axistra` had `animation: surfaceIn` (with translateY transform) and `transition: transform ...` — the lingering `matrix(1,0,0,1,0,0)` computed transform created a CSS containing block that captured `position: fixed` overlays. Fixed by switching `surfaceIn` to an opacity-only keyframe and removing `transform` from the `.card-axistra` transition. Modals now center in viewport and Save buttons are always visible.
  - **Atoms.jsx Modal** restructured to a flex-col with a sticky header and a scrolling body (`overflow-y-auto` only on the inner body).
  - **Settings.jsx** — Receiving Wallets + Vendors modals bumped to `size="lg"` for breathing room.
  - **Recharges customer column** now shows `customer.full_name` + `@magnus_username` (falls back to `customer_code` when no Magnus username is set).
  - **Delete + gap-fill numbering** — full CRUD-with-cascade support:
    - `DELETE /api/recharges/:id` cascades: `crypto_transactions` + `treasury_movements` + `wallet_ledgers.linked_recharge_id` + `magnus_sync_logs` + the linked invoice. Audit-logged.
    - `DELETE /api/invoices/:id` blocks (400) when a recharge still references the invoice; succeeds for stand-alone invoices.
    - `DELETE /api/customers/:id` cascades all the customer's recharges (and their chains) + KYC docs + stand-alone invoices.
    - `nextCode()` (recharges), `nextNumber()` (invoices), `nextCode()` (customers) all rebuilt as **smallest-free-slot** algorithms — when you delete RCH-2605-00050, the next new recharge reuses 00050.
    - `RechargesService.create()` now has a **retry-on-duplicate** loop (5 attempts, fresh code per attempt, orphan-invoice rollback) so webhook races can never bubble up `UQ_*` duplicate-key errors.
  - **Frontend deletes**: red `Delete` button on the Recharge detail page header (`data-testid="delete-recharge-btn"`), trash icon on each invoice row (`data-testid="invoice-delete-<num>"`), Customers page already had delete and now benefits from the cascade.
  - **PostgreSQL note**: this sandbox was rebooted and lost its Postgres install. Was re-installed (`apt-get install postgresql-15`) and the `axistra` user/`axistra_db` were re-created; the NestJS seeder rebuilt the admin + receiving wallets. No production impact — production VPS already runs Postgres in Docker.
  - **Testing**: iteration_8 — 5/5 pytest pass, screenshots confirm modal centering, no regressions in earlier flows.

- **UPDATE (May 27, 2026 v2): Record Crypto TX modal aligned with New Recharge**
  - `RechargeDetail.jsx` "Record Crypto TX" modal rebuilt: Payment Gateway + Coin + Network + Crypto Amount only — manual AED Rate / AED Value inputs removed.
  - Modal fetches saved Receiving Wallets from `/api/settings/receiving-wallets` and auto-fills the destination address when `{gateway, coin, network}` matches a saved wallet, with a green "Saved address auto-filled" banner; falls back to a "Save it under Settings → Receiving Wallets" hint when none matches.
  - Footer note clarifies: "AED value at payment is auto-computed from the live FX feed".
  - Backend `RechargesService.addCryptoTx` now relies on `resolveAedValues(data, recharge)` only — the legacy "AED rate and AED value at payment time are required" guard is gone. Verified: $60 USD recharge → backend wrote `aed_rate=3.6725`, `aed_value=220.35` from the FX peg without any frontend input.

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
