"""Phase 2 backend tests: invoice A/B PDFs, reports/charts dashboard,
report PDF/Excel exports and Month-End ZIP bundle."""
import io
import os
import zipfile
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
                      timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="session")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def invoice_id(auth):
    r = requests.get(f"{BASE_URL}/api/invoices", headers=auth, timeout=30)
    assert r.status_code == 200, r.text[:200]
    data = r.json()
    arr = data if isinstance(data, list) else (data.get("rows") or data.get("data") or [])
    assert arr, "No invoices in DB to test PDF rendering"
    return arr[0].get("id") or arr[0].get("invoice_id") or arr[0].get("_id")


# ---------- Invoice PDF/HTML A/B ----------

class TestInvoiceAB:
    def test_pdf_default_branded(self, auth, invoice_id):
        r = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}/pdf", headers=auth, timeout=120)
        assert r.status_code == 200, r.text[:200]
        head = r.content[:4]
        assert head == b"%PDF", f"Not a PDF, got magic={head!r} ct={r.headers.get('Content-Type')}"

    def test_pdf_branded(self, auth, invoice_id):
        r = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}/pdf?style=branded", headers=auth, timeout=120)
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF"

    def test_pdf_minimal(self, auth, invoice_id):
        r = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}/pdf?style=minimal", headers=auth, timeout=120)
        assert r.status_code == 200
        assert r.content[:4] == b"%PDF", f"minimal not PDF magic={r.content[:6]!r}"

    def test_html_minimal_contains_sections(self, auth, invoice_id):
        r = requests.get(f"{BASE_URL}/api/invoices/{invoice_id}/html?style=minimal", headers=auth, timeout=60)
        assert r.status_code == 200
        html = r.text
        assert "Tax Invoice" in html, "missing 'Tax Invoice'"
        # at least one of the secondary sections should be present
        assert any(s in html for s in ["Billed To", "Payment Trace", "Legal & Tax"]), \
            "missing key sections in minimal template"


# ---------- Reports dashboard / charts ----------

class TestChartsDashboard:
    def test_charts_2026(self, auth):
        r = requests.get(f"{BASE_URL}/api/reports/dashboard/charts?year=2026", headers=auth, timeout=60)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        for key in ["kpis", "monthly_trend", "top_customers", "payment_method_split", "gateway_split"]:
            assert key in d, f"missing key {key}"
        kpis = d["kpis"]
        for k in ["total_sales", "total_expenses", "gross_profit", "net_profit", "vat_progress_pct", "vat_remaining_aed"]:
            assert k in kpis, f"missing kpi {k}"
        assert isinstance(d["monthly_trend"], list) and len(d["monthly_trend"]) > 0, "monthly_trend empty"
        assert isinstance(d["top_customers"], list) and len(d["top_customers"]) > 0, "top_customers empty"
        assert isinstance(d["payment_method_split"], list) and len(d["payment_method_split"]) > 0, "payment_method_split empty"
        assert isinstance(d["gateway_split"], list) and len(d["gateway_split"]) > 0, "gateway_split empty"


# ---------- Report PDF/Excel exports ----------

REPORTS_PDF = ["yearly-pl", "vat-threshold", "corporate-tax", "bank-reconciliation"]


class TestReportExports:
    @pytest.mark.parametrize("rep", REPORTS_PDF)
    def test_pdf_export(self, auth, rep):
        url = f"{BASE_URL}/api/reports/export/pdf?report={rep}&year=2026"
        r = requests.get(url, headers=auth, timeout=180)
        assert r.status_code == 200, r.text[:200]
        magic = r.content[:4]
        assert magic == b"%PDF", f"{rep} PDF magic={magic!r} (chrome fallback to HTML?)"

    def test_excel_yearly_pl(self, auth):
        r = requests.get(f"{BASE_URL}/api/reports/export/excel?report=yearly-pl&year=2026", headers=auth, timeout=60)
        assert r.status_code == 200
        assert r.content[:2] == b"PK", f"xlsx magic={r.content[:4]!r}"


# ---------- Month-End ZIP bundle ----------

class TestMonthEndBundle:
    def test_bundle_zip_contents(self, auth):
        r = requests.get(f"{BASE_URL}/api/reports/bundle/month-end?year=2026&month=05",
                         headers=auth, timeout=240)
        assert r.status_code == 200, r.text[:200]
        ct = r.headers.get("Content-Type", "")
        assert "application/zip" in ct or "octet-stream" in ct, f"unexpected CT {ct}"
        assert r.content[:2] == b"PK", "not a ZIP"

        z = zipfile.ZipFile(io.BytesIO(r.content))
        names = z.namelist()
        expected = [
            "00-Cover-2026-05.pdf",
            "01-yearly-pl-2026-05.pdf", "01-yearly-pl-2026-05.xlsx",
            "02-vat-threshold-2026-05.pdf", "02-vat-threshold-2026-05.xlsx",
            "03-corporate-tax-2026-05.pdf", "03-corporate-tax-2026-05.xlsx",
            "04-bank-reconciliation-2026-05.pdf", "04-bank-reconciliation-2026-05.xlsx",
        ]
        for e in expected:
            assert e in names, f"missing {e} in {names}"
        assert len(names) == 9, f"expected 9 entries got {len(names)}: {names}"

        # validate magic for each
        for n in names:
            data = z.read(n)
            if n.endswith(".pdf"):
                assert data[:4] == b"%PDF", f"{n} not a PDF (magic={data[:6]!r})"
            elif n.endswith(".xlsx"):
                assert data[:2] == b"PK", f"{n} not xlsx (magic={data[:4]!r})"


# ---------- Regression ----------

class TestRegression:
    def test_wallets_overview(self, auth):
        r = requests.get(f"{BASE_URL}/api/wallets/overview", headers=auth, timeout=30)
        assert r.status_code == 200
        d = r.json()
        wallets = d.get("wallets") if isinstance(d, dict) else d
        assert isinstance(wallets, list) and len(wallets) == 5, f"expected 5 wallets, got {wallets}"

    def test_chain_search(self, auth):
        r = requests.get(f"{BASE_URL}/api/chain/search?q=0x", headers=auth, timeout=30)
        assert r.status_code in (200, 204), r.text[:200]
