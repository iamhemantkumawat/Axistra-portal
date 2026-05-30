"""Backend tests for direct crypto→fiat conversion (iter_18).

Covers the new POST /api/treasury/exchange-convert branches:
- crypto → AED direct (no USDT step) — status='converted_to_aed', fiat_currency='AED'
- crypto → USD direct — status='converted_to_aed', fiat_currency='USD'
- crypto → EUR direct — status='converted_to_aed', fiat_currency='EUR'
- crypto → USDT (regression) — status='converted_to_usdt', usdt_amount set
- crypto → crypto (BTC→ETH) — status='received_in_exchange', no usdt_amount no fiat_received
- Wallet ledger fan-out for direct fiat path: convert_from -coin + convert_to +fiat
  with external_ref '{batch_code}-CONV-AED' (legacy suffix, now used for all fiat targets)
- DELETE /api/treasury/batches/:id/step/aed removes the convert pair + clears fiat fields
"""
import os
import pytest
import requests
from decimal import Decimal


def _read_env(path, key):
    try:
        with open(path) as f:
            for line in f:
                if line.startswith(f"{key}="):
                    return line.split('=', 1)[1].strip()
    except FileNotFoundError:
        return None
    return None


BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or _read_env('/app/frontend/.env', 'REACT_APP_BACKEND_URL')).rstrip('/')
EMAIL = 'admin@axistratech.com'
PASSWORD = 'admin123'


@pytest.fixture(scope='module')
def session():
    s = requests.Session()
    s.headers.update({'Content-Type': 'application/json'})
    r = s.post(f"{BASE_URL}/api/auth/login", json={
        'email': EMAIL, 'password': PASSWORD, 'accept_terms': True
    })
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json().get('access_token') or r.json().get('token')
    assert token, f"no token in login response: {r.json()}"
    s.headers.update({'Authorization': f'Bearer {token}'})
    return s


def _post_convert(session, **overrides):
    payload = {
        'wallet': 'BINANCE',
        'from_coin': 'BTC',
        'to_coin': 'AED',
        'from_amount': '0.01',
        'to_amount': '3500',
        'event_at': '2026-05-29',
        'notes': 'TEST_iter18',
    }
    payload.update(overrides)
    r = session.post(f"{BASE_URL}/api/treasury/exchange-convert", json=payload)
    assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
    return r.json()


# ---- Direct crypto → fiat -----------------------------------------------------
class TestDirectFiatConversion:
    """BTC → AED, BTC → USD, ETH → EUR — no USDT hop."""

    def test_btc_to_aed_returns_correct_batch_shape(self, session):
        body = _post_convert(session, from_coin='BTC', to_coin='AED',
                             from_amount='0.01', to_amount='3500',
                             notes='TEST_iter18_btc_aed')
        b = body['batch']
        assert b['status'] == 'converted_to_aed', b
        assert b['coin'] == 'BTC'
        assert Decimal(str(b['crypto_converted'])) == Decimal('0.01'), b
        assert Decimal(str(b['fiat_received'])) == Decimal('3500'), b
        assert b['fiat_currency'] == 'AED', b
        assert Decimal(str(b['conversion_rate'])) == Decimal('350000'), b
        # USDT step skipped
        assert not b.get('usdt_amount') or Decimal(str(b.get('usdt_amount') or 0)) == 0, b
        TestDirectFiatConversion.btc_aed_batch = b

    def test_btc_to_usd_creates_usd_batch(self, session):
        body = _post_convert(session, from_coin='BTC', to_coin='USD',
                             from_amount='0.01', to_amount='950',
                             notes='TEST_iter18_btc_usd')
        b = body['batch']
        assert b['status'] == 'converted_to_aed', b  # status is legacy name
        assert b['fiat_currency'] == 'USD', b
        assert Decimal(str(b['fiat_received'])) == Decimal('950'), b
        assert not b.get('usdt_amount') or Decimal(str(b.get('usdt_amount') or 0)) == 0

    def test_eth_to_eur_creates_eur_batch(self, session):
        body = _post_convert(session, from_coin='ETH', to_coin='EUR',
                             from_amount='1', to_amount='3200',
                             notes='TEST_iter18_eth_eur')
        b = body['batch']
        assert b['status'] == 'converted_to_aed', b
        assert b['fiat_currency'] == 'EUR', b
        assert b['coin'] == 'ETH'
        assert Decimal(str(b['fiat_received'])) == Decimal('3200'), b

    def test_eth_to_usd_creates_usd_batch_direct(self, session):
        body = _post_convert(session, from_coin='ETH', to_coin='USD',
                             from_amount='1', to_amount='3400',
                             notes='TEST_iter18_eth_usd')
        b = body['batch']
        assert b['status'] == 'converted_to_aed'
        assert b['fiat_currency'] == 'USD'
        assert b['coin'] == 'ETH'
        TestDirectFiatConversion.eth_usd_batch = b


# ---- Regression: USDT target still works --------------------------------------
class TestUsdtRegression:
    def test_btc_to_usdt_still_works(self, session):
        body = _post_convert(session, from_coin='BTC', to_coin='USDT',
                             from_amount='0.001', to_amount='90',
                             notes='TEST_iter18_btc_usdt_regression')
        b = body['batch']
        assert b['status'] == 'converted_to_usdt', b
        assert Decimal(str(b['usdt_amount'])) == Decimal('90'), b
        assert not b.get('fiat_received') or Decimal(str(b.get('fiat_received') or 0)) == 0, b
        # fiat_currency should NOT be set on the USDT-only path
        assert not b.get('fiat_currency'), b


