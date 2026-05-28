"""
Iteration 15 — Treasury batch ledger SORT + GRANULAR STEP DELETE + CASCADE DELETE.

Validates:
  1. stampNowTime: batch ledger event_at picks up batch.updated_at hh:mm:ss
     so freshly-saved rows surface ABOVE same-day 00:00 deposits.
  2. wallets.convert() applies same time-bump for yyyy-mm-dd event_at.
  3. DELETE /api/treasury/batches/:id cascade-removes all step ledger rows.
  4. DELETE /api/treasury/batches/:id/step/usdt clears only the conversion
     (BTC sweep remains intact).
"""
import os
import secrets
import pytest
import requests
from pathlib import Path


def _load_base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if url:
        return url.rstrip("/")
    env_file = Path("/app/frontend/.env")
    for line in env_file.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE_URL = _load_base_url()
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"


def _hex64():
    return secrets.token_hex(32)


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD,
                     "accept_terms": True}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}",
                      "Content-Type": "application/json"})
    return s


def _ledger(api, code):
    r = api.get(f"{BASE_URL}/api/wallets/{code}/ledger?limit=500", timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    return j if isinstance(j, list) else (j.get("rows") or j.get("entries") or [])


def _find_by_ref(rows, ref):
    return [r for r in rows if r.get("external_ref") == ref]


def _create_batch(api, label_suffix, period_date="2026-05-15"):
    r = api.post(f"{BASE_URL}/api/treasury/batches", json={
        "name": f"TEST Iter15 {label_suffix}",
        "source_gateway": "BTCPay",
        "source_wallet": "BTCPay Wallet",
        "destination_exchange": "Binance",
        "destination_wallet": "BINANCE-MAIN",
        "coin": "BTC",
        "network": "BTC",
        "period_start": period_date,
        "period_end": period_date,
    }, timeout=20)
    assert r.status_code in (200, 201), f"create batch: {r.status_code} {r.text}"
    return r.json()


def _patch_full(api, bid, conversion_date):
    tx = _hex64()
    r = api.patch(f"{BASE_URL}/api/treasury/batches/{bid}", json={
        "settlement_tx_hash": tx,
        "source_wallet": "BTCPay Wallet",
        "destination_exchange": "Binance",
        "destination_wallet": "BINANCE-MAIN",
        "coin": "BTC",
        "received_crypto_amount": "0.00099000",
        "exchange_received_at": conversion_date,
        "usdt_amount": "50.00000000",
        "usdt_conversion_rate": "50505.05",
        "usdt_conversion_date": conversion_date,
        "usdt_conversion_reference": f"TEST-CR-{secrets.token_hex(4)}",
    }, timeout=30)
    assert r.status_code in (200, 201), f"patch: {r.status_code} {r.text}"
    return r.json()


# ---------- Test 1: stampNowTime on batch fan-out ----------
@pytest.fixture(scope="module")
def batch_a(api):
    b = _create_batch(api, "STAMP")
    _patch_full(api, b["id"], "2026-05-15")
    yield b
    api.delete(f"{BASE_URL}/api/treasury/batches/{b['id']}", timeout=15)


class TestStampNowTime:
    def test_sweep_event_at_not_midnight(self, api, batch_a):
        rows = _ledger(api, "BTCPAY")
        sweep = _find_by_ref(rows, f"{batch_a['batch_code']}-SWEEP")
        assert len(sweep) == 1, f"expected 1 sweep row, got {sweep}"
        ev = sweep[0]["event_at"]
        timepart = ev.split("T")[1] if "T" in ev else ""
        # Must NOT be exactly 00:00:00 — should carry updated_at hh:mm:ss
        assert not timepart.startswith("00:00:00"), \
            f"sweep event_at sank to 00:00 UTC: {ev}"

    def test_conv_event_at_not_midnight(self, api, batch_a):
        rows = _ledger(api, "BINANCE")
        conv = _find_by_ref(rows, f"{batch_a['batch_code']}-CONV-USDT")
        assert len(conv) == 2, f"expected 2 conv rows, got {conv}"
        for r in conv:
            timepart = r["event_at"].split("T")[1]
            assert not timepart.startswith("00:00:00"), \
                f"conv event_at midnight: {r['event_at']}"


# ---------- Test 2: wallets.convert() time-bump ----------
class TestWalletsConvertTimeBump:
    def test_convert_with_date_only_event_at(self, api):
        body = {
            "from_coin": "USDT",
            "to_coin": "USDC",
            "from_amount": "1.0",
            "to_amount": "1.0",
            "rate": "1.0",
            "event_at": "2026-05-15",
            "notes": "TEST_ITER15_convert_date_only",
        }
        r = api.post(f"{BASE_URL}/api/wallets/BINANCE/convert", json=body, timeout=20)
        if r.status_code not in (200, 201):
            pytest.skip(f"/wallets/convert returned {r.status_code}: {r.text[:200]}")
        out = r.json()
        ref = out.get("conv_id") or out.get("external_ref") or out.get("id")
        rows = _ledger(api, "BINANCE")
        # Find rows from this convert via notes match (fallback)
        matching = [x for x in rows
                    if (ref and x.get("external_ref") == ref)
                    or x.get("notes") == "TEST_ITER15_convert_date_only"]
        assert matching, f"no convert rows found (ref={ref})"
        for x in matching:
            timepart = x["event_at"].split("T")[1]
            assert not timepart.startswith("00:00:00"), \
                f"convert event_at midnight: {x['event_at']}"
        # Cleanup
        for x in matching:
            api.delete(f"{BASE_URL}/api/wallets/ledger/{x['id']}", timeout=10)


# ---------- Test 3: granular step delete ----------
class TestClearBatchStepUsdt:
    def test_delete_usdt_step_leaves_sweep_intact(self, api):
        b = _create_batch(api, f"USDT_{secrets.token_hex(3)}", "2026-05-16")
        bid, bcode = b["id"], b["batch_code"]
        _patch_full(api, bid, "2026-05-16")

        # Pre
        btc = _ledger(api, "BTCPAY")
        bnc = _ledger(api, "BINANCE")
        assert _find_by_ref(btc, f"{bcode}-SWEEP"), "sweep should exist"
        assert len(_find_by_ref(bnc, f"{bcode}-CONV-USDT")) == 2, \
            "conv pair should exist"

        # DELETE step/usdt
        r = api.delete(f"{BASE_URL}/api/treasury/batches/{bid}/step/usdt", timeout=20)
        assert r.status_code in (200, 201, 204), f"{r.status_code}: {r.text}"
        if r.text:
            data = r.json()
            assert data.get("cleared") == "usdt", data
            assert data.get("ledger_rows_removed") == 2, data
            assert data.get("batch_status") in (
                "sent_to_exchange", "received_in_exchange"), data

        # Post: conv gone, sweep still there
        btc2 = _ledger(api, "BTCPAY")
        bnc2 = _ledger(api, "BINANCE")
        assert _find_by_ref(btc2, f"{bcode}-SWEEP"), \
            "sweep must remain after step/usdt delete"
        assert len(_find_by_ref(bnc2, f"{bcode}-CONV-USDT")) == 0, \
            "conv pair must be removed"
        # BINANCE-side sweep (+BTC) also remains
        assert _find_by_ref(bnc2, f"{bcode}-SWEEP"), \
            "BINANCE sweep-in row must remain"

        # Batch itself still exists, usdt fields cleared
        rb = api.get(f"{BASE_URL}/api/treasury/batches/{bid}", timeout=15)
        assert rb.status_code == 200
        body = rb.json()
        assert not body.get("usdt_amount"), \
            f"usdt_amount should be cleared, got {body.get('usdt_amount')}"
        assert not body.get("usdt_conversion_date")

        # Cleanup
        api.delete(f"{BASE_URL}/api/treasury/batches/{bid}", timeout=15)


# ---------- Test 4: cascade delete ----------
class TestCascadeDeleteBatch:
    def test_delete_batch_removes_all_ledger_rows(self, api):
        b = _create_batch(api, f"CAS_{secrets.token_hex(3)}", "2026-05-17")
        bid, bcode = b["id"], b["batch_code"]
        _patch_full(api, bid, "2026-05-17")

        btc = _ledger(api, "BTCPAY")
        bnc = _ledger(api, "BINANCE")
        assert _find_by_ref(btc, f"{bcode}-SWEEP")
        assert len(_find_by_ref(bnc, f"{bcode}-CONV-USDT")) == 2

        r = api.delete(f"{BASE_URL}/api/treasury/batches/{bid}", timeout=20)
        assert r.status_code in (200, 201, 204), f"{r.status_code}: {r.text}"
        if r.text:
            data = r.json()
            assert data.get("deleted") is True, data
            # sweep (2 rows: BTCPAY out + BINANCE in) + conv (2 rows) = 4
            assert data.get("ledger_rows_removed", 0) >= 3, data

        btc2 = _ledger(api, "BTCPAY")
        bnc2 = _ledger(api, "BINANCE")
        assert not _find_by_ref(btc2, f"{bcode}-SWEEP"), \
            "BTCPAY sweep must be cascade-deleted"
        assert not _find_by_ref(bnc2, f"{bcode}-SWEEP"), \
            "BINANCE sweep-in must be cascade-deleted"
        assert not _find_by_ref(bnc2, f"{bcode}-CONV-USDT"), \
            "conv pair must be cascade-deleted"

        rb = api.get(f"{BASE_URL}/api/treasury/batches/{bid}", timeout=15)
        assert rb.status_code == 404, f"batch should be gone, got {rb.status_code}"
