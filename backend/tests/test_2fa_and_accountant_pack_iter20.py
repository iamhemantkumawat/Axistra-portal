"""
Iter_20 — Test 2FA enforcement / setup / verify / disable / regenerate flows
and GET /api/reports/bundle/accountant-pack.

Run:
  pytest /app/backend/tests/test_2fa_and_accountant_pack_iter20.py -v \
    --junitxml=/app/test_reports/pytest/iter20_2fa_pack.xml
"""
import io
import os
import zipfile

import pyotp
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://crypto-audit-chain.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@axistratech.com"
ADMIN_PASSWORD = "admin123"


# ---------- helpers ----------
def login_basic():
    """Login expecting full token (no 2FA enabled)."""
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()


def login_step1():
    return requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


OK_POST = (200, 201)  # NestJS defaults POST -> 201 unless @HttpCode(200) is set


def ensure_disabled(token):
    """Best-effort: if 2FA is currently enabled, force-disable via setup() side effect.

    two-fa.service.ts setup() sets two_fa_enabled=false and clears recovery_codes.
    """
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers(token)).json()
    if not me.get("two_fa_enabled"):
        return True
    r = requests.post(f"{BASE_URL}/api/auth/2fa/setup", headers=auth_headers(token))
    return r.status_code in OK_POST


@pytest.fixture(scope="module")
def baseline_token():
    """Module-scope: get a working token. If 2FA happens to be on, disable via setup() side-effect."""
    r = login_step1()
    if r.status_code == 200 and r.json().get("require_2fa"):
        pytest.fail(
            "Admin currently has 2FA enabled and we have no valid TOTP secret to bypass step 2. "
            "Manual reset required."
        )
    data = r.json()
    return data["token"]


# ---------- T1: login when 2FA disabled returns must_setup_2fa=true ----------
class TestLoginWith2faDisabled:
    def test_login_returns_full_token_and_must_setup_flag(self, baseline_token):
        # Ensure clean state first
        ensure_disabled(baseline_token)
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        d = r.json()
        assert "token" in d and isinstance(d["token"], str) and len(d["token"]) > 20
        assert d["user"]["role"] == "admin"
        assert d["user"]["must_setup_2fa"] is True
        assert d["user"]["two_fa_enabled"] is False
        # not require_2fa
        assert not d.get("require_2fa")

    def test_me_reports_must_setup_2fa(self, baseline_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers(baseline_token))
        assert r.status_code == 200
        d = r.json()
        assert d["enforce_admin_2fa"] is True
        assert d["must_setup_2fa"] is True
        assert d["two_fa_enabled"] is False


# ---------- T2: setup ----------
class TestSetup:
    def test_setup_returns_qr_and_secret(self, baseline_token):
        r = requests.post(f"{BASE_URL}/api/auth/2fa/setup", headers=auth_headers(baseline_token))
        assert r.status_code in OK_POST, r.text
        d = r.json()
        assert "otpauth_url" in d and d["otpauth_url"].startswith("otpauth://totp/")
        assert "qr_data_url" in d and d["qr_data_url"].startswith("data:image/png;base64,")
        assert "secret" in d and len(d["secret"]) >= 16
        assert "issuer" in d
        # stash secret for next test class via fixture below


@pytest.fixture(scope="module")
def fresh_secret(baseline_token):
    r = requests.post(f"{BASE_URL}/api/auth/2fa/setup", headers=auth_headers(baseline_token))
    assert r.status_code in OK_POST, r.text
    return r.json()["secret"]


# ---------- T3: enable ----------
class TestEnable:
    def test_enable_wrong_code_returns_401(self, baseline_token, fresh_secret):
        r = requests.post(
            f"{BASE_URL}/api/auth/2fa/enable",
            headers=auth_headers(baseline_token),
            json={"code": "000000"},
        )
        assert r.status_code == 401

    def test_enable_with_correct_code_returns_recovery_codes(self, baseline_token, fresh_secret):
        totp = pyotp.TOTP(fresh_secret).now()
        r = requests.post(
            f"{BASE_URL}/api/auth/2fa/enable",
            headers=auth_headers(baseline_token),
            json={"code": totp},
        )
        assert r.status_code in OK_POST, r.text
        d = r.json()
        assert d.get("enabled") is True
        assert isinstance(d.get("recovery_codes"), list) and len(d["recovery_codes"]) == 10
        # save first 3 for later tests
        TestEnable.recovery_codes = d["recovery_codes"]


