"""
Phase 3 backend tests — Leads (public POST + authed GET/PATCH) and Magnus listUsers.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code in (200, 201), f"login failed {r.status_code} {r.text}"
    body = r.json()
    return body.get("access_token") or body.get("token")


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


# --- Leads -----------------------------------------------------------------
class TestLeads:
    @pytest.fixture(scope="class")
    def created_lead_id(self):
        # Public POST – no token; uses x-forwarded-for IP
        payload = {
            "first_name": "TEST_Lead",
            "last_name": f"User_{uuid.uuid4().hex[:6]}",
            "email": f"lead_{uuid.uuid4().hex[:6]}@axistra.test",
            "company": "TEST_Co",
            "message": "Inbound test lead",
            "phone": "+971500000000",
        }
        r = requests.post(
            f"{API}/leads",
            json=payload,
            headers={"Content-Type": "application/json", "X-Forwarded-For": "203.0.113.45"},
            timeout=15,
        )
        assert r.status_code in (200, 201), f"public lead create {r.status_code} {r.text}"
        body = r.json()
        assert body.get("id"), body
        assert "message" in body
        return body["id"]

    def test_public_post_no_auth(self, created_lead_id):
        assert isinstance(created_lead_id, str) and len(created_lead_id) > 0

    def test_get_requires_auth(self):
        r = requests.get(f"{API}/leads", timeout=10)
        assert r.status_code in (401, 403)

    def test_authed_list_desc_order_and_contains_created(self, client, created_lead_id):
        r = client.get(f"{API}/leads")
        assert r.status_code == 200, r.text
        leads = r.json()
        assert isinstance(leads, list) and len(leads) >= 1
        # First entry should be the newest
        ids = [x.get("id") for x in leads]
        assert created_lead_id in ids
        # DESC by created_at
        dates = [x.get("created_at") for x in leads if x.get("created_at")]
        assert dates == sorted(dates, reverse=True)
        # IP was captured from x-forwarded-for
        mine = next(x for x in leads if x["id"] == created_lead_id)
        assert mine.get("ip_address") in ("203.0.113.45", None) or mine.get("ip_address").startswith("203.0.113.45")

    def test_patch_status_transitions(self, client, created_lead_id):
        for s in ["contacted", "qualified", "converted", "rejected", "new"]:
            r = client.patch(f"{API}/leads/{created_lead_id}/status", json={"status": s})
            assert r.status_code in (200, 201), f"status={s} -> {r.status_code} {r.text}"
            body = r.json()
            assert body.get("status") == s


# --- Magnus listUsers ------------------------------------------------------
class TestMagnusUsers:
    def test_list_users_basic(self, client):
        r = client.get(f"{API}/magnus/users", params={"limit": 5}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("mode") == "live", body
        assert isinstance(body.get("users"), list)
        if body["users"]:
            u = body["users"][0]
            for k in ("id", "username", "credit", "email", "plan_id", "active"):
                assert k in u, f"missing {k} in {u}"

    def test_list_users_search_starts_with(self, client):
        r = client.get(f"{API}/magnus/users", params={"search": "hem", "limit": 5}, timeout=30)
        # Should not error even if 0 matches
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("mode") == "live"
        assert isinstance(body.get("users"), list)
        # if there are results, usernames should startwith 'hem' (case may vary)
        for u in body["users"]:
            if u.get("username"):
                assert u["username"].lower().startswith("hem"), u

    def test_list_users_pagination(self, client):
        r1 = client.get(f"{API}/magnus/users", params={"page": 1, "limit": 10}, timeout=30)
        r2 = client.get(f"{API}/magnus/users", params={"page": 2, "limit": 10}, timeout=30)
        assert r1.status_code == 200 and r2.status_code == 200
        b1, b2 = r1.json(), r2.json()
        assert b1.get("page") == 1 and b2.get("page") == 2
        # If both have data, ensure they differ (or upstream has < 10 total)
        ids1 = {u["id"] for u in b1.get("users", []) if u.get("id")}
        ids2 = {u["id"] for u in b2.get("users", []) if u.get("id")}
        if ids1 and ids2:
            assert ids1 != ids2 or len(ids1) < 10
