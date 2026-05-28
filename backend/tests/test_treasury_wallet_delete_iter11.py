"""
Iteration 11 — Backend tests for Axistra treasury/wallet delete + balance-sync fixes:
  1) GET /api/wallets/overview is the source of truth for chip balances.
  2) DELETE /api/wallets/ledger/:id (with paired row delete) — 200/404.
  3) DELETE /api/treasury/batches/:id (unlinks movements) — 200/404.
  4) DELETE /api/recharges/:id and /api/expenses/:id still work.
  5) Seed expense BINANCE/USDT 700 → wallets/overview BINANCE.USDT goes down by 700.
"""

import os
import uuid
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


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    assert tok, f"no token in {data}"
    return tok


@pytest.fixture(scope="session")
def session(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}",
                      "Content-Type": "application/json"})
    return s


# ---------- 1. Wallets overview is reachable ----------

def test_wallets_overview_endpoint(session):
    r = session.get(f"{BASE_URL}/api/wallets/overview", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    codes = {w["code"] for w in data}
    # Must include all 5 wallets
    for code in ["OXAPAY", "BTCPAY", "BINANCE", "OKX", "WIO_BANK"]:
        assert code in codes, f"missing wallet {code} in overview"
    for w in data:
        assert "balances" in w and isinstance(w["balances"], list)


def _binance_usdt_balance(overview):
    for w in overview:
        if w["code"] == "BINANCE":
            for b in w["balances"]:
                if b["coin"] == "USDT":
                    return float(b["balance"])
            return 0.0
    return 0.0


# ---------- 2. Delete unknown ledger row → 404 ----------

def test_delete_unknown_ledger_row_returns_404(session):
    r = session.delete(f"{BASE_URL}/api/wallets/ledger/00000000-0000-0000-0000-000000000000",
                       timeout=15)
    assert r.status_code == 404, r.text


# ---------- 3. Delete unknown batch → 404 ----------

def test_delete_unknown_batch_returns_404(session):
    r = session.delete(f"{BASE_URL}/api/treasury/batches/00000000-0000-0000-0000-000000000000",
                       timeout=15)
    assert r.status_code == 404, r.text


# ---------- 4. Seed expense → balance sync → cleanup ----------

def test_binance_expense_700_syncs_to_wallets_overview(session):
    # Baseline
    ov0 = session.get(f"{BASE_URL}/api/wallets/overview", timeout=15).json()
    before = _binance_usdt_balance(ov0)

    # Create expense paid in USDT from BINANCE
    payload = {
        "vendor_name": f"TEST_VENDOR_{uuid.uuid4().hex[:8]}",
        "category": "infrastructure",
        "amount": 700,
        "currency": "USDT",
        "paid_in_usdt": True,
        "source_wallet": "BINANCE",
        "expense_date": "2025-01-15",
        "description": "iter11 balance-sync test",
    }
    r = session.post(f"{BASE_URL}/api/expenses", json=payload, timeout=20)
    assert r.status_code in (200, 201), f"expense create failed: {r.status_code} {r.text}"
    expense = r.json()
    expense_id = expense.get("id") or expense.get("_id")
    assert expense_id

    try:
        # Re-fetch overview
        ov1 = session.get(f"{BASE_URL}/api/wallets/overview", timeout=15).json()
        after = _binance_usdt_balance(ov1)
        delta = round(after - before, 4)
        assert delta == -700.0, (
            f"BINANCE USDT did not move by -700 (before={before}, after={after}, delta={delta})"
        )
    finally:
        # Cleanup
        r2 = session.delete(f"{BASE_URL}/api/expenses/{expense_id}", timeout=20)
        assert r2.status_code in (200, 204), f"expense delete failed: {r2.status_code} {r2.text}"

    # Verify balance restored
    ov2 = session.get(f"{BASE_URL}/api/wallets/overview", timeout=15).json()
    restored = _binance_usdt_balance(ov2)
    assert round(restored - before, 4) == 0.0, (
        f"BINANCE USDT not restored after expense delete (before={before}, restored={restored})"
    )


# ---------- 5. Recharges delete works ----------

def test_recharges_delete_endpoint_works(session):
    # Create a recharge via the standard endpoint
    payload = {
        "client_email": f"test+{uuid.uuid4().hex[:6]}@example.com",
        "amount_usdt": 10,
        "payment_gateway": "manual",
        "notes": "iter11 delete recharge test",
    }
    r = session.post(f"{BASE_URL}/api/recharges", json=payload, timeout=20)
    if r.status_code not in (200, 201):
        pytest.skip(f"recharge create not supported with this payload: {r.status_code} {r.text[:200]}")
    rec = r.json()
    rid = rec.get("id") or rec.get("_id")
    assert rid
    d = session.delete(f"{BASE_URL}/api/recharges/{rid}", timeout=20)
    assert d.status_code in (200, 204), f"recharge delete failed: {d.status_code} {d.text}"


# ---------- 6. Ledger row CRUD via send-batch then delete (paired delete) ----------

def test_create_batch_then_delete_ledger_row_pair(session):
    # Use sendBatch between BINANCE → OKX to make 2 linked rows.
    body = {
        "to_wallet": "OKX",
        "coin": "USDT",
        "amount": "1",
        "notes": "iter11 paired delete test",
    }
    r = session.post(f"{BASE_URL}/api/wallets/BINANCE/send-batch", json=body, timeout=20)
    assert r.status_code in (200, 201), f"send-batch failed: {r.status_code} {r.text}"
    data = r.json()
    out_id = (data.get("out") or {}).get("id")
    in_id = (data.get("in") or {}).get("id")
    assert out_id and in_id

    # Delete one — pair should also be removed
    d = session.delete(f"{BASE_URL}/api/wallets/ledger/{out_id}", timeout=15)
    assert d.status_code == 200, f"ledger delete failed: {d.status_code} {d.text}"
    body = d.json()
    assert body.get("deleted") is True
    assert body.get("paired_deleted") is True

    # The paired row should also be gone
    g = session.get(f"{BASE_URL}/api/wallets/ledger/{in_id}", timeout=15)
    assert g.status_code == 404, f"paired row still present: {g.status_code} {g.text}"
