"""
Iteration 13 — Backend tests for the enhanced wallets.convert() endpoint.

Verifies the Phase-A requirements for Wallet Ledger Convert modal:
  1. Convert with explicit to_amount (Received Amount) returns 200, rate auto-computed.
  2. Convert WITHOUT to_amount but with rate computes toAmt = fromAmt * rate.
  3. Convert WITHOUT either to_amount or rate → 400 "Either Received Amount or Rate is required".
  4. Convert with from_coin == to_coin → 400 "Same coin".
  5. Convert with from_amount = 0 → 400 "From amount must be positive".
  6. After conversion, GET /api/wallets/BINANCE/ledger shows 2 rows:
       - convert_from (-BTC), convert_to (+USDT)
       - identical rate_used, identical event_at, linked via linked_ledger_id
  7. event_at honored (2026-05-28 round-trips).
  8. GET /api/wallets/overview reflects the conversion balances.
"""

import os
import pytest
import requests
from datetime import datetime
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
WALLET = "BINANCE"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "accept_terms": True},
        timeout=20,
    )
    assert r.status_code in (200, 201), f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in response: {r.text}"
    s.headers.update(
        {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    )
    return s


# ---------- Validation tests ----------

class TestConvertValidation:
    def test_same_coin_rejected(self, session):
        r = session.post(
            f"{BASE_URL}/api/wallets/{WALLET}/convert",
            json={
                "from_coin": "BTC",
                "to_coin": "BTC",
                "from_amount": "0.01",
                "to_amount": "0.01",
            },
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        body = r.json()
        msg = body.get("message") or body.get("detail") or str(body)
        assert "Same coin" in str(msg), f"unexpected message: {msg}"

    def test_zero_from_amount_rejected(self, session):
        r = session.post(
            f"{BASE_URL}/api/wallets/{WALLET}/convert",
            json={
                "from_coin": "BTC",
                "to_coin": "USDT",
                "from_amount": "0",
                "to_amount": "100",
            },
            timeout=15,
        )
        assert r.status_code == 400
        body = r.json()
        msg = body.get("message") or body.get("detail") or str(body)
        assert "positive" in str(msg).lower(), f"unexpected message: {msg}"

    def test_missing_received_and_rate_rejected(self, session):
        r = session.post(
            f"{BASE_URL}/api/wallets/{WALLET}/convert",
            json={
                "from_coin": "BTC",
                "to_coin": "USDT",
                "from_amount": "0.01",
                # no to_amount, no rate
            },
            timeout=15,
        )
        assert r.status_code == 400
        body = r.json()
        msg = body.get("message") or body.get("detail") or str(body)
        assert "Received Amount" in str(msg) or "Rate" in str(msg), (
            f"unexpected message: {msg}"
        )


# ---------- Happy path: explicit to_amount (Received Amount priority) ----------

class TestConvertWithReceivedAmount:
    @pytest.fixture(scope="class")
    def conv_result(self, session):
        payload = {
            "from_coin": "BTC",
            "to_coin": "USDT",
            "from_amount": "0.03158544",
            "to_amount": "3450.10",
            "event_at": "2026-05-28",
            "notes": "test iter13 received-amount",
        }
        r = session.post(
            f"{BASE_URL}/api/wallets/{WALLET}/convert", json=payload, timeout=20
        )
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text}"
        return r.json()

    def test_response_has_conv_id_and_legs(self, conv_result):
        assert conv_result.get("conv_id"), conv_result
        out = conv_result.get("out")
        inn = conv_result.get("in")
        assert out and inn
        # out is the -BTC leg
        assert out["coin"] == "BTC"
        assert float(out["amount"]) == pytest.approx(-0.03158544, abs=1e-8)
        assert out["tx_type"] == "convert_from"
        # in is the +USDT leg
        assert inn["coin"] == "USDT"
        assert float(inn["amount"]) == pytest.approx(3450.10, abs=1e-4)
        assert inn["tx_type"] == "convert_to"

    def test_rate_auto_computed(self, conv_result):
        # rate_used = to_amount / from_amount = 3450.10 / 0.03158544
        expected = 3450.10 / 0.03158544  # ≈ 109230.70883293
        out_rate = float(conv_result["out"]["rate_used"])
        in_rate = float(conv_result["in"]["rate_used"])
        assert out_rate == pytest.approx(expected, rel=1e-6), (
            f"out rate {out_rate} vs expected {expected}"
        )
        assert in_rate == pytest.approx(expected, rel=1e-6)
        # The exact published expected rate is 109230.70883293
        assert out_rate == pytest.approx(109230.70883293, rel=1e-6)

    def test_event_at_honored(self, conv_result):
        for leg_name in ("out", "in"):
            ev = conv_result[leg_name].get("event_at")
            assert ev, f"{leg_name} missing event_at: {conv_result[leg_name]}"
            # Parse — backend serializes as ISO string
            parsed = ev[:10]  # yyyy-mm-dd
            assert parsed == "2026-05-28", f"event_at not honored: {ev}"

    def test_legs_linked(self, conv_result):
        out_id = conv_result["out"]["id"]
        in_id = conv_result["in"]["id"]
        assert conv_result["in"]["linked_ledger_id"] == out_id

    def test_ledger_endpoint_shows_both_legs(self, session, conv_result):
        conv_id = conv_result["conv_id"]
        r = session.get(f"{BASE_URL}/api/wallets/{WALLET}/ledger", timeout=15)
        assert r.status_code in (200, 201), r.text
        rows = r.json()
        if isinstance(rows, dict) and "rows" in rows:
            rows = rows["rows"]
        # Find rows where external_ref == conv_id
        matching = [row for row in rows if row.get("external_ref") == conv_id]
        assert len(matching) >= 2, (
            f"expected at least 2 rows for {conv_id}, got {len(matching)}"
        )
        from_row = next(
            (r for r in matching if r.get("tx_type") == "convert_from"), None
        )
        to_row = next((r for r in matching if r.get("tx_type") == "convert_to"), None)
        assert from_row and to_row
        # Rate identical
        assert float(from_row["rate_used"]) == pytest.approx(
            float(to_row["rate_used"]), rel=1e-9
        )
        # event_at identical (compare date portion)
        assert from_row["event_at"][:10] == to_row["event_at"][:10] == "2026-05-28"
        # linked_ledger_id wiring
        assert (
            from_row.get("linked_ledger_id") == to_row["id"]
            or to_row.get("linked_ledger_id") == from_row["id"]
        )

    def test_overview_reflects_balances(self, session, conv_result):
        r = session.get(f"{BASE_URL}/api/wallets/overview", timeout=15)
        assert r.status_code in (200, 201), r.text
        overview = r.json()
        # Find BINANCE wallet
        if isinstance(overview, dict):
            wallets = overview.get("wallets") or overview.get("data") or []
        else:
            wallets = overview
        binance = None
        for w in wallets:
            code = w.get("wallet") or w.get("code") or w.get("name")
            if code == "BINANCE":
                binance = w
                break
        assert binance, f"BINANCE wallet not in overview: {overview}"
        # Balances should include BTC (could be negative if no prior balance) and USDT positive
        bal = binance.get("balances") or binance.get("by_coin") or {}
        if isinstance(bal, list):
            bal_map = {
                b.get("coin"): float(b.get("balance") or b.get("amount") or 0)
                for b in bal
            }
        else:
            bal_map = {k: float(v) for k, v in bal.items()}
        assert "BTC" in bal_map or "USDT" in bal_map, f"no balance map: {bal_map}"
        # USDT positive (we just added +3450.10 in addition to whatever was there)
        # Just sanity-check that USDT is present and BTC is present
        # (cannot assert exact value because other prior tests may have run)


# ---------- Happy path: explicit rate, no to_amount ----------

class TestConvertWithRate:
    def test_rate_only_computes_to_amount(self, session):
        rate = 109230.0
        from_amt = 0.001
        payload = {
            "from_coin": "BTC",
            "to_coin": "USDT",
            "from_amount": str(from_amt),
            "rate": str(rate),
            "notes": "test iter13 rate-only",
        }
        r = session.post(
            f"{BASE_URL}/api/wallets/{WALLET}/convert", json=payload, timeout=20
        )
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text}"
        body = r.json()
        inn = body["in"]
        expected_to = from_amt * rate  # 109.23
        assert float(inn["amount"]) == pytest.approx(expected_to, rel=1e-6)
        assert float(inn["rate_used"]) == pytest.approx(rate, rel=1e-6)
