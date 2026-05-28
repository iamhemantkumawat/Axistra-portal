"""
Iteration 12 — Backend tests for the BTCPay missed-webhook backfill fix.

Bugs being verified:
  1. crypto_amount fallback to fiat `amount` removed — falls back to '0' instead.
  2. Manual recharge create with tx_hash + crypto_amount also creates the
     crypto_transactions row AND appends a wallet_ledger row, so the BTCPay
     Wallet Ledger sees the deposit.
  3. POST /api/treasury/btcpay/:rechargeId/verify no longer returns
     "No BTC transaction found" because the crypto_transactions row exists.
  4. Off-chain manual credit (no tx_hash, no crypto_amount) still works as a
     no-op for the backfill block — crypto_amount stored as '0'.
  5. Duplicate tx_hash backfill must not crash the recharge save.
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
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not configured")


BASE_URL = _load_base_url()
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"


def _hex64():
    return secrets.token_hex(32)


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
               timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    s.headers.update({"Authorization": f"Bearer {tok}",
                      "Content-Type": "application/json"})
    return s


# ---------- Seed data: customer + BTCPay receiving wallet ----------

@pytest.fixture(scope="session")
def customer(session):
    # Try to reuse if a TEST_ customer with magnus 'cugino1napoli_test' exists
    r = session.get(f"{BASE_URL}/api/customers", timeout=15)
    assert r.status_code == 200
    for c in r.json():
        if c.get("magnus_username") == "cugino1napoli_test":
            return c
    r = session.post(f"{BASE_URL}/api/customers", json={
        "full_name": "TEST Cugino1Napoli",
        "magnus_username": "cugino1napoli_test",
        "risk_level": "Low",
    }, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()


@pytest.fixture(scope="session")
def btcpay_wallet(session):
    r = session.get(f"{BASE_URL}/api/settings/receiving-wallets", timeout=15)
    assert r.status_code == 200
    for w in r.json():
        if w.get("gateway") == "BTCPay" and (w.get("coin") or "").upper() == "BTC":
            return w
    r = session.post(f"{BASE_URL}/api/settings/receiving-wallets", json={
        "gateway": "BTCPay",
        "coin": "BTC",
        "network": "BTC",
        "address": f"bc1qtest{secrets.token_hex(8)}",
        "label": "TEST BTCPay BTC",
        "is_active": True,
    }, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _create_recharge(session, customer, wallet, **overrides):
    payload = {
        "customer_id": customer["id"],
        "amount": "200",
        "currency": "EUR",
        "payment_gateway": "BTCPay",
        "crypto_coin": "BTC",
        "crypto_network": "BTC",
        "wallet_address": wallet["address"],
    }
    payload.update(overrides)
    r = session.post(f"{BASE_URL}/api/recharges", json=payload, timeout=20)
    return r


# ---------- 1. crypto_amount preserved exactly, not falling back to fiat ----------

def test_create_recharge_records_exact_crypto_amount(session, customer, btcpay_wallet):
    tx = _hex64()
    r = _create_recharge(session, customer, btcpay_wallet,
                         tx_hash=tx, crypto_amount="0.00320770")
    assert r.status_code in (200, 201), r.text
    body = r.json()
    rid = body["id"]
    # Inline response must NOT show 200 BTC
    assert str(body["crypto_amount"]) not in ("200", "200.00000000"), \
        f"crypto_amount fell back to fiat amount: {body['crypto_amount']}"
    # GET round-trip
    g = session.get(f"{BASE_URL}/api/recharges/{rid}", timeout=15).json()
    # PostgreSQL numeric(18,8) -> "0.00320770"
    assert float(g["crypto_amount"]) == pytest.approx(0.00320770, rel=1e-6), \
        f"persisted crypto_amount={g['crypto_amount']}"
    assert g["crypto_coin"] == "BTC"
    assert g["tx_hash"] == tx
    # Cleanup
    session.delete(f"{BASE_URL}/api/recharges/{rid}", timeout=15)


# ---------- 2. crypto_transactions row gets created on manual TX backfill ----------

def test_manual_backfill_creates_crypto_transaction(session, customer, btcpay_wallet):
    tx = _hex64()
    r = _create_recharge(session, customer, btcpay_wallet,
                         tx_hash=tx, crypto_amount="0.00320770")
    assert r.status_code in (200, 201), r.text
    rid = r.json()["id"]

    g = session.get(f"{BASE_URL}/api/recharges/{rid}", timeout=15).json()
    txs = g.get("crypto_transactions") or []
    assert len(txs) == 1, f"expected 1 crypto_transactions row, got {len(txs)}: {txs}"
    assert (txs[0].get("coin") or "").upper() == "BTC"
    assert txs[0].get("tx_hash") == tx
    assert float(txs[0].get("crypto_amount")) == pytest.approx(0.00320770, rel=1e-6)
    # Cleanup
    session.delete(f"{BASE_URL}/api/recharges/{rid}", timeout=15)


# ---------- 3. wallet_ledger row gets appended for BTCPAY wallet ----------

def test_manual_backfill_appends_btcpay_ledger(session, customer, btcpay_wallet):
    tx = _hex64()
    r = _create_recharge(session, customer, btcpay_wallet,
                         tx_hash=tx, crypto_amount="0.00320770")
    assert r.status_code in (200, 201), r.text
    rid = r.json()["id"]

    led = session.get(f"{BASE_URL}/api/wallets/BTCPAY/ledger", timeout=15)
    assert led.status_code == 200, led.text
    rows = led.json()
    rows_list = rows if isinstance(rows, list) else (rows.get("entries") or rows.get("rows") or [])
    matched = [row for row in rows_list if (row.get("tx_hash") or "") == tx]
    assert matched, f"no BTCPAY ledger row for tx {tx}; got {len(rows_list)} total rows"
    row = matched[0]
    assert float(row.get("amount")) == pytest.approx(0.00320770, rel=1e-6), \
        f"ledger amount={row.get('amount')}"
    assert (row.get("coin") or "").upper() == "BTC"
    # Cleanup
    session.delete(f"{BASE_URL}/api/recharges/{rid}", timeout=15)


# ---------- 4. Treasury verify no longer returns "No BTC transaction found" ----------

def test_treasury_btcpay_verify_finds_tx(session, customer, btcpay_wallet):
    tx = _hex64()
    r = _create_recharge(session, customer, btcpay_wallet,
                         tx_hash=tx, crypto_amount="0.00320770")
    assert r.status_code in (200, 201), r.text
    rid = r.json()["id"]

    v = session.post(f"{BASE_URL}/api/treasury/btcpay/{rid}/verify",
                     json={}, timeout=30)
    body_text = v.text
    # The KEY assertion: NOT the "No BTC transaction found" precondition error
    assert "No BTC transaction found" not in body_text, \
        f"crypto_transactions row missing — verify response: {v.status_code} {body_text}"
    # Mempool itself may legitimately error in this test pod (network/tx not yet broadcast)
    # — we only require the precondition is satisfied.
    if v.status_code == 200:
        body = v.json()
        # Should expose a transactions array or verified results
        assert any(k in body for k in ("transactions", "verified", "results", "tx_hash")), \
            f"unexpected verify success body: {body}"
    # Cleanup
    session.delete(f"{BASE_URL}/api/recharges/{rid}", timeout=15)


# ---------- 5. Off-chain manual credit (no tx, no crypto_amount) is a graceful no-op ----------

def test_offchain_manual_credit_no_op(session, customer, btcpay_wallet):
    # No tx_hash, no crypto_amount, Binance gateway
    r = session.post(f"{BASE_URL}/api/recharges", json={
        "customer_id": customer["id"],
        "amount": "150",
        "currency": "USD",
        "payment_gateway": "Binance",
        "crypto_coin": "USDT",
        "crypto_network": "TRC20",
        "wallet_address": "",
    }, timeout=20)
    assert r.status_code in (200, 201), r.text
    rid = r.json()["id"]
    g = session.get(f"{BASE_URL}/api/recharges/{rid}", timeout=15).json()
    # crypto_amount must be 0 (NOT 150)
    assert float(g["crypto_amount"]) == 0, \
        f"off-chain credit got crypto_amount={g['crypto_amount']} (must be 0)"
    # No crypto_transactions row
    assert len(g.get("crypto_transactions") or []) == 0
    # Cleanup
    session.delete(f"{BASE_URL}/api/recharges/{rid}", timeout=15)


# ---------- 6. Duplicate tx_hash backfill must not crash the recharge save ----------

def test_duplicate_tx_hash_backfill_does_not_crash(session, customer, btcpay_wallet):
    tx = _hex64()
    # First create — populates crypto_transactions row
    r1 = _create_recharge(session, customer, btcpay_wallet,
                          tx_hash=tx, crypto_amount="0.00100000")
    assert r1.status_code in (200, 201), r1.text
    rid1 = r1.json()["id"]

    # Second create — same tx_hash should skip the backfill block silently
    # and STILL save the recharge.
    r2 = _create_recharge(session, customer, btcpay_wallet,
                          tx_hash=tx, crypto_amount="0.00100000")
    assert r2.status_code in (200, 201), \
        f"duplicate tx_hash crashed the recharge save: {r2.status_code} {r2.text}"
    rid2 = r2.json()["id"]
    assert rid2 != rid1
    # The second recharge should NOT have created a second crypto_transactions row
    g2 = session.get(f"{BASE_URL}/api/recharges/{rid2}", timeout=15).json()
    assert len(g2.get("crypto_transactions") or []) == 0, \
        "duplicate tx_hash should skip backfill, not create a 2nd crypto_tx row"
    # Cleanup
    session.delete(f"{BASE_URL}/api/recharges/{rid2}", timeout=15)
    session.delete(f"{BASE_URL}/api/recharges/{rid1}", timeout=15)
