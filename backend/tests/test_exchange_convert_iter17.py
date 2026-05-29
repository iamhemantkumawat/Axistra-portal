"""Backend tests for Wallet Ledger → Convert routing through Treasury /exchange-convert.

Covers:
- POST /api/treasury/exchange-convert happy path (BINANCE BTC→USDT)
- Returned batch shape (codes, source/destination, status, amounts, rate)
- Wallet ledger fan-out (convert_from / convert_to pair with external_ref)
- Wallets overview reflects the conversion (BTC↓, USDT↑)
- Greedy auto-assignment of unbatched recharges (3 × 0.01 BTC <= 0.04 from_amount)
- Validation errors: unknown wallet (BTCPAY/OXAPAY/WIO_BANK), same coin, non-positive amounts
"""
import os
import uuid
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


def _get_balance(session, wallet, coin):
    r = session.get(f"{BASE_URL}/api/wallets/overview")
    assert r.status_code == 200, r.text
    for w in r.json():
        if w.get('code') == wallet:
            for b in (w.get('balances') or []):
                if b.get('coin') == coin:
                    return Decimal(str(b.get('balance') or 0))
    return Decimal(0)


# ---- Happy path ----------------------------------------------------------------
class TestExchangeConvertHappyPath:
    def test_binance_btc_to_usdt_returns_batch(self, session):
        before_btc = _get_balance(session, 'BINANCE', 'BTC')
        before_usdt = _get_balance(session, 'BINANCE', 'USDT')

        payload = {
            'wallet': 'BINANCE',
            'from_coin': 'BTC',
            'to_coin': 'USDT',
            'from_amount': '0.05',
            'to_amount': '4500',
            'event_at': '2026-05-29',
            'notes': 'TEST_iter17_happy',
        }
        r = session.post(f"{BASE_URL}/api/treasury/exchange-convert", json=payload)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        body = r.json()
        assert 'batch' in body, body
        assert 'assigned_recharges_count' in body
        assert 'assigned_amount' in body
        assert 'remaining_unbatched_amount' in body

        batch = body['batch']
        assert batch.get('batch_code', '').startswith('BIN-'), batch
        assert batch.get('source_gateway') == 'BINANCE'
        assert batch.get('source_wallet') == 'BINANCE'
        assert batch.get('destination_exchange') == 'BINANCE'
        assert batch.get('destination_wallet') == 'BINANCE'
        assert batch.get('status') == 'converted_to_usdt'
        assert batch.get('coin') == 'BTC'
        assert Decimal(str(batch.get('received_crypto_amount') or 0)) == Decimal('0.05')
        assert Decimal(str(batch.get('usdt_amount') or 0)) == Decimal('4500')
        rate = Decimal(str(batch.get('usdt_conversion_rate') or 0))
        assert rate > Decimal('80000') and rate < Decimal('100000'), f"rate sanity: {rate}"

        # Persist for follow-up tests
        TestExchangeConvertHappyPath.batch_code = batch['batch_code']
        TestExchangeConvertHappyPath.from_amount = Decimal('0.05')
        TestExchangeConvertHappyPath.to_amount = Decimal('4500')
        TestExchangeConvertHappyPath.before_btc = before_btc
        TestExchangeConvertHappyPath.before_usdt = before_usdt

    def test_wallet_ledger_has_convert_pair(self, session):
        bc = TestExchangeConvertHappyPath.batch_code
        r = session.get(f"{BASE_URL}/api/wallets/BINANCE/ledger?limit=200")
        assert r.status_code == 200, r.text
        rows = r.json().get('rows', [])
        ext_ref = f"{bc}-CONV-USDT"
        cf = [x for x in rows if x.get('tx_type') == 'convert_from' and x.get('external_ref') == ext_ref]
        ct = [x for x in rows if x.get('tx_type') == 'convert_to' and x.get('external_ref') == ext_ref]
        assert cf, f"convert_from row missing for {ext_ref}"
        assert ct, f"convert_to row missing for {ext_ref}"
        assert cf[0].get('coin') == 'BTC'
        assert ct[0].get('coin') == 'USDT'
        assert Decimal(str(cf[0].get('amount'))) == Decimal('-0.05')
        assert Decimal(str(ct[0].get('amount'))) == Decimal('4500')

    def test_overview_reflects_conversion(self, session):
        after_btc = _get_balance(session, 'BINANCE', 'BTC')
        after_usdt = _get_balance(session, 'BINANCE', 'USDT')
        # delta within rounding tolerance
        assert (TestExchangeConvertHappyPath.before_btc - after_btc) == Decimal('0.05'), \
            f"BTC delta: before={TestExchangeConvertHappyPath.before_btc} after={after_btc}"
        assert (after_usdt - TestExchangeConvertHappyPath.before_usdt) == Decimal('4500'), \
            f"USDT delta: before={TestExchangeConvertHappyPath.before_usdt} after={after_usdt}"


