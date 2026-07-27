"""Iteration 28 — re-verification of iteration_27 fixes.

Covers:
  * corporate-tax-working numeric rounding (no float artefacts)
  * empty CSV exports emit a 'No data for the selected period.' notice
  * regression: all 14 report endpoints + exports still 200 for admin & CA
"""
import os
import re
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

REPORT_KEYS = [
    "monthly-sales", "quarterly-sales", "yearly-pl", "customer-recharge",
    "crypto-to-aed", "bank-reconciliation", "vat-threshold", "corporate-tax",
    "expenses", "suspicious", "sales-journal", "vat-return", "expense-ledger",
    "corporate-tax-working",
]
MONEY_RE = re.compile(r"^-?\d+(\.\d{1,2})?$")


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


def _assert_rounded(obj, path=""):
    """Recursively assert every float has <= 2 decimals."""
    bad = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            bad += _assert_rounded(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:50]):
            bad += _assert_rounded(v, f"{path}[{i}]")
    elif isinstance(obj, float):
        if not MONEY_RE.match(repr(obj)):
            bad.append((path, repr(obj)))
    return bad


# ---------------------------------------------------------------- rounding
class TestCorporateTaxRounding:
    def test_corporate_tax_working_rounded(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/corporate-tax-working?year=2026", timeout=90)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for f in ["revenue_aed", "total_expenses_aed", "gross_profit_aed"]:
            assert f in d, f"missing {f} in {list(d.keys())}"
            assert MONEY_RE.match(repr(float(d[f]))), f"{f} not rounded: {d[f]!r}"
        bad = _assert_rounded(d)
        assert not bad, f"unrounded floats: {bad}"

    def test_yearly_pl_rounded(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/yearly-pl?year=2026", timeout=90)
        assert r.status_code == 200
        bad = _assert_rounded(r.json())
        assert not bad, f"unrounded floats in yearly-pl: {bad}"

    def test_vat_return_rounded(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/reports/vat-return?year=2026", timeout=90)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d, dict) and len(d) > 0
        bad = _assert_rounded(d)
        assert not bad, f"unrounded floats in vat-return: {bad}"


# ------------------------------------------------------------- empty CSVs
class TestEmptyCsvNotice:
    @pytest.mark.parametrize("key", ["crypto-to-aed", "suspicious"])
    def test_empty_csv_has_notice(self, admin_client, key):
        r = admin_client.get(f"{BASE_URL}/api/reports/export/csv?report={key}&year=2026", timeout=90)
        assert r.status_code == 200, r.text[:300]
        body = r.content
        assert len(body) > 0, f"{key} CSV is 0 bytes"
        assert b"No data for the selected period" in body, f"{key} CSV body: {body[:200]!r}"


# ------------------------------------------------------------- regression
class TestReportsRegression:
    @pytest.mark.parametrize("key", REPORT_KEYS)
    def test_report_endpoint_200(self, admin_client, key):
        r = admin_client.get(f"{BASE_URL}/api/reports/{key}?year=2026", timeout=120)
        assert r.status_code == 200, f"{key} -> {r.status_code} {r.text[:200]}"
        assert r.json() is not None

    @pytest.mark.parametrize("key", ["vat-return", "corporate-tax-working", "expense-ledger", "sales-journal"])
    @pytest.mark.parametrize("fmt", ["csv", "excel", "pdf"])
    def test_exports_200(self, admin_client, key, fmt):
        r = admin_client.get(f"{BASE_URL}/api/reports/export/{fmt}?report={key}&year=2026", timeout=120)
        assert r.status_code == 200, f"{fmt}/{key} -> {r.status_code} {r.text[:200]}"
        assert len(r.content) > 0, f"{fmt}/{key} empty body"

    def test_ca_can_access_reports(self, ca_client):
        r = ca_client.get(f"{BASE_URL}/api/reports/monthly-sales?year=2026", timeout=90)
        assert r.status_code == 200, r.text[:200]

    @pytest.mark.parametrize("key", ["vat-return", "corporate-tax-working"])
    def test_ca_new_reports(self, ca_client, key):
        r = ca_client.get(f"{BASE_URL}/api/reports/{key}?year=2026", timeout=90)
        assert r.status_code == 200, r.text[:200]

    def test_rows_reports_have_row_arrays(self, admin_client):
        for key, field in [("monthly-sales", "rows"), ("quarterly-sales", "rows"),
                           ("expenses", "rows"), ("expense-ledger", "rows"), ("sales-journal", "rows")]:
            r = admin_client.get(f"{BASE_URL}/api/reports/{key}?year=2026", timeout=120)
            assert r.status_code == 200, key
            d = r.json()
            assert isinstance(d, dict) and isinstance(d.get(field), list), f"{key} has no {field} array"
