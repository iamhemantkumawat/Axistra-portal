"""
Iteration 10 tests — Expenses CRUD + wallet ledger linkage,
OxaPay ledger schema (original_coin/original_amount), sync-history endpoint.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "token" in body and isinstance(body["token"], str) and len(body["token"]) > 20
    return body["token"]


@pytest.fixture(scope="session")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- Auth sanity ----------
class TestAuth:
    def test_login_returns_jwt(self, token):
        # Two-segment dot separator check (header.payload.sig)
        assert token.count(".") == 2


# ---------- Vendor seed fixture ----------
@pytest.fixture(scope="module")
def vendor(H):
    payload = {
        "name": f"TEST_Vendor_{uuid.uuid4().hex[:6]}",
        "type": "Vendor",
        "default_payment_method": "Bank",
        "default_wallet": "WIO_BANK",
    }
    r = requests.post(f"{BASE_URL}/api/settings/vendors", headers=H, json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    v = r.json()
    yield v
    # teardown
    requests.delete(f"{BASE_URL}/api/settings/vendors/{v['id']}", headers=H, timeout=20)


def _ledger_rows_for_expense(H, wallet, expense_id):
    r = requests.get(f"{BASE_URL}/api/wallets/{wallet}/ledger", headers=H, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    rows = body.get("rows", body) if isinstance(body, dict) else body
    return [row for row in rows if row.get("linked_expense_id") == expense_id]


# ---------- Expenses CRUD + ledger linkage ----------
class TestExpensesCRUDLedger:
    def test_create_expense_creates_ledger_row(self, H, vendor):
        payload = {
            "expense_date": "2026-01-15",
            "vendor_id": vendor["id"],
            "category": "VPS",
            "amount": "150.00",
            "currency": "AED",
            "payment_method": "Bank",
            "bank_name": "Wio Bank",
            "tx_hash": f"TEST_REF_{uuid.uuid4().hex[:8]}",
            "notes": "iter10 create",
        }
        r = requests.post(f"{BASE_URL}/api/expenses", headers=H, json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        exp = r.json()
        assert exp["amount"] == "150.00"
        assert exp["vendor_name"] == vendor["name"]
        assert "id" in exp

        # ledger row exists, signed negative
        ledger_rows = _ledger_rows_for_expense(H, "WIO_BANK", exp["id"])
        assert len(ledger_rows) == 1, f"expected 1 ledger row, got {ledger_rows}"
        row = ledger_rows[0]
        assert row["tx_type"] == "expense"
        assert float(row["amount"]) == -150.00
        assert (row["coin"] or "").upper() == "AED"
        # cleanup
        requests.delete(f"{BASE_URL}/api/expenses/{exp['id']}", headers=H, timeout=20)

    def test_update_expense_recreates_ledger(self, H, vendor):
        # Create
        create = requests.post(f"{BASE_URL}/api/expenses", headers=H, json={
            "expense_date": "2026-01-15", "vendor_id": vendor["id"], "category": "Office",
            "amount": "200.00", "currency": "AED", "payment_method": "Bank",
            "bank_name": "Wio Bank", "notes": "iter10 update-before",
        }, timeout=20)
        assert create.status_code in (200, 201), create.text
        exp_id = create.json()["id"]

        rows = _ledger_rows_for_expense(H, "WIO_BANK", exp_id)
        assert len(rows) == 1
        assert float(rows[0]["amount"]) == -200.00

        # Update amount
        upd = requests.patch(f"{BASE_URL}/api/expenses/{exp_id}", headers=H, json={
            "amount": "275.50", "notes": "iter10 update-after",
        }, timeout=20)
        assert upd.status_code == 200, upd.text
        assert upd.json()["amount"] == "275.50"

        rows = _ledger_rows_for_expense(H, "WIO_BANK", exp_id)
        assert len(rows) == 1, f"expected exactly 1 ledger row after update, got {len(rows)}"
        assert float(rows[0]["amount"]) == -275.50

        # cleanup
        requests.delete(f"{BASE_URL}/api/expenses/{exp_id}", headers=H, timeout=20)

    def test_delete_expense_reverses_ledger(self, H, vendor):
        create = requests.post(f"{BASE_URL}/api/expenses", headers=H, json={
            "expense_date": "2026-01-15", "vendor_id": vendor["id"], "category": "Other",
            "amount": "99.99", "currency": "AED", "payment_method": "Bank",
            "bank_name": "Wio Bank",
        }, timeout=20)
        assert create.status_code in (200, 201), create.text
        exp_id = create.json()["id"]
        rows = _ledger_rows_for_expense(H, "WIO_BANK", exp_id)
        assert len(rows) == 1

        d = requests.delete(f"{BASE_URL}/api/expenses/{exp_id}", headers=H, timeout=20)
        assert d.status_code in (200, 204), d.text

        # Verify ledger rows are gone (no orphans)
        rows_after = _ledger_rows_for_expense(H, "WIO_BANK", exp_id)
        assert len(rows_after) == 0, f"orphan ledger rows after delete: {rows_after}"

        # Verify expense list no longer contains this id
        lst = requests.get(f"{BASE_URL}/api/expenses", headers=H, timeout=20).json()
        assert all(e["id"] != exp_id for e in lst)


# ---------- OxaPay ledger schema + sync endpoint ----------
class TestOxaPayLedgerSchema:
    def test_oxapay_ledger_schema_includes_original_fields(self, H):
        r = requests.get(f"{BASE_URL}/api/wallets/OXAPAY/ledger", headers=H, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        # Endpoint shape: either array or { rows, summary }
        rows = body.get("rows", body) if isinstance(body, dict) else body
        assert isinstance(rows, list)
        # If empty, schema can't be inspected — that's okay, but assert
        # the endpoint is reachable. To enforce schema, we look at the
        # column when at least one row exists.
        if rows:
            sample = rows[0]
            # Both keys should be present (may be None when not yet synced)
            assert "original_coin" in sample, f"missing original_coin in ledger row: {sample.keys()}"
            assert "original_amount" in sample, f"missing original_amount in ledger row: {sample.keys()}"

    def test_oxapay_sync_history_endpoint(self, H):
        r = requests.post(f"{BASE_URL}/api/webhooks/oxapay/sync-history", headers=H, timeout=60)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        # service returns { scanned, matched, errors, by_key, db_backfilled }
        for key in ("scanned", "matched", "errors", "by_key"):
            assert key in body, f"missing key {key}: got {body.keys()}"
        assert isinstance(body["by_key"], list)

    def test_oxapay_sync_requires_jwt(self):
        r = requests.post(f"{BASE_URL}/api/webhooks/oxapay/sync-history", timeout=20)
        assert r.status_code in (401, 403)
