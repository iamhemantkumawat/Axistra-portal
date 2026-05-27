"""Phase 1 bug fixes after Wallet Ledger rebuild.

Covers:
- /api/wallets/config returns exactly 5 wallets (no MANUAL)
- /api/wallets/overview returns those 5 with merged ETH onto OKX
- /api/recharges/:id/crypto-tx accepts received_wallet (lands on chosen wallet)
- /api/recharges/:id/crypto-tx still rejects missing receiving + received wallet
- Telegram-manual webhook defaults gateway to Binance
- Expense Card/Cash → WIO_BANK
- Regression: send-batch / convert / cashout / chain still work
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://crypto-audit-chain.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"

EXPECTED_WALLETS = ["BINANCE", "BTCPAY", "OKX", "OXAPAY", "WIO_BANK"]
TAG_PREFIX = "0xphase1"

_created_expense_ids: list[str] = []
_created_recharge_ids: list[str] = []


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
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


def _create_customer(headers) -> str:
    """Create a customer and return its id."""
    payload = {
        "name": f"TEST_{TAG_PREFIX}_{uuid.uuid4().hex[:6]}",
        "email": f"{TAG_PREFIX}_{uuid.uuid4().hex[:6]}@test.com",
        "phone": "+971500000000",
    }
    r = requests.post(f"{BASE_URL}/api/customers", json=payload, headers=headers, timeout=20)
    assert r.status_code in (200, 201), r.text[:300]
    return r.json()["id"]


def _create_recharge_with_invoice(headers, payment_gateway="Binance",
                                  coin="ETH", network="ERC20",
                                  crypto_amount="0.5", aed_amount="1000") -> str:
    """Create a customer + recharge + invoice; return recharge_id ready for addCryptoTx."""
    customer_id = _create_customer(headers)
    payload = {
        "customer_id": customer_id,
        "amount": aed_amount,
        "currency": "AED",
        "payment_gateway": payment_gateway,
        "crypto_coin": coin,
        "crypto_network": network,
        "crypto_amount": crypto_amount,
        "magnus_username": f"TEST_{TAG_PREFIX}_user",
        "notes": f"TEST {TAG_PREFIX} recharge",
    }
    r = requests.post(f"{BASE_URL}/api/recharges", json=payload, headers=headers, timeout=20)
    assert r.status_code in (200, 201), f"create recharge: {r.status_code} {r.text[:300]}"
    rid = r.json()["id"]
    _created_recharge_ids.append(rid)
    # Generate invoice (some flows: POST /api/recharges/:id/invoice)
    inv = requests.post(f"{BASE_URL}/api/recharges/{rid}/invoice", headers=headers, timeout=20)
    # may be 200/201/409 (already exists). don't assert hard.
    assert inv.status_code < 500, inv.text[:300]
    return rid


# ---------- Wallet config + overview ----------
class TestWalletConfigPhase1:
    def test_config_returns_exactly_five_wallets_no_manual(self, headers):
        r = requests.get(f"{BASE_URL}/api/wallets/config", headers=headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        codes = sorted([w["code"] for w in data])
        assert codes == EXPECTED_WALLETS, f"got {codes}"
        assert "MANUAL" not in codes

    def test_overview_returns_five_wallets(self, headers):
        r = requests.get(f"{BASE_URL}/api/wallets/overview", headers=headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        codes = sorted([w["code"] for w in data])
        assert codes == EXPECTED_WALLETS
        assert len(data) == 5
        assert "MANUAL" not in codes

    def test_eth_balance_is_on_okx_not_manual(self, headers):
        """The 9 ETH that used to live on MANUAL should be on OKX now."""
        okx_eth = _balance(headers, "OKX", "ETH")
        # The migration should have moved 9 ETH to OKX (per task brief)
        assert okx_eth >= 9.0 - 0.0001, f"OKX ETH balance is {okx_eth}, expected >=9"


# ---------- crypto-tx with received_wallet ----------
class TestRechargeCryptoTxReceivedWallet:
    def test_crypto_tx_with_received_wallet_binance_eth(self, headers):
        rid = _create_recharge_with_invoice(headers, payment_gateway="Binance",
                                            coin="ETH", network="ERC20",
                                            crypto_amount="0.5", aed_amount="1000")
        before = _balance(headers, "BINANCE", "ETH")
        payload = {
            "received_wallet": "BINANCE",
            "coin": "ETH",
            "network": "ERC20",
            "crypto_amount": "0.5",
            "tx_hash": f"TEST_{TAG_PREFIX}_BIN_ETH_{uuid.uuid4().hex[:10]}",
            "aed_rate_at_payment": "2000",
            "aed_value": "1000",
        }
        r = requests.post(f"{BASE_URL}/api/recharges/{rid}/crypto-tx",
                          json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), r.text[:300]
        after = _balance(headers, "BINANCE", "ETH")
        # Deposit ledger row should add 0.5 ETH to BINANCE
        assert round(after - before, 6) == 0.5, f"BINANCE ETH delta {after - before}"

    def test_crypto_tx_with_received_wallet_okx_usdt(self, headers):
        rid = _create_recharge_with_invoice(headers, payment_gateway="Manual",
                                            coin="USDT", network="TRC20",
                                            crypto_amount="100", aed_amount="367")
        before = _balance(headers, "OKX", "USDT")
        payload = {
            "received_wallet": "OKX",
            "coin": "USDT",
            "network": "TRC20",
            "crypto_amount": "100",
            "tx_hash": f"TEST_{TAG_PREFIX}_OKX_USDT_{uuid.uuid4().hex[:10]}",
            "aed_rate_at_payment": "3.67",
            "aed_value": "367",
        }
        r = requests.post(f"{BASE_URL}/api/recharges/{rid}/crypto-tx",
                          json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), r.text[:300]
        after = _balance(headers, "OKX", "USDT")
        assert round(after - before, 2) == 100.00, f"OKX USDT delta {after - before}"

    def test_crypto_tx_missing_both_wallets_returns_400(self, headers):
        rid = _create_recharge_with_invoice(headers, payment_gateway="Binance",
                                            coin="USDT", network="ERC20",
                                            crypto_amount="50", aed_amount="183.5")
        payload = {
            # no receiving_wallet, no received_wallet
            "coin": "USDT",
            "network": "ERC20",
            "crypto_amount": "50",
            "tx_hash": f"TEST_{TAG_PREFIX}_NOWAL_{uuid.uuid4().hex[:10]}",
            "aed_rate_at_payment": "3.67",
            "aed_value": "183.5",
        }
        r = requests.post(f"{BASE_URL}/api/recharges/{rid}/crypto-tx",
                          json=payload, headers=headers, timeout=20)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:300]}"
        msg = (r.json().get("message") or "").lower()
        assert "wallet" in msg or "address" in msg, f"unexpected error: {msg}"


# ---------- Telegram webhook ----------
class TestTelegramWebhookDefault:
    def test_telegram_manual_defaults_to_binance_not_manual(self, headers):
        """POST /api/webhooks/telegram with minimal payload (no wallet_tag) should set payment_gateway='Binance'."""
        magnus_user = f"TEST_{TAG_PREFIX}_tg_{uuid.uuid4().hex[:6]}"
        tx_hash = f"TEST_{TAG_PREFIX}_TG_{uuid.uuid4().hex[:10]}"
        secret = os.environ.get("PAYMENT_WEBHOOK_SECRET", "964dffaf381126785ca1275422dae351d38286ef78f65460")
        payload = {
            "source": "telegram_manual",
            "magnus_username": magnus_user,
            "amount": "500",
            "currency": "AED",
            "crypto_coin": "USDT",
            "crypto_amount": "136.24",
            "crypto_network": "TRC20",
            "tx_hash": tx_hash,
            "aed_rate_at_payment": "3.67",
            "aed_value": "500",
            "status": "paid",
        }
        r = requests.post(f"{BASE_URL}/api/webhooks/telegram-manual",
                          json=payload,
                          headers={"x-axistra-webhook-secret": secret,
                                   "Content-Type": "application/json"},
                          timeout=20)
        # may or may not be auth-protected; just check no 5xx
        assert r.status_code < 500, f"webhook failed: {r.status_code}: {r.text[:300]}"
        if r.status_code in (401, 403):
            pytest.skip(f"telegram webhook protected ({r.status_code}); skipping default-gateway check")
        assert r.status_code in (200, 201), f"webhook failed: {r.status_code}: {r.text[:300]}"
        recharge_id = r.json().get("recharge_id")
        assert recharge_id, f"webhook response missing recharge_id: {r.json()}"
        # fetch the recharge and verify gateway
        gr = requests.get(f"{BASE_URL}/api/recharges/{recharge_id}", headers=headers, timeout=20)
        assert gr.status_code == 200, gr.text[:300]
        gw = (gr.json().get("payment_gateway") or "").lower()
        assert gw == "binance", f"expected 'Binance', got '{gw}'"


# ---------- Expense wallet routing ----------
class TestExpenseWalletRouting:
    def _create_expense(self, headers, method, currency="AED", amount="100"):
        payload = {
            "vendor_name": f"TEST_{TAG_PREFIX}_vendor_{method.lower()}",
            "category": "Office",
            "amount": amount,
            "currency": currency,
            "payment_method": method,
            "notes": f"TEST {TAG_PREFIX} expense {method}",
        }
        r = requests.post(f"{BASE_URL}/api/expenses", json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), r.text[:300]
        eid = r.json()["id"]
        _created_expense_ids.append(eid)
        return eid

    def test_card_expense_lands_on_wio_bank(self, headers):
        before = _balance(headers, "WIO_BANK", "AED")
        self._create_expense(headers, method="Card", currency="AED", amount="100")
        after = _balance(headers, "WIO_BANK", "AED")
        assert round(before - after, 2) == 100.00, f"WIO AED delta {before - after}"

    def test_cash_expense_lands_on_wio_bank(self, headers):
        before = _balance(headers, "WIO_BANK", "AED")
        self._create_expense(headers, method="Cash", currency="AED", amount="50")
        after = _balance(headers, "WIO_BANK", "AED")
        assert round(before - after, 2) == 50.00, f"WIO AED delta {before - after}"


# ---------- Regression ----------
class TestRegression:
    def test_send_batch_still_works(self, headers):
        amt = 5.0
        before_src = _balance(headers, "OXAPAY", "USDT")
        before_dst = _balance(headers, "BINANCE", "USDT")
        payload = {"to_wallet": "BINANCE", "coin": "USDT", "amount": str(amt),
                   "fee_amount": "0.5", "notes": f"TEST_{TAG_PREFIX} batch"}
        r = requests.post(f"{BASE_URL}/api/wallets/OXAPAY/send-batch",
                          json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), r.text[:300]
        after_src = _balance(headers, "OXAPAY", "USDT")
        after_dst = _balance(headers, "BINANCE", "USDT")
        assert round(before_src - after_src, 2) == round(amt + 0.5, 2)
        assert round(after_dst - before_dst, 2) == round(amt - 0.5, 2)

    def test_convert_still_works(self, headers):
        before_btc = _balance(headers, "BINANCE", "BTC")
        before_usdt = _balance(headers, "BINANCE", "USDT")
        payload = {"from_coin": "BTC", "to_coin": "USDT", "from_amount": "0.0001",
                   "rate": "60000", "fee_amount": "0.1", "fee_currency": "USDT",
                   "notes": f"TEST_{TAG_PREFIX} conv"}
        r = requests.post(f"{BASE_URL}/api/wallets/BINANCE/convert",
                          json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), r.text[:300]
        after_btc = _balance(headers, "BINANCE", "BTC")
        after_usdt = _balance(headers, "BINANCE", "USDT")
        assert round(before_btc - after_btc, 6) == 0.0001
        assert round(after_usdt - before_usdt, 4) == round(0.0001 * 60000 - 0.1, 4)

    def test_cashout_still_works(self, headers):
        before_wio = _balance(headers, "WIO_BANK", "AED")
        payload = {"amount_aed": "100", "bank_fee_aed": "2",
                   "bank_reference": f"TEST_{TAG_PREFIX}_CASH_{uuid.uuid4().hex[:6]}",
                   "notes": f"TEST_{TAG_PREFIX} cashout"}
        r = requests.post(f"{BASE_URL}/api/wallets/BINANCE/cashout",
                          json=payload, headers=headers, timeout=20)
        assert r.status_code in (200, 201), r.text[:300]
        after_wio = _balance(headers, "WIO_BANK", "AED")
        assert round(after_wio - before_wio, 2) == 98.00

    def test_chain_search_still_returns_counts(self, headers):
        rs = requests.get(f"{BASE_URL}/api/recharges?limit=1", headers=headers, timeout=20)
        if rs.status_code != 200:
            pytest.skip("recharges unavailable")
        body = rs.json()
        rows = body if isinstance(body, list) else (body.get("rows") or body.get("data") or [])
        if not rows:
            pytest.skip("no recharges")
        code = rows[0].get("recharge_code") or rows[0].get("invoice_number")
        if not code:
            pytest.skip("no code")
        r = requests.get(f"{BASE_URL}/api/chain/search",
                        params={"q": code}, headers=headers, timeout=20)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "counts" in data
        if data["counts"]["recharges"] == 1:
            assert data.get("chain") is not None
