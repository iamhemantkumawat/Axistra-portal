"""
Axistra Compliance + Accounting Portal — Backend regression tests.

Covers:
- Auth (login, me, admin list/create)
- Dashboard (kpis, chart, recent)
- Customers CRUD
- Recharges CRUD + audit chain (crypto-tx, magnus sync match/mismatch)
- Invoices list + PDF
- Treasury (list, reconciliation, movement upsert)
- Expenses CRUD
- Reports (10 reports + CSV/Excel exports)
- Compliance (list + actions)
- Magnus (status/logs/lookups - placeholder mode)
- Audit logs
"""

import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code in (200, 201), f"login failed {r.status_code} {r.text}"
    body = r.json()
    assert "access_token" in body or "token" in body, body
    return body.get("access_token") or body.get("token")


@pytest.fixture(scope="session")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def seed_customer(client):
    payload = {
        "full_name": f"TEST_Customer_{uuid.uuid4().hex[:6]}",
        "email": f"test_{uuid.uuid4().hex[:6]}@axistra.test",
        "magnus_username": f"tuser_{uuid.uuid4().hex[:6]}",
        "country": "AE",
        "risk_level": "low",
        "kyc_status": "verified",
    }
    r = client.post(f"{API}/customers", json=payload)
    assert r.status_code in (200, 201), f"customer create {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def seed_recharge(client, seed_customer):
    payload = {
        "customer_id": seed_customer["id"],
        "amount": 500,
        "currency": "USD",
        "crypto_coin": "USDT",
        "crypto_network": "TRC20",
        "crypto_amount": 500,
        "tx_hash": f"0xTEST{uuid.uuid4().hex}",
        "payment_gateway": "Manual",
    }
    r = client.post(f"{API}/recharges", json=payload)
    assert r.status_code in (200, 201), f"recharge create {r.status_code} {r.text}"
    return r.json()


