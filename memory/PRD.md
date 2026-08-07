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
- `ca@axistratech.com` / `ca123456` — chartered_accountant role (idempotent, added Aug 2026)

## Modules

### Implemented
- Auth (JWT login, admin user list/create, **TOTP 2FA with enforcement, recovery codes, and self-service disable/regenerate** — see § Two-Factor Authentication)
- Customers (CRUD, code `AXC-NNNNN`, risk levels, KYC status, signup IP). **KYC docs support multi-file upload (Feb 2026)** — pick passport front + back in one go via `POST /api/kyc/:customerId/upload-multi`.
- Recharges (CRUD, code `RCH-YYYY-NNNNN`, status flow with mismatch detection). **Split Recharge support (Feb 2026)** — single on-chain TX shared between N Magnus accounts via `POST /api/recharges/split`. Ledger sees the deposit once; siblings carry `split_group_id`/`split_index`/`split_total`. Webhook ingestion (`telegram-manual`, `oxapay`, `btcpay`) now auto-merges incoming TX+amount into an existing PENDING placeholder for the same customer/amount/currency within the last 30 days (no orphan duplicates).
- Invoices (auto-generated `AX-YYYY-NNNNN`, Puppeteer PDF, View + Download). **Every invoice is billed in AED (Feb 2026)** — EUR/USD source amounts are converted to AED using the FX Rate configured on **Settings → Invoice FX Rates** (mode: `auto` uses ECB live for EUR + pegged 3.6725 for USD; mode: `manual` uses admin-locked rates). AED total + FX rate rendered on every PDF, list row, and API response (`aed_rate`, `aed_total`, `billing_currency`, `source_currency`). No DB migration — conversion happens at read time so **all 1270 legacy invoices instantly show correct AED totals** when the rate changes.
- Crypto Treasury (per-recharge movement, USDT → OKX → AED → Wio chain)
- Treasury Batches (NEW — aggregated batch view)
- Expenses (CRUD, 10 categories, payment methods: Bank/Card/USDT/Binance Pay/Cash/Other)
- Profit & Loss (yearly P&L, UAE Corp Tax 9% estimate, monthly chart)
- Reports (10 reports, PDF/CSV/Excel exports). **AED-first reporting (Aug 2026)** — Monthly Sales and Quarterly Sales now show `sales_aed` and `total_sales_aed` KPIs alongside the source-currency totals. Three new detailed reports (`monthly-detailed`, `quarterly-detailed`, `yearly-detailed`) return every invoice for the picked period with date, invoice #, customer, source amount, FX rate and AED amount, plus period totals; all three export formats (PDF / Excel / CSV) support `?month=` and `?quarter=` filters. New **Period Bundle ZIP** (`/api/reports/bundle/period`) accepts `year` + optional `month` or `quarter` and packages the detailed sheet (PDF + Excel + CSV) + yearly P&L context + cover + README. Reports UI and every export endpoint are accessible to both `admin` and `chartered_accountant` roles.
- **Corporate Documents Vault (Feb 2026, P1)** — `corporate_documents` table; 12 doc types (Trade License, MOA, AOA, Share Cert, TRN, Lease, Board/Shareholder Resolutions, COF, POA, Bank Letter, Other); expiry tracking with 90-day warning + expired badges. `/api/corporate-docs` CRUD + file download.
- **Tax & VAT Center (Feb 2026, P2)** — `tax_filings` table; supports VAT, Corporate Tax, Excise, WHT; period labels (Q1 2026, FY 2025); auto-flag overdue when `due_date < today` and status not in (filed/paid/exempt); summary KPI (upcoming/overdue/outstanding); optional file attachment for filed returns. `/api/tax` + `/api/tax/summary`.
- **Contracts Vault (Feb 2026, P2)** — `contracts` table; 6 contract types (customer agreement, NDA, supplier, employment, service, other); soft-link to customer; auto-flag expired when `end_date < today` and status=active; expiring-in-60-days KPI. `/api/contracts` CRUD + file download.
- **Crypto Conversion Register / Source of Funds (Feb 2026, P3)** — read-only aggregator at `/api/conversion-register` that stitches Customer → Invoice → Crypto TX → Exchange Settlement → USDT Conversion → AED Sale → Wio Bank Deposit per recharge. Used as the master audit-chain report for compliance. No new tables — joins existing entities.
- **CEO Net-Worth PDF (Feb 2026, P3)** — `GET /api/dashboard/net-worth` returns a structured snapshot (assets[], liabilities[], net_worth_aed, ytd_revenue/expenses, reconciliation). `GET /api/dashboard/net-worth/pdf` renders an Axistra-branded "Statement of Net Worth" via Puppeteer with director signature + company seal. One-click export from the Dashboard via the **Export Net Worth PDF** button (data-testid `dashboard-export-net-worth-btn`). Assets: Wio bank balance + non-Wio bank opening balances + crypto treasury still on exchange + open invoices receivable. Liabilities: unpaid payroll runs + outstanding tax (tax_due − tax_paid for non-paid filings).
- **Customer lookup by code (Feb 2026, bugfix)** — `/api/customers/:id` now accepts either UUID or `AXC-NNNNN`. Previously, passing a non-UUID code caused a Postgres 500; now returns proper 404 for missing codes and resolves correctly for valid ones. `update` / `delete` share the same `findCustomer()` helper.
- **Dashboard refactor (Feb 2026)** — Dashboard.jsx slimmed from ~349 → ~175 lines. Extracted `<RevenueRow/>`, `<ObligationsRow/>`, `<TreasuryRow/>`, `<PostureRow/>` to `/components/dashboard/KpiRows.jsx` and the helpers (StatCard, SectionLabel, CurrencyBreakdown, VatBar) to `/components/dashboard/Atoms.jsx`.
- **Treasury refactor (Feb 2026)** — Treasury.jsx slimmed 1997 → 1887 lines. Pure helpers (BATCH_STATUS_META, statusMeta, fmtCrypto, fmtLedgerAmount, txFinalUsdt, rechargeFinalUsdt, rechargeCryptoLabel, batchCryptoAmount/UsdtAmount/AedAmount, numeric, receiptCryptoAmount, entryCoin, safeJson, isReadyReceipt, startOfDay, inDateRange, rowCoin, cleanPayload, emptyBatchTemplate, dateInput) extracted to `/components/treasury/utils.js`. Presentational components (BatchStatus, StepPill) to `/components/treasury/Atoms.jsx`. Also fixed a pre-existing broken import — `InFlightTab` and `AuditChainTab` were referenced but not imported from TreasuryAdvanced (caused Audit Chain tab to blank the page).
- **Smart Offer/Revision Letter (Feb 2026)** — `GET /api/payroll/employees/:id/offer-letter.pdf` now auto-detects salary changes. If the employee has any `salary_change` record, the endpoint returns the LATEST Salary Revision Letter (new salary + revision date) using filename `salary-revision-<name>-<ref>.pdf`. If no revisions, returns the original Offer Letter. Fixes the bug where the offer-letter icon was showing "new salary, old date".
- **Global UUID-cast exception filter (Feb 2026)** — `/app/backend-nest/src/common/typeorm-exception.filter.ts` catches Postgres `22P02 invalid input syntax for type uuid` and maps it to **404 Not Found**. Applied globally via `app.useGlobalFilters()` in `main.ts`. Also maps `23505` (unique constraint) → 409 Conflict, `23503` (FK violation) → 409, and other 22P02 casts → 400. Eliminates the 500s when users land on `/recharges/RCH-…`, `/payroll/items/…`, `/invoices/AX-…`, etc.
- **Treasury tab extraction round 2 (Feb 2026)** — Treasury.jsx slimmed 1888 → 1661 lines. Extracted three tabs to their own files: `<ReceiptsTab/>`, `<BtcPayTab/>`, `<OxaPayTab/>` in `/components/treasury/*Tab.jsx`. Each tab takes only the props it needs (data + handlers + a `filterBar` React-element slot). OKX/Binance/AED-Wio tabs remain inline because they're heavily state-coupled.
- **Treasury tab extraction round 3 + Customer DTO + Salary History (Feb 2026)** —
  * Treasury.jsx now 1530 lines: extracted `<AedWioTab/>` (5-prop, fully self-contained KPIs + AED conversion queue + Wio deposits panel).
  * `CreateCustomerDto` with `class-validator` decorators (`IsEmail`, `MaxLength`, `IsIn` enums) and `ensureHasIdentifier()` guard — `POST /api/customers` now rejects empty bodies with 400 instead of silently creating "Unknown customer".
  * New page `/payroll/employees/:id` (EmployeeDetail.jsx) — Profile panel + 4 KPIs (Current Salary, Salary Revisions, Position Changes, Tenure) + **HR audit-trail Employment History timeline** with old→new diff for each change, ±% badge, sign status pill, and inline "View Letter PDF" buttons. Employee names on Payroll page now link to the detail page.
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

