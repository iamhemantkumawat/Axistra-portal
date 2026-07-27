"""Iteration 26 — sign-letter public flow + chartered_accountant role."""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

PRIMARY_TOKEN = "8A70g4Y74SJ33u3qNCaWOWJWODEWliBL"   # reserved for UI test
BACKUP_TOKEN = "CcpGK6PN3DTWDEyKRSmdecGLkyhYt7-T"    # used for POST agree here

CA_EMAIL, CA_PASS = "ca@axistratech.com", "ca123456"
ADMIN_EMAIL, ADMIN_PASS = "admin@axistratech.com", "admin123"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Module: public sign-letter (token auth) ----------
class TestSignLetter:
    def test_get_primary_token_returns_document(self, client):
        r = client.get(f"{BASE_URL}/api/sign-letter/{PRIMARY_TOKEN}", timeout=30)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["change_type"] == "salary_change"
        assert d["reference_number"]
        assert d["employee_name"]
        assert d["employer"]
        assert d["director_name"]
        assert "_id" not in d
        assert d["sign_status"] in ("pending", "agreed", "declined")

    def test_get_invalid_token_404(self, client):
        r = client.get(f"{BASE_URL}/api/sign-letter/notarealtoken123", timeout=30)
        assert r.status_code in (400, 404), r.status_code
        assert "message" in r.json()

    def test_post_agree_backup_token_and_persist(self, client):
        pre = client.get(f"{BASE_URL}/api/sign-letter/{BACKUP_TOKEN}", timeout=30)
        assert pre.status_code == 200, pre.text[:400]
        pre_doc = pre.json()

        payload = {"decision": "agreed", "signature": pre_doc["employee_name"], "signature_method": "typed"}
        r = client.post(f"{BASE_URL}/api/sign-letter/{BACKUP_TOKEN}", json=payload, timeout=60)

        if pre_doc["sign_status"] == "pending":
            assert r.status_code in (200, 201), r.text[:600]
            data = r.json()
            assert data["status"] == "agreed"
            assert data.get("signed_at")
        else:
            # already signed earlier -> server must reject re-signing
            assert r.status_code in (400, 409), r.text[:400]

        # GET verifies persistence
        post = client.get(f"{BASE_URL}/api/sign-letter/{BACKUP_TOKEN}", timeout=30)
        assert post.status_code == 200
        assert post.json()["sign_status"] == "agreed"
        assert post.json()["signed_at"]

    def test_post_invalid_token_rejected(self, client):
        r = client.post(
            f"{BASE_URL}/api/sign-letter/notarealtoken123",
            json={"decision": "agreed", "signature": "X", "signature_method": "typed"},
            timeout=30,
        )
        assert r.status_code in (400, 404), r.status_code


# ---------- Module: auth / chartered_accountant role ----------
class TestRoles:
    def test_ca_login(self, client):
        r = client.post(f"{BASE_URL}/api/auth/login", json={"email": CA_EMAIL, "password": CA_PASS}, timeout=30)
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        assert d.get("access_token") or d.get("token"), d
        user = d.get("user") or {}
        assert user.get("role") == "chartered_accountant", d
        assert not d.get("must_setup_2fa"), "CA should not be forced into 2FA"

    def test_admin_login(self, client):
        r = client.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        user = d.get("user") or {}
        assert user.get("role") == "admin", d

    def test_ca_bad_password_401(self, client):
        r = client.post(f"{BASE_URL}/api/auth/login", json={"email": CA_EMAIL, "password": "wrongpass"}, timeout=30)
        assert r.status_code == 401, r.status_code

    def test_ca_token_can_read_finance_surface(self, client):
        r = client.post(f"{BASE_URL}/api/auth/login", json={"email": CA_EMAIL, "password": CA_PASS}, timeout=30)
        tok = r.json().get("access_token") or r.json().get("token")
        h = {"Authorization": f"Bearer {tok}"}
        for path in ("/api/customers", "/api/invoices", "/api/expenses"):
            resp = client.get(f"{BASE_URL}{path}", headers=h, timeout=45)
            assert resp.status_code == 200, f"{path} -> {resp.status_code} {resp.text[:200]}"
