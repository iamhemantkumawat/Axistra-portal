"""Iteration 22 tests:
- /api/dashboard/net-worth JSON
- /api/dashboard/net-worth/pdf PDF
- /api/customers/AXC-XXXXX (404 vs 200)
- /api/customers/<UUID> backwards compat
- PATCH /api/customers/AXC-00001 smoke test
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://crypto-audit-chain.preview.emergentagent.com').rstrip('/')


@pytest.fixture(scope='session')
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@axistratech.com",
        "password": "admin123",
    }, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    tok = body.get('token') or body.get('access_token')
    assert tok, f"No token in login response: {body}"
    return tok


@pytest.fixture(scope='session')
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# ---------- Dashboard Net Worth ----------

class TestNetWorth:
    def test_net_worth_json_shape(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/net-worth", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        for k in ['assets', 'liabilities', 'total_assets_aed', 'total_liabilities_aed',
                  'net_worth_aed', 'ytd_revenue_aed', 'ytd_expenses_aed', 'reconciliation',
                  'reference_number', 'as_of']:
            assert k in data, f"Missing key '{k}'"
        assert isinstance(data['assets'], list)
        assert isinstance(data['liabilities'], list)
        assert isinstance(data['total_assets_aed'], (int, float))
        assert isinstance(data['total_liabilities_aed'], (int, float))
        assert isinstance(data['net_worth_aed'], (int, float))
        # Math consistency
        assert abs(data['net_worth_aed'] - (data['total_assets_aed'] - data['total_liabilities_aed'])) < 0.01
        # Reconciliation block
        rec = data['reconciliation']
        for k in ['pending_recharges', 'mismatches', 'open_invoices', 'drift_to_settle_aed']:
            assert k in rec, f"Missing reconciliation key '{k}'"

    def test_net_worth_pdf(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/net-worth/pdf", headers=auth_headers, timeout=60)
        assert r.status_code == 200, f"PDF endpoint returned {r.status_code}: {r.text[:200]}"
        assert r.headers.get('content-type', '').startswith('application/pdf'), \
            f"Content-Type was {r.headers.get('content-type')}"
        cd = r.headers.get('content-disposition', '')
        assert 'attachment' in cd.lower() and '.pdf' in cd.lower(), f"Bad Content-Disposition: {cd}"
        assert r.content[:4] == b'%PDF', f"PDF magic bytes wrong: {r.content[:8]}"
        assert len(r.content) > 1000, f"PDF too small: {len(r.content)} bytes"

    def test_net_worth_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/dashboard/net-worth", timeout=15)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"


# ---------- Customers lookup by code vs UUID ----------

class TestCustomerLookup:
    def test_non_existent_code_returns_404(self, auth_headers):
        """Regression: previously returned 500 because Postgres rejected non-UUID."""
        r = requests.get(f"{BASE_URL}/api/customers/AXC-99999", headers=auth_headers, timeout=15)
        assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.text[:200]}"

    def test_invalid_format_returns_404(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/customers/not-a-valid-id", headers=auth_headers, timeout=15)
        assert r.status_code == 404, f"Expected 404 for invalid id, got {r.status_code}: {r.text[:200]}"

    def test_valid_code_returns_customer(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/customers/AXC-00001", headers=auth_headers, timeout=15)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
        data = r.json()
        assert data.get('customer_code') == 'AXC-00001'
        assert 'id' in data
        # Save uuid for next test via class-level cache
        TestCustomerLookup._uuid = data['id']

    def test_uuid_lookup_backwards_compat(self, auth_headers):
        uuid = getattr(TestCustomerLookup, '_uuid', None)
        if not uuid:
            # Resolve UUID if previous test didn't run
            rr = requests.get(f"{BASE_URL}/api/customers/AXC-00001", headers=auth_headers, timeout=15)
            assert rr.status_code == 200
            uuid = rr.json()['id']
        r = requests.get(f"{BASE_URL}/api/customers/{uuid}", headers=auth_headers, timeout=15)
        assert r.status_code == 200, f"UUID lookup failed: {r.status_code} {r.text[:200]}"
        assert r.json().get('id') == uuid
        assert r.json().get('customer_code') == 'AXC-00001'

    def test_patch_by_customer_code(self, auth_headers):
        """Smoke test — PATCH /api/customers/AXC-00001 should accept code."""
        r = requests.patch(
            f"{BASE_URL}/api/customers/AXC-00001",
            json={"notes": "TEST_iter22_patch_via_code"},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code in (200, 201), f"PATCH via code failed: {r.status_code} {r.text[:300]}"
        # GET back to verify persistence
        rg = requests.get(f"{BASE_URL}/api/customers/AXC-00001", headers=auth_headers, timeout=15)
        assert rg.status_code == 200
        assert rg.json().get('notes') == "TEST_iter22_patch_via_code"

    def test_patch_non_existent_code_returns_404(self, auth_headers):
        r = requests.patch(
            f"{BASE_URL}/api/customers/AXC-99999",
            json={"notes": "x"},
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 404, f"Expected 404 for PATCH on missing code, got {r.status_code}"
