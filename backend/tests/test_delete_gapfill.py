"""Backend tests for DELETE + gap-fill numbering across recharges/invoices/customers.

Covers iteration 8 work: cascade deletes, gap-fill reuse of smallest free code,
and the BadRequest guard on invoice delete when linked to a recharge.
"""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
EMAIL = "admin@axistratech.com"
PASSWORD = "admin123"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, f"No token in {r.json()}"
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def wallet_address(auth_headers):
    r = requests.get(f"{BASE_URL}/api/settings/receiving-wallets", headers=auth_headers)
    assert r.status_code == 200
    wallets = r.json()
    binance = next((w for w in wallets if w["gateway"] == "Binance"), wallets[0])
    return binance["address"]


def _make_customer(headers, suffix):
    payload = {
        "first_name": f"TestF{suffix}",
        "last_name": f"TestL{suffix}",
        "email": f"TEST_{suffix}_{int(time.time()*1000)}@example.com",
        "phone": "+971500000000",
        "country": "AE",
        "magnus_username": f"magnus_{suffix}_{int(time.time()*1000)}",
    }
    r = requests.post(f"{BASE_URL}/api/customers", headers=headers, json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _make_recharge(headers, customer_id, wallet_address, amount="100.00"):
    payload = {
        "customer_id": customer_id,
        "amount": amount,
        "currency": "USD",
        "crypto_amount": "100",
        "crypto_coin": "USDT",
        "crypto_network": "TRC20",
        "wallet_address": wallet_address,
        "payment_gateway": "Binance",
    }
    r = requests.post(f"{BASE_URL}/api/recharges", headers=headers, json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _tail_number(code):
    m = re.search(r"(\d+)$", code or "")
    return int(m.group(1)) if m else None


# --- Customer gap-fill -------------------------------------------------------
class TestCustomerGapFill:
    def test_customer_code_gap_fill(self, auth_headers):
        a = _make_customer(auth_headers, "gapA")
        b = _make_customer(auth_headers, "gapB")
        c = _make_customer(auth_headers, "gapC")
        codes = [a["customer_code"], b["customer_code"], c["customer_code"]]
        nums = [_tail_number(x) for x in codes]
        assert all(n is not None for n in nums)
        # Delete the middle one
        del_r = requests.delete(f"{BASE_URL}/api/customers/{b['id']}", headers=auth_headers)
        assert del_r.status_code in (200, 204), del_r.text
        body = del_r.json()
        assert body.get("success") is True
        assert body.get("customer_code") == b["customer_code"]
        assert "cascaded_recharges" in body

        # New customer should reuse the freed slot (smallest free)
        d = _make_customer(auth_headers, "gapD")
        assert d["customer_code"] == b["customer_code"], (
            f"Expected reuse {b['customer_code']}, got {d['customer_code']}"
        )

        # cleanup
        for x in (a, c, d):
            requests.delete(f"{BASE_URL}/api/customers/{x['id']}", headers=auth_headers)


# --- Recharge + invoice gap-fill + delete cascade ----------------------------
class TestRechargeAndInvoiceGapFill:
    def test_recharge_delete_cascade_and_gap_fill(self, auth_headers, wallet_address):
        # Create a customer + recharge
        cust = _make_customer(auth_headers, "rch")
        r1 = _make_recharge(auth_headers, cust["id"], wallet_address)
        r2 = _make_recharge(auth_headers, cust["id"], wallet_address)
        r3 = _make_recharge(auth_headers, cust["id"], wallet_address)

        r1_code = r1["recharge_code"]
        r2_code = r2["recharge_code"]
        r3_code = r3["recharge_code"]
        r2_invoice_number = r2["invoice_number"]
        r2_invoice_id = r2["invoice_id"]

        # Verify invoice still exists pre-delete
        inv_r = requests.get(f"{BASE_URL}/api/invoices/{r2_invoice_id}", headers=auth_headers)
        assert inv_r.status_code == 200

        # Delete middle recharge -> should cascade-delete invoice too
        d = requests.delete(f"{BASE_URL}/api/recharges/{r2['id']}", headers=auth_headers)
        assert d.status_code in (200, 204), d.text
        assert d.json().get("success") is True
        assert d.json().get("recharge_code") == r2_code

        # Invoice should be gone
        inv_after = requests.get(f"{BASE_URL}/api/invoices/{r2_invoice_id}", headers=auth_headers)
        assert inv_after.status_code == 404, f"Invoice should be cascade-deleted: {inv_after.status_code}"

        # Recharge no longer exists
        get_r2 = requests.get(f"{BASE_URL}/api/recharges/{r2['id']}", headers=auth_headers)
        assert get_r2.status_code == 404

        # Create new recharge -> should REUSE the freed recharge_code AND invoice_number
        r4 = _make_recharge(auth_headers, cust["id"], wallet_address)
        assert r4["recharge_code"] == r2_code, f"Expected gap-fill to reuse {r2_code}, got {r4['recharge_code']}"
        assert r4["invoice_number"] == r2_invoice_number, (
            f"Expected invoice gap-fill to reuse {r2_invoice_number}, got {r4['invoice_number']}"
        )

        # Cleanup: delete the customer -> cascades remaining recharges
        cleanup = requests.delete(f"{BASE_URL}/api/customers/{cust['id']}", headers=auth_headers)
        assert cleanup.status_code in (200, 204)
        body = cleanup.json()
        assert body.get("cascaded_recharges", 0) >= 1


# --- Invoice delete guard ----------------------------------------------------
class TestInvoiceDeleteGuard:
    def test_cannot_delete_invoice_linked_to_recharge(self, auth_headers, wallet_address):
        cust = _make_customer(auth_headers, "invguard")
        rch = _make_recharge(auth_headers, cust["id"], wallet_address)
        invoice_id = rch["invoice_id"]

        # Direct invoice delete should be blocked
        d = requests.delete(f"{BASE_URL}/api/invoices/{invoice_id}", headers=auth_headers)
        assert d.status_code == 400, f"Expected 400 BadRequest, got {d.status_code} {d.text}"
        body = d.json()
        msg = body.get("message") or body.get("detail") or ""
        assert "recharge" in str(msg).lower(), f"Error should mention recharge: {body}"

        # cleanup
        requests.delete(f"{BASE_URL}/api/customers/{cust['id']}", headers=auth_headers)

    def test_can_delete_standalone_invoice(self, auth_headers):
        cust = _make_customer(auth_headers, "invstandalone")
        # Generate a standalone invoice (not via recharge)
        r = requests.post(
            f"{BASE_URL}/api/invoices/generate",
            headers=auth_headers,
            json={"customer_id": cust["id"], "amount": "50.00", "currency": "USD"},
        )
        assert r.status_code in (200, 201), r.text
        invoice = r.json()
        d = requests.delete(f"{BASE_URL}/api/invoices/{invoice['id']}", headers=auth_headers)
        assert d.status_code in (200, 204), d.text
        # cleanup
        requests.delete(f"{BASE_URL}/api/customers/{cust['id']}", headers=auth_headers)


# --- Customer delete cascades whole chain ------------------------------------
class TestCustomerCascade:
    def test_delete_customer_cascades_recharges_and_invoices(self, auth_headers, wallet_address):
        cust = _make_customer(auth_headers, "cascadeC")
        rch1 = _make_recharge(auth_headers, cust["id"], wallet_address)
        rch2 = _make_recharge(auth_headers, cust["id"], wallet_address)
        d = requests.delete(f"{BASE_URL}/api/customers/{cust['id']}", headers=auth_headers)
        assert d.status_code in (200, 204), d.text
        body = d.json()
        assert body.get("success") is True
        assert body.get("cascaded_recharges") == 2
        # All linked recharges gone
        for rch in (rch1, rch2):
            assert requests.get(f"{BASE_URL}/api/recharges/{rch['id']}", headers=auth_headers).status_code == 404
            assert requests.get(f"{BASE_URL}/api/invoices/{rch['invoice_id']}", headers=auth_headers).status_code == 404
