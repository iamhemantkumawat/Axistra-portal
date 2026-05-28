"""
Treasury → Wallet Ledger fan-out tests.

Validates:
  - Treasury upsertMovement writes paired ledger rows for each step (okx/aed/wio)
  - external_ref = movement-<recharge_id>-step-<step>
  - Idempotency (re-upsert + toggle off)
  - Cascade delete drops all movement-step ledger rows
  - OxaPay sync endpoint reachability
"""
import os
import time
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
    return r.json()["token"]


@pytest.fixture(scope="session")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def binance_wallet(H):
    r = requests.get(f"{BASE_URL}/api/settings/receiving-wallets", headers=H, timeout=20)
    assert r.status_code == 200
    rows = r.json()
    binance = next((w for w in rows if w["gateway"] == "Binance"), None)
    assert binance is not None
    return binance


def _create_customer(H):
    uniq = uuid.uuid4().hex[:6]
    payload = {
        "full_name": f"TEST_Fanout {uniq}",
        "first_name": "TEST",
        "last_name": f"Fanout{uniq}",
        "email": f"test_fanout_{uniq}@example.com",
        "phone": f"+97150{uniq}",
        "country": "AE",
        "magnus_username": f"test_fanout_{uniq}",
    }
    r = requests.post(f"{BASE_URL}/api/customers", headers=H, json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _create_recharge(H, customer_id, wallet):
    payload = {
        "customer_id": customer_id,
        "payment_gateway": "Binance",
        "amount": "1000.00",
        "currency": "AED",
        "crypto_coin": "USDT",
        "crypto_network": "TRC20",
        "crypto_amount": "272.50",
        "wallet_address": wallet["address"],
    }
    r = requests.post(f"{BASE_URL}/api/recharges", headers=H, json=payload, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _set_tx(H, recharge_id, tx_hash, wallet_addr):
    r = requests.post(f"{BASE_URL}/api/recharges/{recharge_id}/crypto-tx",
                      headers=H, json={"tx_hash": tx_hash, "coin": "USDT",
                                       "network": "TRC20",
                                       "crypto_amount": "272.50",
                                       "received_wallet": "BINANCE",
                                       "receiving_wallet": wallet_addr},
                      timeout=20)
    assert r.status_code in (200, 201), r.text


def _sync_magnus(H, recharge_id):
    r = requests.post(f"{BASE_URL}/api/recharges/{recharge_id}/sync-magnus",
                      headers=H, json={"magnus_credit_added": "1000.00"}, timeout=20)
    assert r.status_code in (200, 201), r.text


def _ledger_rows(H, wallet_code, recharge_id):
    """Fetch ledger rows for a wallet filtered by linked recharge."""
    r = requests.get(f"{BASE_URL}/api/wallets/{wallet_code}/ledger?limit=500",
                     headers=H, timeout=20)
    assert r.status_code == 200, r.text
    rows = r.json().get("rows", [])
    return [x for x in rows if x.get("linked_recharge_id") == recharge_id]


@pytest.fixture(scope="module")
def chain(H, binance_wallet):
    """Build customer + recharge ready for treasury steps."""
    cust = _create_customer(H)
    rch = _create_recharge(H, cust["id"], binance_wallet)
    tx_hash = "TEST_" + uuid.uuid4().hex[:32]
    _set_tx(H, rch["id"], tx_hash, binance_wallet["address"])
    _sync_magnus(H, rch["id"])
    yield {"customer": cust, "recharge": rch, "tx_hash": tx_hash}
    # cleanup
    requests.delete(f"{BASE_URL}/api/recharges/{rch['id']}", headers=H, timeout=20)
    requests.delete(f"{BASE_URL}/api/customers/{cust['id']}", headers=H, timeout=20)


# ----- Treasury Fan-out -----

class TestTreasuryFanout:
    def test_okx_step_writes_pair(self, H, chain):
        rid = chain["recharge"]["id"]
        body = {
            "transferred_to_okx": True,
            "okx_deposit_tx_hash": "0xokxhash_" + uuid.uuid4().hex[:16],
            "total_usdt_received": "272.50",
            "okx_account_reference": "OKX-MAIN-001",
        }
        r = requests.post(f"{BASE_URL}/api/treasury/movement/{rid}",
                          headers=H, json=body, timeout=30)
        assert r.status_code in (200, 201), r.text

        # Binance (source) should have -272.50 batch_out
        bin_rows = [x for x in _ledger_rows(H, "BINANCE", rid)
                    if x["external_ref"] == f"movement-{rid}-step-okx"]
        okx_rows = [x for x in _ledger_rows(H, "OKX", rid)
                    if x["external_ref"] == f"movement-{rid}-step-okx"]
        assert len(bin_rows) == 1, f"Expected 1 BINANCE out row, got {len(bin_rows)}: {bin_rows}"
        assert len(okx_rows) == 1
        assert bin_rows[0]["tx_type"] == "batch_out"
        assert float(bin_rows[0]["amount"]) == pytest.approx(-272.50)
        assert okx_rows[0]["tx_type"] == "batch_in"
        assert float(okx_rows[0]["amount"]) == pytest.approx(272.50)

    def test_aed_step_writes_pair(self, H, chain):
        rid = chain["recharge"]["id"]
        body = {
            "transferred_to_okx": True,
            "okx_deposit_tx_hash": "0xokxhash_static",
            "total_usdt_received": "272.50",
            "converted_to_aed": True,
            "usdt_converted": "272.50",
            "okx_conversion_rate": "3.67",
            "aed_received": "1000.07",
        }
        r = requests.post(f"{BASE_URL}/api/treasury/movement/{rid}",
                          headers=H, json=body, timeout=30)
        assert r.status_code in (200, 201), r.text
        okx_rows = [x for x in _ledger_rows(H, "OKX", rid)
                    if x["external_ref"] == f"movement-{rid}-step-aed"]
        assert len(okx_rows) == 2, f"Expected pair on OKX, got {len(okx_rows)}"
        types = sorted(x["tx_type"] for x in okx_rows)
        assert types == ["convert_from", "convert_to"]
        amounts = {x["coin"]: float(x["amount"]) for x in okx_rows}
        assert amounts["USDT"] == pytest.approx(-272.50)
        assert amounts["AED"] == pytest.approx(1000.07)

    def test_wio_step_writes_pair(self, H, chain):
        rid = chain["recharge"]["id"]
        body = {
            "transferred_to_okx": True,
            "okx_deposit_tx_hash": "0xokxhash_static",
            "total_usdt_received": "272.50",
            "converted_to_aed": True,
            "usdt_converted": "272.50",
            "okx_conversion_rate": "3.67",
            "aed_received": "1000.07",
            "transferred_to_wio": True,
            "wio_aed_amount": "1000.07",
            "wio_bank_reference": "WIO-TEST-001",
            "wio_deposit_date": "2026-01-15",
        }
        r = requests.post(f"{BASE_URL}/api/treasury/movement/{rid}",
                          headers=H, json=body, timeout=30)
        assert r.status_code in (200, 201), r.text
        okx_aed = [x for x in _ledger_rows(H, "OKX", rid)
                   if x["external_ref"] == f"movement-{rid}-step-wio"]
        wio_rows = [x for x in _ledger_rows(H, "WIO_BANK", rid)
                    if x["external_ref"] == f"movement-{rid}-step-wio"]
        assert len(okx_aed) == 1 and okx_aed[0]["tx_type"] == "cashout"
        assert float(okx_aed[0]["amount"]) == pytest.approx(-1000.07)
        assert len(wio_rows) == 1 and wio_rows[0]["tx_type"] == "bank_deposit"
        assert float(wio_rows[0]["amount"]) == pytest.approx(1000.07)

    def test_idempotency_no_duplicates(self, H, chain):
        """Re-POST same body — counts must not grow."""
        rid = chain["recharge"]["id"]
        body = {
            "transferred_to_okx": True,
            "okx_deposit_tx_hash": "0xokxhash_static",
            "total_usdt_received": "272.50",
            "converted_to_aed": True,
            "usdt_converted": "272.50",
            "okx_conversion_rate": "3.67",
            "aed_received": "1000.07",
            "transferred_to_wio": True,
            "wio_aed_amount": "1000.07",
            "wio_bank_reference": "WIO-TEST-001",
            "wio_deposit_date": "2026-01-15",
        }
        r1 = requests.post(f"{BASE_URL}/api/treasury/movement/{rid}", headers=H, json=body, timeout=30)
        assert r1.status_code in (200, 201)
        r2 = requests.post(f"{BASE_URL}/api/treasury/movement/{rid}", headers=H, json=body, timeout=30)
        assert r2.status_code in (200, 201)
        for code, expected in [("BINANCE", 1), ("OKX", 4), ("WIO_BANK", 1)]:
            rows = [x for x in _ledger_rows(H, code, rid)
                    if (x.get("external_ref") or "").startswith(f"movement-{rid}-step-")]
            assert len(rows) == expected, f"{code} expected {expected} rows, got {len(rows)}"

    def test_toggle_off_deletes_pair(self, H, chain):
        rid = chain["recharge"]["id"]
        # Toggle wio OFF
        body = {
            "transferred_to_okx": True,
            "okx_deposit_tx_hash": "0xokxhash_static",
            "total_usdt_received": "272.50",
            "converted_to_aed": True,
            "usdt_converted": "272.50",
            "okx_conversion_rate": "3.67",
            "aed_received": "1000.07",
            "transferred_to_wio": False,
        }
        r = requests.post(f"{BASE_URL}/api/treasury/movement/{rid}", headers=H, json=body, timeout=30)
        assert r.status_code in (200, 201), r.text
        wio_rows = [x for x in _ledger_rows(H, "WIO_BANK", rid)
                    if x.get("external_ref") == f"movement-{rid}-step-wio"]
        assert len(wio_rows) == 0, f"Expected wio pair deleted, got {wio_rows}"


# ----- Cascade Delete -----

class TestCascadeDelete:
    def test_recharge_delete_drops_movement_ledger(self, H, binance_wallet):
        cust = _create_customer(H)
        rch = _create_recharge(H, cust["id"], binance_wallet)
        try:
            _set_tx(H, rch["id"], "TEST_" + uuid.uuid4().hex[:32], binance_wallet["address"])
            _sync_magnus(H, rch["id"])
            body = {
                "transferred_to_okx": True,
                "okx_deposit_tx_hash": "0xokxdel_" + uuid.uuid4().hex[:8],
                "total_usdt_received": "272.50",
                "converted_to_aed": True,
                "usdt_converted": "272.50",
                "okx_conversion_rate": "3.67",
                "aed_received": "1000.07",
                "transferred_to_wio": True,
                "wio_aed_amount": "1000.07",
                "wio_bank_reference": "WIO-DEL-001",
                "wio_deposit_date": "2026-01-15",
            }
            r = requests.post(f"{BASE_URL}/api/treasury/movement/{rch['id']}",
                              headers=H, json=body, timeout=30)
            assert r.status_code in (200, 201)
            # Confirm rows exist
            before = (
                len(_ledger_rows(H, "BINANCE", rch["id"]))
                + len(_ledger_rows(H, "OKX", rch["id"]))
                + len(_ledger_rows(H, "WIO_BANK", rch["id"]))
            )
            assert before >= 5
            # Delete recharge
            rd = requests.delete(f"{BASE_URL}/api/recharges/{rch['id']}", headers=H, timeout=20)
            assert rd.status_code in (200, 204), rd.text
            # Confirm zero orphan rows
            after = (
                len(_ledger_rows(H, "BINANCE", rch["id"]))
                + len(_ledger_rows(H, "OKX", rch["id"]))
                + len(_ledger_rows(H, "WIO_BANK", rch["id"]))
            )
            assert after == 0, f"Orphan ledger rows after delete: {after}"
        finally:
            requests.delete(f"{BASE_URL}/api/customers/{cust['id']}", headers=H, timeout=20)


# ----- OxaPay Sync Endpoint -----

class TestOxaPaySync:
    def test_sync_endpoint_requires_jwt(self):
        r = requests.post(f"{BASE_URL}/api/webhooks/oxapay/sync-history", timeout=20)
        assert r.status_code in (401, 403), r.status_code

    def test_sync_endpoint_returns_summary(self, H):
        r = requests.post(f"{BASE_URL}/api/webhooks/oxapay/sync-history",
                          headers=H, json={}, timeout=60)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        for k in ("scanned", "matched", "errors", "by_key"):
            assert k in data, f"Missing key {k} in {data}"
        assert isinstance(data["by_key"], list)
        # errors must be 0 (API reachability OK) per spec
        assert data["errors"] == 0, f"OxaPay sync had errors: {data}"


# ----- Gap-fill regression (session 8) -----

class TestGapfillRegression:
    def test_customer_code_reuses_smallest_slot(self, H):
        created = []
        try:
            for i in range(3):
                c = _create_customer(H)
                created.append(c)
            codes_before = [c["customer_code"] for c in created]
            # Delete middle
            mid = created[1]
            r = requests.delete(f"{BASE_URL}/api/customers/{mid['id']}", headers=H, timeout=20)
            assert r.status_code in (200, 204)
            created.pop(1)
            # New one should reuse the freed code
            c_new = _create_customer(H)
            created.append(c_new)
            assert c_new["customer_code"] == mid["customer_code"], (
                f"Expected reuse of {mid['customer_code']}, got {c_new['customer_code']}"
            )
        finally:
            for c in created:
                requests.delete(f"{BASE_URL}/api/customers/{c['id']}", headers=H, timeout=20)
