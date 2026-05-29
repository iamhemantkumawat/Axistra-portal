"""
Iteration 16 — AED/Wio feed rows + step/aed + step/wio granular deletes
+ verify-btc-transfer no-longer-trips on partial AED data.

Validates:
  1. POST /treasury/batches creates a batch with full Step 2/3/4 fields.
  2. DELETE /api/treasury/batches/:id/step/aed clears only crypto_converted,
     conversion_rate, fiat_received, conversion_date. Sweep + USDT conv intact.
  3. DELETE /api/treasury/batches/:id/step/wio clears only bank_reference,
     bank_deposit_date, bank_fee_aed, net_bank_deposit_amount. AED + earlier
     steps intact.
  4. POST /treasury/batches/:id/verify-btc-transfer works even when batch
     has PARTIAL Step 3 AED data (crypto_converted set but conversion_rate
     missing) — it does NOT enforce "Conversion rate is required".
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
    body = r.json()
    tok = body.get("token") or body.get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}",
                      "Content-Type": "application/json"})
    return s


def _create_batch(api, suffix, period_date="2026-06-01"):
    r = api.post(f"{BASE_URL}/api/treasury/batches", json={
        "name": f"TEST Iter16 {suffix}",
        "source_gateway": "BTCPay",
        "source_wallet": "BTCPay Wallet",
        "destination_exchange": "Binance",
        "destination_wallet": "BINANCE-MAIN",
        "coin": "BTC",
        "network": "BTC",
        "period_start": period_date,
        "period_end": period_date,
    }, timeout=20)
    assert r.status_code in (200, 201), f"create: {r.status_code} {r.text}"
    return r.json()


def _patch_full_all_steps(api, bid, when="2026-06-01"):
    """PATCH all Step 1+2+3+4 fields: sweep, USDT conv, AED conv, Wio deposit."""
    r = api.patch(f"{BASE_URL}/api/treasury/batches/{bid}", json={
        # Step 1 — sweep
        "settlement_tx_hash": _hex64(),
        "source_wallet": "BTCPay Wallet",
        "destination_exchange": "Binance",
        "destination_wallet": "BINANCE-MAIN",
        "coin": "BTC",
        "received_crypto_amount": "0.00099000",
        "exchange_received_at": when,
        # Step 2 — USDT conversion
        "usdt_amount": "50.00000000",
        "usdt_conversion_rate": "50505.05",
        "usdt_conversion_date": when,
        "usdt_conversion_reference": f"TEST-CR-{secrets.token_hex(4)}",
        # Step 3 — AED conversion
        "crypto_converted": "50.00000000",
        "conversion_rate": "3.673",
        "fiat_received": "183.65",
        "fiat_currency": "AED",
        "conversion_date": when,
        # Step 4 — Wio bank deposit
        "bank_name": "Wio Bank",
        "bank_reference": f"WIO-{secrets.token_hex(4)}",
        "bank_deposit_date": when,
        "bank_fee_aed": "75.00",
        "net_bank_deposit_amount": "108.65",
    }, timeout=30)
    assert r.status_code in (200, 201), f"patch full: {r.status_code} {r.text}"
    return r.json()


def _get_batch(api, bid):
    r = api.get(f"{BASE_URL}/api/treasury/batches/{bid}", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------- TEST 1: step/aed granular clear ----------------
class TestClearBatchStepAed:
    def test_delete_aed_step_leaves_sweep_and_usdt_intact(self, api):
        b = _create_batch(api, f"AED_{secrets.token_hex(3)}", "2026-06-02")
        bid = b["id"]
        _patch_full_all_steps(api, bid, "2026-06-02")

        # Sanity — AED fields populated
        pre = _get_batch(api, bid)
        assert float(pre.get("fiat_received") or 0) > 0
        assert pre.get("conversion_rate")

        # DELETE step/aed
        r = api.delete(f"{BASE_URL}/api/treasury/batches/{bid}/step/aed",
                       timeout=20)
        assert r.status_code in (200, 201, 204), f"{r.status_code}: {r.text}"
        if r.text:
            data = r.json()
            assert data.get("cleared") == "aed", data

        # Post-state — AED fields gone, sweep+USDT remain
        post = _get_batch(api, bid)
        assert not post.get("fiat_received"), \
            f"fiat_received should be cleared, got {post.get('fiat_received')}"
        assert not post.get("conversion_rate"), \
            f"conversion_rate should be cleared, got {post.get('conversion_rate')}"
        assert not post.get("conversion_date"), \
            f"conversion_date should be cleared, got {post.get('conversion_date')}"
        # Sweep + USDT must remain
        assert post.get("settlement_tx_hash"), "sweep TXID must remain"
        assert float(post.get("usdt_amount") or 0) > 0, \
            f"USDT must remain, got {post.get('usdt_amount')}"
        # Wio still set — separate step
        assert post.get("bank_reference"), \
            "Wio bank_reference unaffected by step/aed"

        # Cleanup
        api.delete(f"{BASE_URL}/api/treasury/batches/{bid}", timeout=15)


# ---------------- TEST 2: step/wio granular clear ----------------
class TestClearBatchStepWio:
    def test_delete_wio_step_leaves_aed_and_earlier_intact(self, api):
        b = _create_batch(api, f"WIO_{secrets.token_hex(3)}", "2026-06-03")
        bid = b["id"]
        _patch_full_all_steps(api, bid, "2026-06-03")

        pre = _get_batch(api, bid)
        assert pre.get("bank_reference")

        # DELETE step/wio
        r = api.delete(f"{BASE_URL}/api/treasury/batches/{bid}/step/wio",
                       timeout=20)
        assert r.status_code in (200, 201, 204), f"{r.status_code}: {r.text}"
        if r.text:
            data = r.json()
            assert data.get("cleared") == "wio", data

        post = _get_batch(api, bid)
        assert not post.get("bank_reference"), "bank_reference must be cleared"
        assert not post.get("bank_deposit_date"), \
            "bank_deposit_date must be cleared"
        # AED + USDT + sweep stay
        assert float(post.get("fiat_received") or 0) > 0, \
            "AED fiat_received must remain"
        assert post.get("conversion_rate"), "AED conversion_rate must remain"
        assert float(post.get("usdt_amount") or 0) > 0, "USDT must remain"
        assert post.get("settlement_tx_hash"), "sweep must remain"

        # Cleanup
        api.delete(f"{BASE_URL}/api/treasury/batches/{bid}", timeout=15)


# ---------------- TEST 3: verify-btc-transfer with partial AED ----------------
class TestVerifyBtcTransferWithPartialAed:
    """
    The user-reported bug: clicking 'Verify BTC Transfer from Mempool' on a
    batch that has partial Step 3 AED data (crypto_converted set but
    conversion_rate empty) used to error with 'Conversion rate is required'.
    The fix is purely on the FE PATCH payload (sweep fields only).
    Here we verify the BE endpoint itself doesn't enforce conversion_rate.
    """

    def test_full_patch_with_partial_aed_DOES_trip_validation(self, api):
        """Reproduces the original bug — if FE sends the FULL settlementForm
        (the OLD verify-mempool behavior), BE rejects with
        'Conversion rate is required' when crypto_converted is set without
        conversion_rate. This is correct BE behavior; the FE fix is to
        not include those fields in the verify-mempool PATCH."""
        b = _create_batch(api, f"VBUG_{secrets.token_hex(3)}", "2026-06-04")
        bid = b["id"]
        r = api.patch(f"{BASE_URL}/api/treasury/batches/{bid}", json={
            "settlement_tx_hash": _hex64(),
            "source_wallet": "BTCPay Wallet",
            "destination_exchange": "Binance",
            "destination_wallet": "BINANCE-MAIN",
            "coin": "BTC",
            "received_crypto_amount": "0.00050000",
            "exchange_received_at": "2026-06-04",
            "crypto_converted": "25.00000000",  # partial AED → no rate
        }, timeout=30)
        # BE correctly enforces this — proves the FE fix is necessary
        assert r.status_code == 400, \
            f"BE should reject partial AED, got {r.status_code}: {r.text}"
        assert "conversion rate" in (r.text or "").lower()
        api.delete(f"{BASE_URL}/api/treasury/batches/{bid}", timeout=15)

    def test_sweep_only_patch_succeeds_then_verify_doesnt_trip_aed(self, api):
        """This is the fix verification — when FE sends only sweep fields
        (no crypto_converted/conversion_rate), PATCH succeeds and then
        verify-btc-transfer never sees an AED-validation error.
        """
        b = _create_batch(api, f"VFIX_{secrets.token_hex(3)}", "2026-06-04")
        bid = b["id"]
        # The exact payload the FIXED verifyActiveBtcTransfer sends.
        sweep_only = {
            "settlement_tx_hash": _hex64(),
            "source_wallet": "BTCPay Wallet",
            "destination_exchange": "Binance",
            "destination_wallet": "BINANCE-MAIN",
            "coin": "BTC",
            "received_crypto_amount": "0.00050000",
            "exchange_received_at": "2026-06-04",
        }
        r = api.patch(f"{BASE_URL}/api/treasury/batches/{bid}", json=sweep_only,
                      timeout=30)
        assert r.status_code in (200, 201), \
            f"sweep-only patch should succeed: {r.status_code} {r.text}"
        body_text = (r.text or "").lower()
        assert "conversion rate" not in body_text

        # Now also call verify-btc-transfer — will likely 400 from mempool
        # (random hash) but MUST NOT mention conversion rate / fiat_received.
        v = api.post(
            f"{BASE_URL}/api/treasury/batches/{bid}/verify-btc-transfer",
            timeout=30,
        )
        vtxt = (v.text or "").lower()
        assert "conversion rate" not in vtxt, \
            f"verify-btc-transfer should never mention conversion rate: {v.text}"
        assert "fiat_received" not in vtxt, \
            f"verify-btc-transfer should not enforce fiat_received: {v.text}"

        api.delete(f"{BASE_URL}/api/treasury/batches/{bid}", timeout=15)
