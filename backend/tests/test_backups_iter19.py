"""
Backend regression tests for the Backup & Restore module (iter_19).

Covers:
- Admin auth guard on /api/backups
- Manual backup create / list / download
- Path-traversal rejection on download/restore
- Upload (.sql.gz) + non-.sql.gz rejection
- Delete (local)
- Restore with confirm phrase (and rejection without)
- Google Drive guards (not configured)
- Non-admin (accountant) -> 403
"""
import io
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://crypto-audit-chain.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"
CONFIRM_PHRASE = "I_UNDERSTAND_THIS_REPLACES_ALL_DATA"


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "accept_terms": True,
    }, timeout=30)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok, "No token in admin login response"
    return tok


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def accountant_token(admin_headers):
    """Create a non-admin (accountant) and return its login token."""
    email = f"TEST_acct_{uuid.uuid4().hex[:8]}@axistratech.com"
    pwd = "TestAcct!2026"
    r = requests.post(
        f"{API}/auth/admins",
        json={"email": email, "password": pwd, "full_name": "Test Acct", "role": "accountant"},
        headers=admin_headers, timeout=30,
    )
    assert r.status_code in (200, 201), f"createAdmin failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("role") == "accountant", f"Expected accountant role, got {data}"
    # login as the new accountant
    rl = requests.post(f"{API}/auth/login", json={
        "email": email, "password": pwd, "accept_terms": True,
    }, timeout=30)
    assert rl.status_code == 200, f"accountant login failed: {rl.status_code} {rl.text}"
    return rl.json()["token"]


# ---------- auth guard ----------

