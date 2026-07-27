"""Iteration 29 — UAE VAT country-aware zero-rating fix.

Covers:
  * sales-journal  -> all non-UAE customers zero-rated (0% VAT)
  * vat-return     -> NIL RETURN, zero-rated box carries full gross
  * UAE positive path -> one UAE customer recharge becomes standard-rated 5%
  * regression on the other report endpoints
"""
import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

ADMIN = {"email": "admin@axistratech.com", "password": "admin123"}
CA = {"email": "ca@axistratech.com", "password": "ca123456"}

YEAR = 2026
EXPECTED_GROSS = 141777.61
EXPECTED_COUNT = 1105


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"login failed {r.status_code}: {r.text[:300]}")
    body = r.json()
    tok = body.get("access_token") or body.get("token") or (body.get("data") or {}).get("access_token")
    if not tok:
        pytest.fail(f"no token in login response: {str(body)[:300]}")
    return tok


@pytest.fixture(scope="session")
def admin_client():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {_login(ADMIN)}"})
    return s


@pytest.fixture(scope="session")
def ca_client():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {_login(CA)}"})
    return s


# ------------------------------------------------------- sales journal
class TestSalesJournalZeroRated:
    def test_totals(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/sales-journal?year={YEAR}", timeout=120)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["total_vat"] == 0, f"total_vat={d['total_vat']}"
        assert d["total_net"] == EXPECTED_GROSS, d["total_net"]
        assert d["total_gross"] == EXPECTED_GROSS, d["total_gross"]
        assert d["zero_rated_count"] == EXPECTED_COUNT, d["zero_rated_count"]
        assert d["standard_rated_count"] == 0, d["standard_rated_count"]
        assert d["zero_rated_gross"] == EXPECTED_GROSS
        assert d["standard_rated_gross"] == 0
        assert "zero-rated" in str(d.get("note", "")).lower()

    def test_rows_zero_rated(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/sales-journal?year={YEAR}", timeout=120)
        assert r.status_code == 200
        rows = r.json()["rows"]
        assert len(rows) == EXPECTED_COUNT
        for row in rows[:5] + rows[-5:]:
            assert row["vat_amount"] == 0, row
            assert row["vat_treatment"] == "Zero-rated export", row
            assert row["vat_rate_pct"] == 0, row
            assert row["net_amount"] == row["gross_amount"], row

    def test_no_standard_rated_row_anywhere(self, admin_client):
        rows = admin_client.get(f"{BASE_URL}/api/reports/sales-journal?year={YEAR}", timeout=120).json()["rows"]
        bad = [r for r in rows if r["vat_amount"] != 0 or r["vat_rate_pct"] != 0]
        assert not bad, f"{len(bad)} rows still VAT-charged, e.g. {bad[:2]}"


# ---------------------------------------------------------- vat return
class TestVatReturnNil:
    def test_nil_return(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/vat-return?year={YEAR}", timeout=120)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["standard_rated_sales"]["count"] == 0, d["standard_rated_sales"]
        assert d["standard_rated_sales"]["output_vat_aed"] == 0
        assert d["standard_rated_sales"]["gross_aed"] == 0
        assert d["zero_rated_sales"]["count"] == EXPECTED_COUNT, d["zero_rated_sales"]
        assert d["zero_rated_sales"]["gross_aed"] == EXPECTED_GROSS, d["zero_rated_sales"]
        assert d["zero_rated_sales"]["rate_pct"] == 0
        assert d["net_vat_payable_aed"] == 0, d["net_vat_payable_aed"]
        assert d["status"] == "NIL RETURN", d["status"]
        assert d.get("note")


# ----------------------------------------------------- UAE positive path
class TestUaeCustomerStandardRated:
    def test_uae_customer_is_standard_rated(self, admin_client):
        cust_id = None
        rech_id = None
        inv_id = None
        try:
            cr = admin_client.post(f"{BASE_URL}/api/customers", json={
                "full_name": "TEST_UAE VAT Probe",
                "email": "test_uae_vat_probe@example.test",
                "country": "UAE",
                "status": "active",
            }, timeout=60)
            assert cr.status_code in (200, 201), cr.text[:300]
            cust = cr.json()
            cust_id = cust.get("id") or (cust.get("data") or {}).get("id")
            assert cust_id, cust

            rr = admin_client.post(f"{BASE_URL}/api/recharges", json={
                "customer_id": cust_id,
                "amount": 105,
                "currency": "AED",
                "payment_gateway": "Binance",
                "crypto_coin": "USDT",
                "crypto_network": "TRC20",
                "admin_notes": "TEST_iter29 vat probe",
            }, timeout=60)
            assert rr.status_code in (200, 201), rr.text[:300]
            rec = rr.json()
            rech_id = rec.get("id") or (rec.get("data") or {}).get("id")
            inv_id = rec.get("invoice_id") or (rec.get("data") or {}).get("invoice_id")
            assert rech_id, rec

            sj = admin_client.get(f"{BASE_URL}/api/reports/sales-journal?year={YEAR}", timeout=120).json()
            assert sj["standard_rated_count"] == 1, sj["standard_rated_count"]
            std = [r for r in sj["rows"] if r["vat_rate_pct"] > 0]
            assert len(std) == 1, len(std)
            row = std[0]
            assert row["vat_treatment"] == "Standard-rated 5%", row
            assert row["vat_amount"] == 5, row
            assert row["net_amount"] == 100, row
            assert row["gross_amount"] == 105, row
            assert sj["zero_rated_count"] == EXPECTED_COUNT

            vr = admin_client.get(f"{BASE_URL}/api/reports/vat-return?year={YEAR}", timeout=120).json()
            assert vr["standard_rated_sales"]["count"] == 1, vr["standard_rated_sales"]
            assert vr["standard_rated_sales"]["output_vat_aed"] == 5, vr["standard_rated_sales"]
            assert vr["status"] in ("PAYABLE", "REFUNDABLE"), vr["status"]
        finally:
            if rech_id:
                admin_client.delete(f"{BASE_URL}/api/recharges/{rech_id}", timeout=60)
            if inv_id:
                admin_client.delete(f"{BASE_URL}/api/invoices/{inv_id}", timeout=60)
            if cust_id:
                admin_client.delete(f"{BASE_URL}/api/customers/{cust_id}", timeout=60)

    def test_baseline_restored_after_cleanup(self, admin_client):
        sj = admin_client.get(f"{BASE_URL}/api/reports/sales-journal?year={YEAR}", timeout=120).json()
        assert sj["standard_rated_count"] == 0, sj["standard_rated_count"]
        assert sj["zero_rated_count"] == EXPECTED_COUNT, sj["zero_rated_count"]
        assert sj["total_gross"] == EXPECTED_GROSS, sj["total_gross"]
        vr = admin_client.get(f"{BASE_URL}/api/reports/vat-return?year={YEAR}", timeout=120).json()
        assert vr["status"] == "NIL RETURN", vr["status"]


# ----------------------------------------------------------- regression
class TestOtherReportsRegression:
    @pytest.mark.parametrize("key", [
        "monthly-sales", "quarterly-sales", "yearly-pl", "expense-ledger",
        "corporate-tax-working", "expenses",
    ])
    def test_report_200(self, admin_client, key):
        r = admin_client.get(f"{BASE_URL}/api/reports/{key}?year={YEAR}", timeout=120)
        assert r.status_code == 200, f"{key} -> {r.status_code} {r.text[:200]}"
        assert r.json() is not None

    @pytest.mark.parametrize("key", ["sales-journal", "vat-return", "monthly-sales"])
    def test_ca_access(self, ca_client, key):
        r = ca_client.get(f"{BASE_URL}/api/reports/{key}?year={YEAR}", timeout=120)
        assert r.status_code == 200, f"{key} -> {r.status_code} {r.text[:200]}"

    @pytest.mark.parametrize("fmt", ["csv", "excel", "pdf"])
    def test_sales_journal_exports(self, admin_client, fmt):
        r = admin_client.get(f"{BASE_URL}/api/reports/export/{fmt}?report=sales-journal&year={YEAR}", timeout=120)
        assert r.status_code == 200, f"{fmt} -> {r.status_code} {r.text[:200]}"
        assert len(r.content) > 0
