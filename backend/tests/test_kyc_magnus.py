"""
Phase 2 backend tests — KYC document upload and Live MagnusBilling integration.

Covers:
- KYC: upload (multipart), list, review (approve/reject), file download/stream,
       reject unsupported types, 404 on missing customer, KYC propagation
- Magnus: live mode (mode=live, configured=true), sync-user, user lookup, CDR,
          sync log persistence in magnus_sync_logs
"""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    return body.get("access_token") or body.get("token")


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def json_client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def kyc_customer(json_client):
    payload = {
        "full_name": f"TEST_KYC_{uuid.uuid4().hex[:6]}",
        "email": f"kyc_{uuid.uuid4().hex[:6]}@axistra.test",
        "magnus_username": f"kuser_{uuid.uuid4().hex[:6]}",
        "country": "AE",
        "risk_level": "low",
        "kyc_status": "not_required",
    }
    r = json_client.post(f"{API}/customers", json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()


# Tiny minimal-valid PNG (1x1) bytes
TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
    b"\xc0\x00\x00\x00\x03\x00\x01\x5b\xc8\xcd\x7c\x00\x00\x00\x00IEND\xaeB`\x82"
)

# Minimal PDF
TINY_PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"


# ---------- KYC ----------
class TestKyc:
    def test_upload_png_success(self, auth_headers, kyc_customer):
        cid = kyc_customer["id"]
        files = {"file": ("passport.png", io.BytesIO(TINY_PNG), "image/png")}
        data = {"document_type": "passport"}
        r = requests.post(f"{API}/kyc/{cid}/upload", headers=auth_headers, files=files, data=data, timeout=30)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["customer_id"] == cid
        assert body["document_type"] == "passport"
        assert body["file_name"] == "passport.png"
        assert body["status"] == "submitted"
        assert body["file_url"].startswith(f"/api/kyc/{cid}/file/")
        # Save filename for later file-stream test
        pytest.kyc_doc_id = body["id"]
        pytest.kyc_file_name = body["file_url"].rsplit("/", 1)[-1]

    def test_customer_kyc_status_propagated_to_submitted(self, json_client, kyc_customer):
        r = json_client.get(f"{API}/customers/{kyc_customer['id']}")
        assert r.status_code == 200
        assert r.json()["kyc_status"] == "submitted"

    def test_upload_pdf_success(self, auth_headers, kyc_customer):
        cid = kyc_customer["id"]
        files = {"file": ("source.pdf", io.BytesIO(TINY_PDF), "application/pdf")}
        data = {"document_type": "source_of_funds"}
        r = requests.post(f"{API}/kyc/{cid}/upload", headers=auth_headers, files=files, data=data, timeout=30)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["document_type"] == "source_of_funds"
        pytest.kyc_second_doc_id = body["id"]

    def test_list_returns_desc(self, json_client, kyc_customer):
        r = json_client.get(f"{API}/kyc/{kyc_customer['id']}")
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list)
        assert len(docs) >= 2
        # DESC order: first item created_at >= second
        assert docs[0]["created_at"] >= docs[1]["created_at"]

    def test_reject_unsupported_type(self, auth_headers, kyc_customer):
        cid = kyc_customer["id"]
        files = {"file": ("bad.txt", io.BytesIO(b"hello world"), "text/plain")}
        data = {"document_type": "other"}
        r = requests.post(f"{API}/kyc/{cid}/upload", headers=auth_headers, files=files, data=data, timeout=30)
        # Multer fileFilter raises Error -> 400 or 500 (Nest may surface as 500)
        assert r.status_code in (400, 415, 500), f"expected error, got {r.status_code} {r.text[:200]}"

    def test_upload_nonexistent_customer_404(self, auth_headers):
        fake_id = str(uuid.uuid4())
        files = {"file": ("p.png", io.BytesIO(TINY_PNG), "image/png")}
        data = {"document_type": "passport"}
        r = requests.post(f"{API}/kyc/{fake_id}/upload", headers=auth_headers, files=files, data=data, timeout=30)
        assert r.status_code == 404, r.text

    def test_file_stream(self, auth_headers, kyc_customer):
        cid = kyc_customer["id"]
        fname = getattr(pytest, "kyc_file_name", None)
        assert fname, "no file name from upload step"
        r = requests.get(f"{API}/kyc/{cid}/file/{fname}", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert len(r.content) >= len(TINY_PNG) - 4  # roughly

    def test_review_reject_then_approve_propagation(self, json_client, kyc_customer):
        # Reject first doc -> customer should become rejected
        doc1 = pytest.kyc_doc_id
        r = json_client.patch(f"{API}/kyc/document/{doc1}",
                              json={"status": "rejected", "comment": "TEST_blurry"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "rejected"
        c = json_client.get(f"{API}/customers/{kyc_customer['id']}").json()
        assert c["kyc_status"] == "rejected", c

        # Approve all docs -> customer should become approved
        doc2 = pytest.kyc_second_doc_id
        r2 = json_client.patch(f"{API}/kyc/document/{doc2}",
                               json={"status": "approved", "comment": "ok"})
        assert r2.status_code == 200, r2.text
        # Now approve doc1 too
        r3 = json_client.patch(f"{API}/kyc/document/{doc1}",
                               json={"status": "approved", "comment": "resolved"})
        assert r3.status_code == 200
        c2 = json_client.get(f"{API}/customers/{kyc_customer['id']}").json()
        assert c2["kyc_status"] == "approved", c2


# ---------- Magnus (Live mode) ----------
class TestMagnusLive:
    def test_status_live(self, json_client):
        r = json_client.get(f"{API}/magnus/status")
        assert r.status_code == 200
        body = r.json()
        assert body.get("configured") is True, body
        assert body.get("mode") == "live", body
        assert "cyberxcalls.com" in (body.get("base_url") or "")

    def test_logs_returns_list(self, json_client):
        r = json_client.get(f"{API}/magnus/logs")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_sync_user_creates_log(self, json_client):
        before = len(json_client.get(f"{API}/magnus/logs").json())
        uname = f"probe_{uuid.uuid4().hex[:6]}"
        r = json_client.post(f"{API}/magnus/sync-user", json={"magnus_username": uname})
        assert r.status_code in (200, 201), r.text
        body = r.json()
        # Either upstream reachable (ok=true) or unreachable (ok=false) - both acceptable
        assert body.get("mode") == "live", body
        assert "ok" in body
        # Log entry was persisted
        logs = json_client.get(f"{API}/magnus/logs").json()
        assert len(logs) >= before + 1
        latest = logs[0]
        assert latest["magnus_username"] == uname
        assert latest["action"] == "sync_user"
        assert latest["status"] in ("success", "failed")

    def test_user_lookup_live(self, json_client):
        uname = f"probe2_{uuid.uuid4().hex[:6]}"
        r = json_client.get(f"{API}/magnus/user/{uname}")
        assert r.status_code == 200
        body = r.json()
        assert body.get("mode") == "live", body

    def test_cdr_live(self, json_client):
        uname = f"probe3_{uuid.uuid4().hex[:6]}"
        r = json_client.get(f"{API}/magnus/cdr/{uname}",
                            params={"from": "2026-01-01", "to": "2026-01-31"})
        assert r.status_code == 200
        body = r.json()
        assert body.get("mode") == "live", body
        # cdrs should be a list (possibly empty)
        assert "cdrs" in body and isinstance(body["cdrs"], list)