class TestAuthGuard:
    def test_no_token_returns_401(self):
        r = requests.get(f"{API}/backups", timeout=15)
        assert r.status_code == 401, f"expected 401, got {r.status_code}"

    def test_non_admin_returns_403(self, accountant_token):
        r = requests.get(
            f"{API}/backups",
            headers={"Authorization": f"Bearer {accountant_token}"},
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403 for non-admin, got {r.status_code} {r.text}"


# ---------- list / create / download ----------

class TestBackupCrud:
    created_name: str = ""
    downloaded_bytes: bytes = b""

    def test_list_returns_array(self, admin_headers):
        r = requests.get(f"{API}/backups", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_create_manual_backup(self, admin_headers):
        r = requests.post(f"{API}/backups", headers=admin_headers, json={}, timeout=120)
        assert r.status_code in (200, 201), f"create backup failed: {r.status_code} {r.text}"
        data = r.json()
        for key in ("name", "size_bytes", "kind", "created_at"):
            assert key in data, f"missing key {key} in {data}"
        assert data["kind"] == "manual", data
        assert data["name"].endswith(".sql.gz"), data
        assert data["size_bytes"] > 0
        TestBackupCrud.created_name = data["name"]

        # subsequent list contains it
        rl = requests.get(f"{API}/backups", headers=admin_headers, timeout=15)
        assert rl.status_code == 200
        names = [b["name"] for b in rl.json()]
        assert data["name"] in names, f"created backup not in list: {names}"

    def test_download_streams_gzip(self, admin_headers):
        name = TestBackupCrud.created_name
        assert name, "no backup created in previous test"
        r = requests.get(f"{API}/backups/{name}/download", headers=admin_headers, timeout=60)
        assert r.status_code == 200, r.text
        assert "gzip" in r.headers.get("Content-Type", ""), r.headers
        # gzip magic
        assert r.content[:2] == b"\x1f\x8b", "file does not have gzip magic bytes"
        TestBackupCrud.downloaded_bytes = r.content

    def test_path_traversal_download_rejected(self, admin_headers):
        # Use a name that contains '..' but no '/' so the route matches and the
        # in-app `fullPath()` guard rejects it. Note: encoded '%2F' is decoded
        # before route matching by ingress/express and 404s before reaching
        # the controller, so it is not a useful payload here.
        r = requests.get(
            f"{API}/backups/bad..name.sql.gz/download",
            headers=admin_headers, timeout=15, allow_redirects=False,
        )
        assert r.status_code == 400, f"expected 400 for path traversal, got {r.status_code} {r.text}"
        msg = (r.json().get("message") or "").lower() if r.headers.get("content-type", "").startswith("application/json") else ""
        # Either JSON body with "invalid backup name", or at minimum status 400.
        if msg:
            assert "invalid backup name" in msg, r.text

    def test_path_traversal_restore_rejected(self, admin_headers):
        r = requests.post(
            f"{API}/backups/..hack.sql.gz/restore",
            headers=admin_headers,
            json={"confirm": CONFIRM_PHRASE},
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
        msg = (r.json().get("message") or "").lower()
        assert "invalid backup name" in msg, r.text


# ---------- upload / delete ----------

class TestUploadDelete:
    uploaded_name: str = ""
    extra_backup: str = ""

    def test_upload_sql_gz(self, admin_headers):
        # Reuse downloaded content if available, else minimal gzip
        content = TestBackupCrud.downloaded_bytes
        if not content:
            # 2-byte gzip header + empty body is fine for storage acceptance test
            content = b"\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\x03"
        upload_name = f"TEST_upload_{uuid.uuid4().hex[:8]}.sql.gz"
        files = {"file": (upload_name, io.BytesIO(content), "application/gzip")}
        r = requests.post(f"{API}/backups/upload", headers=admin_headers, files=files, timeout=60)
        assert r.status_code in (200, 201), f"upload failed: {r.status_code} {r.text}"
        data = r.json()
        assert data["name"].endswith(".sql.gz"), data
        assert data["size_bytes"] == len(content), f"size mismatch: stored {data['size_bytes']} vs uploaded {len(content)}"
        TestUploadDelete.uploaded_name = data["name"]

        # appears in list
        rl = requests.get(f"{API}/backups", headers=admin_headers, timeout=15)
        names = [b["name"] for b in rl.json()]
        assert data["name"] in names

    def test_upload_non_sqlgz_rejected(self, admin_headers):
        files = {"file": ("evil.txt", io.BytesIO(b"hello"), "text/plain")}
        r = requests.post(f"{API}/backups/upload", headers=admin_headers, files=files, timeout=30)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"

    def test_delete_removes_file(self, admin_headers):
        name = TestUploadDelete.uploaded_name
        assert name
        r = requests.delete(f"{API}/backups/{name}", headers=admin_headers, timeout=30)
        assert r.status_code in (200, 204), r.text

        rl = requests.get(f"{API}/backups", headers=admin_headers, timeout=15)
        names = [b["name"] for b in rl.json()]
        assert name not in names, f"deleted backup still listed: {name}"


# ---------- restore ----------

class TestRestore:
    def test_restore_without_confirm_returns_400(self, admin_headers):
        name = TestBackupCrud.created_name
        assert name
        r = requests.post(f"{API}/backups/{name}/restore", headers=admin_headers, json={}, timeout=30)
        assert r.status_code == 400, r.text
        msg = (r.json().get("message") or "").lower()
        assert "confirm" in msg or "phrase" in msg, f"unexpected error message: {r.text}"

    def test_restore_with_wrong_confirm_returns_400(self, admin_headers):
        name = TestBackupCrud.created_name
        r = requests.post(
            f"{API}/backups/{name}/restore",
            headers=admin_headers,
            json={"confirm": "NOPE"},
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_restore_with_correct_confirm_succeeds(self, admin_headers):
        # Use the smallest manual backup so the restore is fast.
        rl = requests.get(f"{API}/backups", headers=admin_headers, timeout=15)
        assert rl.status_code == 200
        backups = [b for b in rl.json() if b["name"].endswith(".sql.gz")]
        assert backups, "no .sql.gz backups available"
        backups.sort(key=lambda b: b["size_bytes"])
        target = backups[0]["name"]

        r = requests.post(
            f"{API}/backups/{target}/restore",
            headers=admin_headers,
            json={"confirm": CONFIRM_PHRASE},
            timeout=300,
        )
        assert r.status_code in (200, 201), f"restore failed: {r.status_code} {r.text}"
        data = r.json()
        assert data.get("restored") is True, data
        snap = data.get("safety_snapshot", "")
        assert snap.startswith("axistra-manual-") and snap.endswith(".sql.gz"), data

    def test_db_still_functional_after_restore(self, admin_headers):
        # Wait a beat for connection pool to settle
        time.sleep(2)
        # The admin token issued before restore may now be invalid because the
        # admin_users row was rewritten; re-login as admin (seeder restores it).
        rl = requests.post(f"{API}/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "accept_terms": True,
        }, timeout=30)
        # Allow brief grace for the schema reload
        tries = 0
        while rl.status_code != 200 and tries < 5:
            time.sleep(2)
            rl = requests.post(f"{API}/auth/login", json={
                "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "accept_terms": True,
            }, timeout=30)
            tries += 1
        assert rl.status_code == 200, f"admin login broken after restore: {rl.status_code} {rl.text}"
        token = rl.json()["token"]
        h = {"Authorization": f"Bearer {token}"}

        rd = requests.get(f"{API}/dashboard/kpis", headers=h, timeout=30)
        assert rd.status_code == 200, f"/api/dashboard/kpis broken after restore: {rd.status_code} {rd.text}"

        rc = requests.get(f"{API}/customers", headers=h, timeout=30)
        assert rc.status_code == 200, f"/api/customers broken after restore: {rc.status_code} {rc.text}"


# ---------- Google Drive (not configured) ----------

class TestDriveGuards:
    def test_drive_status_not_configured(self, admin_headers):
        r = requests.get(f"{API}/backups/drive/status", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("configured") is False, data

    def test_drive_list_returns_400_not_configured(self, admin_headers):
        r = requests.get(f"{API}/backups/drive/list", headers=admin_headers, timeout=15)
        assert r.status_code == 400, r.text
        msg = (r.json().get("message") or "").lower()
        assert "google drive is not configured" in msg, r.text

    def test_drive_delete_returns_400_not_configured(self, admin_headers):
        r = requests.delete(f"{API}/backups/drive/some-id", headers=admin_headers, timeout=15)
        assert r.status_code == 400, r.text
        msg = (r.json().get("message") or "").lower()
        assert "google drive is not configured" in msg, r.text
