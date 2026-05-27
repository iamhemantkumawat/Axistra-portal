"""
Backend regression tests for the Axistra Compliance + Accounting portal:
  - Receiving Wallets CRUD (Settings)
  - Vendors CRUD (Settings)
  - Recharges: auto-gateway detection from wallet address; Manual rejected
  - Expenses: vendor_id + BinancePay + source_wallet=BINANCE creates negative
    ledger row in BINANCE wallet; bank_name=Wio Bank debits WIO_BANK in AED
  - Light regression: customers list, recharges list, invoice PDF endpoint
"""
import os
import time
import requests
import pytest

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"

BINANCE_BTC_SEED = "129ifR1iQyY4fWkq3G8MXCMwReZZHhqfkt"
OKX_BTC_SEED = "bc1q3a4gskudn4kd3curm5yxjfnk2ey0zldv3v023wjyu29e0jwxg9ksx38sjj"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


# ---------------- Receiving Wallets ----------------
class TestReceivingWallets:
    def test_list_contains_seeded_btc_addresses(self, client):
        r = client.get(f"{BASE}/api/settings/receiving-wallets", timeout=20)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 2
        addresses = {w["address"] for w in rows}
        assert BINANCE_BTC_SEED in addresses, f"Binance BTC seed not found in {addresses}"
        assert OKX_BTC_SEED in addresses, f"OKX BTC seed not found in {addresses}"
        # gateway assignments correct
        binance_row = next(w for w in rows if w["address"] == BINANCE_BTC_SEED)
        okx_row = next(w for w in rows if w["address"] == OKX_BTC_SEED)
        assert binance_row["gateway"] == "Binance"
        assert okx_row["gateway"] == "OKX"
        assert binance_row["coin"].upper() == "BTC"
        assert okx_row["coin"].upper() == "BTC"

    def test_create_update_delete_wallet(self, client):
        payload = {
            "gateway": "Binance",
            "coin": "USDT",
            "network": "TRC20",
            "address": f"TEST_TRC20_{int(time.time())}",
            "label": "TEST wallet",
        }
        r = client.post(f"{BASE}/api/settings/receiving-wallets", json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        created = r.json()
        wid = created["id"]
        assert created["gateway"] == "Binance"
        assert created["coin"] == "USDT"
        assert created["network"] == "TRC20"
        assert created["address"] == payload["address"]

        # PATCH
        r = client.patch(f"{BASE}/api/settings/receiving-wallets/{wid}",
                         json={"label": "TEST renamed"}, timeout=20)
        assert r.status_code in (200, 201), r.text
        assert r.json()["label"] == "TEST renamed"

        # DELETE
        r = client.delete(f"{BASE}/api/settings/receiving-wallets/{wid}", timeout=20)
        assert r.status_code in (200, 204), r.text

    def test_create_wallet_rejects_bad_gateway(self, client):
        r = client.post(f"{BASE}/api/settings/receiving-wallets",
                        json={"gateway": "Manual", "coin": "BTC", "network": "BTC", "address": "x"},
                        timeout=20)
        assert r.status_code == 400, r.text

    def test_create_wallet_rejects_missing_fields(self, client):
        r = client.post(f"{BASE}/api/settings/receiving-wallets",
                        json={"gateway": "Binance"}, timeout=20)
        assert r.status_code == 400, r.text


# ---------------- Vendors ----------------
class TestVendors:
    def test_vendor_crud(self, client):
        name = f"TEST_Vendor_{int(time.time())}"
        r = client.post(f"{BASE}/api/settings/vendors",
                        json={"name": name, "type": "SaaS", "default_wallet": "BINANCE",
                              "default_payment_method": "BinancePay"},
                        timeout=20)
        assert r.status_code in (200, 201), r.text
        created = r.json()
        vid = created["id"]
        assert created["name"] == name

        # list contains it
        r = client.get(f"{BASE}/api/settings/vendors", timeout=20)
        assert r.status_code == 200
        assert any(v["id"] == vid for v in r.json())

        # PATCH
        r = client.patch(f"{BASE}/api/settings/vendors/{vid}",
                        json={"notes": "renamed by test"}, timeout=20)
        assert r.status_code in (200, 201), r.text
        assert r.json()["notes"] == "renamed by test"

        # DELETE
        r = client.delete(f"{BASE}/api/settings/vendors/{vid}", timeout=20)
        assert r.status_code in (200, 204), r.text

    def test_vendor_create_requires_name(self, client):
        r = client.post(f"{BASE}/api/settings/vendors", json={}, timeout=20)
        assert r.status_code == 400


# ---------------- Recharges ----------------
@pytest.fixture(scope="session")
def some_customer_id(client):
    r = client.get(f"{BASE}/api/customers", timeout=20)
    assert r.status_code == 200, r.text
    rows = r.json()
    rows = rows.get("items", rows) if isinstance(rows, dict) else rows
    assert isinstance(rows, list) and rows, "No customers seeded"
    return rows[0]["id"]


class TestRecharges:
    def test_create_with_binance_seed_address_auto_sets_gateway(self, client, some_customer_id):
        payload = {
            "customer_id": some_customer_id,
            "amount": "10.00",
            "currency": "USD",
            "crypto_amount": "0.0002",
            "crypto_coin": "BTC",
            "crypto_network": "BTC",
            "wallet_address": BINANCE_BTC_SEED,
            # NOTE: deliberately omitting payment_gateway → detection should kick in
        }
        r = client.post(f"{BASE}/api/recharges", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["payment_gateway"] == "Binance", body

    def test_create_with_manual_gateway_rejected(self, client, some_customer_id):
        payload = {
            "customer_id": some_customer_id,
            "amount": "10.00",
            "currency": "USD",
            "crypto_coin": "BTC",
            "crypto_network": "BTC",
            "wallet_address": "irrelevant",
            "payment_gateway": "Manual",
        }
        r = client.post(f"{BASE}/api/recharges", json=payload, timeout=30)
        assert r.status_code == 400, r.text

    def test_list_recharges_still_works(self, client):
        r = client.get(f"{BASE}/api/recharges", timeout=20)
        assert r.status_code == 200
        rows = r.json()
        rows = rows.get("items", rows) if isinstance(rows, dict) else rows
        assert isinstance(rows, list)


# ---------------- Expenses ----------------
@pytest.fixture(scope="session")
def vendor_for_expense(client):
    name = f"TEST_VENDOR_EXP_{int(time.time())}"
    r = client.post(f"{BASE}/api/settings/vendors",
                    json={"name": name, "type": "SaaS"}, timeout=20)
    assert r.status_code in (200, 201), r.text
    yield r.json()
    # cleanup
    client.delete(f"{BASE}/api/settings/vendors/{r.json()['id']}", timeout=20)


class TestExpenses:
    def test_binancepay_expense_debits_binance_ledger(self, client, vendor_for_expense):
        amount = "12.34"
        tx = f"TEST_TX_{int(time.time())}"
        payload = {
            "vendor_id": vendor_for_expense["id"],
            "amount": amount,
            "currency": "USDT",
            "payment_method": "BinancePay",
            "source_wallet": "BINANCE",
            "tx_hash": tx,
            "category": "SaaS",
        }
        r = client.post(f"{BASE}/api/expenses", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        exp = r.json()
        assert exp["source_wallet"] == "BINANCE"
        assert exp["payment_method"] == "BinancePay"

        # Ledger should now contain a negative -amount row linked to expense
        time.sleep(0.4)
        r = client.get(f"{BASE}/api/wallets/BINANCE/ledger", timeout=20)
        assert r.status_code == 200, r.text
        ledger = r.json()
        rows = ledger.get("rows", ledger.get("items", ledger)) if isinstance(ledger, dict) else ledger
        match = [row for row in rows if row.get("linked_expense_id") == exp["id"]]
        assert match, f"No ledger row linked to expense {exp['id']} in BINANCE wallet"
        amt = float(match[0]["amount"])
        assert amt < 0, f"Expected negative amount, got {amt}"
        assert abs(abs(amt) - float(amount)) < 0.001

    def test_bank_expense_debits_wio_aed(self, client, vendor_for_expense):
        amount = "75.00"
        payload = {
            "vendor_id": vendor_for_expense["id"],
            "amount": amount,
            "currency": "AED",
            "payment_method": "Bank",
            "bank_name": "Wio Bank",
            "category": "Other",
        }
        r = client.post(f"{BASE}/api/expenses", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        exp = r.json()
        assert exp["bank_name"] == "Wio Bank"
        assert exp["payment_method"] == "Bank"

        time.sleep(0.4)
        r = client.get(f"{BASE}/api/wallets/WIO_BANK/ledger", timeout=20)
        assert r.status_code == 200, r.text
        ledger = r.json()
        rows = ledger.get("rows", ledger.get("items", ledger)) if isinstance(ledger, dict) else ledger
        match = [row for row in rows if row.get("linked_expense_id") == exp["id"]]
        assert match, "No ledger row in WIO_BANK linked to bank expense"
        assert (match[0].get("coin") or "AED").upper() == "AED"
        assert float(match[0]["amount"]) < 0


# ---------------- Light regression ----------------
class TestRegression:
    def test_customers_list(self, client):
        r = client.get(f"{BASE}/api/customers", timeout=20)
        assert r.status_code == 200

    def test_wallets_overview(self, client):
        r = client.get(f"{BASE}/api/wallets/overview", timeout=20)
        assert r.status_code == 200
        body = r.json()
        rows = body.get("items", body) if isinstance(body, dict) else body
        assert isinstance(rows, list) and len(rows) >= 5

    def test_invoice_pdf_still_works(self, client):
        r = client.get(f"{BASE}/api/invoices?page=1&limit=1", timeout=20)
        assert r.status_code == 200
        rows = r.json()
        rows = rows.get("items", rows) if isinstance(rows, dict) else rows
        if not rows:
            pytest.skip("No invoices in DB")
        inv_id = rows[0]["id"]
        r = client.get(f"{BASE}/api/invoices/{inv_id}/pdf", timeout=60)
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"
