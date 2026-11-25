"""
Iteration 32 — Paused webhook release (confirm) + vendor defaults.
Uses QA admin (qa-admin@preview.local). Leaves both intake toggles ON.
DB cleanup of created recharge/invoice/customer/crypto tx/webhooks done via SQL by tester afterwards.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
SECRET = os.environ.get("TEST_PAYMENT_WEBHOOK_SECRET")
QA = {"email": os.environ.get("QA_EMAIL"), "password": os.environ.get("QA_PASSWORD"), "accept_terms": True}
STATE = {}


@pytest.fixture(scope="module")
def H():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=QA, timeout=30)
    if r.status_code not in (200, 201):
        pytest.skip(f"QA login failed {r.status_code} {r.text[:200]}")
    tok = r.json().get("token") or r.json().get("access_token")
    h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    yield h
    requests.put(f"{BASE_URL}/api/webhooks/intake-settings", json={"oxapay": True, "btcpay": True}, headers=h, timeout=30)
    if STATE.get("vendor_id"):
        requests.delete(f"{BASE_URL}/api/settings/vendors/{STATE['vendor_id']}", headers=h, timeout=30)


def wh(path, body):
    return requests.post(f"{BASE_URL}/api/webhooks/{path}", json=body,
                         headers={"x-axistra-webhook-secret": SECRET}, timeout=60)


# Paused intake + release
class TestPausedRelease:
    def test_oxapay_off_pauses(self, H):
        r = requests.put(f"{BASE_URL}/api/webhooks/intake-settings", json={"oxapay": False}, headers=H, timeout=30)
        assert r.status_code == 200 and r.json()["oxapay"] is False
        b = wh("oxapay", {"track_id": "TEST-QA-1", "status": "Paid", "amount": 7, "currency": "USD",
                          "email": "tqa@test.local", "description": "test"})
        assert b.status_code in (200, 201), b.text
        d = b.json()
        assert d.get("paused") is True and not d.get("recharge_id")
        STATE["wid"] = d["webhook_id"]

    def test_paused_listed(self, H):
        r = requests.get(f"{BASE_URL}/api/webhooks/logs", params={"processed": "paused"}, headers=H, timeout=30)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()["rows"]]
        assert STATE["wid"] in ids
        s = requests.get(f"{BASE_URL}/api/webhooks/logs/stats", headers=H, timeout=30).json()
        assert sum(x.get("paused", 0) for x in s["by_source"]) >= 1

    def test_preview(self, H):
        r = requests.get(f"{BASE_URL}/api/webhooks/logs/{STATE['wid']}", headers=H, timeout=30)
        assert r.status_code == 200
        p = r.json()["preview"]
        assert str(p["amount"]) == "7" and p["currency"] == "USD" and p["email"] == "tqa@test.local"
        assert p["paid"] is True

    def test_release_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/webhooks/logs/{STATE['wid']}/release", timeout=30)
        assert r.status_code == 401

    def test_release_404(self, H):
        r = requests.post(f"{BASE_URL}/api/webhooks/logs/00000000-0000-0000-0000-000000000000/release", headers=H, timeout=30)
        assert r.status_code in (400, 404), r.text

    def test_btcpay_off_pauses_and_informational_skipped(self, H):
        r = requests.put(f"{BASE_URL}/api/webhooks/intake-settings", json={"btcpay": False}, headers=H, timeout=30)
        assert r.json()["btcpay"] is False
        b = wh("recharge", {"source": "btcpay", "invoice_id": "TEST-QA-BTC-1", "status": "Settled",
                            "amount": 9, "currency": "USD", "email": "tqa@test.local"})
        assert b.status_code in (200, 201), b.text
        assert b.json().get("paused") is True
        STATE["bwid"] = b.json()["webhook_id"]
        i = wh("recharge", {"source": "btcpay", "type": "InvoiceCreated", "invoiceId": "TEST-QA-BTC-INFO", "storeId": "x",
                          "metadata": {"buyerEmail": "tqa@test.local"}})
        assert i.status_code in (200, 201), i.text
        STATE["iwid"] = i.json().get("webhook_id")
        r = requests.get(f"{BASE_URL}/api/webhooks/logs", params={"processed": "paused"}, headers=H, timeout=30)
        ids = [x["id"] for x in r.json()["rows"]]
        assert STATE["bwid"] in ids
        assert STATE["iwid"] not in ids


# Vendor defaults CRUD
class TestVendorDefaults:
    def test_create_vendor(self, H):
        body = {"name": "TEST Vendor QA API", "default_payment_method": "USDT", "default_wallet": "BINANCE",
                "default_currency": "USDT", "default_network": "TRC20", "default_vendor_wallet": "TTESTaddr123"}
        r = requests.post(f"{BASE_URL}/api/settings/vendors", json=body, headers=H, timeout=30)
        assert r.status_code in (200, 201), r.text
        v = r.json()
        STATE["vendor_id"] = v["id"]
        STATE["vendor"] = v
        assert v["default_vendor_wallet"] == "TTESTaddr123"
        assert v["default_currency"] == "USDT" and v["default_network"] == "TRC20"

    def test_update_vendor(self, H):
        r = requests.patch(f"{BASE_URL}/api/settings/vendors/{STATE['vendor_id']}",
                         json={"default_network": "ERC20"}, headers=H, timeout=30)
        assert r.status_code == 200, r.text
        lst = requests.get(f"{BASE_URL}/api/settings/vendors", headers=H, timeout=30).json()
        v = next(x for x in lst if x["id"] == STATE["vendor_id"])
        assert v["default_network"] == "ERC20"
        assert v["default_vendor_wallet"] == "TTESTaddr123"
        assert v["default_currency"] == "USDT"
