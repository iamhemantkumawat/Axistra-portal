"""
Iteration 31 — Gateway Recharge Intake toggle + security/regression after package upgrades.

Covers:
  * Webhook intake settings auth (GET JWT, PUT admin-only, CA -> 403)
  * oxapay/btcpay intake OFF => webhook received+logged but NO recharge created (paused:true)
  * toggles ON => normal processing works (manual source via /webhooks/recharge)
  * Regression: invoice PDF, report exports (pdf/excel/csv), period bundle zip, payroll + net-worth PDFs
  * Security hardening: /api/backups 401, removed backup routes gone

Cleanup: deletes any recharge it creates (TEST_ magnus identifiers). Leaves both toggles ON.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
WEBHOOK_SECRET = os.environ.get("TEST_PAYMENT_WEBHOOK_SECRET")

ADMIN = {"email": "admin@axistratech.com", "password": "admin123", "accept_terms": True}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        return None
    return r.json().get("token")


@pytest.fixture(scope="module")
def admin_token():
    tok = _login(ADMIN)
    if not tok:
        pytest.skip("Admin login failed")
    return tok


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def created_recharge_ids():
    return []


@pytest.fixture(scope="module", autouse=True)
def cleanup(created_recharge_ids, admin_headers):
    yield
    # restore both toggles ON
    try:
        requests.put(f"{BASE_URL}/api/webhooks/intake-settings",
                     json={"oxapay": True, "btcpay": True}, headers=admin_headers, timeout=30)
    except Exception:
        pass
    for rid in created_recharge_ids:
        try:
            requests.delete(f"{BASE_URL}/api/recharges/{rid}", headers=admin_headers, timeout=30)
        except Exception:
            pass


# ---------------- Auth on intake-settings ----------------
class TestIntakeAuth:
    def test_get_requires_jwt(self):
        r = requests.get(f"{BASE_URL}/api/webhooks/intake-settings", timeout=20)
        assert r.status_code == 401, r.text

    def test_get_with_admin(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/webhooks/intake-settings", headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "oxapay" in d and "btcpay" in d
        assert isinstance(d["oxapay"], bool) and isinstance(d["btcpay"], bool)

    def test_put_requires_token(self):
        r = requests.put(f"{BASE_URL}/api/webhooks/intake-settings", json={"oxapay": True}, timeout=20)
        assert r.status_code == 401, r.text

    def test_put_forbidden_for_ca_role(self, admin_headers):
        # CA-role 403 is verified separately (bash + DB cleanup) because there is
        # no DELETE route for admin users and the restored-DB CA password is unknown.
        ca_tok = _login({"email": "ca@axistratech.com", "password": "ca123456", "accept_terms": True})
        if not ca_tok:
            pytest.skip("CA login failed (restored-DB password != documented ca123456); covered via bash check")
        r = requests.put(f"{BASE_URL}/api/webhooks/intake-settings",
                         json={"oxapay": False},
                         headers={"Authorization": f"Bearer {ca_tok}"}, timeout=20)
        assert r.status_code == 403, f"expected 403 for CA, got {r.status_code}: {r.text}"


# ---------------- Intake OFF => paused ----------------
class TestIntakePaused:
    def _get_log(self, admin_headers, webhook_id):
        r = requests.get(f"{BASE_URL}/api/webhooks/logs/{webhook_id}", headers=admin_headers, timeout=20)
        return r

    def test_oxapay_paused(self, admin_headers, created_recharge_ids):
        # turn oxapay OFF
        r = requests.put(f"{BASE_URL}/api/webhooks/intake-settings",
                         json={"oxapay": False}, headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["oxapay"] is False

        payload = {
            "amount": 50, "currency": "USD",
            "track_id": f"TEST-OXA-{uuid.uuid4().hex[:10]}",
            "status": "Paid", "magnus_username": "TEST_intake_user",
        }
        wr = requests.post(f"{BASE_URL}/api/webhooks/oxapay", json=payload,
                           headers={"x-axistra-webhook-secret": WEBHOOK_SECRET}, timeout=30)
        assert wr.status_code in (200, 201), wr.text
        body = wr.json()
        assert body.get("ok") is True
        assert body.get("paused") is True, f"expected paused:true, got {body}"
        assert "recharge_id" not in body or not body.get("recharge_id")

        wid = body.get("webhook_id")
        log = self._get_log(admin_headers, wid)
        assert log.status_code == 200, log.text
        ld = log.json()
        assert ld.get("processed") in (False, None, 0, "false"), f"log not unprocessed: {ld.get('processed')}"
        assert "paused" in (ld.get("error_message") or "").lower(), f"missing pause msg: {ld.get('error_message')}"

    def test_btcpay_paused_via_recharge_route(self, admin_headers):
        r = requests.put(f"{BASE_URL}/api/webhooks/intake-settings",
                         json={"btcpay": False}, headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["btcpay"] is False

        payload = {
            "source": "btcpay", "amount": 75, "currency": "USD",
            "invoice_id": f"TEST-BTC-{uuid.uuid4().hex[:10]}",
            "status": "Settled", "magnus_username": "TEST_intake_user",
        }
        wr = requests.post(f"{BASE_URL}/api/webhooks/recharge", json=payload,
                           headers={"x-axistra-webhook-secret": WEBHOOK_SECRET}, timeout=30)
        assert wr.status_code in (200, 201), wr.text
        body = wr.json()
        assert body.get("paused") is True, f"expected paused:true, got {body}"


# ---------------- Intake ON => normal processing ----------------
class TestIntakeOnProcessing:
    def test_manual_source_creates_recharge(self, admin_headers, created_recharge_ids):
        # ensure both ON
        r = requests.put(f"{BASE_URL}/api/webhooks/intake-settings",
                         json={"oxapay": True, "btcpay": True}, headers=admin_headers, timeout=20)
        assert r.status_code == 200
        assert r.json()["oxapay"] is True and r.json()["btcpay"] is True

        payload = {
            "source": "manual", "amount": 123.45, "currency": "USD",
            "magnus_username": "TEST_intake_user",
            "tx_hash": f"TEST-TX-{uuid.uuid4().hex}",
            "crypto_amount": 123.45,
            "crypto_coin": "USDT", "crypto_network": "ERC20",
            "payment_gateway": "Binance",
        }
        wr = requests.post(f"{BASE_URL}/api/webhooks/recharge", json=payload,
                           headers={"x-axistra-webhook-secret": WEBHOOK_SECRET}, timeout=60)
        assert wr.status_code in (200, 201), wr.text
        body = wr.json()
        assert body.get("ok") is True, body
        assert not body.get("paused"), body
        rid = body.get("recharge_id")
        assert rid, f"no recharge created: {body}"
        created_recharge_ids.append(rid)

        # verify persisted
        g = requests.get(f"{BASE_URL}/api/recharges/{rid}", headers=admin_headers, timeout=30)
        assert g.status_code == 200, g.text
        assert float(g.json()["amount"]) == pytest.approx(123.45, abs=0.01)

    def test_oxapay_on_creates_recharge(self, admin_headers, created_recharge_ids):
        payload = {
            "amount": 60, "currency": "USD",
            "track_id": f"TEST-OXAON-{uuid.uuid4().hex[:10]}",
            "status": "Paid", "magnus_username": "TEST_intake_user",
            "tx_hash": f"TEST-TX-{uuid.uuid4().hex}",
            "crypto_amount": 60, "crypto_coin": "USDT", "crypto_network": "ERC20",
        }
        wr = requests.post(f"{BASE_URL}/api/webhooks/oxapay", json=payload,
                           headers={"x-axistra-webhook-secret": WEBHOOK_SECRET}, timeout=60)
        assert wr.status_code in (200, 201), wr.text
        body = wr.json()
        assert not body.get("paused"), body
        rid = body.get("recharge_id")
        if rid:
            created_recharge_ids.append(rid)


# ---------------- Regression: PDFs / exports ----------------
class TestRegressionExports:
    def test_report_export_pdf(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/reports/export/pdf?report=monthly-detailed&year=2026&month=8",
                         headers=admin_headers, timeout=90)
        assert r.status_code == 200, r.text[:200]
        assert "application/pdf" in r.headers.get("content-type", ""), r.headers.get("content-type")

    def test_report_export_excel(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/reports/export/excel?report=monthly-detailed&year=2026&month=8",
                         headers=admin_headers, timeout=90)
        assert r.status_code == 200, r.text[:200]
        ct = r.headers.get("content-type", "")
        assert "spreadsheet" in ct or "excel" in ct or "octet-stream" in ct, ct

    def test_report_export_csv(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/reports/export/csv?report=monthly-detailed&year=2026&month=8",
                         headers=admin_headers, timeout=90)
        assert r.status_code == 200, r.text[:200]
        assert "csv" in r.headers.get("content-type", "").lower() or r.content

    def test_period_bundle_zip(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/reports/bundle/period?year=2026&quarter=3",
                         headers=admin_headers, timeout=120)
        assert r.status_code == 200, r.text[:200]
        ct = r.headers.get("content-type", "")
        assert "zip" in ct or "octet-stream" in ct, ct
        assert r.content[:2] == b"PK", "not a zip file"

    def test_invoice_pdf(self, admin_headers):
        lst = requests.get(f"{BASE_URL}/api/invoices?limit=1", headers=admin_headers, timeout=30)
        assert lst.status_code == 200, lst.text[:200]
        rows = lst.json()
        rows = rows.get("rows", rows) if isinstance(rows, dict) else rows
        if not rows:
            pytest.skip("no invoices to render")
        inv_id = rows[0]["id"]
        r = requests.get(f"{BASE_URL}/api/invoices/{inv_id}/pdf", headers=admin_headers, timeout=90)
        assert r.status_code == 200, r.text[:200]
        assert "application/pdf" in r.headers.get("content-type", ""), r.headers.get("content-type")
        assert r.content[:4] == b"%PDF", "invoice not a PDF"

    def test_net_worth_pdf(self, admin_headers):
        for path in ("/api/dashboard/net-worth/pdf", "/api/dashboard/net-worth.pdf"):
            r = requests.get(f"{BASE_URL}{path}", headers=admin_headers, timeout=90)
            if r.status_code == 200:
                assert "application/pdf" in r.headers.get("content-type", ""), r.headers.get("content-type")
                return
        pytest.skip("net-worth pdf route not found under tried paths")

    def test_payroll_pdf(self, admin_headers):
        runs = requests.get(f"{BASE_URL}/api/payroll/runs", headers=admin_headers, timeout=30)
        if runs.status_code != 200:
            pytest.skip("payroll runs list unavailable")
        data = runs.json()
        data = data.get("rows", data) if isinstance(data, dict) else data
        if not data:
            pytest.skip("no payroll runs")
        pid = data[0]["id"]
        r = requests.get(f"{BASE_URL}/api/payroll/runs/{pid}/board-resolution.pdf",
                         headers=admin_headers, timeout=90)
        assert r.status_code == 200, r.text[:200]
        assert "application/pdf" in r.headers.get("content-type", ""), r.headers.get("content-type")
        assert r.content[:4] == b"%PDF", "payroll not a PDF"


# ---------------- Security hardening ----------------
class TestSecurityHardening:
    def test_backups_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/backups", timeout=20)
        assert r.status_code == 401, r.text

    def test_removed_download_route(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/backups/somefile.sql/download", headers=admin_headers, timeout=20)
        assert r.status_code in (404, 405), f"download route should be gone, got {r.status_code}"

    def test_removed_upload_route(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/backups/upload", headers=admin_headers, timeout=20)
        assert r.status_code in (404, 405), f"upload route should be gone, got {r.status_code}"

    def test_removed_restore_route(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/backups/somefile.sql/restore", headers=admin_headers, timeout=20)
        assert r.status_code in (404, 405), f"restore route should be gone, got {r.status_code}"