# ---- Crypto → Crypto ----------------------------------------------------------
class TestCryptoToCrypto:
    def test_btc_to_eth_no_fiat_no_usdt(self, session):
        body = _post_convert(session, from_coin='BTC', to_coin='ETH',
                             from_amount='0.01', to_amount='0.18',
                             notes='TEST_iter18_btc_eth')
        b = body['batch']
        assert b['status'] == 'received_in_exchange', b
        assert b['coin'] == 'BTC'
        assert not b.get('usdt_amount') or Decimal(str(b.get('usdt_amount') or 0)) == 0
        assert not b.get('fiat_received') or Decimal(str(b.get('fiat_received') or 0)) == 0
        assert not b.get('fiat_currency'), b


# ---- Ledger fan-out for direct fiat -------------------------------------------
class TestLedgerFanout:
    def test_btc_to_aed_creates_btc_convert_from_aed_convert_to(self, session):
        b = TestDirectFiatConversion.btc_aed_batch
        ext_ref = f"{b['batch_code']}-CONV-AED"

        # BTC side
        r = session.get(f"{BASE_URL}/api/wallets/BINANCE/ledger?coin=BTC&limit=300")
        assert r.status_code == 200, r.text
        rows = r.json().get('rows', [])
        cf = [x for x in rows if x.get('tx_type') == 'convert_from' and x.get('external_ref') == ext_ref]
        assert cf, f"convert_from BTC row missing for {ext_ref}"
        assert cf[0]['coin'] == 'BTC'
        assert Decimal(str(cf[0]['amount'])) == Decimal('-0.01')

        # Verify NO -CONV-USDT row exists for this batch (USDT step skipped)
        usdt_ref = f"{b['batch_code']}-CONV-USDT"
        rr = session.get(f"{BASE_URL}/api/wallets/BINANCE/ledger?limit=500")
        all_rows = rr.json().get('rows', [])
        usdt_rows = [x for x in all_rows if x.get('external_ref') == usdt_ref]
        assert not usdt_rows, f"USDT step should be skipped, found rows: {usdt_rows}"

        # AED side
        r2 = session.get(f"{BASE_URL}/api/wallets/BINANCE/ledger?coin=AED&limit=300")
        assert r2.status_code == 200, r2.text
        rows2 = r2.json().get('rows', [])
        ct = [x for x in rows2 if x.get('tx_type') == 'convert_to' and x.get('external_ref') == ext_ref]
        assert ct, f"convert_to AED row missing for {ext_ref}"
        assert ct[0]['coin'] == 'AED'
        assert Decimal(str(ct[0]['amount'])) == Decimal('3500')

    def test_eth_to_usd_creates_eth_minus_usd_plus(self, session):
        b = TestDirectFiatConversion.eth_usd_batch
        ext_ref = f"{b['batch_code']}-CONV-AED"  # legacy suffix used for any fiat
        r = session.get(f"{BASE_URL}/api/wallets/BINANCE/ledger?limit=500")
        rows = r.json().get('rows', [])
        cf = [x for x in rows if x.get('external_ref') == ext_ref and x.get('tx_type') == 'convert_from']
        ct = [x for x in rows if x.get('external_ref') == ext_ref and x.get('tx_type') == 'convert_to']
        assert cf, f"missing ETH convert_from for {ext_ref}"
        assert ct, f"missing USD convert_to for {ext_ref}"
        assert cf[0]['coin'] == 'ETH', cf[0]
        assert ct[0]['coin'] == 'USD', ct[0]
        assert Decimal(str(cf[0]['amount'])) == Decimal('-1')
        assert Decimal(str(ct[0]['amount'])) == Decimal('3400')


# ---- DELETE step/aed for a direct BTC→AED batch -------------------------------
class TestDeleteAedStep:
    def test_delete_aed_step_removes_pair_and_clears_fields(self, session):
        # Create a fresh direct batch
        body = _post_convert(session, from_coin='BTC', to_coin='AED',
                             from_amount='0.005', to_amount='1700',
                             notes='TEST_iter18_delete_aed')
        b = body['batch']
        batch_id = b['id']
        batch_code = b['batch_code']
        ext_ref = f"{batch_code}-CONV-AED"

        # Verify ledger rows exist
        r = session.get(f"{BASE_URL}/api/wallets/BINANCE/ledger?limit=500")
        rows = r.json().get('rows', [])
        before = [x for x in rows if x.get('external_ref') == ext_ref]
        assert len(before) >= 2, f"expected at least 2 rows pre-delete: {before}"

        # DELETE the AED step
        d = session.delete(f"{BASE_URL}/api/treasury/batches/{batch_id}/step/aed")
        assert d.status_code in (200, 204), f"{d.status_code} {d.text}"

        # Verify ledger rows are gone
        r2 = session.get(f"{BASE_URL}/api/wallets/BINANCE/ledger?limit=500")
        rows2 = r2.json().get('rows', [])
        after = [x for x in rows2 if x.get('external_ref') == ext_ref]
        assert not after, f"expected ledger rows removed, still found: {after}"

        # Verify batch fiat fields are cleared
        # Fetch via /api/treasury/batches/:id
        rb = session.get(f"{BASE_URL}/api/treasury/batches/{batch_id}")
        if rb.status_code == 200:
            updated = rb.json()
            assert not updated.get('fiat_received') or Decimal(str(updated.get('fiat_received') or 0)) == 0, updated
            assert not updated.get('crypto_converted') or Decimal(str(updated.get('crypto_converted') or 0)) == 0, updated
            assert not updated.get('conversion_rate') or Decimal(str(updated.get('conversion_rate') or 0)) == 0, updated