# ---------- T4: login after 2FA enabled returns challenge_token ----------
class TestLoginAfter2faEnabled:
    def test_login_returns_require_2fa(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200
        d = r.json()
        assert d.get("require_2fa") is True
        assert "challenge_token" in d and len(d["challenge_token"]) > 20
        assert "token" not in d  # no full token at step 1

    def test_login_verify_invalid_totp_401(self):
        ch = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()
        r = requests.post(
            f"{BASE_URL}/api/auth/2fa/login-verify",
            json={"challenge_token": ch["challenge_token"], "code": "000000"},
        )
        assert r.status_code == 401

    def test_login_verify_valid_totp_returns_full_token(self, fresh_secret):
        ch = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()
        totp = pyotp.TOTP(fresh_secret).now()
        r = requests.post(
            f"{BASE_URL}/api/auth/2fa/login-verify",
            json={"challenge_token": ch["challenge_token"], "code": totp},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "token" in d
        assert d["user"]["two_fa_enabled"] is True
        assert d["user"]["must_setup_2fa"] is False
        TestLoginAfter2faEnabled.full_token = d["token"]

    def test_login_verify_with_recovery_code_succeeds_and_is_single_use(self):
        codes = TestEnable.recovery_codes
        first_code = codes[0]
        # use #1
        ch = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()
        r = requests.post(
            f"{BASE_URL}/api/auth/2fa/login-verify",
            json={"challenge_token": ch["challenge_token"], "recovery_code": first_code},
        )
        assert r.status_code == 200, r.text
        assert "token" in r.json()
        # second use of same code -> 401
        ch2 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()
        r2 = requests.post(
            f"{BASE_URL}/api/auth/2fa/login-verify",
            json={"challenge_token": ch2["challenge_token"], "recovery_code": first_code},
        )
        assert r2.status_code == 401


# ---------- T5: regenerate recovery codes ----------
class TestRegenerate:
    def test_regenerate_invalidates_old_codes(self, fresh_secret):
        # get current full token via TOTP login
        ch = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()
        totp = pyotp.TOTP(fresh_secret).now()
        login_d = requests.post(
            f"{BASE_URL}/api/auth/2fa/login-verify",
            json={"challenge_token": ch["challenge_token"], "code": totp},
        ).json()
        token = login_d["token"]

        # regenerate
        totp2 = pyotp.TOTP(fresh_secret).now()
        r = requests.post(
            f"{BASE_URL}/api/auth/2fa/recovery-codes/regenerate",
            headers=auth_headers(token),
            json={"code": totp2},
        )
        assert r.status_code in OK_POST, r.text
        new_codes = r.json()["recovery_codes"]
        assert isinstance(new_codes, list) and len(new_codes) == 10
        TestRegenerate.new_codes = new_codes

        # try OLD code (#2 from original batch was never used) -> 401
        old_unused = TestEnable.recovery_codes[1]
        ch2 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()
        r2 = requests.post(
            f"{BASE_URL}/api/auth/2fa/login-verify",
            json={"challenge_token": ch2["challenge_token"], "recovery_code": old_unused},
        )
        assert r2.status_code == 401

        # NEW code works
        ch3 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()
        r3 = requests.post(
            f"{BASE_URL}/api/auth/2fa/login-verify",
            json={"challenge_token": ch3["challenge_token"], "recovery_code": new_codes[0]},
        )
        assert r3.status_code == 200


# ---------- T6: disable 2FA ----------
class TestDisable:
    def test_disable_with_valid_totp(self, fresh_secret):
        # login fresh
        ch = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).json()
        totp = pyotp.TOTP(fresh_secret).now()
        token = requests.post(
            f"{BASE_URL}/api/auth/2fa/login-verify",
            json={"challenge_token": ch["challenge_token"], "code": totp},
        ).json()["token"]

        totp2 = pyotp.TOTP(fresh_secret).now()
        r = requests.post(
            f"{BASE_URL}/api/auth/2fa/disable",
            headers=auth_headers(token),
            json={"code": totp2},
        )
        assert r.status_code in OK_POST, r.text
        assert r.json().get("disabled") is True

        # me() should now show two_fa_enabled=false and must_setup_2fa=true
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers(token)).json()
        assert me["two_fa_enabled"] is False
        assert me["must_setup_2fa"] is True


# ---------- T7: accountant-pack ZIP ----------
class TestAccountantPack:
    def test_accountant_pack_returns_valid_zip(self, baseline_token):
        # login is enough since 2FA was disabled by previous test
        r = requests.get(
            f"{BASE_URL}/api/reports/bundle/accountant-pack",
            params={"year": "2026"},
            headers=auth_headers(baseline_token),
            timeout=180,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:300]}"
        ct = r.headers.get("Content-Type", "").lower()
        assert "zip" in ct, f"Content-Type was {ct}"
        size = len(r.content)
        assert size > 100 * 1024, f"ZIP too small: {size} bytes"

        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        assert any("manifest" in n.lower() and n.lower().endswith(".csv") for n in names), f"No MANIFEST*.csv: {names[:20]}"
        assert any("readme" in n.lower() and n.lower().endswith(".txt") for n in names), f"No README*.txt: {names[:20]}"
        assert any(n.lower().endswith(".pdf") for n in names), "No PDFs in pack"
        assert any(n.lower().endswith(".xlsx") for n in names), "No XLSX in pack"
        # cover pdf
        assert any("cover" in n.lower() and n.lower().endswith(".pdf") for n in names), \
            f"No cover PDF found: {[n for n in names if n.lower().endswith('.pdf')][:5]}"


# ---------- final cleanup ----------
def teardown_module(module):
    """Ensure 2FA is disabled at end of test run."""
    try:
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        d = r.json()
        if d.get("require_2fa"):
            # Can't disable without secret; that's fine — disable test above already disabled it.
            return
        token = d.get("token")
        if token:
            ensure_disabled(token)
    except Exception:
        pass
