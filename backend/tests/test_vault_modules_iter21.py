"""
Iteration 21 backend tests - Corporate Vault, Tax/VAT, Contracts, Conversion Register, KYC multi-upload.
"""
import os
import io
import pytest
import requests
from datetime import date, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://crypto-audit-chain.preview.emergentagent.com').rstrip('/')


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@axistratech.com", "password": "admin123"},
                      timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tk = data.get("token") or data.get("access_token")
    assert tk, f"no token in response: {data}"
    return tk


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Corporate Documents Vault ----------
class TestCorporateDocs:
    created_id = None

    def test_list_empty_ok(self, auth):
        r = requests.get(f"{BASE_URL}/api/corporate-docs", headers=auth, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_missing_file_returns_400(self, auth):
        r = requests.post(f"{BASE_URL}/api/corporate-docs",
                          headers=auth, data={"title": "no-file"}, timeout=15)
        assert r.status_code == 400

    def test_create_with_file(self, auth):
        files = {"file": ("trade-license.pdf", io.BytesIO(b"%PDF-1.4 stub"), "application/pdf")}
        data = {"title": "TEST_Trade License 2026", "doc_type": "trade_license",
                "reference_number": "TL-001", "issuing_authority": "DED"}
        r = requests.post(f"{BASE_URL}/api/corporate-docs", headers=auth, files=files, data=data, timeout=20)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["title"] == "TEST_Trade License 2026"
        assert body["doc_type"] == "trade_license"
        assert body["file_url"].startswith("/api/corporate-docs/")
        TestCorporateDocs.created_id = body["id"]

    def test_get_persisted(self, auth):
        assert TestCorporateDocs.created_id
        r = requests.get(f"{BASE_URL}/api/corporate-docs/{TestCorporateDocs.created_id}", headers=auth, timeout=15)
        assert r.status_code == 200
        assert r.json()["reference_number"] == "TL-001"

    def test_patch_metadata(self, auth):
        r = requests.patch(f"{BASE_URL}/api/corporate-docs/{TestCorporateDocs.created_id}",
                           headers=auth, json={"notes": "renewed"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["notes"] == "renewed"

    def test_download_file(self, auth):
        r = requests.get(f"{BASE_URL}/api/corporate-docs/{TestCorporateDocs.created_id}", headers=auth, timeout=15)
        file_url = r.json()["file_url"]
        r2 = requests.get(f"{BASE_URL}{file_url}", headers=auth, timeout=15)
        assert r2.status_code == 200
        assert b"PDF" in r2.content[:10] or len(r2.content) > 0

    def test_delete(self, auth):
        r = requests.delete(f"{BASE_URL}/api/corporate-docs/{TestCorporateDocs.created_id}", headers=auth, timeout=15)
        assert r.status_code == 200
        assert r.json().get("deleted") is True
        r2 = requests.get(f"{BASE_URL}/api/corporate-docs/{TestCorporateDocs.created_id}", headers=auth, timeout=15)
        assert r2.status_code == 404


# ---------- Tax & VAT Center ----------
class TestTax:
    upcoming_id = None
    overdue_id = None

    def test_summary_empty_ok(self, auth):
        r = requests.get(f"{BASE_URL}/api/tax/summary", headers=auth, timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("total_filings", "upcoming", "overdue_count", "total_due_aed", "total_paid_aed", "outstanding_aed"):
            assert k in body

    def test_create_upcoming(self, auth):
        future = (date.today() + timedelta(days=30)).isoformat()
        data = {"tax_type": "vat", "period_label": "TEST_Q1_2026", "due_date": future,
                "status": "upcoming", "tax_due_aed": "1000", "tax_paid_aed": "0"}
        r = requests.post(f"{BASE_URL}/api/tax", headers=auth, data=data, timeout=15)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["period_label"] == "TEST_Q1_2026"
        assert body["status"] == "upcoming"
        TestTax.upcoming_id = body["id"]

    def test_create_overdue_autoflag(self, auth):
        past = (date.today() - timedelta(days=5)).isoformat()
        data = {"tax_type": "vat", "period_label": "TEST_Past_Q4", "due_date": past,
                "status": "upcoming", "tax_due_aed": "500"}
        r = requests.post(f"{BASE_URL}/api/tax", headers=auth, data=data, timeout=15)
        assert r.status_code in (200, 201)
        TestTax.overdue_id = r.json()["id"]

        # list should flag this overdue
        rl = requests.get(f"{BASE_URL}/api/tax", headers=auth, timeout=15)
        assert rl.status_code == 200
        matches = [x for x in rl.json() if x["id"] == TestTax.overdue_id]
        assert matches and matches[0]["status"] == "overdue", f"expected overdue, got {matches}"

    def test_summary_counts(self, auth):
        r = requests.get(f"{BASE_URL}/api/tax/summary", headers=auth, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["overdue_count"] >= 1
        assert body["total_due_aed"] >= 1500

    def test_patch_status_paid(self, auth):
        r = requests.patch(f"{BASE_URL}/api/tax/{TestTax.upcoming_id}", headers=auth,
                           data={"status": "paid", "tax_paid_aed": "1000"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "paid"

    def test_cleanup(self, auth):
        for tid in (TestTax.upcoming_id, TestTax.overdue_id):
            requests.delete(f"{BASE_URL}/api/tax/{tid}", headers=auth, timeout=10)


# ---------- Contracts Vault ----------
class TestContracts:
    active_id = None
    expired_id = None

    def test_list_ok(self, auth):
        r = requests.get(f"{BASE_URL}/api/contracts", headers=auth, timeout=15)
        assert r.status_code == 200

    def test_create_active(self, auth):
        future = (date.today() + timedelta(days=180)).isoformat()
        data = {"title": "TEST_MSA_2026", "contract_type": "vendor", "counterparty_name": "Acme LLC",
                "start_date": date.today().isoformat(), "end_date": future, "status": "active",
                "contract_value": "50000", "currency": "AED"}
        r = requests.post(f"{BASE_URL}/api/contracts", headers=auth, data=data, timeout=15)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["title"] == "TEST_MSA_2026"
        assert body["status"] == "active"
        TestContracts.active_id = body["id"]

    def test_create_missing_title_returns_400(self, auth):
        r = requests.post(f"{BASE_URL}/api/contracts", headers=auth, data={"contract_type": "vendor"}, timeout=15)
        assert r.status_code == 400

    def test_auto_expiry(self, auth):
        past = (date.today() - timedelta(days=2)).isoformat()
        data = {"title": "TEST_Expired_Lease", "contract_type": "lease",
                "start_date": "2020-01-01", "end_date": past, "status": "active"}
        r = requests.post(f"{BASE_URL}/api/contracts", headers=auth, data=data, timeout=15)
        assert r.status_code in (200, 201)
        TestContracts.expired_id = r.json()["id"]

        rl = requests.get(f"{BASE_URL}/api/contracts", headers=auth, timeout=15)
        matches = [x for x in rl.json() if x["id"] == TestContracts.expired_id]
        assert matches and matches[0]["status"] == "expired", f"expected expired, got {matches}"

    def test_patch_contract(self, auth):
        r = requests.patch(f"{BASE_URL}/api/contracts/{TestContracts.active_id}", headers=auth,
                           data={"notes": "renewal-in-progress"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["notes"] == "renewal-in-progress"

    def test_cleanup(self, auth):
        for cid in (TestContracts.active_id, TestContracts.expired_id):
            requests.delete(f"{BASE_URL}/api/contracts/{cid}", headers=auth, timeout=10)


# ---------- Conversion Register ----------
class TestConversionRegister:
    def test_list(self, auth):
        r = requests.get(f"{BASE_URL}/api/conversion-register", headers=auth, timeout=20)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_summary(self, auth):
        r = requests.get(f"{BASE_URL}/api/conversion-register/summary", headers=auth, timeout=20)
        assert r.status_code == 200
        body = r.json()
        for k in ("total_chains", "fully_reconciled", "pending_in_exchange",
                  "pending_sweep", "awaiting_payment", "total_gross_aed", "total_net_aed"):
            assert k in body, f"missing key {k}"


# ---------- KYC Multi-file upload ----------
class TestKycMulti:
    customer_id = None
    doc_ids = []

    def test_pick_or_create_customer(self, auth):
        r = requests.get(f"{BASE_URL}/api/customers", headers=auth, timeout=15)
        assert r.status_code == 200
        rows = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        if rows:
            TestKycMulti.customer_id = rows[0]["id"]
        else:
            payload = {"full_name": "TEST KYC Customer", "email": "testkyc@example.com", "country": "UAE"}
            cr = requests.post(f"{BASE_URL}/api/customers", headers=auth, json=payload, timeout=15)
            assert cr.status_code in (200, 201)
            TestKycMulti.customer_id = cr.json()["id"]
        assert TestKycMulti.customer_id

    def test_upload_multi_two_files(self, auth):
        files = [
            ("files", ("passport_front.jpg", io.BytesIO(b"\xff\xd8\xff frontstub"), "image/jpeg")),
            ("files", ("passport_back.jpg", io.BytesIO(b"\xff\xd8\xff backstub"), "image/jpeg")),
        ]
        data = {"document_type": "passport"}
        r = requests.post(f"{BASE_URL}/api/kyc/{TestKycMulti.customer_id}/upload-multi",
                          headers=auth, files=files, data=data, timeout=20)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["uploaded"] == 2
        assert len(body["documents"]) == 2
        TestKycMulti.doc_ids = [d["id"] for d in body["documents"]]

    def test_list_includes_uploaded(self, auth):
        r = requests.get(f"{BASE_URL}/api/kyc/{TestKycMulti.customer_id}", headers=auth, timeout=15)
        assert r.status_code == 200
        ids = {d["id"] for d in r.json()}
        for did in TestKycMulti.doc_ids:
            assert did in ids

    def test_delete_kyc_doc(self, auth):
        for did in TestKycMulti.doc_ids:
            r = requests.delete(f"{BASE_URL}/api/kyc/document/{did}", headers=auth, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json().get("deleted") is True
        # ensure gone
        r2 = requests.get(f"{BASE_URL}/api/kyc/{TestKycMulti.customer_id}", headers=auth, timeout=15)
        remaining = {d["id"] for d in r2.json()}
        for did in TestKycMulti.doc_ids:
            assert did not in remaining

    def test_upload_multi_no_files_400(self, auth):
        r = requests.post(f"{BASE_URL}/api/kyc/{TestKycMulti.customer_id}/upload-multi",
                          headers=auth, data={"document_type": "id"}, timeout=15)
        assert r.status_code == 400