- **UPDATE (May 30, 2026 v20): Backup & Restore module — admin-only, full Postgres dump + Google Drive mirror**
  - **Settings → Backup & Restore** card (`/app/frontend/src/components/BackupRestoreCard.jsx`). Hidden for non-admin roles client-side; backend enforces with `JwtAuthGuard + AdminGuard` on every `/api/backups/*` route.
  - **Local snapshots**: `POST /api/backups` runs `pg_dump | gzip` to `BACKUP_DIR` (default `/app/backups`) producing `axistra-manual-<ts>.sql.gz`. `GET /api/backups` lists, `GET /api/backups/:name/download` streams the file (with read-error handler), `DELETE /api/backups/:name` removes it.
  - **Upload-to-restore**: `POST /api/backups/upload` (multer, default 500 MB cap via `BACKUP_UPLOAD_MAX_MB` env) accepts an admin-uploaded `.sql.gz`/`.dump.gz` and parks it in `BACKUP_DIR` so it can be restored.
  - **Restore**: `POST /api/backups/:name/restore` requires body `{confirm:"I_UNDERSTAND_THIS_REPLACES_ALL_DATA"}`. Always creates a `axistra-safety-<ts>.sql.gz` snapshot first, then drops + recreates the `public` schema and pipes the gunzipped dump into `psql`. Returns `{restored:true, safety_snapshot:<name>}`.
  - **Scheduled**: `@Cron(EVERY_DAY_AT_2AM)` runs a `kind:'scheduled'` snapshot every 02:00 UTC. Auto-prune (`BACKUP_RETAIN_DAYS`, default 30 days) only touches files matching `axistra-(manual|scheduled|safety)-` — admin-uploaded archives are preserved.
  - **Google Drive mirror** (`GoogleDriveService`): uses **Service Account auth** (`googleapis@173`). Two env vars enable it — `GOOGLE_DRIVE_FOLDER_ID` and `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` (single-line JSON) or `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`. Folder must be shared with the service-account email as Editor. When configured: scheduled snapshots auto-mirror to Drive (`BACKUP_DRIVE_AUTO_UPLOAD=scheduled|all|off`); manual snapshots can be mirrored via the "Backup + Drive" button. Endpoints: `GET /api/backups/drive/status`, `GET /api/backups/drive/list`, `POST /api/backups/:name/upload-to-drive`, `POST /api/backups/drive/:id/pull` (download from Drive back to server), `DELETE /api/backups/drive/:id`. When not configured all Drive endpoints (except `status`) return 400 with a clear message; local backups still work.
  - **New guards**: `/app/backend-nest/src/auth/jwt-auth.guard.ts` (alias for `AuthGuard('jwt')`) and `/app/backend-nest/src/auth/admin.guard.ts` (rejects non-admin roles with 403).
  - **Audit log entries**: every create/delete/restore/Drive upload/Drive delete is recorded via `AuditService` with actor email + IP.
  - **Testing**: iteration_19 — pytest 17/17 PASS (`/app/backend/tests/test_backups_iter19.py`). Coverage: admin-only guard (401 no token, 403 accountant), create/list/download/delete cycle, path-traversal rejection (literal `..`), upload of `.sql.gz` (accept) + `.txt` (reject), restore wrong/missing confirm (400) + correct confirm (200), post-restore DB still functional, Drive guards when not configured.

