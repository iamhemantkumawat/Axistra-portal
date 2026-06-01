"""
Iteration 25 backend tests:
  1) POST /api/customers DTO hardening (CreateCustomerDto + ensureHasIdentifier)
  2) GET /api/payroll/employees/:uuid/history returns ordered list, no sign_token leak
"""

import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"
HEMANT_ID = "3ec19cce-834d-42e3-81e0-f1840a42482c"

_created_customer_ids = []


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=20,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"No token in login response: {data}"
    return token


@pytest.fixture(scope="session")
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session", autouse=True)
def cleanup(admin_token):
    yield
    headers = {"Authorization": f"Bearer {admin_token}"}
    for cid in _created_customer_ids:
        try:
            requests.delete(f"{BASE_URL}/api/customers/{cid}", headers=headers, timeout=10)
        except Exception:
            pass


# -------- Customer DTO tests --------

class TestCreateCustomerDto:
    def test_empty_body_returns_400(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/customers", headers=auth_headers, json={}, timeout=15)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        body = r.json()
        msg = body.get("message", "")
        msg_str = " ".join(msg) if isinstance(msg, list) else str(msg)
        assert "required" in msg_str.lower() or "at least one" in msg_str.lower(), (
            f"Expected message about required identifier, got: {body}"
        )

    def test_valid_body_returns_201(self, auth_headers):
        payload = {
            "first_name": "TESTITER25",
            "last_name": "Valid",
            "email": "test_iter25_valid@example.com",
            "magnus_username": "test_iter25_valid_user",
        }
        r = requests.post(f"{BASE_URL}/api/customers", headers=auth_headers, json=payload, timeout=15)
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        data = r.json()
        assert "id" in data
        assert data.get("first_name") == "TESTITER25"
        assert data.get("email") == "test_iter25_valid@example.com"
        _created_customer_ids.append(data["id"])

    def test_invalid_email_returns_400(self, auth_headers):
        payload = {"first_name": "Bob", "email": "not-an-email"}
        r = requests.post(f"{BASE_URL}/api/customers", headers=auth_headers, json=payload, timeout=15)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        body = r.json()
        msg = body.get("message", "")
        msg_str = " ".join(msg) if isinstance(msg, list) else str(msg)
        assert "email" in msg_str.lower(), f"Expected email validation error, got: {body}"

    def test_single_identifier_magnus_only_returns_201(self, auth_headers):
        payload = {"magnus_username": "test_iter25_just_user"}
        r = requests.post(f"{BASE_URL}/api/customers", headers=auth_headers, json=payload, timeout=15)
        assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("magnus_username") == "test_iter25_just_user"
        _created_customer_ids.append(data["id"])

    def test_invalid_status_enum_returns_400(self, auth_headers):
        payload = {"first_name": "TESTITER25_X", "status": "invalid_status"}
        r = requests.post(f"{BASE_URL}/api/customers", headers=auth_headers, json=payload, timeout=15)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
        body = r.json()
        msg = body.get("message", "")
        msg_str = " ".join(msg) if isinstance(msg, list) else str(msg)
        assert "status" in msg_str.lower(), f"Expected status validation error, got: {body}"


# -------- Payroll history endpoint tests --------

class TestEmployeeHistory:
    def test_history_returns_array(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/payroll/employees/{HEMANT_ID}/history",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Expected at least one history event for Hemant"

    def test_history_event_types(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/payroll/employees/{HEMANT_ID}/history",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        types = {evt.get("change_type") or evt.get("type") for evt in data}
        # Expect at least initial_offer + salary_change present
        assert any(t in types for t in ("initial_offer",)), f"Missing initial_offer in {types}"
        assert any(t in types for t in ("salary_change",)), f"Missing salary_change in {types}"

    def test_history_strips_sign_token_but_keeps_flag(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/payroll/employees/{HEMANT_ID}/history",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        for evt in data:
            assert "sign_token" not in evt, f"sign_token leaked in event: {evt}"
            assert "has_sign_token" in evt, f"has_sign_token missing in event: {evt}"
            assert isinstance(evt["has_sign_token"], bool)

    def test_history_sorted_by_effective_date_desc(self, auth_headers):
        r = requests.get(
            f"{BASE_URL}/api/payroll/employees/{HEMANT_ID}/history",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        dates = [evt.get("effective_date") for evt in data if evt.get("effective_date")]
        assert dates == sorted(dates, reverse=True), f"History not sorted desc: {dates}"

    def test_history_unknown_uuid_returns_empty_or_404(self, auth_headers):
        # Valid UUID format but unknown — should not 500
        r = requests.get(
            f"{BASE_URL}/api/payroll/employees/00000000-0000-0000-0000-000000000000/history",
            headers=auth_headers,
            timeout=15,
        )
        assert r.status_code in (200, 404), f"Expected 200/404, got {r.status_code}: {r.text}"
        if r.status_code == 200:
            assert r.json() == []
