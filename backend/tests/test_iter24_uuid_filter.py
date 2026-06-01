"""
Iteration 24 — verify TypeOrmExceptionFilter
- Non-UUID :id param → 404 (no longer 500)
- Real-UUID lookup still works
- Valid UUID but non-existent → 404
- Customer code lookup (regression) → 200/404
- Auth & validation pipes still work
"""
import os
import pytest
import requests
import uuid

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"No token in response: {data}"
    return tok


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# -- Module: Non-UUID :id parameters must return 404, NOT 500 ---------------
NON_UUID_ENDPOINTS = [
    "/api/recharges/RCH-2026-99999",
    "/api/payroll/items/ITEM-XYZ",
    "/api/payroll/runs/MAY-2026",
    "/api/invoices/AX-2026-001",
    "/api/treasury/batches/BATCH-X",
    "/api/expenses/foo-bar",
    "/api/tax/some-bad-id",
    "/api/contracts/abc",
    "/api/corporate-docs/xyz",
]


@pytest.mark.parametrize("ep", NON_UUID_ENDPOINTS)
def test_non_uuid_id_returns_404_not_500(auth_headers, ep):
    r = requests.get(f"{BASE_URL}{ep}", headers=auth_headers, timeout=20)
    assert r.status_code != 500, f"{ep} returned 500 (filter not catching): {r.text[:200]}"
    assert r.status_code == 404, f"{ep} expected 404, got {r.status_code}: {r.text[:200]}"


# -- Module: Real UUID lookup still works -----------------------------------
def test_real_uuid_employee_returns_200(auth_headers):
    list_resp = requests.get(f"{BASE_URL}/api/payroll/employees", headers=auth_headers, timeout=20)
    assert list_resp.status_code == 200, f"List employees failed: {list_resp.status_code}"
    employees = list_resp.json()
    if isinstance(employees, dict) and "items" in employees:
        employees = employees["items"]
    if isinstance(employees, dict) and "data" in employees:
        employees = employees["data"]
    if not employees:
        pytest.skip("No employees seeded — skipping real-UUID lookup")
    emp_id = employees[0].get("id")
    assert emp_id, f"No id field in employee: {employees[0]}"
    r = requests.get(f"{BASE_URL}/api/payroll/employees/{emp_id}", headers=auth_headers, timeout=20)
    assert r.status_code == 200, f"Real UUID lookup failed: {r.status_code} {r.text[:200]}"


def test_nonexistent_valid_uuid_returns_404(auth_headers):
    fake = "00000000-0000-0000-0000-000000000000"
    r = requests.get(f"{BASE_URL}/api/payroll/employees/{fake}", headers=auth_headers, timeout=20)
    assert r.status_code == 404, f"Expected 404 for non-existent UUID, got {r.status_code}: {r.text[:200]}"


# -- Module: Customer regression (code lookup vs not-found) -----------------
def test_customer_code_lookup_works(auth_headers):
    r = requests.get(f"{BASE_URL}/api/customers/AXC-00001", headers=auth_headers, timeout=20)
    assert r.status_code == 200, f"Customer code lookup failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    assert data.get("code") == "AXC-00001" or data.get("customerCode") == "AXC-00001" or "AXC-00001" in str(data)


def test_customer_code_notfound_returns_404(auth_headers):
    r = requests.get(f"{BASE_URL}/api/customers/AXC-99999", headers=auth_headers, timeout=20)
    assert r.status_code == 404, f"Expected 404 for unknown customer code, got {r.status_code}"


# -- Module: Auth & validation regressions ---------------------------------
def test_invalid_login_returns_401_not_500():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "bogus@example.com", "password": "wrongpass"},
        timeout=20,
    )
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text[:200]}"


def test_validation_pipe_returns_400_on_missing_fields(auth_headers):
    r = requests.post(f"{BASE_URL}/api/customers", headers=auth_headers, json={}, timeout=20)
    assert r.status_code == 400, f"Expected 400 from validation pipe, got {r.status_code}: {r.text[:200]}"
    body = r.json()
    assert "message" in body or "errors" in body, f"No structured error: {body}"