# ---- Auto-assignment of unbatched recharges -----------------------------------
class TestAutoAssignment:
    created_ids = []

    @classmethod
    def _ensure_customer(cls, session):
        r = session.get(f"{BASE_URL}/api/customers")
        customers = r.json() if r.status_code == 200 else []
        if isinstance(customers, list) and customers:
            return customers[0].get('id')
        # create a test customer
        body = {
            'full_name': 'TEST_iter17 AutoAssign Customer',
            'email': f'test_iter17_{uuid.uuid4().hex[:8]}@axistratest.com',
            'phone': '+971500000000',
        }
        rr = session.post(f"{BASE_URL}/api/customers", json=body)
        if rr.status_code not in (200, 201):
            pytest.skip(f"Cannot create customer: {rr.status_code} {rr.text}")
        return rr.json().get('id')

    @classmethod
    def _create_recharge(cls, session, customer_id, idx):
        unique_hash = f"TEST_iter17_{uuid.uuid4().hex[:16]}_{idx}"
        body = {
            'customer_id': customer_id,
            'amount': '500',
            'currency': 'AED',
            'payment_method': 'crypto',
            'payment_gateway': 'Binance',
            'crypto_coin': 'BTC',
            'crypto_amount': '0.01',
            'tx_hash': unique_hash,
            'payment_date': '2026-05-20',
            'notes': f'TEST_iter17_assign_{idx}',
        }
        rr = session.post(f"{BASE_URL}/api/recharges", json=body)
        if rr.status_code not in (200, 201):
            pytest.skip(f"Cannot create recharge: {rr.status_code} {rr.text}")
        rid = rr.json().get('id')
        cls.created_ids.append(rid)
        return rid

    def test_three_recharges_all_assigned_to_new_batch(self, session):
        customer_id = self._ensure_customer(session)
        # Seed 3 unbatched recharges on BINANCE
        for i in range(3):
            self._create_recharge(session, customer_id, i)

        payload = {
            'wallet': 'BINANCE',
            'from_coin': 'BTC',
            'to_coin': 'USDT',
            'from_amount': '0.04',
            'to_amount': '3600',
            'event_at': '2026-05-30',
            'notes': 'TEST_iter17_auto_assign',
        }
        r = session.post(f"{BASE_URL}/api/treasury/exchange-convert", json=payload)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        body = r.json()
        # 3 × 0.01 = 0.03 ≤ 0.04 → all 3 should be assigned
        assert body.get('assigned_recharges_count') == 3, body
        assigned_amt = Decimal(str(body.get('assigned_amount') or 0))
        assert assigned_amt == Decimal('0.03'), f"assigned={assigned_amt}"
        remaining = Decimal(str(body.get('remaining_unbatched_amount') or 0))
        assert remaining == Decimal('0.01'), f"remaining={remaining}"

    def teardown_method(self, method):
        # Note: cannot easily delete recharges if API doesn't expose; leave TEST_ tagged.
        pass


# ---- Validation errors --------------------------------------------------------
class TestValidation:
    @pytest.mark.parametrize('wallet', ['BTCPAY', 'OXAPAY', 'WIO_BANK'])
    def test_unknown_exchange_wallet_returns_400(self, session, wallet):
        r = session.post(f"{BASE_URL}/api/treasury/exchange-convert", json={
            'wallet': wallet, 'from_coin': 'BTC', 'to_coin': 'USDT',
            'from_amount': '0.01', 'to_amount': '900', 'event_at': '2026-05-29'
        })
        assert r.status_code == 400, f"{wallet}: {r.status_code} {r.text}"
        msg = (r.json().get('message') or '').lower()
        assert 'unknown' in msg or 'exchange' in msg, r.text

    def test_same_coin_returns_400(self, session):
        r = session.post(f"{BASE_URL}/api/treasury/exchange-convert", json={
            'wallet': 'BINANCE', 'from_coin': 'BTC', 'to_coin': 'BTC',
            'from_amount': '0.01', 'to_amount': '0.01', 'event_at': '2026-05-29'
        })
        assert r.status_code == 400, r.text
        msg = (r.json().get('message') or '').lower()
        assert 'differ' in msg or 'same' in msg or 'from' in msg, r.text

    def test_zero_from_amount_returns_400(self, session):
        r = session.post(f"{BASE_URL}/api/treasury/exchange-convert", json={
            'wallet': 'BINANCE', 'from_coin': 'BTC', 'to_coin': 'USDT',
            'from_amount': '0', 'to_amount': '4500', 'event_at': '2026-05-29'
        })
        assert r.status_code == 400, r.text

    def test_negative_to_amount_returns_400(self, session):
        r = session.post(f"{BASE_URL}/api/treasury/exchange-convert", json={
            'wallet': 'BINANCE', 'from_coin': 'BTC', 'to_coin': 'USDT',
            'from_amount': '0.01', 'to_amount': '-1', 'event_at': '2026-05-29'
        })
        assert r.status_code == 400, r.text


# ---- Idempotency: two identical calls => two distinct batches -----------------
class TestNonIdempotent:
    def test_repeat_creates_new_batch(self, session):
        payload = {
            'wallet': 'BINANCE', 'from_coin': 'BTC', 'to_coin': 'USDT',
            'from_amount': '0.001', 'to_amount': '90', 'event_at': '2026-05-29',
            'notes': 'TEST_iter17_idem_check'
        }
        r1 = session.post(f"{BASE_URL}/api/treasury/exchange-convert", json=payload)
        r2 = session.post(f"{BASE_URL}/api/treasury/exchange-convert", json=payload)
        assert r1.status_code in (200, 201) and r2.status_code in (200, 201)
        b1 = r1.json()['batch']['batch_code']
        b2 = r2.json()['batch']['batch_code']
        assert b1 != b2, f"expected distinct batches, got {b1} == {b2}"
