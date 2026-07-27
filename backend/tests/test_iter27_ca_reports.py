"""Iteration 27 — CA reports (sales-journal, vat-return, expense-ledger, corporate-tax-working)
plus regression on the original 10 reports and their CSV/Excel/PDF exports."""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"
YEAR = 2026

ADMIN = {"email": "admin@axistratech.com", "password": "admin123"}
CA = {"email": "ca@axistratech.com", "password": "ca123456"}

ORIGINAL_REPORTS = [
    "monthly-sales", "quarterly-sales", "yearly-pl", "customer-recharge",
    "crypto-to-aed", "bank-reconciliation", "vat-threshold", "corporate-tax",
    "expenses", "suspicious",
]
NEW_REPORTS = ["sales-journal", "vat-return", "expense-ledger", "corporate-tax-working"]


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"Login failed for {creds['email']}: {r.status_code} {r.text[:300]}")
    data = r.json()
    token = data.get("access_token") or data.get("token") or (data.get("data") or {}).get("access_token")
    if not token:
        pytest.fail(f"No token in login response: {str(data)[:300]}")
    return token


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


class TestAuthAndAccess:
    def test_admin_login(self, admin_client):
        r = admin_client.get(f"{API}/reports/dashboard/charts?year={YEAR}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert "kpis" in r.json()

    def test_unauthenticated_rejected(self):
        r = requests.get(f"{API}/reports/sales-journal?year={YEAR}", timeout=60)
        assert r.status_code == 401


# --- New CA reports ---
class TestNewCaReports:
    def test_sales_journal(self, admin_client):
        r = admin_client.get(f"{API}/reports/sales-journal?year={YEAR}", timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ["rows", "total_gross", "total_net", "total_vat", "count"]:
            assert k in d, f"missing {k}"
        assert isinstance(d["rows"], list)
        assert d["count"] == len(d["rows"])
        if d["rows"]:
            row = d["rows"][0]
            for k in ["net_amount", "vat_amount", "gross_amount"]:
                assert k in row
            assert abs(row["net_amount"] + row["vat_amount"] - row["gross_amount"]) < 0.05

    def test_vat_return(self, admin_client):
        r = admin_client.get(f"{API}/reports/vat-return?year={YEAR}", timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert isinstance(d.get("output_vat"), dict)
        assert isinstance(d.get("input_vat"), dict)
        assert "net_vat_payable_aed" in d
        assert d["status"] in ("PAYABLE", "REFUNDABLE")
        ov = d["output_vat"]["output_vat_aed"]
        iv = d["input_vat"]["input_vat_aed"]
        assert abs((ov - iv) - d["net_vat_payable_aed"]) < 0.05

    def test_vat_return_quarter(self, admin_client):
        r = admin_client.get(f"{API}/reports/vat-return?year={YEAR}&quarter=2", timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["quarter"] == 2
        assert d["period"]["from"].startswith(f"{YEAR}-04")

    def test_expense_ledger(self, admin_client):
        r = admin_client.get(f"{API}/reports/expense-ledger?year={YEAR}", timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert isinstance(d.get("rows"), list)
        assert isinstance(d.get("by_category"), dict)
        assert d["total_count"] == len(d["rows"])
        if d["rows"]:
            row = d["rows"][0]
            for k in ["date", "category", "gross_aed", "input_vat_aed", "net_aed"]:
                assert k in row

    def test_corporate_tax_working(self, admin_client):
        r = admin_client.get(f"{API}/reports/corporate-tax-working?year={YEAR}", timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ["revenue_aed", "gross_profit_aed", "total_estimated_tax_aed",
                  "first_bracket_threshold_aed", "second_bracket_taxable_aed"]:
            assert k in d, f"missing {k}"
        expected = round(max(0, d["gross_profit_aed"] - d["first_bracket_threshold_aed"]) * 0.09, 2)
        assert abs(d["total_estimated_tax_aed"] - expected) < 0.5


# --- Regression: original 10 reports ---
class TestOriginalReports:
    @pytest.mark.parametrize("key", ORIGINAL_REPORTS)
    def test_report_endpoint(self, admin_client, key):
        r = admin_client.get(f"{API}/reports/{key}?year={YEAR}", timeout=90)
        assert r.status_code == 200, f"{key}: {r.status_code} {r.text[:300]}"
        d = r.json()
        assert d is not None and d != {}


# --- Exports ---
EXPORTS = [
    ("csv", "text/csv"),
    ("excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ("pdf", "application/pdf"),
]


class TestExports:
    @pytest.mark.parametrize("key", NEW_REPORTS + ORIGINAL_REPORTS)
    @pytest.mark.parametrize("fmt,ctype", EXPORTS)
    def test_export(self, admin_client, key, fmt, ctype):
        r = admin_client.get(f"{API}/reports/export/{fmt}?report={key}&year={YEAR}", timeout=120)
        assert r.status_code == 200, f"{key}/{fmt}: {r.status_code} {r.text[:200]}"
        assert ctype in r.headers.get("Content-Type", ""), (
            f"{key}/{fmt} content-type={r.headers.get('Content-Type')}")
        assert len(r.content) > 0, f"{key}/{fmt} empty body"
        if fmt == "pdf":
            assert r.content[:4] == b"%PDF", f"{key} pdf magic missing"


class TestAccountantPack:
    def test_pack_zip(self, admin_client):
        import io
        import zipfile
        r = admin_client.get(f"{API}/reports/bundle/accountant-pack?year={YEAR}", timeout=240)
        assert r.status_code == 200, r.text[:300]
        assert "application/zip" in r.headers.get("Content-Type", "")
        z = zipfile.ZipFile(io.BytesIO(r.content))
        names = z.namelist()
        for key in NEW_REPORTS:
            assert any(key in n for n in names), f"{key} missing from pack: {names}"
        manifest = [n for n in names if n.startswith("MANIFEST")]
        assert manifest
        content = z.read(manifest[0]).decode()
        for key in NEW_REPORTS:
            assert key in content, f"{key} missing from manifest"


# --- CA role access ---
class TestCaAccess:
    @pytest.mark.parametrize("key", NEW_REPORTS)
    def test_ca_can_read_new_reports(self, ca_client, key):
        r = ca_client.get(f"{API}/reports/{key}?year={YEAR}", timeout=90)
        assert r.status_code == 200, f"CA {key}: {r.status_code} {r.text[:200]}"

    def test_ca_pdf_sales_journal(self, ca_client):
        r = ca_client.get(f"{API}/reports/export/pdf?report=sales-journal&year={YEAR}", timeout=120)
        assert r.status_code == 200, r.text[:200]
        assert r.content[:4] == b"%PDF"
