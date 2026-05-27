"""Tests for Wallet Ledger (Option B Crypto Treasury), Audit Chain, Snapshot, Onchain."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://crypto-audit-chain.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"

WALLET_CODES = ["OXAPAY", "BTCPAY", "BINANCE", "OKX", "WIO_BANK", "MANUAL"]

_created_expense_ids = []


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text[:200]}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _balance(headers, wallet, coin):
    r = requests.get(f"{BASE_URL}/api/wallets/{wallet}/balances", headers=headers, timeout=20)
    assert r.status_code == 200, r.text[:200]
    for b in r.json():
        if b["coin"] == coin:
            return float(b["balance"])
    return 0.0


# ---------- Wallet config + overview ----------
class TestWalletConfig:
    def test_config_returns_six_wallets(self, headers):
        r = requests.get(f"{BASE_URL}/api/wallets/config", headers=headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        codes = sorted([w["code"] for w in data])
        assert codes == sorted(WALLET_CODES), f"got {codes}"

    def test_overview_returns_balances(self, headers):
        r = requests.get(f"{BASE_URL}/api/wallets/overview", headers=headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 6
        oxa = next(w for w in data if w["code"] == "OXAPAY")
        assert "balances" in oxa and isinstance(oxa["balances"], list)


# ---------- Ledger listing ----------
class TestLedgerListing:
    def test_oxapay_ledger_default(self, headers):
        r = requests.get(f"{BASE_URL}/api/wallets/OXAPAY/ledger", headers=headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "rows" in data and "total" in data and "limit" in data
        assert data["wallet"] == "OXAPAY"
        assert isinstance(data["rows"], list)

    def test_oxapay_ledger_filter_coin_usdt(self, headers):
        r = requests.get(f"{BASE_URL}/api/wallets/OXAPAY/ledger?coin=USDT&limit=10", headers=headers, timeout=20)
        assert r.status_code == 200
        for row in r.json()["rows"]:
            assert row["coin"] == "USDT"

    def test_oxapay_ledger_filter_tx_type_deposit(self, headers):
        r = requests.get(f"{BASE_URL}/api/wallets/OXAPAY/ledger?tx_type=deposit", headers=headers, timeout=20)
        assert r.status_code == 200
        for row in r.json()["rows"]:
            assert row["tx_type"] == "deposit"

    def test_ledger_pagination(self, headers):
        r = requests.get(f"{BASE_URL}/api/wallets/OXAPAY/ledger?limit=2&offset=0", headers=headers, timeout=20)
        assert r.status_code == 200
        assert len(r.json()["rows"]) <= 2


# ---------- Send Batch (OxaPay → Binance) ----------
class TestSendBatch:
    def test_send_batch_moves_balances(self, headers):
        amt = 50.0
        before_src = _balance(headers, "OXAPAY", "USDT")
        before_dst = _balance(headers, "BINANCE", "USDT")
        payload = {"to_wallet": "BINANCE", "coin": "USDT", "amount": str(amt), "fee_amount": "1",
                   "notes": "TEST batch out"}
        r = requests.post(f"{BASE_URL}/api/wallets/OXAPAY/send-batch", json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), r.text[:300]
        data = r.json()
        assert "batch_id" in data and "out" in data and "in" in data
        assert data["out"]["tx_type"] == "batch_out"
        assert data["in"]["tx_type"] == "batch_in"
        after_src = _balance(headers, "OXAPAY", "USDT")
        after_dst = _balance(headers, "BINANCE", "USDT")
        # source decreased by amt+fee, destination increased by amt-fee
        assert round(before_src - after_src, 2) == round(amt + 1, 2), f"src delta {before_src - after_src}"
        assert round(after_dst - before_dst, 2) == round(amt - 1, 2), f"dst delta {after_dst - before_dst}"

    def test_send_batch_same_wallet_rejected(self, headers):
        r = requests.post(f"{BASE_URL}/api/wallets/OXAPAY/send-batch",
                          json={"to_wallet": "OXAPAY", "coin": "USDT", "amount": "1"},
                          headers=headers, timeout=20)
        assert r.status_code == 400


# ---------- Convert ----------
class TestConvert:
    def test_convert_btc_to_usdt(self, headers):
        # Use a small fraction of BTC; if balance is 0 still should record (balance can go negative? test expects books move)
        before_btc = _balance(headers, "BINANCE", "BTC")
        before_usdt = _balance(headers, "BINANCE", "USDT")
        payload = {"from_coin": "BTC", "to_coin": "USDT", "from_amount": "0.001", "rate": "60000",
                   "fee_amount": "0.5", "fee_currency": "USDT", "notes": "TEST conv"}
        r = requests.post(f"{BASE_URL}/api/wallets/BINANCE/convert", json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), r.text[:300]
        d = r.json()
        assert d["out"]["tx_type"] == "convert_from"
        assert d["in"]["tx_type"] == "convert_to"
        after_btc = _balance(headers, "BINANCE", "BTC")
        after_usdt = _balance(headers, "BINANCE", "USDT")
        assert round(before_btc - after_btc, 6) == 0.001
        assert round(after_usdt - before_usdt, 4) == round(0.001 * 60000 - 0.5, 4)


# ---------- Cashout ----------
class TestCashout:
    def test_cashout_creates_pair(self, headers):
        before_wio = _balance(headers, "WIO_BANK", "AED")
        payload = {"amount_aed": "1000", "bank_fee_aed": "5",
                   "bank_reference": "TEST-WIO-REF-001", "notes": "TEST cashout"}
        r = requests.post(f"{BASE_URL}/api/wallets/BINANCE/cashout", json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), r.text[:300]
        d = r.json()
        assert d["out"]["tx_type"] == "cashout"
        assert d["in"]["tx_type"] == "bank_deposit"
        after_wio = _balance(headers, "WIO_BANK", "AED")
        # net = 1000 - 5 = 995 deposited into Wio
        assert round(after_wio - before_wio, 2) == 995.00


# ---------- Expense ledger integration ----------
class TestExpenseLedger:
    def test_expense_binance_usdt_debits_balance(self, headers):
        before = _balance(headers, "BINANCE", "USDT")
        payload = {
            "vendor_name": "TEST_VENDOR_BIN", "category": "Office", "amount": "25",
            "currency": "USDT", "payment_method": "Binance Pay", "paid_in_usdt": True,
            "vendor_wallet": "binance", "tx_hash": "TEST_TXH_BIN_001",
            "notes": "TEST expense ledger",
        }
        r = requests.post(f"{BASE_URL}/api/expenses", json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), r.text[:300]
        exp = r.json()
        eid = exp["id"]
        _created_expense_ids.append(eid)
        after = _balance(headers, "BINANCE", "USDT")
        assert round(before - after, 2) == 25.00, f"delta {before - after}"

    def test_patch_expense_reflows_ledger(self, headers):
        if not _created_expense_ids:
            pytest.skip("no expense to patch")
        eid = _created_expense_ids[0]
        before = _balance(headers, "BINANCE", "USDT")
        # Change amount from 25 → 30
        r = requests.patch(f"{BASE_URL}/api/expenses/{eid}", json={"amount": "30"}, headers=headers, timeout=20)
        assert r.status_code == 200, r.text[:300]
        after = _balance(headers, "BINANCE", "USDT")
        # ledger reset then re-added: net delta = +25 (restore) -30 (new) = -5
        assert round(before - after, 2) == 5.00, f"delta {before - after}"

    def test_delete_expense_restores_balance(self, headers):
        if not _created_expense_ids:
            pytest.skip("no expense to delete")
        eid = _created_expense_ids.pop(0)
        before = _balance(headers, "BINANCE", "USDT")
        r = requests.delete(f"{BASE_URL}/api/expenses/{eid}", headers=headers, timeout=20)
        assert r.status_code in (200, 204), r.text[:300]
        after = _balance(headers, "BINANCE", "USDT")
        # delete should restore the last amount (30)
        assert round(after - before, 2) == 30.00, f"delta {after - before}"


# ---------- Audit Chain ----------
class TestAuditChain:
    def test_chain_search_returns_counts(self, headers):
        # find any recharge code
        rs = requests.get(f"{BASE_URL}/api/recharges?limit=1", headers=headers, timeout=20)
        if rs.status_code != 200:
            pytest.skip("recharges unavailable")
        rows = rs.json() if isinstance(rs.json(), list) else rs.json().get("rows") or rs.json().get("data") or []
        if not rows:
            pytest.skip("no recharges seeded")
        code = rows[0].get("recharge_code") or rows[0].get("invoice_number")
        if not code:
            pytest.skip("no recharge_code on row")
        r = requests.get(f"{BASE_URL}/api/chain/search", params={"q": code}, headers=headers, timeout=20)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "counts" in data
        assert data["counts"]["recharges"] >= 1
        # chain object should be built when exactly 1 recharge match
        if data["counts"]["recharges"] == 1:
            assert data.get("chain") is not None
            assert "recharge" in data["chain"]
            assert "ledger_entries" in data["chain"]

    def test_chain_search_short_query(self, headers):
        r = requests.get(f"{BASE_URL}/api/chain/search", params={"q": "ab"}, headers=headers, timeout=20)
        assert r.status_code == 200
        assert r.json()["chain"] is None


# ---------- Snapshot ----------
class TestSnapshot:
    def test_daily_snapshot(self, headers):
        r = requests.get(f"{BASE_URL}/api/snapshot/daily", headers=headers, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "date" in d and "rows" in d
        if d["rows"]:
            row = d["rows"][0]
            for k in ("wallet", "coin", "opening", "closing"):
                assert k in row


# ---------- Onchain ----------
class TestOnchain:
    def test_btc_verify_known_hash(self, headers):
        # Genesis-era well-known TX (Pizza)
        h = "a1075db55d416d3ca199f55b6084e2115b9345e16c5cf302fc80e9d5fbf5d48d"
        r = requests.get(f"{BASE_URL}/api/onchain/verify/btc/{h}", headers=headers, timeout=30)
        # Allow either ok or graceful error (no 5xx)
        assert r.status_code < 500, r.text[:300]
        d = r.json()
        assert "network" in d and d["network"] == "btc"

    def test_onchain_unsupported_network(self, headers):
        r = requests.get(f"{BASE_URL}/api/onchain/verify/dogecoin/abc123", headers=headers, timeout=20)
        assert r.status_code == 400