# ---------- Auth ----------
class TestAuth:
    def test_login_success(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code in (200, 201)
        body = r.json()
        assert body.get("access_token") or body.get("token")

    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"})
        assert r.status_code in (400, 401, 403)

    def test_me(self, client):
        r = client.get(f"{API}/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body.get("email") == ADMIN_EMAIL

    def test_admins_list(self, client):
        r = client.get(f"{API}/auth/admins")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_unauthorized(self):
        r = requests.get(f"{API}/customers")
        assert r.status_code in (401, 403)


# ---------- Dashboard ----------
class TestDashboard:
    def test_kpis(self, client):
        r = client.get(f"{API}/dashboard/kpis")
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_chart(self, client):
        r = client.get(f"{API}/dashboard/chart")
        assert r.status_code == 200

    def test_recent(self, client):
        r = client.get(f"{API}/dashboard/recent")
        assert r.status_code == 200


# ---------- Customers ----------
class TestCustomers:
    def test_list(self, client):
        r = client.get(f"{API}/customers")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_and_get(self, client, seed_customer):
        assert seed_customer.get("id")
        assert seed_customer.get("customer_code", "").startswith("AXC")
        r = client.get(f"{API}/customers/{seed_customer['id']}")
        assert r.status_code == 200
        assert r.json()["id"] == seed_customer["id"]

    def test_update(self, client, seed_customer):
        r = client.patch(f"{API}/customers/{seed_customer['id']}", json={"country": "US"})
        assert r.status_code == 200
        r2 = client.get(f"{API}/customers/{seed_customer['id']}")
        assert r2.json()["country"] == "US"

    def test_search(self, client, seed_customer):
        r = client.get(f"{API}/customers", params={"search": seed_customer["full_name"]})
        assert r.status_code == 200
        assert any(c["id"] == seed_customer["id"] for c in r.json())


# ---------- Recharges (audit chain) ----------
class TestRecharges:
    def test_list(self, client):
        r = client.get(f"{API}/recharges")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_invoice_autogen(self, client, seed_recharge):
        assert seed_recharge.get("recharge_code", "").startswith("RCH-")
        assert seed_recharge.get("invoice_number", "").startswith("AX-")
        assert seed_recharge.get("status") == "pending_payment"

    def test_get_with_relations(self, client, seed_recharge):
        r = client.get(f"{API}/recharges/{seed_recharge['id']}")
        assert r.status_code == 200
        d = r.json()
        assert d["invoice"] is not None
        assert "crypto_transactions" in d
        assert "treasury" in d

    def test_add_crypto_tx_advances_status(self, client, seed_recharge):
        r = client.post(f"{API}/recharges/{seed_recharge['id']}/crypto-tx", json={
            "crypto_amount": 500,
            "coin": "USDT",
            "network": "TRC20",
            "tx_hash": f"0xCRYPTO{uuid.uuid4().hex}",
            "receiving_wallet": "TXyzWalletABC",
        })
        assert r.status_code in (200, 201), r.text
        # Verify status
        r2 = client.get(f"{API}/recharges/{seed_recharge['id']}")
        assert r2.json()["status"] == "payment_received"

    def test_magnus_sync_match(self, client, seed_recharge):
        r = client.post(f"{API}/recharges/{seed_recharge['id']}/sync-magnus", json={
            "magnus_credit_added": 500,
            "magnus_reference_id": "MAG-TEST-1",
        })
        assert r.status_code in (200, 201), r.text
        r2 = client.get(f"{API}/recharges/{seed_recharge['id']}")
        assert r2.json()["status"] == "magnus_credited"

    def test_magnus_sync_mismatch(self, client, seed_customer):
        # Fresh recharge to test mismatch
        cr = client.post(f"{API}/recharges", json={
            "customer_id": seed_customer["id"], "amount": 200, "currency": "USD",
            "crypto_coin": "USDT", "crypto_network": "TRC20", "crypto_amount": 200,
            "tx_hash": f"0xMISMATCH{uuid.uuid4().hex}",
        })
        rid = cr.json()["id"]
        r = client.post(f"{API}/recharges/{rid}/sync-magnus", json={"magnus_credit_added": 180})
        assert r.status_code in (200, 201)
        d = client.get(f"{API}/recharges/{rid}").json()
        assert d["status"] == "mismatch"
        assert d.get("reconciliation_note")

    def test_update_status(self, client, seed_recharge):
        r = client.patch(f"{API}/recharges/{seed_recharge['id']}/status", json={"status": "fully_reconciled", "note": "test"})
        assert r.status_code == 200


# ---------- Invoices ----------
class TestInvoices:
    def test_list(self, client):
        r = client.get(f"{API}/invoices")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_and_pdf(self, client, seed_recharge):
        inv_id = seed_recharge["invoice_id"]
        r = client.get(f"{API}/invoices/{inv_id}")
        assert r.status_code == 200
        assert r.json()["invoice_number"].startswith("AX-")
        # PDF (or HTML fallback)
        rpdf = client.get(f"{API}/invoices/{inv_id}/pdf")
        assert rpdf.status_code == 200
        assert len(rpdf.content) > 100
        ctype = rpdf.headers.get("content-type", "")
        assert "pdf" in ctype or "html" in ctype


# ---------- Treasury ----------
class TestTreasury:
    def test_list(self, client):
        r = client.get(f"{API}/treasury")
        assert r.status_code == 200

    def test_reconciliation(self, client):
        r = client.get(f"{API}/treasury/reconciliation")
        assert r.status_code == 200

    def test_movement_upsert(self, client, seed_recharge):
        r = client.post(f"{API}/treasury/movement/{seed_recharge['id']}", json={
            "total_usdt_received": 500,
            "transferred_to_okx": True,
            "okx_conversion_rate": 3.67,
            "aed_received": 1835,
            "converted_to_aed": True,
            "transferred_to_wio": True,
            "wio_bank_reference": "WIO-TEST-001",
        })
        assert r.status_code in (200, 201), r.text


# ---------- Expenses ----------
class TestExpenses:
    def test_list(self, client):
        r = client.get(f"{API}/expenses")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create(self, client):
        r = client.post(f"{API}/expenses", json={
            "vendor_name": "TEST_VPS_Provider",
            "category": "VPS",
            "amount": 50,
            "currency": "USDT",
            "paid_in_usdt": True,
            "aed_rate": 3.67,
        })
        assert r.status_code in (200, 201), r.text
        return r.json()


# ---------- Reports ----------
class TestReports:
    @pytest.mark.parametrize("path", [
        "monthly-sales", "quarterly-sales", "yearly-pl", "customer-recharge",
        "crypto-to-aed", "bank-reconciliation", "vat-threshold",
        "corporate-tax", "expenses", "suspicious",
    ])
    def test_report(self, client, path):
        r = client.get(f"{API}/reports/{path}")
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"

    def test_csv_export(self, client):
        r = client.get(f"{API}/reports/export/csv", params={"report": "monthly-sales"})
        assert r.status_code == 200
        assert "csv" in r.headers.get("content-type", "")

    def test_excel_export(self, client):
        r = client.get(f"{API}/reports/export/excel", params={"report": "monthly-sales"})
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "") or "excel" in r.headers.get("content-type", "")


# ---------- Compliance ----------
class TestCompliance:
    def test_list(self, client):
        r = client.get(f"{API}/compliance")
        assert r.status_code == 200

    def test_log_action(self, client, seed_customer):
        r = client.post(f"{API}/compliance/log", json={
            "customer_id": seed_customer["id"],
            "action": "suspicious_note",
            "notes": "TEST_suspicious_activity_note",
        })
        assert r.status_code in (200, 201), r.text

    def test_mark_high_risk(self, client, seed_customer):
        r = client.post(f"{API}/compliance/mark-high-risk", json={
            "customer_id": seed_customer["id"], "notes": "TEST_high_risk"
        })
        assert r.status_code in (200, 201), r.text

    def test_request_kyc(self, client, seed_customer):
        r = client.post(f"{API}/compliance/request-kyc", json={
            "customer_id": seed_customer["id"], "notes": "TEST_kyc_request"
        })
        assert r.status_code in (200, 201), r.text


# ---------- Magnus (placeholder) ----------
class TestMagnus:
    def test_status(self, client):
        r = client.get(f"{API}/magnus/status")
        assert r.status_code == 200

    def test_logs(self, client):
        r = client.get(f"{API}/magnus/logs")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_user_lookup(self, client):
        r = client.get(f"{API}/magnus/user/someuser")
        # Placeholder mode — should return 200 (mock) or 404
        assert r.status_code in (200, 404)


# ---------- Audit logs ----------
class TestAuditLogs:
    def test_list(self, client):
        r = client.get(f"{API}/audit-logs")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        # Should have entries from previous test actions
        assert len(r.json()) > 0
