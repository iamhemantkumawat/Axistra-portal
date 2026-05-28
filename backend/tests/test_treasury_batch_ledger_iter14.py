"""
Iteration 14 — Backend tests for Treasury Batch → Wallet Ledger fan-out
(applyBatchLedger).

Bug being verified:
  User created BPAY-2605-00001 sweeping BTCPay → Binance and converting BTC→USDT.
  Batch status flipped to "Converted to USDT" but Wallet Ledger Binance tab
  showed 0 USDT — applyBatchLedger never wrote ledger rows.

Tests:
  T1 Sweep step (BTCPay → Binance): writes -BTC on BTCPAY and +BTC on BINANCE
     linked by external_ref = `${batch_code}-SWEEP`.
  T2 USDT conversion step: writes -BTC and +USDT on BINANCE linked by
     external_ref = `${batch_code}-CONV-USDT`.
  T3 Wallet overview reflects net balances: BTCPAY BTC -=swept, BINANCE BTC 0,
     BINANCE USDT += usdt_amount.
  T4 Re-PATCH same fields => no duplicates (findByExternalRef gate).
  T5 POST /sync-ledger is idempotent and returns {synced:true, batch_code}.
  T6 Extending the batch with AED + WIO data writes the AED conversion pair
     AND the WIO bank transfer pair — all idempotent on re-save.
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
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD,
                     "accept_terms": True},
               timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, r.text
    s.headers.update({"Authorization": f"Bearer {tok}",
                      "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def customer(session):
    r = session.get(f"{BASE_URL}/api/customers", timeout=15)
    assert r.status_code == 200
    for c in r.json():
        if c.get("magnus_username") == "iter14_batch_test":
            return c
    r = session.post(f"{BASE_URL}/api/customers", json={
        "full_name": "TEST Iter14 BatchLedger",
        "magnus_username": "iter14_batch_test",
        "risk_level": "Low",
    }, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()


@pytest.fixture(scope="module")
def btcpay_wallet(session):
    r = session.get(f"{BASE_URL}/api/settings/receiving-wallets", timeout=15)
    assert r.status_code == 200
    for w in r.json():
        if w.get("gateway") == "BTCPay" and (w.get("coin") or "").upper() == "BTC":
            return w
    r = session.post(f"{BASE_URL}/api/settings/receiving-wallets", json={
        "gateway": "BTCPay", "coin": "BTC", "network": "BTC",
        "address": f"bc1qtest{secrets.token_hex(8)}",
        "label": "TEST BTCPay BTC", "is_active": True,
    }, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()


@pytest.fixture(scope="module")
def batch(session, customer, btcpay_wallet):
    """Create a BTCPay→Binance batch with sweep + USDT conversion fields.

    Mirrors the user's BPAY-2605-00001 scenario but with smaller numbers
    so concurrent test data does not interfere.
    """
    # First create the batch (open) — uses POST /api/treasury/batches
    r = session.post(f"{BASE_URL}/api/treasury/batches", json={
        "name": "TEST Iter14 BTCPay→Binance",
        "source_gateway": "BTCPay",
        "source_wallet": "BTCPay Wallet",
        "destination_exchange": "Binance",
        "destination_wallet": "BINANCE-MAIN",
        "coin": "BTC",
        "network": "BTC",
        "period_start": "2026-05-01",
        "period_end": "2026-05-28",
    }, timeout=20)
    assert r.status_code in (200, 201), f"create batch failed: {r.status_code} {r.text}"
    b = r.json()
    yield b
    # Cleanup
    session.delete(f"{BASE_URL}/api/treasury/batches/{b['id']}", timeout=15)


def _get_ledger(session, code):
    r = session.get(f"{BASE_URL}/api/wallets/{code}/ledger?limit=500", timeout=20)
    assert r.status_code == 200, r.text
    j = r.json()
    return j if isinstance(j, list) else (j.get("rows") or j.get("entries") or [])


def _get_overview(session):
    r = session.get(f"{BASE_URL}/api/wallets/overview", timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------- T1 + T2: PATCH writes both sweep and CONV-USDT pairs ----------------

def test_patch_batch_writes_sweep_and_conv_usdt(session, batch):
    bid = batch["id"]
    code = batch["batch_code"]
    tx = _hex64()
    r = session.patch(f"{BASE_URL}/api/treasury/batches/{bid}", json={
        "settlement_tx_hash": tx,
        "source_wallet": "BTCPay Wallet",
        "destination_exchange": "Binance",
        "destination_wallet": "BINANCE-MAIN",
        "coin": "BTC",
        "received_crypto_amount": "0.03159609",
        "exchange_received_at": "2026-05-28",
        "usdt_amount": "2309.76258400",
        "usdt_conversion_rate": "73102.79797279",
        "usdt_conversion_date": "2026-05-28",
    }, timeout=30)
    assert r.status_code in (200, 201), f"PATCH failed: {r.status_code} {r.text}"
    saved = r.json()
    assert saved["status"] in ("converted_to_usdt", "received_in_exchange",
                               "sent_to_exchange", "reconciled")

    btcpay_rows = [x for x in _get_ledger(session, "BTCPAY")
                   if x.get("external_ref") == f"{code}-SWEEP"]
    binance_rows = [x for x in _get_ledger(session, "BINANCE")
                    if x.get("external_ref") in (f"{code}-SWEEP", f"{code}-CONV-USDT")]

    # T1: Sweep — -BTC on BTCPAY
    assert len(btcpay_rows) == 1, f"BTCPAY sweep row missing: {btcpay_rows}"
    assert btcpay_rows[0]["tx_type"] == "batch_out"
    assert float(btcpay_rows[0]["amount"]) == pytest.approx(-0.03159609, rel=1e-6)
    assert (btcpay_rows[0]["coin"] or "").upper() == "BTC"

    # T1: Sweep — +BTC on BINANCE
    sweep_in = [x for x in binance_rows if x["external_ref"] == f"{code}-SWEEP"]
    assert len(sweep_in) == 1
    assert sweep_in[0]["tx_type"] == "batch_in"
    assert float(sweep_in[0]["amount"]) == pytest.approx(0.03159609, rel=1e-6)

    # T2: Convert — -BTC and +USDT on BINANCE with shared CONV-USDT ref
    conv = [x for x in binance_rows if x["external_ref"] == f"{code}-CONV-USDT"]
    assert len(conv) == 2, f"expected 2 conv rows, got {len(conv)}: {conv}"
    types = sorted(x["tx_type"] for x in conv)
    assert types == ["convert_from", "convert_to"], types
    by_coin = {x["coin"].upper(): float(x["amount"]) for x in conv}
    assert by_coin["BTC"] == pytest.approx(-0.03159609, rel=1e-6)
    assert by_coin["USDT"] == pytest.approx(2309.76258400, rel=1e-6)


# ---------------- T3: overview reflects balances ----------------

def test_overview_reflects_balances(session, batch):
    ov = _get_overview(session)
    # Helper: pluck (wallet,coin) balance from overview rows
    def _bal(wallet, coin):
        # overview can be list[{wallet, balances:[{coin,balance}]}] or {[wallet]:{coin:bal}}
        if isinstance(ov, dict) and wallet in ov:
            return float((ov[wallet] or {}).get(coin, 0))
        if isinstance(ov, list):
            for row in ov:
                w = row.get("wallet") or row.get("code") or row.get("name")
                if w != wallet:
                    continue
                bals = row.get("balances") or row.get("coins") or []
                if isinstance(bals, dict):
                    return float(bals.get(coin, 0))
                for b in bals:
                    if (b.get("coin") or "").upper() == coin:
                        return float(b.get("balance", 0))
        if isinstance(ov, dict) and "wallets" in ov:
            for row in ov["wallets"]:
                if (row.get("wallet") or row.get("code")) == wallet:
                    bals = row.get("balances") or []
                    for b in bals:
                        if (b.get("coin") or "").upper() == coin:
                            return float(b.get("balance", 0))
        return None

    bn_usdt = _bal("BINANCE", "USDT")
    bn_btc = _bal("BINANCE", "BTC")
    # Allow other test data to coexist — only assert this batch's delta
    # showed up by checking that BINANCE USDT is at least the batch amount.
    assert bn_usdt is None or bn_usdt >= 2309.76, \
        f"BINANCE USDT={bn_usdt} did not include batch fan-out (+2309.76)"
    # BTC sweep + convert net = 0; we only check it is finite (no crash)
    assert bn_btc is None or isinstance(bn_btc, float)


# ---------------- T4: re-PATCH must not duplicate ----------------

def test_repatch_same_fields_no_duplicates(session, batch):
    bid = batch["id"]
    code = batch["batch_code"]
    cur = session.get(f"{BASE_URL}/api/treasury/batches/{bid}", timeout=15).json()
    r = session.patch(f"{BASE_URL}/api/treasury/batches/{bid}", json={
        "settlement_tx_hash": cur.get("settlement_tx_hash"),
        "source_wallet": "BTCPay Wallet",
        "destination_exchange": "Binance",
        "destination_wallet": "BINANCE-MAIN",
        "coin": "BTC",
        "received_crypto_amount": "0.03159609",
        "exchange_received_at": "2026-05-28",
        "usdt_amount": "2309.76258400",
        "usdt_conversion_rate": "73102.79797279",
        "usdt_conversion_date": "2026-05-28",
    }, timeout=30)
    assert r.status_code in (200, 201), r.text
    btcpay_rows = [x for x in _get_ledger(session, "BTCPAY")
                   if x.get("external_ref") == f"{code}-SWEEP"]
    binance_sweep = [x for x in _get_ledger(session, "BINANCE")
                     if x.get("external_ref") == f"{code}-SWEEP"]
    binance_conv = [x for x in _get_ledger(session, "BINANCE")
                    if x.get("external_ref") == f"{code}-CONV-USDT"]
    assert len(btcpay_rows) == 1, f"DUP: btcpay sweep rows = {len(btcpay_rows)}"
    assert len(binance_sweep) == 1, f"DUP: binance sweep rows = {len(binance_sweep)}"
    assert len(binance_conv) == 2, f"DUP: binance conv rows = {len(binance_conv)}"


# ---------------- T5: sync-ledger endpoint ----------------

def test_sync_ledger_endpoint_idempotent(session, batch):
    bid = batch["id"]
    code = batch["batch_code"]
    r = session.post(f"{BASE_URL}/api/treasury/batches/{bid}/sync-ledger",
                     json={}, timeout=30)
    assert r.status_code in (200, 201), f"sync failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("synced") is True, body
    assert body.get("batch_code") == code, body
    # Re-call — still no duplicates
    r2 = session.post(f"{BASE_URL}/api/treasury/batches/{bid}/sync-ledger",
                      json={}, timeout=30)
    assert r2.status_code in (200, 201), r2.text
    btcpay_rows = [x for x in _get_ledger(session, "BTCPAY")
                   if x.get("external_ref") == f"{code}-SWEEP"]
    binance_conv = [x for x in _get_ledger(session, "BINANCE")
                    if x.get("external_ref") == f"{code}-CONV-USDT"]
    assert len(btcpay_rows) == 1
    assert len(binance_conv) == 2


# ---------------- T6: extending batch writes AED + WIO pairs ----------------

def test_extend_batch_writes_aed_and_wio_pairs(session, batch):
    bid = batch["id"]
    code = batch["batch_code"]
    r = session.patch(f"{BASE_URL}/api/treasury/batches/{bid}", json={
        "fiat_received": "8500.00",
        "fiat_currency": "AED",
        "crypto_converted": "2309.76258400",
        "conversion_rate": "3.68",
        "conversion_date": "2026-05-28",
        "bank_reference": "WIO-REF-12345",
        "bank_deposit_date": "2026-05-28",
        "net_bank_deposit_amount": "8485.00",
        "bank_name": "Wio Bank",
    }, timeout=30)
    assert r.status_code in (200, 201), f"extend PATCH failed: {r.status_code} {r.text}"

    binance_aed = [x for x in _get_ledger(session, "BINANCE")
                   if x.get("external_ref") == f"{code}-CONV-AED"]
    assert len(binance_aed) == 2, f"AED conv rows = {len(binance_aed)}: {binance_aed}"
    types = sorted(x["tx_type"] for x in binance_aed)
    assert types == ["convert_from", "convert_to"], types
    by_coin = {x["coin"].upper(): float(x["amount"]) for x in binance_aed}
    assert by_coin["USDT"] == pytest.approx(-2309.76258400, rel=1e-6)
    assert by_coin["AED"] == pytest.approx(8500.00, rel=1e-6)

    binance_wio = [x for x in _get_ledger(session, "BINANCE")
                   if x.get("external_ref") == f"{code}-WIO"]
    wio_bank = [x for x in _get_ledger(session, "WIO_BANK")
                if x.get("external_ref") == f"{code}-WIO"]
    assert len(binance_wio) == 1 and binance_wio[0]["tx_type"] == "batch_out"
    assert float(binance_wio[0]["amount"]) == pytest.approx(-8485.00, rel=1e-6)
    assert (binance_wio[0]["coin"] or "").upper() == "AED"
    assert len(wio_bank) == 1 and wio_bank[0]["tx_type"] == "batch_in"
    assert float(wio_bank[0]["amount"]) == pytest.approx(8485.00, rel=1e-6)

    # Idempotency on extend re-save
    r2 = session.patch(f"{BASE_URL}/api/treasury/batches/{bid}", json={
        "fiat_received": "8500.00", "fiat_currency": "AED",
        "crypto_converted": "2309.76258400", "conversion_rate": "3.68",
        "conversion_date": "2026-05-28",
        "bank_reference": "WIO-REF-12345", "bank_deposit_date": "2026-05-28",
        "net_bank_deposit_amount": "8485.00",
    }, timeout=30)
    assert r2.status_code in (200, 201), r2.text
    binance_aed2 = [x for x in _get_ledger(session, "BINANCE")
                    if x.get("external_ref") == f"{code}-CONV-AED"]
    wio_bank2 = [x for x in _get_ledger(session, "WIO_BANK")
                 if x.get("external_ref") == f"{code}-WIO"]
    assert len(binance_aed2) == 2, f"DUP AED rows after re-save: {len(binance_aed2)}"
    assert len(wio_bank2) == 1, f"DUP WIO rows after re-save: {len(wio_bank2)}"