- **UPDATE (May 30, 2026 v19): Direct crypto → fiat conversion (BTC → AED / USD / EUR / GBP)**
  - **Backend `recordExchangeConversion()`** now branches on a `FIAT = ['AED','USD','EUR','GBP']` set:
    - `to_coin = USDT` → existing path (sets `usdt_amount`, `usdt_conversion_rate`, status `converted_to_usdt`).
    - `to_coin ∈ FIAT` → DIRECT path (sets `crypto_converted = fromAmt`, `fiat_received = toAmt`, `fiat_currency = toCoin`, `conversion_rate`, `conversion_date`, status `converted_to_aed`). USDT fields stay null.
    - `to_coin ∈ {BTC, ETH, ...}` → crypto-to-crypto path (no fiat/USDT fields, status `received_in_exchange`).
  - **`applyBatchLedger()` STEP 3** generalized: source coin = `'USDT'` if a USDT step preceded, else `batch.coin` (the original crypto). Same `${batch_code}-CONV-AED` external_ref is reused regardless of fiat target.
  - **Frontend `WalletLedger.jsx`**: BINANCE + OKX coin lists extended to `[USDT, BTC, ETH, AED, USD, EUR, GBP]` so the dropdown surfaces every supported target.
  - **Frontend `Treasury.jsx` feed**: the "AED Conversion" row now renders a dynamic badge `<from>→<fiat> Conversion` (e.g. `BTC→AED Conversion`, `ETH→USD Conversion`) and shows a `· direct` suffix when no USDT step preceded. Status badge label now reads "Converted to USD/EUR/GBP" instead of "Converted to AED" for non-AED fiat batches.
  - **Testing**: iteration_18 — pytest 9/9 PASS at `/app/backend/tests/test_exchange_convert_direct_fiat_iter18.py`. Frontend Playwright verified dropdown coins (BTC/ETH/USDT/AED/USD/EUR/GBP) + Treasury direct row label + step delete. 100/100.

- **UPDATE (May 29, 2026 v18): Wallet Ledger Convert is now the single entry point for exchange conversions**
  - `POST /api/treasury/exchange-convert` atomically creates the wallet_ledger pair + Treasury batch + auto-assigns unbatched receipts. "Convert Selected to USDT" button removed from Treasury Binance/OKX. Toast announces batch_code + assigned count.
  - **Testing**: iteration_17 — pytest 11/11 PASS.


  - **User decision** (live VPS workflow): use Wallet Ledger → Convert for ALL future BTC/ETH/USDT/AED swaps. Treasury "Convert Selected to USDT" is removed.
  - **New atomic endpoint `POST /api/treasury/exchange-convert`**: atomically (a) creates the wallet_ledger pair, (b) creates a Treasury Batch (`BIN-YYMM-NNNNN` / `OKX-…` / `AED-…`), (c) finds unbatched on-chain receipts on that exchange with the matching coin (`crypto_coin = from_coin`, `payment_gateway ILIKE wallet`, no existing `treasury_movements.treasury_batch_id`) and greedily auto-assigns them (earliest payment_date first) up to `from_amount` — preserving the Customer → Invoice → TX → Batch audit chain.
  - **Returns** `{batch, assigned_recharges_count, assigned_amount, remaining_unbatched_amount}` so the UI can show "X receipt(s) auto-assigned".
  - **Schema note**: explicit `::text` cast in the leftJoin to bridge `Recharge.id` (uuid) ↔ `TreasuryMovement.recharge_id` (varchar). Logged as tech debt — proper migration to uuid recommended.
  - **Frontend** (`WalletLedger.jsx submitConvert`): routes to `/api/treasury/exchange-convert` when wallet is `BINANCE|OKX|AED_TREASURY`; falls back to `/api/wallets/:wallet/convert` for `BTCPAY|OXAPAY|WIO_BANK`. Toast announces batch_code + assigned count.
  - **Treasury page** (`Treasury.jsx`): "Convert Selected to USDT (N)" button removed from Binance + OKX tabs, replaced by an info pill "Use Wallet Ledger → Convert to swap coins. Conversions auto-batch any unassigned receipts here." "Convert USDT to AED" + "Cashout to Wio" remain for the existing batch flow.
  - **Testing**: iteration_17 — pytest 11/11 PASS at `/app/backend/tests/test_exchange_convert_iter17.py`. Frontend Playwright verified pill text + Convert routing. 100/100.

