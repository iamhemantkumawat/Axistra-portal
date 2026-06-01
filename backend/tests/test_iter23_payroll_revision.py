"""
Iteration 23 — Payroll Offer Letter / Salary Revision PDF flow.

Verifies that GET /api/payroll/employees/:id/offer-letter.pdf returns:
  1. An 'offer-letter-' PDF when no salary_change exists for the employee.
  2. A 'salary-revision-' PDF that reflects the LATEST salary_change after
     POST /api/payroll/employees/:id/change-salary.
  3. The most recent revision (not the first) when multiple changes exist.
"""
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://crypto-audit-chain.preview.emergentagent.com').rstrip('/')
ADMIN_EMAIL = 'admin@axistratech.com'
ADMIN_PASSWORD = 'admin123'


@pytest.fixture(scope='module')
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={'email': ADMIN_EMAIL, 'password': ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    tok = data.get('token') or data.get('access_token')
    assert tok, f"no token in login response: {data}"
    return tok


@pytest.fixture(scope='module')
def headers(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


def _get_pdf(emp_id, headers):
    r = requests.get(f"{BASE_URL}/api/payroll/employees/{emp_id}/offer-letter.pdf",
                     headers=headers, timeout=30)
    return r


def _filename_from_response(r):
    cd = r.headers.get('content-disposition', '')
    m = re.search(r'filename="?([^";]+)"?', cd)
    return m.group(1) if m else ''


def _create_test_employee(headers):
    """Create a fresh employee so we control the no-revision baseline."""
    payload = {
        'full_name': 'TEST_PDFFlow Employee',
        'position': 'QA Engineer',
        'monthly_salary': '12000',
        'salary_currency': 'AED',
        'start_date': '2026-01-15',
        'status': 'active',
    }
    r = requests.post(f"{BASE_URL}/api/payroll/employees",
                      headers=headers, json=payload, timeout=20)
    assert r.status_code in (200, 201), f"create employee failed: {r.status_code} {r.text[:300]}"
    return r.json()


def test_offer_letter_before_revision_returns_offer_pdf(headers):
    emp = _create_test_employee(headers)
    emp_id = emp['id']
    pytest.test_emp_id = emp_id  # share across tests

    r = _get_pdf(emp_id, headers)
    assert r.status_code == 200, f"expected 200 got {r.status_code} body={r.text[:200]}"
    assert r.headers.get('content-type', '').startswith('application/pdf'), \
        f"wrong content-type: {r.headers.get('content-type')}"
    assert r.content[:4] == b'%PDF', f"not a PDF: {r.content[:8]!r}"

    fname = _filename_from_response(r)
    assert fname.startswith('offer-letter-'), \
        f"expected 'offer-letter-' filename, got '{fname}'"
    assert len(r.content) > 1000, f"PDF too small: {len(r.content)}"


def test_change_salary_then_offer_letter_returns_revision_pdf(headers):
    emp_id = getattr(pytest, 'test_emp_id', None)
    assert emp_id, "previous test must run first"

    # POST salary change
    body = {'new_salary': 18000, 'effective_date': '2026-07-01',
            'reason': 'Iter23 first revision'}
    r = requests.post(f"{BASE_URL}/api/payroll/employees/{emp_id}/change-salary",
                      headers=headers, json=body, timeout=30)
    assert r.status_code in (200, 201), f"change-salary failed: {r.status_code} {r.text[:300]}"
    change = r.json()
    assert change.get('new_salary') in ('18000', 18000, '18000.00')
    pytest.first_ref = change.get('reference_number')

    time.sleep(0.5)
    r = _get_pdf(emp_id, headers)
    assert r.status_code == 200
    assert r.content[:4] == b'%PDF'
    fname = _filename_from_response(r)
    assert fname.startswith('salary-revision-'), \
        f"expected 'salary-revision-' filename, got '{fname}'"
    # Filename should contain reference number from the change
    if pytest.first_ref:
        assert pytest.first_ref in fname, \
            f"filename '{fname}' should contain ref '{pytest.first_ref}'"


def test_second_salary_change_serves_latest_revision(headers):
    emp_id = getattr(pytest, 'test_emp_id', None)
    assert emp_id

    body = {'new_salary': 22000, 'effective_date': '2026-09-01',
            'reason': 'Iter23 second revision'}
    r = requests.post(f"{BASE_URL}/api/payroll/employees/{emp_id}/change-salary",
                      headers=headers, json=body, timeout=30)
    assert r.status_code in (200, 201), f"second change failed: {r.status_code} {r.text[:300]}"
    second_ref = r.json().get('reference_number')
    assert second_ref and second_ref != pytest.first_ref, \
        f"second ref ({second_ref}) should differ from first ({pytest.first_ref})"

    time.sleep(0.5)
    r = _get_pdf(emp_id, headers)
    assert r.status_code == 200
    fname = _filename_from_response(r)
    assert fname.startswith('salary-revision-')
    assert second_ref in fname, \
        f"latest revision ref '{second_ref}' should be in filename '{fname}'"
    assert pytest.first_ref not in fname or pytest.first_ref == second_ref, \
        f"first revision ref '{pytest.first_ref}' should NOT be served anymore"


def test_payroll_employees_list_renders(headers):
    r = requests.get(f"{BASE_URL}/api/payroll/employees", headers=headers, timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)


def test_dashboard_customers_recharges_smoke(headers):
    """Regression smoke for pages that share imports with Treasury."""
    for path in ['/api/dashboard/kpis', '/api/customers', '/api/recharges']:
        r = requests.get(f"{BASE_URL}{path}", headers=headers, timeout=20)
        assert r.status_code in (200, 204), f"{path} → {r.status_code} {r.text[:200]}"
