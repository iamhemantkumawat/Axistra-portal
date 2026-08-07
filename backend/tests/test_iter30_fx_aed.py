"""Iteration 30 — Invoice FX / AED conversion tests (fx settings + invoice AED totals)."""
import os
import re
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

ADMIN = {"email": "admin@axistratech.com", "password": "admin123"}
CA = {"email": "ca@axistratech.com", "password": "ca123456"}


def login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"login failed {creds['email']} -> {r.status_code} {r.text[:300]}")
    data = r.json()
    token = data.get("access_token") or data.get("token")
    assert token, f"no token in login response: {list(data.keys())}"
    return token


@pytest.fixture(scope="module")
def admin_token():
    return login(ADMIN)


@pytest.fixture(scope="module")
def ca_token():
    return login(CA)


@pytest.fixture(scope="module")
def admin_client(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def ca_client(ca_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {ca_token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module", autouse=True)
def restore_settings(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/fx/settings", timeout=60)
    original = r.json() if r.status_code == 200 else None
    yield
    if original:
        admin_client.put(f"{BASE_URL}/api/fx/settings", json={
            "mode": original.get("mode", "auto"),
            "eur_to_aed": original.get("eur_to_aed"),
            "usd_to_aed": original.get("usd_to_aed"),
        }, timeout=60)


# --- FX settings endpoint ---
class TestFxSettings:
    def test_get_settings_shape(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/fx/settings", timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["mode"] in ("auto", "manual")
        assert float(d["eur_to_aed"]) > 0
        assert float(d["usd_to_aed"]) > 0

    def test_get_settings_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/fx/settings", timeout=60)
        assert r.status_code == 401, f"expected 401, got {r.status_code}"

    def test_put_settings_persists(self, admin_client):
        payload = {"mode": "manual", "eur_to_aed": 4.00, "usd_to_aed": 3.6725}
        r = admin_client.put(f"{BASE_URL}/api/fx/settings", json=payload, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["mode"] == "manual"
        assert abs(float(d["eur_to_aed"]) - 4.00) < 1e-6
        g = admin_client.get(f"{BASE_URL}/api/fx/settings", timeout=60).json()
        assert g["mode"] == "manual"
        assert abs(float(g["eur_to_aed"]) - 4.00) < 1e-6
        assert abs(float(g["usd_to_aed"]) - 3.6725) < 1e-6

    def test_ca_cannot_put_settings(self, ca_client):
        r = ca_client.put(f"{BASE_URL}/api/fx/settings", json={"mode": "manual", "eur_to_aed": 9.99}, timeout=60)
        assert r.status_code == 403, f"expected 403 for CA role, got {r.status_code} {r.text[:200]}"

    def test_ca_settings_attempt_did_not_change_rates(self, admin_client):
        g = admin_client.get(f"{BASE_URL}/api/fx/settings", timeout=60).json()
        assert abs(float(g["eur_to_aed"]) - 9.99) > 1e-6


# --- Invoice AED fields ---
class TestInvoiceAed:
    def test_all_invoices_have_aed_fields(self, admin_client):
        admin_client.put(f"{BASE_URL}/api/fx/settings",
                         json={"mode": "manual", "eur_to_aed": 4.00, "usd_to_aed": 3.6725}, timeout=120)
        r = admin_client.get(f"{BASE_URL}/api/invoices", timeout=300)
        assert r.status_code == 200, r.text[:300]
        invoices = r.json()
        assert isinstance(invoices, list) and len(invoices) > 0
        print(f"invoice count: {len(invoices)}")
        missing = [i.get("invoice_number") for i in invoices
                   if i.get("aed_rate") is None or i.get("aed_total") is None
                   or i.get("billing_currency") != "AED" or not i.get("source_currency")]
        assert not missing, f"{len(missing)} invoices missing AED fields, e.g. {missing[:5]}"
        # no mongo-ish leakage / correct math
        bad = []
        for i in invoices:
            amt = float(i.get("amount") or 0)
            expected = round(amt * float(i["aed_rate"]), 2)
            if abs(expected - float(i["aed_total"])) > 0.05:
                bad.append((i.get("invoice_number"), amt, i["aed_rate"], i["aed_total"]))
        assert not bad, f"aed_total mismatch: {bad[:5]}"
        currencies = {i["source_currency"] for i in invoices}
        print(f"source currencies: {currencies}")

    def test_eur_invoice_uses_manual_rate(self, admin_client):
        admin_client.put(f"{BASE_URL}/api/fx/settings",
                         json={"mode": "manual", "eur_to_aed": 4.00, "usd_to_aed": 3.6725}, timeout=120)
        invoices = admin_client.get(f"{BASE_URL}/api/invoices", timeout=300).json()
        eur = [i for i in invoices if i["source_currency"] == "EUR"]
        assert eur, "no EUR invoices found"
        s = eur[0]
        assert abs(float(s["aed_rate"]) - 4.00) < 1e-4, s
        assert abs(float(s["aed_total"]) - round(float(s["amount"]) * 4.00, 2)) < 0.05

    def test_usd_invoice_pegged_rate(self, admin_client):
        invoices = admin_client.get(f"{BASE_URL}/api/invoices", timeout=300).json()
        usd = [i for i in invoices if i["source_currency"] in ("USD", "USDT")]
        assert usd, "no USD invoices found"
        s = usd[0]
        assert abs(float(s["aed_rate"]) - 3.6725) < 1e-4, s
        assert abs(float(s["aed_total"]) - round(float(s["amount"]) * 3.6725, 2)) < 0.05

    def test_rate_change_recomputes_at_read_time(self, admin_client):
        invoices = admin_client.get(f"{BASE_URL}/api/invoices", timeout=300).json()
        eur = [i for i in invoices if i["source_currency"] == "EUR"]
        target = eur[0]
        inv_id = target["id"]
        admin_client.put(f"{BASE_URL}/api/fx/settings",
                         json={"mode": "manual", "eur_to_aed": 5.00, "usd_to_aed": 3.6725}, timeout=120)
        one = admin_client.get(f"{BASE_URL}/api/invoices/{inv_id}", timeout=120)
        assert one.status_code == 200, one.text[:300]
        d = one.json()
        assert abs(float(d["aed_rate"]) - 5.00) < 1e-4, d
        assert abs(float(d["aed_total"]) - round(float(d["amount"]) * 5.00, 2)) < 0.05
        # currency column untouched in DB (source currency still EUR)
        assert d["source_currency"] == "EUR"
        assert str(d.get("currency", "")).upper() == "EUR", "invoice row currency must NOT be rewritten to AED"

    def test_auto_mode_eur_live_rate(self, admin_client):
        r = admin_client.put(f"{BASE_URL}/api/fx/settings", json={"mode": "auto"}, timeout=120)
        assert r.status_code == 200
        invoices = admin_client.get(f"{BASE_URL}/api/invoices", timeout=300).json()
        eur = [i for i in invoices if i["source_currency"] == "EUR"][0]
        rate = float(eur["aed_rate"])
        assert 3.0 < rate < 6.0, f"unrealistic auto EUR->AED rate {rate}"
        print(f"auto EUR rate: {rate}")


# --- Invoice HTML / PDF rendering ---
class TestInvoiceRender:
    def test_html_shows_aed_total_and_fx_rate(self, admin_client):
        invoices = admin_client.get(f"{BASE_URL}/api/invoices", timeout=300).json()
        eur = [i for i in invoices if i["source_currency"] == "EUR"][0]
        r = admin_client.get(f"{BASE_URL}/api/invoices/{eur['id']}/html", timeout=120)
        assert r.status_code == 200, r.text[:300]
        html = r.text
        assert re.search(r"Total Billed \(AED\)", html, re.I), "missing Total Billed (AED)"
        assert "FX Rate" in html, "missing FX Rate line"
        assert re.search(r"Reference \(EUR\)", html, re.I), "missing Reference (EUR) line"
        grand = f"{float(eur['aed_total']):,.2f}"
        assert grand in html, f"AED grand total {grand} not present in HTML"

    def test_pdf_valid(self, admin_client):
        invoices = admin_client.get(f"{BASE_URL}/api/invoices", timeout=300).json()
        usd = [i for i in invoices if i["source_currency"] in ("USD", "USDT")][0]
        r = admin_client.get(f"{BASE_URL}/api/invoices/{usd['id']}/pdf", timeout=180)
        assert r.status_code == 200, r.text[:300]
        assert r.content[:4] == b"%PDF", f"not a PDF: {r.content[:20]}"
        assert len(r.content) > 5000