- **UPDATE (May 29, 2026 v17): "Convert remaining" one-click cleanup + root-cause of the BTC ghost**
  - Root cause: `isReadyReceipt()` filter excluded 3 of 14 BTC deposits from "Convert Selected" because they lacked `magnus_credited_at`. Math confirmed via Reconcile breakdown.
  - Fix: "Convert remaining →" button in Reconcile modal next to each coin balance opens the Convert modal pre-filled with the live wallet balance.


  - **Root cause confirmed** from the Reconcile breakdown (live VPS): Binance BTC had `14 deposits +0.02194426 / 2 batch_in +0.05453788 / 3 convert_from -0.07172087 = net 0.00476127`. The math is consistent — the user's "Convert Selected" only processed 11 of 14 deposits because `isReadyReceipt()` filters out receipts that don't have `magnus_credited_at` set (i.e. weren't credited to MagnusBilling) or were already-reconciled/batched. 3 deposits failed that gate and were excluded from selection → their 0.00475266 BTC stayed as ghost.
  - **Fix**: new **"Convert remaining →"** button next to each coin row in the Reconcile modal. One click opens the Wallet Ledger Convert modal pre-filled with the exact wallet balance (e.g. `0.00476127 BTC → USDT`). User enters the received USDT amount and saves — the ledger balance drops to 0 instantly.
  - **Conditional render**: button only appears when (a) balance > 0, (b) coin != USDT (no USDT→USDT), (c) wallet supports convert (BINANCE/OKX/AED Treasury).
  - **No backend changes** — uses existing `POST /api/wallets/:wallet/convert`.

- **UPDATE (May 29, 2026 v16): Wallet Reconcile — per-tx_type breakdown for drift hunting**
  - `GET /api/wallets/:code/audit` now returns a `breakdown` per coin × tx_type. UI: new table in Reconcile modal showing each coin's deposit/convert_from/convert_to/batch_in/batch_out sums so drift is identifiable in one glance.


  - **User report**: Binance BTC shows `0.00476127` remaining after converting 15 selected items to USDT — sum should be 0. They couldn't tell which specific ledger rows make up the ghost balance.
  - **Diagnostic addition**: `GET /api/wallets/:code/audit` now also returns a `breakdown` array — per coin, per tx_type, with row count + signed sum. So you can instantly see "BTC: deposit +0.017 / convert_from -0.013 / batch_in +0.001 → net 0.005 (the orphan)".
  - **UI**: Reconcile modal renders a new "Per-coin breakdown by tx type" table for each coin in the wallet. Easy to spot mismatches at a glance.
  - **No regression risk** — audit is read-only.

- **UPDATE (May 29, 2026 v15): Convert Selected modal — editable amount + wallet balance reconciliation**
  - Total Source Coin field made editable. 3-chip reconciliation (Selected sum / Wallet balance / Other) so the gap is visible up-front. Rate auto-recalculates from either side.


  - **Root cause of user confusion** (live VPS): clicking "Convert Selected to USDT (15)" opened a modal showing `Total Source Coin: 0.04012478` (sum of the 15 selected items' crypto_amount) while the Binance BTC chip showed `0.04488605`. The 0.00476127 BTC gap is real (other ledger rows like manual entries, conversions, orphan rows) but the Total field was `disabled` so the user couldn't override it to convert the full balance.
  - **Fix**: the "Total Source Coin" field is now EDITABLE. The modal also shows a 3-chip reconciliation panel above:
    - `Selected sum` — what the 15 items add up to (was the only thing previously shown)
    - `<EXCHANGE> balance` — the actual ledger balance from `/api/wallets/overview`
    - `Other in wallet` — the gap (yellow if non-zero) with an inline hint: "Wallet holds more than the selected items. Edit the Total Source Coin below to convert the full balance if needed."
  - **No backend changes** — purely a UI clarification + input enabling. The rate auto-recalculates when the user edits Total OR Final USDT.

- **UPDATE (May 29, 2026 v14): Treasury feed AED + Wio rows + focused step modal + verify-mempool fix**
  - **AED Conversion + Wio Deposit feed rows**: batch with `fiat_received > 0` renders a separate "AED Conversion" row; with `bank_reference` set renders a "Wio Deposit" row. Combined with v13 split, a fully-settled batch shows as 4 distinct rows.
  - **Granular delete per step** for aed/wio.
  - **Focused step modal**: `openBatch(batch, focusStep)` opens only the clicked step's card expanded.
  - **Verify-mempool fix**: PATCH payload restricted to sweep-only fields.
  - **Testing**: iteration_16 — backend 4/4 + frontend 6/6 PASS.


  - **AED Conversion + Wio Deposit feed rows**: a batch with `fiat_received > 0` now also renders a separate "AED Conversion" row (`-USDT / +AED`), and a batch with `bank_reference` set renders a "Wio Deposit" row (`-AED from exchange / +AED Wio Bank`). Combined with iter_15's split, a fully-settled batch now appears as 4 distinct chronologically-sortable rows in the Binance/OKX merged feed.
  - **Granular delete per step**: AED Conversion row's trash hits `DELETE /api/treasury/batches/:id/step/aed`; Wio Deposit row's trash hits `/step/wio`. Each removes only its own ledger pair and clears just that step's batch fields — earlier steps stay intact.
  - **Focused step modal**: `openBatch(batch, focusStep)` accepts an optional step name (`sweep|usdt|aed|wio`). Clicking the AED Conversion row in the feed now opens the batch modal with ONLY Step 3 expanded (showStep2=false, showStep3=true, showStep4=false). Same for the other rows. Clicking with no focusStep keeps the previous "auto-reveal completed steps" behaviour.
  - **Verify-mempool fix**: previously `verifyActiveBtcTransfer` sent the entire `settlementForm` to PATCH, dragging unvalidated AED/Wio fields with it → tripped `'Conversion rate is required'`. Now the PATCH payload is restricted to sweep-only fields (`source_wallet`, `destination_exchange`, `destination_wallet`, `settlement_tx_hash`, `transfer_fee_crypto`, `exchange_received_at`, `received_crypto_amount`, `settlement_reference`, `coin`).
  - **Defensive step-name validation** in `clearBatchStep` — rejects unknown step strings with 400.
  - **Testing**: iteration_16 — backend 4/4 + frontend 6/6 PASS. 100% on a full 4-row batch lifecycle.

- **UPDATE (May 29, 2026 v13): Treasury feed split + sort fix + cascade delete**
  - **Sort order fix**: `stampNowTime()` helper preserves user's chosen date but bumps time-of-day to `batch.updated_at`, so freshly-saved rows surface at the top of Wallet Ledger.
  - **Treasury feed restructure**: each batch renders as up to 2 rows (Transfer + Conversion when usdt_amount > 0). Removed "Converted USDT" column.
  - **Granular delete**: `DELETE /api/treasury/batches/:id/step/:step` (sweep|usdt|aed|wio) — Conversion row trash clears only that step.
  - **Cascade delete on batch**: removes all `${batch_code}-<STEP>` ledger rows.
  - **Testing**: iteration_15 — pytest 5/5 + frontend 100%.


  - **Sort order fix**: ledger rows fanned out from a Treasury batch (BPAY-…-SWEEP / -CONV-USDT) were stamped at `00:00 UTC` because the user typed `2026-05-28` as a date-only field. They sank below same-day deposits (14:00+). New `stampNowTime()` helper preserves the user's chosen DATE but adopts the time-of-day from `batch.updated_at`, so freshly-saved batch rows bubble to the TOP of the Wallet Ledger as expected. Same fix applied to `wallets.convert()` when `event_at` is a `YYYY-MM-DD` string.
  - **Treasury feed restructure**: each batch now renders as up to TWO rows in the OKX/Binance merged feed: a "Transfer" row (sweep info) and a "Conversion" row (only when `usdt_amount > 0`, showing "-BTC / +USDT" stacked with the rate). Sweep-only batches render as 1 row. The "Converted USDT" column is removed.
  - **Granular delete**: new `DELETE /api/treasury/batches/:id/step/:step` (`step` ∈ `sweep|usdt|aed|wio`) clears just that step's fields AND removes only the matching `external_ref` ledger rows. The Conversion row's trash icon hits `/step/usdt` — keeps the Transfer intact.
  - **Cascade delete on batch**: `DELETE /api/treasury/batches/:id` now also removes all 4 external_ref groups of ledger rows so Wallet Ledger stays in sync (returns `{deleted, unlinked_movements, ledger_rows_removed}`).
  - **Testing**: iteration_15 — pytest 5/5 PASS at `/app/backend/tests/test_treasury_iter15.py`. Frontend Playwright confirmed split rows + cascade + granular delete + new sort. 100/100.

- **UPDATE (May 29, 2026 v12): Treasury Batch ↔ Wallet Ledger fan-out (the missing link)**
  - **Root cause** (live VPS report): BPAY-2605-00001 was saved with sweep+conversion fields but Binance USDT stayed at 0 — `applyBatchStatus()` only updated each recharge's status; never wrote rows to `wallet_ledgers`.
  - **Fix**: new `applyBatchLedger()` runs on every batch save, writes 4 step-scoped ledger pairs idempotently via `external_ref = '${batch_code}-<STEP>'`.
  - **New `POST /api/treasury/batches/:id/sync-ledger`** + "Sync to Wallet Ledger" button to backfill pre-fix batches.
  - **Helpers added to wallets.service.ts**: `recordTransferPair()` + `recordConvertPair()` + `findByExternalRef()`.
  - **Testing**: iteration_14 — pytest 5/5 PASS.


  - **Root cause** (live VPS report): BPAY-2605-00001 was saved with sweep+conversion fields but the Binance USDT balance stayed at 0 — `applyBatchStatus()` only updated each recharge's status; it NEVER wrote rows to `wallet_ledgers`. So the Treasury page showed "Converted to USDT" but the Wallet Ledger had no idea the batch happened.
  - **Fix — `applyBatchLedger()`**: new private method (called from `applyBatchStatus` on every batch save) that idempotently writes 4 step-scoped ledger pairs:
    1. **Sweep**: `-coin` on source (BTCPAY/OXAPAY) + `+coin` at exchange (BINANCE/OKX), `external_ref = '${batch_code}-SWEEP'`.
    2. **Convert to USDT**: `-coin` + `+USDT` both on exchange, `external_ref = '-CONV-USDT'`.
    3. **Convert to AED**: `-USDT` + `+AED` both on exchange, `external_ref = '-CONV-AED'`.
    4. **Withdraw to Wio**: `-AED` from exchange + `+AED` at `WIO_BANK`, `external_ref = '-WIO'`.
    Each step is gated by data availability AND `findByExternalRef` so re-saving a batch never duplicates the rows.
  - **New `POST /api/treasury/batches/:id/sync-ledger`** manual re-fan endpoint + **"Sync to Wallet Ledger"** button in the batch detail modal (data-testid `treasury-sync-ledger-btn`) — needed because user already had BPAY-2605-00001 saved on live VPS with NO ledger entries. One click backfills it.
  - **Helpers added to `wallets.service.ts`**: `recordTransferPair()` (two-leg transfer between wallets) and `recordConvertPair()` (in-wallet conversion). Used by `applyBatchLedger` and reusable for future flows.
  - **Treasury merged-feed sort fix**: a batch's `ts` now uses `Math.max(bank_deposit_date, conversion_date, usdt_conversion_date, exchange_received_at, updated_at, period_end, period_start, created_at)` so a batch with `period_start = 2 weeks ago` but settled today bubbles to the TOP of the Binance/OKX feed instead of sinking to the bottom.
  - **Testing**: iteration_14 — pytest 5/5 PASS at `/app/backend/tests/test_treasury_batch_ledger_iter14.py`. Frontend Playwright verified the sync button + new sort order with a real BPAY-2605-00001 batch.

- **UPDATE (May 29, 2026 v11 — Phase A): Sweep-only Treasury + Convert modal UX overhaul**
  - **Treasury Transfer modal**: Cards 2/3/4 collapsed by default — sweep is enough. Toggle buttons (`treasury-step{2,3,4}-toggle`). Auto-expands a card only if data already exists.
  - **Wallet Ledger Convert modal**: dropdowns for wallet/from-coin/to-coin (with balances), MAX button, Received Amount-primary with live rate display, Conversion Date default today.
  - **Backend `convert()`**: accepts `event_at`; prefers `to_amount` over `rate`.
  - **Testing**: iteration_13 — pytest 10/10 PASS.


  - **Treasury Transfer modal**: Cards 2 (Convert to USDT), 3 (Convert to AED), 4 (Withdraw to Wio) now COLLAPSED by default — only Card 1 (Sweep) is required. User can finish just the sweep ("Held as BTC at Binance") and convert later. Each card has a `▼ Expand` / `▲ Hide` toggle (`data-testid='treasury-step{2,3,4}-toggle'`). Auto-expands a card only if data already exists for it.
  - **Wallet Ledger Convert modal**: rewritten to mirror real exchange UX.
    - Wallet, From Coin, To Coin all SELECT dropdowns (no free-text typos)
    - From Coin dropdown shows current balance beside each coin
    - **MAX button** auto-fills `from_amount` with the available balance (disabled when ≤ 0)
    - **Received Amount** is the primary input; rate is auto-computed and displayed live ("1 BTC = 109,230.71 USDT") + inverse rate
    - **Conversion Date** input defaults to today, sent to backend as `event_at`
    - Visual warning if `from_amount` > available balance (overdraft block)
  - **Backend `wallets.service.ts convert()`**: now accepts optional `event_at` (default = now); prioritizes user-supplied `to_amount` and derives rate from it (rate = to/from); throws `BadRequestException` with clear messages for "Same coin" / "From amount must be positive" / "Either Received Amount or Rate is required".
  - **Testing**: iteration_13 — pytest 10/10 PASS at `/app/backend/tests/test_wallets_convert_iter13.py`. Wallet Ledger Convert modal live-verified end-to-end (live rate display shows '1 BTC = 109,230.70883293 USDT' as expected). Treasury batch-detail toggles structurally verified.
  - **Phase B (next)**: Withdraw-to-Bank standalone action, coin dropdowns on other forms (Expenses / New Recharge), and a "Mark as Held at Exchange" quick-save button on Card 1.

- **UPDATE (May 29, 2026 v10): Wallet ↔ on-chain reconciliation diagnostic + tightened dedupe**
  - **Investigation**: User reported BTCPay ledger total = 0.01896745 BTC while real BLUEwallet shows 0.01895680 BTC — a 0.00001065 BTC (~1065 sats) orphan row hidden somewhere in the ledger. Couldn't pinpoint from screenshots alone.
  - **Fix 1 — Tighter dedupe in `wallets.recordRechargeDeposit()`**: previously the duplicate check required both `tx_hash` AND `linked_recharge_id` to match. Now any existing **deposit** row with the same `tx_hash` blocks a second credit — the same on-chain TX can never credit the wallet twice regardless of which recharge claimed it.
  - **Fix 2 — Diagnostic tool**: new `GET /api/wallets/:code/audit` endpoint returns:
    1. Current balance per coin (sum of signed amounts)
    2. **Duplicate tx_hashes** — any hash with > 1 deposit row (should be 0 after the v10 dedupe)
    3. **Deposit rows without tx_hash** — manual entries, conversions, untraceable credits
    4. **Deposit rows not linked to a recharge** — credited the wallet but no customer recharge exists (common after a delete left ledger debris)
  - **Fix 3 — UI**: new "Reconcile" button next to "Apply" on every wallet ledger tab. Opens a modal that lists each category above with per-row delete buttons so the accountant can spot and remove the offending ~1065-sat orphan immediately.
  - **No regression risk** to existing flows: the audit is read-only; dedupe tightening only removes future duplicates (legacy duplicates surface in the Reconcile modal for manual review).

- **UPDATE (May 28, 2026 v9): Manual missed-webhook backfill fixed end-to-end**
  - **Root cause** (from the live Cugino1Napoli BTC incident with TX `21f9a2a4…20c7`): when an admin manually recorded a missed BTCPay webhook with Amount=200/Currency=EUR but no `crypto_amount`, the backend silently fell back to `data.amount` so the recharge row read "200 BTC" instead of e.g. "0.00320770 BTC". The manual create flow also never created a `crypto_transactions` row, so (a) Wallet Ledger BTCPay never showed the deposit and (b) "Verify with mempool" returned "No BTC transaction found".
  - **Fix 1 — Backend `recharges.service.ts create()`**: replaced `crypto_amount: data.crypto_amount || data.amount` with `isPositiveNumber(data.crypto_amount) ? data.crypto_amount : '0'`. No silent fiat fallback ever again.
  - **Fix 2 — Backend manual TX backfill**: when `tx_hash + positive crypto_amount` are supplied to `POST /api/recharges`, the create() now also creates a `crypto_transactions` row (`notes: '${gateway} manual backfill (missed webhook)'`), calls `wallets.recordRechargeDeposit()` to fan out the BTCPAY/OXAPAY wallet ledger entry, and kicks off the non-blocking mempool verify. Duplicate-hash protection via `cryptoRepo.findOne`. Whole block try/catch so the parent recharge save is never rolled back by downstream issues.
  - **Fix 3 — Frontend Recharges.jsx**: New Recharge modal now has a "Crypto Amount Received (<coin>)" input with `data-testid='rch-form-crypto-amount'` and `step='0.00000001'`. Label updates reactively with the selected coin, placeholder echoes "Actual BTC received (e.g. 0.00320770)", and helper text below clarifies "Required when recording an on-chain TX. Leave blank only for off-chain / manual Binance credit."
  - **Testing**: iteration_12 — pytest 6/6 PASS at `/app/backend/tests/test_recharges_btcpay_backfill_iter12.py`. Frontend modal structure verified visually.

- **UPDATE (May 28, 2026 v8): Balance reconciliation + delete endpoints**
  - **Treasury page balance chips now read straight from `/api/wallets/overview`** (the double-entry `wallet_ledgers` source of truth) — they can never drift from the Wallet Ledger page again. Previously Treasury's Binance/OKX "USDT Balance" chip summed `recharges + batches + expenses` independently, producing figures like 3,358.73 USDT while the Wallet Ledger correctly showed -700 USDT for the same wallet. New helpers `walletBalanceFor(code, coin)` and `walletBalancesFor(code)` derive both `exchangeUsdtBalance` and `activeExchangeCoinSummary` chips from the ledger overview. Same fix applied to OxaPay (`OxaPay Wallet Balance` chip + `Today received` subtitle) and BTCPay (`BTCPay Wallet Balance: X BTC`).
  - **New DELETE endpoints**:
    - `DELETE /api/wallets/ledger/:id` — deletes a single ledger row + paired `linked_ledger_id` row (keeps double-entry balanced); audit log; returns `{deleted, paired_deleted}`.
    - `DELETE /api/treasury/batches/:id` — unlinks all `treasury_movements.treasury_batch_id` then deletes the batch; audit log; returns `{deleted, unlinked_movements}`.
  - **Frontend delete UX**:
    - Wallet Ledger page: new Actions column with Trash icon on every row (confirms first, refreshes overview + list).
    - Treasury page (OKX/Binance merged feed): new Actions column with Trash icons per row that route to the correct backend (batch / recharge / expense). Tooltip explains what gets reversed.
  - **Build-system note caught by testing agent**: backend `AuditLog.details` column is typed `string` — always pass a string template (don't pass an object). I had to fix one regression where `audit.log({ details: { ... } })` blocked `yarn build` and left the running NestJS dist stale. Now fixed.
  - **Testing**: iteration_11 backend 100% (5/5 + 1 minor skip), frontend 100% smoke. Pytest suite at `/app/backend/tests/test_treasury_wallet_delete_iter11.py` covers the balance-sync fix (create 700-USDT BINANCE expense → overview drops 700 → undo + verify restore) and the paired-row delete behaviour.


  - **Wallet Ledger OxaPay tab — Coin / Amount columns now show the RECEIVED coin** (not the converted USDT). Previously every OxaPay deposit looked like `USDT · Bitcoin Network +116.50913146 USDT` even though the customer actually paid 0.00156404 BTC. New behaviour: when `original_coin` + `original_amount` are populated, Coin column renders `BTC · Bitcoin Network`, Amount renders `+0.00156404 BTC`, and the dedicated **Final USDT** column continues to show the converted `116.50913146 USDT`. Rows without conversion data still show "pending sync" in the Final USDT column.
  - **Crypto Treasury & Reconciliation (OKX/Binance tabs) now interleaves entries by date** (newest first). Previously batches → receipts → expense outflows were rendered as three separate groups, so an expense from the 12th would sink to the bottom under a transfer recorded on the 28th. Single merged feed: `[...batches, ...receipts, ...expenses].sort((a,b) => b.ts - a.ts)`.
  - **Expenses page — Edit + Delete actions**. New Actions column with Pencil (opens the same modal in "Edit Expense" mode and pre-fills all fields → `PATCH /api/expenses/:id`) and Trash (window.confirm → `DELETE /api/expenses/:id`) icons per row. Wallet ledger is correctly reversed on delete and refreshed on edit (backend `ExpensesService` already supported both — only the UI was missing).
  - Auto-cron OxaPay sync was already shipped in v3 (`@Cron(EVERY_30_MINUTES)` + `ScheduleModule.forRoot()`), confirmed still registered.
  - **Testing**: iteration_10 — backend pytest 7/7 PASS (`/app/backend/tests/test_expenses_oxapay_iter10.py`), frontend Playwright covers Add/Edit modal title switch, prefilled form, PATCH save and Trash → DELETE flow.


  - Wallet Ledger OxaPay column renamed **"Customer Paid" → "Final USDT"**. The cell now shows the converted USDT amount with the original coin/amount as a small subtitle ("from 0.001 BTC"). For older rows that have no conversion data yet, the cell shows "pending sync" in gray — making it obvious which rows need to be enriched via the OxaPay API.
  - New **"Sync from OxaPay"** button on the OxaPay ledger view (only). Hits `POST /api/webhooks/oxapay/sync-history`, displays a toast with the scanned/matched/by-key counts, and refreshes the table + overview cards. Disabled state while syncing.
  - `OxaPaySyncService.applyToRow` hardened:
    - No longer requires both `payCurrency` and `payAmount`; will still flip a stale BTC/ETH row to USDT when only `finalUsdt` is returned by OxaPay.
    - Removes the `original_coin: IsNull()` constraint when falling back to recharge_id lookup, so we can update older rows too.
    - Also mirrors `final_usdt_amount`/`received_amount` onto the matching `crypto_transactions` row → the Recharge Detail + Audit Chain views stay consistent with the Wallet Ledger.

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

- **UPDATE (May 28, 2026 v7): UI polish from user feedback — OxaPay ledger columns + Treasury chronological order + Expense edit/delete**
  - **Wallet Ledger OxaPay tab — Coin / Amount columns now show the RECEIVED coin** (not the converted USDT). When `original_coin` + `original_amount` are populated, Coin column renders `BTC · Bitcoin Network`, Amount renders `+0.00156404 BTC`, and the dedicated **Final USDT** column continues to show the converted `116.50913146 USDT`.
  - **Crypto Treasury & Reconciliation (OKX/Binance tabs) now interleaves entries by date** (newest first). Previously batches → receipts → expense outflows were rendered as three separate groups.
  - **Expenses page — Edit + Delete actions**. New Actions column with Pencil + Trash icons.
  - **Auto-cron OxaPay sync** re-verified as registered.
  - **Testing**: iteration_10 — backend pytest 7/7 PASS, frontend Playwright covers Add/Edit modal title switch.

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

## CHANGELOG

### 2026-06-01 — Iter 21 (Payroll Module — Phase 1)
- **Backend**: New entities `employees`, `bank_accounts`, `payroll_runs`, `payroll_items`. PayrollService handles employees CRUD, bank-accounts CRUD, monthly runs (auto-populated with all active employees at current salary), draft → approved → paid workflow.
  - **Auto-Expense link**: marking a run "paid" creates one `expenses` row per employee (category=Salary, vendor=employee name) → flows into P&L automatically.
  - **Auto PDF generation** (Puppeteer): Offer Letter, Board Resolution (on approve), Salary Slip (on mark-paid) — all signed using uploaded Director signature + company seal stored in `app_settings.company_branding`.
  - **Payroll Register XLSX** at `GET /api/payroll/register.xlsx`.
  - **Transfer proof upload**: per-item file upload via Multer → stored on disk + linked to the item.
- **Frontend**: New `/payroll` page with 3 tabs (Runs · Employees · Bank Accounts). Sidebar entry added between Expenses and P&L. Settings page has a "Company Branding" card to upload Director signature + company seal PNGs.
- **Seeded data**: Hemant Kumawat (Director & CEO, AED 20k), Sanjana Kumawat (Operations Manager, AED 15k), Wio Business AED as default payroll bank, May 2026 run already created and paid via curl during verification.
- **Endpoints**: `/api/payroll/{employees, bank-accounts, runs, items}` CRUD + `/runs/:id/{approve, mark-paid, cancel}` + PDF/XLSX/proof routes + `/branding` + `/seed`.

## Backlog
- **Phase 2+ Roadmap (owner-confirmed 2026-06-01, in priority order)**:
  1. Corporate Documents Vault — Trade License, COF, MOA, AOA, Lease, TRN, Shareholder/Board Resolutions
  2. Asset Register — BAYZ 102, Indian properties, Trust Wallet/OKX, vehicles, MacBooks/phones (net-worth proof for Binance)
  3. Tax & VAT Center — Corporate Tax, VAT returns, tax calendar, filing attachments
  4. Contracts Vault — Customer/supplier agreements, NDAs
  5. Reimbursements — petty cash, employee-paid-on-company-card → links to Expenses
  6. Leave & Attendance — when employee #3 joins
- **CEO-requested feature set**:
  - Crypto Conversion Register (Customer → USDT → AED sale @rate → Wio deposit trail)
  - Source of Funds module (per revenue stream end-to-end)
  - CEO Dashboard (Today/Month Revenue, Expenses, Payroll Due, Bank/Crypto balances, Outstanding Invoices, Profit)
  - Customer KYC Vault UI (fields already in Customer entity)
  - Company Net Worth Dashboard (Dubai+India property + crypto + bank → 1-click PDF for Binance/Wio)
- **Long-term sidebar restructure** (Dashboard · Customers/Recharges/Invoices · Finance · Crypto · Compliance · Assets · Reports · Settings)
- Fix Reports and Invoice PDF design (user-requested)
- Wire OXAPAY_HISTORY_DELAY_MS background poller into recharge reconciliation
- Show webhook signature errors prominently in `/webhook-logs`
- Add latency analytics ("Reconciliation Health") to dashboard
- Live FX feed already wired (ECB) — extend to lock the rate per recharge at payment time

## CHANGELOG

### 2026-05-30 — Iter 20 (P1 + P2 batch)
- **2FA enforcement (P1)**: TOTP via `otplib`. New columns on `users_admin`: `two_fa_secret`, `two_fa_recovery_codes` (bcrypt hashes, single-use). Endpoints:
  `POST /api/auth/2fa/setup`, `/2fa/enable`, `/2fa/disable`, `/2fa/recovery-codes/regenerate`, `/2fa/login-verify`. Login returns `{require_2fa, challenge_token}` when 2FA is enabled.
  Admins land on `/setup-2fa` until enrolled when `ENFORCE_ADMIN_2FA=true`. Frontend pages: `TwoFactorSetup.jsx`, `TwoFactorCard.jsx` (in Settings).
- **Environment badge (P2)**: `EnvBadge` in `AppLayout` reads `VITE_APP_ENV` / `REACT_APP_APP_ENV`. PRODUCTION = red pulse, STAGING = amber, PREVIEW = sky.
- **Pay-Now flow (P2)**: Settings → Vendors row now has a `CreditCard` Pay button → navigates to `/expenses?pay_vendor=<id>` which auto-opens the Add Expense modal pre-filled with vendor + default payment method + default wallet. Query param is stripped after consumption.
- **Accountant-ready export (P2)**: `GET /api/reports/bundle/accountant-pack?year=YYYY` returns a full-year ZIP — cover PDF, PDF + XLSX for 10 reports (yearly-pl, monthly-sales, quarterly-sales, vat-threshold, corporate-tax, customer-recharge, crypto-to-aed, bank-reconciliation, expenses, suspicious), CSV manifest + README. Wired to "Accountant Pack" button in `/reports`.
- Tests: `/app/backend/tests/test_2fa_and_accountant_pack_iter20.py` — 12/12 pass.

