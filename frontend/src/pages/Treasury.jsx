import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { PageHeader, Badge, KpiCard, Modal, Field, Hash } from '../components/Atoms';
import { RECHARGE_STATUS_META, fmtDate, fmtMoney, fmtNumber } from '../lib/format';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowsLeftRight,
  Bank,
  Buildings,
  CheckCircle,
  Coin,
  DownloadSimple,
  Funnel,
  Receipt,
  Trash,
  Wallet,
  Warning,
} from '@phosphor-icons/react';

const TABS = [
  { key: 'receipts', label: 'Payment Receipts' },
  { key: 'btcpay', label: 'BTCPay' },
  { key: 'oxapay', label: 'OxaPay' },
  { key: 'okx', label: 'OKX' },
  { key: 'binance', label: 'Binance' },
  { key: 'aed', label: 'AED & Wio' },
];

const BATCH_STATUS_META = {
  open: { label: 'Open', cls: 'badge-neutral' },
  ready_to_transfer: { label: 'Ready to Transfer', cls: 'badge-warning' },
  sent_to_exchange: { label: 'Transferred', cls: 'badge-info' },
  received_in_exchange: { label: 'Transferred / Received', cls: 'badge-info' },
  converted_to_usdt: { label: 'Converted to USDT', cls: 'badge-info' },
  converted_to_aed: { label: 'Converted to AED', cls: 'badge-info' },
  reconciled: { label: 'Fully Reconciled', cls: 'badge-success' },
};

const emptyBatch = {
  name: `Treasury Sweep ${new Date().toISOString().slice(0, 10)}`,
  source_gateway: 'Mixed',
  source_wallet: '',
  destination_exchange: 'OKX',
  destination_wallet: '',
  coin: '',
  network: '',
  period_start: new Date().toISOString().slice(0, 10),
  period_end: new Date().toISOString().slice(0, 10),
  settlement_tx_hash: '',
  transfer_fee_crypto: '',
  received_crypto_amount: '',
  notes: '',
};

const dateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');
const statusMeta = (status) => BATCH_STATUS_META[status] || { label: status || 'Open', cls: 'badge-neutral' };
const fmtCrypto = (value) => {
  const n = parseFloat(value || '0');
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, { maximumFractionDigits: 8 });
};
const fmtLedgerAmount = (value, currency) => {
  const normalized = String(currency || '').toUpperCase();
  if (['AED', 'USD', 'EUR', 'INR'].includes(normalized)) return fmtMoney(value, normalized);
  return `${fmtCrypto(value)} ${currency || ''}`.trim();
};
const txFinalUsdt = (tx) => parseFloat(tx.final_usdt_amount || ((tx.coin || '').toUpperCase() === 'USDT' ? tx.received_amount || tx.crypto_amount || '0' : '0')) || 0;
const rechargeFinalUsdt = (recharge) => (recharge.crypto_transactions || []).reduce((sum, tx) => sum + txFinalUsdt(tx), 0);
const rechargeCryptoLabel = (recharge) => {
  const txs = recharge.crypto_transactions || [];
  if (txs.length === 1) return `${fmtCrypto(txs[0].crypto_amount || txs[0].received_amount)} ${txs[0].coin || recharge.crypto_coin}`;
  return `${fmtCrypto(recharge.crypto_amount)} ${recharge.crypto_coin}`;
};
const batchCryptoAmount = (batch) => parseFloat(batch.received_crypto_amount || batch.total_crypto_amount || '0') || 0;
const batchUsdtAmount = (batch) => parseFloat(batch.usdt_amount || batch.crypto_converted || '0') || 0;
const batchAedAmount = (batch) => parseFloat(batch.fiat_received || '0') || 0;
const numeric = (value) => {
  const n = parseFloat(value || '0');
  return Number.isFinite(n) ? n : 0;
};
const receiptCryptoAmount = (receipt) => numeric(receipt.crypto_amount);
const entryCoin = (entry) => String(entry.crypto_coin || entry.coin || entry.currency || '').toUpperCase();
const safeJson = (value) => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};
const isReadyReceipt = (r) => (
  !r.treasury?.treasury_batch_id
  && r.tx_hash
  && r.magnus_credited_at
  && !r.reconciled
  && !['mismatch', 'refunded', 'failed'].includes(r.status)
);
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const inDateRange = (value, filter, customFrom, customTo) => {
  if (!filter || filter === 'all') return true;
  const stamp = value ? new Date(value) : null;
  if (!stamp || Number.isNaN(stamp.getTime())) return false;
  const today = startOfDay(new Date());
  const rowDay = startOfDay(stamp);
  if (filter === 'today') return rowDay.getTime() === today.getTime();
  if (filter === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return rowDay.getTime() === yesterday.getTime();
  }
  if (filter === 'custom') {
    const from = customFrom ? startOfDay(new Date(customFrom)) : null;
    const to = customTo ? startOfDay(new Date(customTo)) : null;
    if (from && rowDay < from) return false;
    if (to && rowDay > to) return false;
  }
  return true;
};
const rowCoin = (row) => String(row.crypto_coin || row.coin || row.currency || '').toUpperCase();

function cleanPayload(payload) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== '' && value !== null && value !== undefined));
}

function BatchStatus({ status }) {
  const meta = statusMeta(status);
  return <Badge className={meta.cls}>{meta.label}</Badge>;
}

function StepPill({ icon: Icon, label, sub }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--axistra-green-light)] text-axistra-green">
        <Icon size={18} weight="duotone" />
      </div>
      <div>
        <div className="text-sm font-semibold text-gray-900">{label}</div>
        <div className="text-xs text-gray-500">{sub}</div>
      </div>
    </div>
  );
}

export default function Treasury() {
  const [data, setData] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [activeTab, setActiveTab] = useState('receipts');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);
  const [gatewayFilter, setGatewayFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [coinFilter, setCoinFilter] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchForm, setBatchForm] = useState(emptyBatch);
  const [activeBatch, setActiveBatch] = useState(null);
  const [activeReceipt, setActiveReceipt] = useState(null);
  const [activeExpense, setActiveExpense] = useState(null);
  const [batchDetail, setBatchDetail] = useState(null);
  const [settlementForm, setSettlementForm] = useState({});
  // Cards 2/3/4 of the Treasury Transfer modal (USDT, AED, Wio Bank) are
  // OPTIONAL. They get hidden by default — finishing just the Sweep step is
  // a valid flow ("Held as BTC at Binance"). User explicitly asked for this
  // breakup so they can hold coin at the exchange without being prompted to
  // convert in the same click.
  const [showStep2, setShowStep2] = useState(false);
  const [showStep3, setShowStep3] = useState(false);
  const [showStep4, setShowStep4] = useState(false);
  const [operationOpen, setOperationOpen] = useState(false);
  const [operationType, setOperationType] = useState('');
  const [operationForm, setOperationForm] = useState({});
  const [verifyingId, setVerifyingId] = useState('');
  const [loading, setLoading] = useState(false);
  // Authoritative wallet balances from the double-entry ledger. Treasury's
  // header chips read straight from this so the numbers can NEVER drift from
  // what the Wallet Ledger page shows.
  const [walletOverview, setWalletOverview] = useState([]);

  const load = async () => {
    const [treasuryRes, expenseRes, walletsRes] = await Promise.all([
      api.get('/treasury/reconciliation'),
      api.get('/expenses'),
      api.get('/wallets/overview'),
    ]);
    setData(treasuryRes.data);
    setExpenses(expenseRes.data);
    setWalletOverview(walletsRes.data || []);
  };

  useEffect(() => { load(); }, []);

  const walletBalanceFor = (walletCode, coin) => {
    const w = walletOverview.find((x) => x.code === walletCode);
    if (!w) return 0;
    const row = (w.balances || []).find((b) => String(b.coin).toUpperCase() === String(coin).toUpperCase());
    return parseFloat(row?.balance || 0) || 0;
  };
  const walletBalancesFor = (walletCode) => {
    const w = walletOverview.find((x) => x.code === walletCode);
    return (w?.balances || []).map((b) => [String(b.coin).toUpperCase(), parseFloat(b.balance) || 0]);
  };

  const deleteReceipt = async (recharge) => {
    if (!window.confirm(`Delete recharge ${recharge.recharge_code}? This cascades to its crypto transactions, invoice (if any) and wallet ledger rows.`)) return;
    try {
      await api.delete(`/recharges/${recharge.id}`);
      toast.success(`Recharge ${recharge.recharge_code} deleted`);
      await load();
    } catch (err) { toast.error(err?.response?.data?.message || 'Failed to delete recharge'); }
  };
  const deleteBatch = async (batch) => {
    if (!window.confirm(`Delete treasury batch ${batch.batch_code || batch.name || batch.id.slice(0, 8)}? This reverses any wallet ledger fan-out tagged to it.`)) return;
    try {
      await api.delete(`/treasury/batches/${batch.id}`);
      toast.success('Batch deleted');
      await load();
    } catch (err) { toast.error(err?.response?.data?.message || 'Failed to delete batch'); }
  };
  const deleteExpenseRow = async (expense) => {
    if (!window.confirm(`Delete expense ${expense.expense_code || expense.vendor_name}? This reverses its wallet ledger entry.`)) return;
    try {
      await api.delete(`/expenses/${expense.id}`);
      toast.success('Expense deleted');
      await load();
    } catch (err) { toast.error(err?.response?.data?.message || 'Failed to delete expense'); }
  };

  const filterRows = (rows) => rows.filter((row) => (
    inDateRange(row.payment_date || row.created_at || row.expense_date || row.conversion_date || row.period_start, dateFilter, customFrom, customTo)
    && (!coinFilter || rowCoin(row) === coinFilter)
  ));

  const coinOptions = useMemo(() => {
    const coins = new Set();
    (data?.recharges || []).forEach((r) => r.crypto_coin && coins.add(String(r.crypto_coin).toUpperCase()));
    (data?.batches || []).forEach((b) => b.coin && coins.add(String(b.coin).toUpperCase()));
    expenses.forEach((e) => e.currency && coins.add(String(e.currency).toUpperCase()));
    return [...coins].sort();
  }, [data, expenses]);

  const readyReceipts = useMemo(() => {
    const rows = filterRows(data?.recharges?.filter(isReadyReceipt) || []);
    if (!gatewayFilter) return rows;
    return rows.filter((r) => (r.payment_gateway || '').toLowerCase() === gatewayFilter.toLowerCase());
  }, [data, gatewayFilter, dateFilter, customFrom, customTo, coinFilter]);

  const selectedReceipts = useMemo(
    () => (data?.recharges || []).filter((r) => selectedIds.includes(r.id)),
    [data, selectedIds],
  );

  const batches = data?.batches || [];
  const btcpayReceipts = useMemo(
    () => filterRows((data?.recharges || []).filter((r) => (r.payment_gateway || '').toLowerCase() === 'btcpay')),
    [data, dateFilter, customFrom, customTo, coinFilter],
  );
  const btcpayReadyReceipts = useMemo(
    () => btcpayReceipts.filter(isReadyReceipt),
    [btcpayReceipts],
  );
  const oxapayReceipts = useMemo(
    () => filterRows((data?.recharges || []).filter((r) => (r.payment_gateway || '').toLowerCase() === 'oxapay')),
    [data, dateFilter, customFrom, customTo, coinFilter],
  );
  const okxReceipts = useMemo(
    () => filterRows((data?.recharges || []).filter((r) => (r.payment_gateway || '').toLowerCase() === 'okx')),
    [data, dateFilter, customFrom, customTo, coinFilter],
  );
  const binanceReceipts = useMemo(
    () => filterRows((data?.recharges || []).filter((r) => (r.payment_gateway || '').toLowerCase() === 'binance')),
    [data, dateFilter, customFrom, customTo, coinFilter],
  );
  const exchangeBatchEntries = useMemo(
    () => filterRows(batches.filter((b) => b.destination_exchange || b.settlement_tx_hash || ['ready_to_transfer', 'sent_to_exchange', 'received_in_exchange', 'converted_to_usdt', 'converted_to_aed', 'reconciled'].includes(b.status))),
    [batches, dateFilter, customFrom, customTo, coinFilter],
  );
  const okxBatchEntries = useMemo(
    () => exchangeBatchEntries.filter((b) => (b.destination_exchange || '').toLowerCase() === 'okx'),
    [exchangeBatchEntries],
  );
  const binanceBatchEntries = useMemo(
    () => exchangeBatchEntries.filter((b) => (b.destination_exchange || '').toLowerCase() === 'binance'),
    [exchangeBatchEntries],
  );
  const expenseOutflows = useMemo(
    () => filterRows(expenses.filter((e) => e.paid_in_usdt || ['USDT', 'OKX', 'Binance', 'BinancePay', 'OxaPay', 'Bank', 'Card', 'Cash'].includes(e.payment_method))),
    [expenses, dateFilter, customFrom, customTo, coinFilter],
  );
  const walletExpenseOutflows = (wallet) => expenseOutflows.filter((e) => (
    String(e.payment_method || '').toLowerCase() === wallet.toLowerCase()
    || String(e.bank_reference || '').toLowerCase() === wallet.toLowerCase()
    || (wallet === 'Binance' && String(e.payment_method || '').toLowerCase() === 'binancepay')
  ));

  const toggleReceipt = (id) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const toggleBatch = (id) => {
    setSelectedBatchIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const activeExchangeName = activeTab === 'okx' ? 'OKX' : 'Binance';
  const exchangeReceipts = activeTab === 'okx' ? okxReceipts : binanceReceipts;
  const exchangeReadyReceipts = exchangeReceipts.filter(isReadyReceipt);
  const exchangeBatchRows = activeTab === 'okx' ? okxBatchEntries : binanceBatchEntries;
  const exchangePayoutRows = walletExpenseOutflows(activeExchangeName);
  const selectedExchangeBatches = exchangeBatchRows.filter((b) => selectedBatchIds.includes(b.id));
  const selectedExchangeReceipts = exchangeReceipts.filter((r) => selectedIds.includes(r.id) && isReadyReceipt(r));
  const selectedExchangeEntryCount = selectedExchangeBatches.length + selectedExchangeReceipts.length;
  const selectVisibleExchangeEntries = () => {
    const receiptIds = exchangeReadyReceipts.map((r) => r.id);
    const batchIds = exchangeBatchRows.map((b) => b.id);
    const allSelected = receiptIds.every((id) => selectedIds.includes(id)) && batchIds.every((id) => selectedBatchIds.includes(id));
    setSelectedIds(allSelected ? [] : receiptIds);
    setSelectedBatchIds(allSelected ? [] : batchIds);
  };
  const clearExchangeSelection = () => {
    setSelectedIds([]);
    setSelectedBatchIds([]);
  };
  // Pull balances STRAIGHT from the double-entry ledger so the chips here
  // match the Wallet Ledger page exactly. The legacy computation from
  // recharges+batches+expenses tended to over-count (it summed USDT-equivalent
  // values of native-coin receipts instead of the actual converted USDT).
  const exchangeWalletCode = activeTab === 'okx' ? 'OKX' : 'BINANCE';
  const exchangeUsdtBalance = walletBalanceFor(exchangeWalletCode, 'USDT');
  const activeExchangeCoinSummary = walletBalancesFor(exchangeWalletCode)
    .filter(([, value]) => Math.abs(value) > 0.00000001)
    .sort(([a], [b]) => a.localeCompare(b));

  const openSourceBatch = ({ sourceGateway, sourceWallet, destinationExchange = 'OKX', coin, network, receipts, name }) => {
    const available = receipts.filter(isReadyReceipt);
    const selectedInSource = available.filter((r) => selectedIds.includes(r.id));
    const rows = selectedInSource.length ? selectedInSource : available;
    const ids = rows.map((r) => r.id);
    if (!ids.length) {
      toast.error(`No ready ${sourceGateway} receipts to transfer`);
      return;
    }
    setSelectedIds(ids);
    const inferredCoins = [...new Set(rows.map((r) => r.crypto_coin).filter(Boolean))];
    const inferredNetworks = [...new Set(rows.map((r) => r.crypto_network).filter(Boolean))];
    setBatchForm({
      ...emptyBatch,
      name: name || `${sourceGateway} Sweep ${new Date().toISOString().slice(0, 10)}`,
      source_gateway: sourceGateway,
      source_wallet: sourceWallet,
      destination_exchange: destinationExchange,
      coin: coin || (inferredCoins.length === 1 ? inferredCoins[0] : ''),
      network: network || (inferredNetworks.length === 1 ? inferredNetworks[0] : ''),
    });
    setBatchOpen(true);
  };

  const openBtcpayBatch = () => openSourceBatch({
    sourceGateway: 'BTCPay',
    sourceWallet: 'BTCPay Wallet',
    destinationExchange: 'Binance',
    coin: 'BTC',
    network: 'BTC',
    receipts: btcpayReceipts,
    name: `BTCPay BTC Sweep ${new Date().toISOString().slice(0, 10)}`,
  });

  const openOxaPayBatch = () => openSourceBatch({
    sourceGateway: 'OxaPay',
    sourceWallet: 'OxaPay Merchant Balance',
    destinationExchange: 'Binance',
    coin: 'USDT',
    network: 'TRC20',
    receipts: oxapayReceipts,
    name: `OxaPay USDT Sweep ${new Date().toISOString().slice(0, 10)}`,
  });

  const verifyBtcpay = async (rechargeId) => {
    setVerifyingId(rechargeId);
    try {
      await api.post(`/treasury/btcpay/${rechargeId}/verify`);
      toast.success('BTCPay BTC transaction verified from mempool');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not verify BTC transaction');
    } finally {
      setVerifyingId('');
    }
  };

  const verifyActiveBtcTransfer = async () => {
    if (!activeBatch) return;
    if (!settlementForm.settlement_tx_hash) {
      toast.error('Enter the BTC transfer TXID first');
      return;
    }
    if (!settlementForm.destination_wallet) {
      toast.error('Enter the Binance/OKX deposit wallet first');
      return;
    }
    setVerifyingId(activeBatch.id);
    try {
      // Persist ONLY sweep-related fields so we don't trip the backend's
      // step-2/3/4 evidence assertions (e.g. "Conversion rate is required"
      // would fire if the user had typed partial AED data). The other steps
      // get saved when the user clicks Save Settlement.
      const sweepPayload = cleanPayload({
        source_wallet: settlementForm.source_wallet,
        destination_exchange: settlementForm.destination_exchange,
        destination_wallet: settlementForm.destination_wallet,
        settlement_tx_hash: settlementForm.settlement_tx_hash,
        transfer_fee_crypto: settlementForm.transfer_fee_crypto,
        exchange_received_at: settlementForm.exchange_received_at,
        received_crypto_amount: settlementForm.received_crypto_amount,
        settlement_reference: settlementForm.settlement_reference,
        coin: activeBatch.coin || settlementForm.coin,
      });
      const { data: saved } = await api.patch(`/treasury/batches/${activeBatch.id}`, sweepPayload);
      const { data: verified } = await api.post(`/treasury/batches/${activeBatch.id}/verify-btc-transfer`);
      toast.success('BTC transfer verified from mempool');
      setActiveBatch(verified);
      setSettlementForm({
        ...settlementForm,
        settlement_tx_hash: verified.settlement_tx_hash || saved.settlement_tx_hash || settlementForm.settlement_tx_hash,
        transfer_fee_crypto: verified.transfer_fee_crypto || '',
        received_crypto_amount: verified.received_crypto_amount || '',
        exchange_received_at: dateInput(verified.exchange_received_at),
        settlement_reference: verified.settlement_reference || '',
        notes: verified.notes || settlementForm.notes || '',
      });
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not verify BTC transfer');
    } finally {
      setVerifyingId('');
    }
  };

  const openOperation = (type) => {
    if (!selectedExchangeEntryCount) {
      toast.error('Select one or more wallet entries first');
      return;
    }
    if (type !== 'to_usdt' && selectedExchangeReceipts.length) {
      toast.error('Direct customer receipts must be grouped or converted to USDT before AED/Wio cashout');
      return;
    }
    const selectedCoins = [
      ...selectedExchangeBatches.map((b) => entryCoin(b)),
      ...selectedExchangeReceipts.map((r) => entryCoin(r)),
    ].filter(Boolean);
    const uniqueCoins = [...new Set(selectedCoins)];
    if (type === 'to_usdt' && uniqueCoins.length !== 1) {
      toast.error('Select only one coin at a time, for example all BTC entries or all ETH entries');
      return;
    }
    const coin = uniqueCoins.join(', ');
    const totalCrypto = selectedExchangeBatches.reduce((sum, b) => sum + batchCryptoAmount(b), 0)
      + selectedExchangeReceipts.reduce((sum, r) => sum + receiptCryptoAmount(r), 0);
    const totalUsdt = selectedExchangeBatches.reduce((sum, b) => sum + batchUsdtAmount(b), 0);
    const totalAed = selectedExchangeBatches.reduce((sum, b) => sum + batchAedAmount(b), 0);
    if (type === 'to_usdt' && selectedExchangeBatches.some((b) => batchUsdtAmount(b) > 0)) {
      toast.error('Selected entries include records already converted to USDT. Select only unconverted BTC/ETH/coin entries.');
      return;
    }
    if (type === 'to_usdt' && totalCrypto <= 0) {
      toast.error('Selected entries do not have a received crypto amount yet');
      return;
    }
    if (type === 'to_usdt' && coin === 'USDT') {
      toast.error('USDT entries are already in USDT. Select them for AED conversion instead.');
      return;
    }
    if (type === 'to_aed' && totalUsdt <= 0) {
      toast.error('Selected entries do not have USDT amounts yet');
      return;
    }
    if (type === 'cashout' && totalAed <= 0) {
      toast.error('Selected entries do not have AED conversion amounts yet');
      return;
    }
    setOperationType(type);
    setOperationForm({
      coin,
      total_crypto: totalCrypto ? totalCrypto.toFixed(8) : '',
      direct_receipts_count: selectedExchangeReceipts.length,
      batch_entries_count: selectedExchangeBatches.length,
      usdt_amount: type === 'to_usdt' ? '' : (totalUsdt ? totalUsdt.toFixed(8) : ''),
      usdt_conversion_rate: '',
      usdt_conversion_reference: '',
      usdt_conversion_date: new Date().toISOString().slice(0, 10),
      crypto_converted: totalUsdt ? totalUsdt.toFixed(8) : '',
      conversion_rate: '',
      fiat_received: totalAed ? totalAed.toFixed(2) : '',
      conversion_date: new Date().toISOString().slice(0, 10),
      bank_reference: '',
      bank_deposit_date: new Date().toISOString().slice(0, 10),
      bank_fee_aed: '75.00',
      net_bank_deposit_amount: '',
      notes: '',
    });
    setOperationOpen(true);
  };

  const prorate = (total, part, sum, decimals = 8) => {
    const n = parseFloat(total || '0');
    const p = parseFloat(part || '0');
    const s = parseFloat(sum || '0');
    if (!Number.isFinite(n) || !Number.isFinite(p) || !Number.isFinite(s) || s <= 0) return '';
    return ((n * p) / s).toFixed(decimals);
  };

  const submitOperation = async (e) => {
    e.preventDefault();
    if (!selectedExchangeEntryCount) {
      toast.error('Select one or more wallet entries first');
      return;
    }
    setLoading(true);
    try {
      if (operationType === 'to_usdt') {
        const directReceipts = selectedExchangeReceipts;
        let targetBatches = [...selectedExchangeBatches];
        if (directReceipts.length) {
          const sourceCoin = entryCoin(directReceipts[0]);
          const networks = [...new Set(directReceipts.map((r) => r.crypto_network).filter(Boolean))];
          const { data: directBatch } = await api.post('/treasury/batches', cleanPayload({
            name: `${activeExchangeName} ${sourceCoin} Direct Client Receipts ${new Date().toISOString().slice(0, 10)}`,
            source_gateway: activeExchangeName,
            source_wallet: `${activeExchangeName} Wallet`,
            destination_exchange: activeExchangeName,
            coin: sourceCoin,
            network: networks.length === 1 ? networks[0] : '',
            period_start: new Date().toISOString().slice(0, 10),
            period_end: new Date().toISOString().slice(0, 10),
            notes: `Direct ${activeExchangeName} client receipts grouped for ${sourceCoin} to USDT conversion.`,
          }));
          const { data: assignedBatch } = await api.post(`/treasury/batches/${directBatch.id}/assign`, { recharge_ids: directReceipts.map((r) => r.id) });
          targetBatches = [...targetBatches, assignedBatch];
        }
        const totalCrypto = targetBatches.reduce((sum, b) => sum + batchCryptoAmount(b), 0);
        const totalUsdt = parseFloat(operationForm.usdt_amount || '0');
        if (!totalUsdt || totalUsdt <= 0) throw new Error('USDT converted amount is required');
        await Promise.all(targetBatches.map((b) => api.patch(`/treasury/batches/${b.id}`, cleanPayload({
          usdt_amount: prorate(operationForm.usdt_amount, batchCryptoAmount(b), totalCrypto, 8),
          usdt_conversion_rate: operationForm.usdt_conversion_rate || (totalCrypto ? (totalUsdt / totalCrypto).toFixed(8) : ''),
          usdt_conversion_date: operationForm.usdt_conversion_date,
          usdt_conversion_reference: operationForm.usdt_conversion_reference,
          received_crypto_amount: b.received_crypto_amount || b.total_crypto_amount,
          notes: operationForm.notes || b.notes,
        }))));
      } else if (operationType === 'to_aed') {
        const totalUsdt = selectedExchangeBatches.reduce((sum, b) => sum + batchUsdtAmount(b), 0);
        if (!parseFloat(operationForm.crypto_converted || '0')) throw new Error('USDT amount is required');
        if (!parseFloat(operationForm.conversion_rate || '0')) throw new Error('AED conversion rate is required');
        if (!parseFloat(operationForm.fiat_received || '0')) throw new Error('AED received is required');
        await Promise.all(selectedExchangeBatches.map((b) => api.patch(`/treasury/batches/${b.id}`, cleanPayload({
          crypto_converted: prorate(operationForm.crypto_converted, batchUsdtAmount(b), totalUsdt, 8),
          conversion_rate: operationForm.conversion_rate,
          fiat_received: prorate(operationForm.fiat_received, batchUsdtAmount(b), totalUsdt, 2),
          fiat_currency: 'AED',
          conversion_date: operationForm.conversion_date,
          notes: operationForm.notes || b.notes,
        }))));
      } else if (operationType === 'cashout') {
        const totalAed = selectedExchangeBatches.reduce((sum, b) => sum + batchAedAmount(b), 0);
        const cashoutAmount = parseFloat(operationForm.fiat_received || '0');
        const bankFee = parseFloat(operationForm.bank_fee_aed || '0');
        const netAmount = parseFloat(operationForm.net_bank_deposit_amount || '0') || Math.max(0, cashoutAmount - bankFee);
        if (!cashoutAmount || cashoutAmount <= 0) throw new Error('Cashout AED amount is required');
        if (!operationForm.bank_reference) throw new Error('Wio bank reference or receipt number is required');
        await Promise.all(selectedExchangeBatches.map((b) => api.patch(`/treasury/batches/${b.id}`, cleanPayload({
          fiat_received: prorate(operationForm.fiat_received, batchAedAmount(b), totalAed, 2),
          bank_fee_aed: prorate(operationForm.bank_fee_aed || '0', batchAedAmount(b), totalAed, 2),
          net_bank_deposit_amount: prorate(String(netAmount), batchAedAmount(b), totalAed, 2),
          bank_name: 'Wio Bank',
          bank_reference: operationForm.bank_reference,
          bank_deposit_date: operationForm.bank_deposit_date,
          notes: operationForm.notes || b.notes,
        }))));
      }
      toast.success('Treasury entries updated');
      setOperationOpen(false);
      setSelectedBatchIds([]);
      setSelectedIds([]);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Could not update selected entries');
    } finally {
      setLoading(false);
    }
  };

  const submitBatch = async (e) => {
    e.preventDefault();
    if (selectedIds.length === 0) {
      toast.error('Select at least one ready receipt');
      return;
    }
    setLoading(true);
    try {
      const inferredCoin = selectedReceipts.length ? [...new Set(selectedReceipts.map((r) => r.crypto_coin).filter(Boolean))] : [];
      const inferredNetwork = selectedReceipts.length ? [...new Set(selectedReceipts.map((r) => r.crypto_network).filter(Boolean))] : [];
      const inferredGateway = selectedReceipts.length ? [...new Set(selectedReceipts.map((r) => r.payment_gateway).filter(Boolean))] : [];
      const { data: batch } = await api.post('/treasury/batches', cleanPayload({
        ...batchForm,
        coin: batchForm.coin || (inferredCoin.length === 1 ? inferredCoin[0] : ''),
        network: batchForm.network || (inferredNetwork.length === 1 ? inferredNetwork[0] : ''),
        source_gateway: batchForm.source_gateway || (inferredGateway.length === 1 ? inferredGateway[0] : 'Mixed'),
      }));
      await api.post(`/treasury/batches/${batch.id}/assign`, { recharge_ids: selectedIds });
      toast.success('Treasury transfer created and receipts assigned');
      setBatchOpen(false);
      setBatchForm(emptyBatch);
      setSelectedIds([]);
      await load();
      setActiveTab((batch.destination_exchange || batchForm.destination_exchange || '').toLowerCase() === 'okx' ? 'okx' : 'binance');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not create treasury transfer');
    } finally {
      setLoading(false);
    }
  };

  const openBatch = async (batch, focusStep) => {
    setActiveBatch(batch);
    setBatchDetail(null);
    setSettlementForm({
      source_wallet: batch.source_wallet || '',
      destination_exchange: batch.destination_exchange || 'OKX',
      destination_wallet: batch.destination_wallet || '',
      settlement_tx_hash: batch.settlement_tx_hash || '',
      settlement_reference: batch.settlement_reference || '',
      transfer_fee_crypto: batch.transfer_fee_crypto || '',
      received_crypto_amount: batch.received_crypto_amount || batch.total_crypto_amount || '',
      exchange_received_at: dateInput(batch.exchange_received_at),
      usdt_amount: batch.usdt_amount || ((batch.coin || '').toUpperCase() === 'USDT' ? batch.received_crypto_amount || batch.total_crypto_amount || '' : ''),
      usdt_conversion_rate: batch.usdt_conversion_rate || '',
      usdt_conversion_date: dateInput(batch.usdt_conversion_date),
      usdt_conversion_reference: batch.usdt_conversion_reference || '',
      crypto_converted: batch.crypto_converted || batch.usdt_amount || '',
      conversion_rate: batch.conversion_rate || '',
      fiat_received: batch.fiat_received || '',
      fiat_currency: batch.fiat_currency || 'AED',
      conversion_date: dateInput(batch.conversion_date),
      bank_name: batch.bank_name || 'Wio Bank',
      bank_reference: batch.bank_reference || '',
      bank_deposit_date: dateInput(batch.bank_deposit_date),
      bank_fee_aed: batch.bank_fee_aed || '75.00',
      net_bank_deposit_amount: batch.net_bank_deposit_amount || '',
      notes: batch.notes || '',
    });
    const { data: detail } = await api.get(`/treasury/batches/${batch.id}`);
    setBatchDetail(detail);
    // When opened from a specific feed row, expand ONLY that step's card.
    // Otherwise auto-reveal whichever steps already have data.
    if (focusStep) {
      setShowStep2(focusStep === 'usdt');
      setShowStep3(focusStep === 'aed');
      setShowStep4(focusStep === 'wio');
    } else {
      setShowStep2(!!(batch.usdt_amount || batch.usdt_conversion_rate || batch.usdt_conversion_date));
      setShowStep3(!!(batch.crypto_converted || batch.conversion_rate || batch.fiat_received));
      setShowStep4(!!(batch.bank_reference || batch.bank_deposit_date));
    }
  };

  const updateSettlement = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.patch(`/treasury/batches/${activeBatch.id}`, cleanPayload(settlementForm));
      toast.success('Treasury transfer updated');
      setActiveBatch(null);
      setBatchDetail(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update treasury transfer');
    } finally {
      setLoading(false);
    }
  };

  const FilterBar = ({ showGateway = false }) => (
    <div className="card-axistra p-4 mb-4 flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Funnel size={16} /> Filters
        </div>
        {showGateway && (
          <select value={gatewayFilter} onChange={(e) => setGatewayFilter(e.target.value)} className="input-axistra md:w-44">
            <option value="">All gateways</option>
            <option>BTCPay</option>
            <option>OxaPay</option>
            <option>OKX</option>
            <option>Binance</option>
          </select>
        )}
        <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="input-axistra md:w-40">
          <option value="all">All dates</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="custom">Custom range</option>
        </select>
        {dateFilter === 'custom' && (
          <>
            <input type="date" className="input-axistra md:w-40" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" className="input-axistra md:w-40" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
        <select value={coinFilter} onChange={(e) => setCoinFilter(e.target.value)} className="input-axistra md:w-36">
          <option value="">All coins</option>
          {coinOptions.map((coin) => <option key={coin} value={coin}>{coin}</option>)}
        </select>
      </div>
      <button type="button" className="btn-secondary" onClick={() => { setDateFilter('all'); setCustomFrom(''); setCustomTo(''); setCoinFilter(''); setGatewayFilter(''); }}>
        Clear
      </button>
    </div>
  );

  if (!data) return <div className="text-gray-500">Loading...</div>;

  return (
    <div>
      <PageHeader
        eyebrow="Treasury"
        title="Crypto Treasury & Reconciliation"
        subtitle="Customer payment proof stays on the recharge. Source transfer records track sweeps to OKX/Binance, conversion to USDT/AED, Wio deposits, and expense outflows created from the Expenses module."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5 mb-6">
        <KpiCard label="Ready Receipts" value={data.totals.ready_for_settlement} icon={Receipt} testId="treasury-kpi-ready" />
        <KpiCard label="Open Transfers" value={data.totals.open_batches} icon={Wallet} testId="treasury-kpi-open-batches" />
        <KpiCard label="Fully Reconciled" value={data.totals.reconciled} icon={CheckCircle} testId="treasury-kpi-reconciled" />
        <KpiCard label="Bank Deposited" value={`AED ${fmtNumber(data.totals.total_bank_deposited)}`} icon={Bank} testId="treasury-kpi-bank" />
        <KpiCard label="Mismatches" value={data.totals.mismatch} icon={Warning} accent testId="treasury-kpi-mismatch" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-6 gap-3 mb-6">
        <StepPill icon={Receipt} label="Customer Payment" sub="BTCPay, OxaPay, Direct" />
        <StepPill icon={Wallet} label="Source Transfer" sub="Daily or weekly sweep" />
        <StepPill icon={Buildings} label="Exchange Wallet" sub="OKX or Binance" />
        <StepPill icon={Coin} label="USDT Ledger" sub="BTC/ETH converted or USDT kept" />
        <StepPill icon={ArrowsLeftRight} label="AED Conversion" sub="Rate and fees recorded" />
        <StepPill icon={Bank} label="Wio Deposit" sub="Bank reference saved" />
      </div>

      <div className="mb-5 flex flex-wrap gap-2 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setSelectedIds([]); setSelectedBatchIds([]); }}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${activeTab === tab.key ? 'border-axistra-green text-axistra-green' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'receipts' && (
        <>
          <FilterBar showGateway />

          <div className="card-axistra overflow-x-auto">
            <table className="table-axistra">
              <thead>
                <tr>
                  <th>Recharge</th><th>Customer</th><th>Gateway / Wallet</th><th>Invoice Amount</th><th>Crypto Paid</th><th>Customer TXID</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {readyReceipts.length === 0 && <tr><td colSpan="7" className="text-center text-gray-500 py-10">No ready customer receipts. Use each source tab to create the correct transfer or conversion record.</td></tr>}
                {readyReceipts.map((r) => (
                  <tr key={r.id} data-testid={`ready-receipt-${r.recharge_code}`}>
                    <td><Link to={`/recharges/${r.id}`} className="font-mono text-axistra-green hover:underline">{r.recharge_code}</Link></td>
                    <td>
                      <div className="font-medium">{r.customer?.full_name || r.magnus_username || 'Customer'}</div>
                      <div className="text-xs text-gray-500">{r.customer?.customer_code || r.magnus_username}</div>
                    </td>
                    <td>
                      <Badge className="badge-neutral">{r.payment_gateway || 'Manual'}</Badge>
                      <div className="mt-1 text-xs text-gray-500">{r.treasury?.receiving_wallet_tag || r.treasury?.receiving_wallet || r.wallet_address || '—'}</div>
                    </td>
                    <td className="font-mono">{fmtMoney(r.amount, r.currency)}</td>
                    <td className="font-mono text-xs">{fmtCrypto(r.crypto_amount)} {r.crypto_coin} <span className="text-gray-400">{r.crypto_network}</span></td>
                    <td><Hash value={r.tx_hash} /></td>
                    <td><Badge className={RECHARGE_STATUS_META[r.status]?.cls}>{RECHARGE_STATUS_META[r.status]?.label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'btcpay' && (
        <>
        <FilterBar />
        <div className="card-axistra overflow-x-auto">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 p-4 border-b border-gray-200">
            <div>
              <div className="label-xs">Gateway Receipts</div>
              <div className="text-sm text-gray-600">BTCPay BTC customer payments, destination wallet evidence, mempool verification, and daily/weekly BTC transfer records.</div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="text-right">
                <div className="label-xs">BTCPay Wallet Balance</div>
                <div className="font-mono text-sm font-semibold text-axistra-green">
                  {fmtCrypto(walletBalanceFor('BTCPAY', 'BTC'))} BTC
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  Today received: {fmtCrypto(btcpayReceipts.filter((r) => inDateRange(r.payment_date || r.created_at, 'today')).reduce((sum, r) => sum + parseFloat(r.crypto_amount || '0'), 0))} BTC
                </div>
              </div>
              <button onClick={openBtcpayBatch} disabled={btcpayReadyReceipts.length === 0} className="btn-primary disabled:opacity-50">
                Create BTC Transfer ({selectedIds.length || btcpayReadyReceipts.length})
              </button>
            </div>
          </div>
          <table className="table-axistra">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Recharge</th>
                <th>Customer</th>
                <th>Invoice Amount</th>
                <th>BTC Payment</th>
                <th>Destination Wallet</th>
                <th>Sender / Inputs</th>
                <th>TX Hash</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {btcpayReceipts.length === 0 && <tr><td colSpan="10" className="text-center text-gray-500 py-10">No BTCPay receipts yet.</td></tr>}
              {btcpayReceipts.map((r) => {
                const txs = r.crypto_transactions || [];
                const primaryTx = txs[0] || {};
                const raw = safeJson(primaryTx.raw_gateway_payload);
                const paymentId = raw?.payment?.id || raw?.payment_id;
                return (
                  <tr key={r.id} data-testid={`btcpay-receipt-${r.recharge_code}`}>
                    <td>
                      {isReadyReceipt(r) && (
                        <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleReceipt(r.id)} />
                      )}
                      {!isReadyReceipt(r) && r.treasury?.treasury_batch_id && <Badge className="badge-info">Batched</Badge>}
                    </td>
                    <td>
                      <Link to={`/recharges/${r.id}`} className="font-mono text-axistra-green hover:underline">{r.recharge_code}</Link>
                      <div className="text-xs text-gray-500">{fmtDate(r.payment_date)}</div>
                    </td>
                    <td>
                      <div className="font-medium">{r.customer?.full_name || r.magnus_username || 'Customer'}</div>
                      <div className="text-xs text-gray-500">{r.magnus_username}</div>
                    </td>
                    <td>
                      <div className="font-mono">{fmtMoney(r.amount, r.currency)}</div>
                      <div className="text-xs text-gray-500">{r.invoice_number || '—'}</div>
                    </td>
                    <td>
                      <div className="font-mono text-sm">{fmtCrypto(r.crypto_amount)} BTC</div>
                      <div className="text-xs text-gray-500">{txs.length} BTC tx{txs.length === 1 ? '' : 's'}</div>
                    </td>
                    <td className="font-mono text-xs max-w-[220px] truncate">{primaryTx.receiving_wallet || r.wallet_address || '—'}</td>
                    <td className="font-mono text-xs max-w-[220px] truncate">
                      {primaryTx.sender_address || 'Verify with mempool'}
                    </td>
                    <td>
                      <Hash value={primaryTx.tx_hash || r.tx_hash} />
                      {paymentId && <div className="mt-1 text-[11px] text-gray-500">BTCPay payment: <span className="font-mono">{String(paymentId).slice(0, 18)}...</span></div>}
                      {raw?.afterExpiration && <div className="mt-1"><Badge className="badge-warning">After expiration</Badge></div>}
                    </td>
                    <td>
                      <Badge className={primaryTx.gateway_tx_status === 'confirmed' ? 'badge-success' : RECHARGE_STATUS_META[r.status]?.cls}>
                        {primaryTx.gateway_tx_status || RECHARGE_STATUS_META[r.status]?.label || r.status}
                      </Badge>
                      <div className="mt-1 text-xs text-gray-500">{primaryTx.confirmations ? `${primaryTx.confirmations} confirmation(s)` : 'No mempool check'}</div>
                    </td>
                    <td className="text-right">
                      <button onClick={() => verifyBtcpay(r.id)} disabled={verifyingId === r.id || !primaryTx.tx_hash} className="btn-secondary text-xs disabled:opacity-50">
                        {verifyingId === r.id ? 'Verifying...' : 'Verify'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {activeTab === 'oxapay' && (
        <>
        <FilterBar />
        <div className="card-axistra overflow-x-auto">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 p-4 border-b border-gray-200">
            <div>
              <div className="label-xs">Gateway Receipts</div>
              <div className="text-sm text-gray-600">OxaPay customer payments, original chain details, auto-conversion evidence, and final USDT received.</div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="text-right">
                <div className="label-xs">OxaPay Wallet Balance</div>
                <div className="font-mono text-sm font-semibold text-axistra-green">
                  {fmtCrypto(walletBalanceFor('OXAPAY', 'USDT'))} USDT
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  Today received: {fmtCrypto((data?.recharges || [])
                    .filter((r) => (r.payment_gateway || '').toLowerCase() === 'oxapay')
                    .filter((r) => inDateRange(r.payment_date || r.created_at, 'today'))
                    .reduce((sum, r) => sum + rechargeFinalUsdt(r), 0))} USDT
                </div>
              </div>
              <button onClick={openOxaPayBatch} disabled={oxapayReceipts.filter(isReadyReceipt).length === 0} className="btn-primary disabled:opacity-50">
                Create USDT Transfer ({selectedIds.length || oxapayReceipts.filter(isReadyReceipt).length})
              </button>
            </div>
          </div>
          <table className="table-axistra">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Recharge</th>
                <th>Customer</th>
                <th>Invoice</th>
                <th>OxaPay Order</th>
                <th>TX Details</th>
                <th>Final USDT</th>
                <th>Treasury</th>
              </tr>
            </thead>
            <tbody>
              {oxapayReceipts.length === 0 && <tr><td colSpan="8" className="text-center text-gray-500 py-10">No OxaPay receipts yet.</td></tr>}
              {oxapayReceipts.map((r) => {
                const txs = r.crypto_transactions || [];
                const finalUsdt = rechargeFinalUsdt(r);
                const orderId = txs.find((tx) => tx.gateway_invoice_id)?.gateway_invoice_id;
                return (
                  <tr key={r.id} data-testid={`oxapay-receipt-${r.recharge_code}`}>
                    <td>
                      {isReadyReceipt(r) && (
                        <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleReceipt(r.id)} />
                      )}
                      {!isReadyReceipt(r) && r.treasury?.treasury_batch_id && <Badge className="badge-info">Batched</Badge>}
                    </td>
                    <td><Link to={`/recharges/${r.id}`} className="font-mono text-axistra-green hover:underline">{r.recharge_code}</Link></td>
                    <td>
                      <div className="font-medium">{r.customer?.full_name || r.magnus_username || 'Customer'}</div>
                      <div className="text-xs text-gray-500">{r.magnus_username}</div>
                    </td>
                    <td>
                      <div className="font-mono text-sm">{r.invoice_number || '—'}</div>
                      <div className="text-xs text-gray-500">{fmtMoney(r.amount, r.currency)}</div>
                    </td>
                    <td>
                      <div className="font-mono text-xs">{orderId || '—'}</div>
                      <div className="text-xs text-gray-500">{txs.length} transaction{txs.length === 1 ? '' : 's'}</div>
                    </td>
                    <td className="min-w-[360px] max-w-[440px]">
                      <div className="space-y-2">
                        {txs.length === 0 && <div className="text-xs text-gray-500">No detailed TX rows stored yet.</div>}
                        {txs.map((tx) => (
                          <div key={tx.id} className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 overflow-hidden">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-mono text-xs text-gray-900">
                                {fmtCrypto(tx.crypto_amount || tx.received_amount || tx.sent_amount)} {tx.coin} <span className="text-gray-400">{tx.network}</span>
                              </div>
                              <Badge className={String(tx.gateway_tx_status || '').toLowerCase() === 'confirmed' ? 'badge-success' : 'badge-warning'}>
                                {tx.gateway_tx_status || 'received'}
                              </Badge>
                            </div>
                            <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-600">
                              <div>Sent: <span className="font-mono">{tx.sent_amount || '—'}</span></div>
                              <div>Received: <span className="font-mono">{tx.received_amount || tx.received_value || '—'}</span></div>
                              <div className="md:col-span-2 min-w-0">Sender: <span className="font-mono break-all">{tx.sender_address || '—'}</span></div>
                              <div className="md:col-span-2 min-w-0">Wallet: <span className="font-mono break-all">{tx.receiving_wallet || '—'}</span></div>
                              <div>Auto convert: <span className="font-mono">{tx.auto_convert_amount || '0'} {tx.auto_convert_currency || ''}</span></div>
                              <div>Confirmations: <span className="font-mono">{tx.confirmations || '—'}</span></div>
                            </div>
                            <div className="mt-1"><Hash value={tx.tx_hash} /></div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="font-mono text-sm font-semibold text-axistra-green">
                      {finalUsdt ? `${fmtCrypto(finalUsdt)} USDT` : `${fmtCrypto(r.crypto_amount)} ${r.crypto_coin}`}
                    </td>
                    <td>
                      {r.treasury?.treasury_batch_id ? <Badge className="badge-info">Batched</Badge> : <Badge className="badge-warning">Ready</Badge>}
                      <div className="mt-1 text-xs text-gray-500">{r.treasury?.source_currency_summary || 'No summary'}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {walletExpenseOutflows('OxaPay').length > 0 && (
            <div className="border-t border-gray-200 p-4">
              <div className="label-xs mb-2">OxaPay expense outflows from Expenses menu</div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {walletExpenseOutflows('OxaPay').map((e) => (
                  <div key={e.id} className="rounded-md border border-gray-200 bg-white px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-gray-900">{e.vendor_name}</div>
                        <div className="text-xs text-gray-500">{e.expense_code || e.category} · {fmtDate(e.expense_date)}</div>
                      </div>
                      <div className="font-mono text-sm text-red-700">-{fmtLedgerAmount(e.amount, e.currency)}</div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500"><Hash value={e.tx_hash} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        </>
      )}

      {['okx', 'binance'].includes(activeTab) && (
        <>
          <FilterBar />
          <div className="card-axistra overflow-x-auto">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 p-4 border-b border-gray-200">
              <div>
                <div className="label-xs">{activeExchangeName} Wallet Ledger</div>
                <div className="text-sm text-gray-600">
                  Direct customer receipts, source transfers swept into {activeExchangeName}, coin conversions, and expense outflows entered from the Expenses menu.
                </div>
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <span className="rounded-md border border-axistra-green/20 bg-[var(--axistra-green-light)] px-3 py-2 text-xs font-semibold text-axistra-green">
                    USDT Balance: {fmtCrypto(exchangeUsdtBalance)} USDT
                  </span>
                  {activeExchangeCoinSummary.length === 0 && <Badge className="badge-neutral">No coin balance yet</Badge>}
                  {activeExchangeCoinSummary.map(([coin, value]) => (
                    <span key={coin} className={`rounded-md border px-3 py-2 text-xs font-semibold ${value < 0 ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-axistra-green'}`}>
                      {coin}: {value < 0 ? '-' : ''}{fmtCrypto(Math.abs(value))}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="button" onClick={selectVisibleExchangeEntries} className="btn-secondary">
                  Select Visible TXs
                </button>
                {selectedExchangeEntryCount > 0 && (
                  <button type="button" onClick={clearExchangeSelection} className="btn-secondary">
                    Clear ({selectedExchangeEntryCount})
                  </button>
                )}
                <div className="flex items-center gap-2 text-xs text-gray-500 mr-2">
                  <span className="inline-flex items-center gap-1">
                    <span className="rounded-full bg-axistra-green/10 text-axistra-green w-5 h-5 inline-flex items-center justify-center font-semibold">i</span>
                    Use <strong className="text-axistra-green mx-1">Wallet Ledger → Convert</strong> to swap coins. Conversions auto-batch any unassigned receipts here.
                  </span>
                </div>
                <button onClick={() => openOperation('to_aed')} disabled={selectedExchangeBatches.length === 0} className="btn-secondary disabled:opacity-50">
                  Convert USDT to AED
                </button>
                <button onClick={() => openOperation('cashout')} disabled={selectedExchangeBatches.length === 0} className="btn-secondary disabled:opacity-50">
                  Cashout to Wio
                </button>
              </div>
            </div>
            <table className="table-axistra">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Entry</th>
                  <th>Source</th>
                  <th>Exchange</th>
                  <th>Invoice / Expense</th>
                  <th>Crypto Amount</th>
                  <th>TX Hash</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {exchangeReceipts.length === 0 && exchangeBatchRows.length === 0 && exchangePayoutRows.length === 0 && (
                  <tr><td colSpan="9" className="text-center text-gray-500 py-10">No {activeExchangeName} receipts, source transfers, or expense outflows yet.</td></tr>
                )}
                {(() => {
                  // Merge batches, direct receipts and expense outflows into a
                  // single chronologically-sorted feed. We render each batch
                  // as TWO rows when a USDT conversion is recorded:
                  //   (a) Transfer: source → exchange (the sweep)
                  //   (b) Conversion: coin → USDT (the in-exchange swap)
                  // Each row has its own delete button — deleting the
                  // conversion clears only the convert ledger pair and the
                  // batch's USDT fields, NOT the sweep.
                  const batchTs = (b) => Math.max(
                    new Date(b.bank_deposit_date || 0).getTime(),
                    new Date(b.conversion_date || 0).getTime(),
                    new Date(b.usdt_conversion_date || 0).getTime(),
                    new Date(b.exchange_received_at || 0).getTime(),
                    new Date(b.updated_at || 0).getTime(),
                    new Date(b.period_end || 0).getTime(),
                    new Date(b.period_start || 0).getTime(),
                    new Date(b.created_at || 0).getTime(),
                  );
                  const merged = [];
                  exchangeBatchRows.forEach((b) => {
                    const baseTs = batchTs(b);
                    // Each completed step renders as its own feed row, so the
                    // user can spot every distinct action chronologically.
                    merged.push({ kind: 'batch-transfer', row: b, ts: baseTs - 3 });
                    if (parseFloat(b.usdt_amount || '0') > 0) {
                      merged.push({ kind: 'batch-conversion', row: b, ts: baseTs - 2 });
                    }
                    if (parseFloat(b.fiat_received || '0') > 0) {
                      merged.push({ kind: 'batch-aed-conversion', row: b, ts: baseTs - 1 });
                    }
                    if (b.bank_reference) {
                      merged.push({ kind: 'batch-wio-deposit', row: b, ts: baseTs });
                    }
                  });
                  exchangeReceipts.forEach((r) => merged.push({ kind: 'receipt', row: r, ts: new Date(r.payment_date || r.created_at || 0).getTime() }));
                  exchangePayoutRows.forEach((e) => merged.push({ kind: 'expense', row: e, ts: new Date(e.expense_date || e.created_at || 0).getTime() }));
                  merged.sort((a, b) => b.ts - a.ts);
                  return merged.map((item) => {
                    if (item.kind === 'batch-transfer') {
                      const b = item.row;
                      return (
                <tr key={`batch-${b.id}-transfer`} onClick={() => openBatch(b, 'sweep')} className="cursor-pointer hover:bg-[var(--axistra-bg)]">
                    <td><input type="checkbox" checked={selectedBatchIds.includes(b.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleBatch(b.id)} /></td>
                    <td>
                      <button type="button" onClick={(e) => { e.stopPropagation(); openBatch(b, 'sweep'); }} className="font-mono text-axistra-green hover:underline">{b.batch_code}</button>
                      <div className="text-xs text-gray-500">{b.name}</div>
                      <div className="mt-1"><Badge className="badge-info">Transfer</Badge></div>
                    </td>
                    <td><Badge className="badge-neutral">{b.source_gateway || 'Transfer'}</Badge></td>
                    <td>
                      <div className="font-semibold">{b.destination_exchange || activeExchangeName}</div>
                      <div className="font-mono text-xs text-gray-500 truncate max-w-[180px]">{b.destination_wallet || 'No wallet saved'}</div>
                    </td>
                    <td className="font-mono">{b.total_invoice_amount ? fmtMoney(b.total_invoice_amount, b.invoice_currency || 'EUR') : '—'}</td>
                    <td className="font-mono">{b.received_crypto_amount || b.total_crypto_amount || '0'} {b.coin || ''}</td>
                    <td><Hash value={b.settlement_tx_hash} /></td>
                    <td><BatchStatus status={b.status} /></td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={(ev) => { ev.stopPropagation(); deleteBatch(b); }}
                        className="rounded-md p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete this batch (sweep + any conversions/withdrawal)"
                        data-testid={`treasury-batch-delete-${b.id}`}
                      >
                        <Trash size={14} />
                      </button>
                    </td>
                  </tr>
                      );
                    }
                    if (item.kind === 'batch-conversion') {
                      const b = item.row;
                      const from = parseFloat(b.received_crypto_amount || b.total_crypto_amount || '0');
                      const to = parseFloat(b.usdt_amount || '0');
                      const rate = from > 0 ? (to / from) : 0;
                      return (
                <tr key={`batch-${b.id}-conv`} onClick={() => openBatch(b, 'usdt')} className="cursor-pointer hover:bg-[var(--axistra-bg)]">
                    <td></td>
                    <td>
                      <button type="button" onClick={(e) => { e.stopPropagation(); openBatch(b, 'usdt'); }} className="font-mono text-axistra-green hover:underline">{b.batch_code}</button>
                      <div className="text-xs text-gray-500">{b.coin || 'BTC'} → USDT</div>
                      <div className="mt-1"><Badge className="badge-success">Conversion</Badge></div>
                    </td>
                    <td><Badge className="badge-neutral">{activeExchangeName}</Badge></td>
                    <td>
                      <div className="font-semibold">{activeExchangeName}</div>
                      <div className="text-xs text-gray-500">In-exchange swap</div>
                    </td>
                    <td className="font-mono text-xs text-gray-500">{rate > 0 ? `@ ${rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT/${b.coin || 'BTC'}` : '—'}</td>
                    <td className="font-mono">
                      <span className="text-red-700">-{from} {b.coin || 'BTC'}</span>
                      <div className="text-axistra-green">+{to.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDT</div>
                    </td>
                    <td className="text-xs text-gray-500">{b.usdt_conversion_reference || '—'}</td>
                    <td><BatchStatus status="converted_to_usdt" /></td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={async (ev) => {
                          ev.stopPropagation();
                          if (!window.confirm(`Delete the BTC → USDT conversion for ${b.batch_code}?\n\nThis removes only the conversion ledger rows (-${from} ${b.coin || 'BTC'} and +${to} USDT on ${activeExchangeName}) and clears the batch's USDT fields. The Sweep step + recharge links stay intact.`)) return;
                          try {
                            await api.delete(`/treasury/batches/${b.id}/step/usdt`);
                            toast.success('Conversion cleared');
                            await load();
                          } catch (err) { toast.error(err?.response?.data?.message || 'Failed to clear conversion'); }
                        }}
                        className="rounded-md p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete this conversion only (keeps the sweep)"
                        data-testid={`treasury-batch-conv-delete-${b.id}`}
                      >
                        <Trash size={14} />
                      </button>
                    </td>
                  </tr>
                      );
                    }
                    if (item.kind === 'batch-aed-conversion') {
                      const b = item.row;
                      const fromUsdt = parseFloat(b.crypto_converted || b.usdt_amount || '0');
                      const aedAmt = parseFloat(b.fiat_received || '0');
                      const fiatCcy = (b.fiat_currency || 'AED').toUpperCase();
                      const rate = fromUsdt > 0 ? (aedAmt / fromUsdt) : 0;
                      return (
                <tr key={`batch-${b.id}-aed`} onClick={() => openBatch(b, 'aed')} className="cursor-pointer hover:bg-[var(--axistra-bg)]">
                    <td></td>
                    <td>
                      <button type="button" onClick={(e) => { e.stopPropagation(); openBatch(b, 'aed'); }} className="font-mono text-axistra-green hover:underline">{b.batch_code}</button>
                      <div className="text-xs text-gray-500">USDT → {fiatCcy}</div>
                      <div className="mt-1"><Badge className="badge-success">AED Conversion</Badge></div>
                    </td>
                    <td><Badge className="badge-neutral">{activeExchangeName}</Badge></td>
                    <td>
                      <div className="font-semibold">{activeExchangeName}</div>
                      <div className="text-xs text-gray-500">In-exchange swap</div>
                    </td>
                    <td className="font-mono text-xs text-gray-500">{rate > 0 ? `@ ${rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${fiatCcy}/USDT` : '—'}</td>
                    <td className="font-mono">
                      <span className="text-red-700">-{fromUsdt} USDT</span>
                      <div className="text-axistra-green">+{aedAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })} {fiatCcy}</div>
                    </td>
                    <td className="text-xs text-gray-500">{b.conversion_reference || '—'}</td>
                    <td><BatchStatus status="converted_to_aed" /></td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={async (ev) => {
                          ev.stopPropagation();
                          if (!window.confirm(`Delete the USDT → ${fiatCcy} conversion for ${b.batch_code}?\n\nThis removes only the AED conversion ledger rows (-${fromUsdt} USDT and +${aedAmt} ${fiatCcy} on ${activeExchangeName}) and clears the batch's AED fields. The Sweep + USDT Conversion stay intact.`)) return;
                          try {
                            await api.delete(`/treasury/batches/${b.id}/step/aed`);
                            toast.success('AED conversion cleared');
                            await load();
                          } catch (err) { toast.error(err?.response?.data?.message || 'Failed to clear AED conversion'); }
                        }}
                        className="rounded-md p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete this AED conversion only (keeps sweep + USDT conversion)"
                        data-testid={`treasury-batch-aed-delete-${b.id}`}
                      >
                        <Trash size={14} />
                      </button>
                    </td>
                  </tr>
                      );
                    }
                    if (item.kind === 'batch-wio-deposit') {
                      const b = item.row;
                      const grossAed = parseFloat(b.fiat_received || '0');
                      const netAed = parseFloat(b.net_bank_deposit_amount || b.fiat_received || '0');
                      const fee = parseFloat(b.bank_fee_aed || '0');
                      const fiatCcy = (b.fiat_currency || 'AED').toUpperCase();
                      return (
                <tr key={`batch-${b.id}-wio`} onClick={() => openBatch(b, 'wio')} className="cursor-pointer hover:bg-[var(--axistra-bg)]">
                    <td></td>
                    <td>
                      <button type="button" onClick={(e) => { e.stopPropagation(); openBatch(b, 'wio'); }} className="font-mono text-axistra-green hover:underline">{b.batch_code}</button>
                      <div className="text-xs text-gray-500">{b.bank_name || 'Wio Bank'}</div>
                      <div className="mt-1"><Badge className="badge-success">Wio Deposit</Badge></div>
                    </td>
                    <td><Badge className="badge-neutral">{activeExchangeName}</Badge></td>
                    <td>
                      <div className="font-semibold">Wio Bank</div>
                      <div className="text-xs text-gray-500">Withdraw to bank</div>
                    </td>
                    <td className="font-mono text-xs text-gray-500">{fee > 0 ? `Fee: ${fee} ${fiatCcy}` : '—'}</td>
                    <td className="font-mono">
                      <span className="text-red-700">-{netAed} {fiatCcy}</span>
                      <div className="text-axistra-green">+{netAed.toLocaleString(undefined, { maximumFractionDigits: 2 })} {fiatCcy} <span className="text-gray-400">(Wio)</span></div>
                    </td>
                    <td className="text-xs"><Hash value={b.bank_reference} /></td>
                    <td><BatchStatus status="reconciled" /></td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={async (ev) => {
                          ev.stopPropagation();
                          if (!window.confirm(`Delete the Wio Bank deposit entry for ${b.batch_code}?\n\nThis removes only the Wio transfer ledger rows (-${netAed} ${fiatCcy} from ${activeExchangeName} and +${netAed} ${fiatCcy} on Wio Bank) and clears the bank fields. Sweep + conversions stay intact.`)) return;
                          try {
                            await api.delete(`/treasury/batches/${b.id}/step/wio`);
                            toast.success('Wio deposit cleared');
                            await load();
                          } catch (err) { toast.error(err?.response?.data?.message || 'Failed to clear Wio deposit'); }
                        }}
                        className="rounded-md p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete this Wio Bank deposit only"
                        data-testid={`treasury-batch-wio-delete-${b.id}`}
                      >
                        <Trash size={14} />
                      </button>
                    </td>
                  </tr>
                      );
                    }
                    if (item.kind === 'receipt') {
                      const r = item.row;
                      return (
                  <tr key={`recharge-${r.id}`} onClick={() => setActiveReceipt(r)} className="cursor-pointer hover:bg-[var(--axistra-bg)]">
                    <td>
                      {isReadyReceipt(r) && (
                        <input type="checkbox" checked={selectedIds.includes(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleReceipt(r.id)} />
                      )}
                      {!isReadyReceipt(r) && r.treasury?.treasury_batch_id && <Badge className="badge-info">Batched</Badge>}
                    </td>
                    <td>
                      <Link to={`/recharges/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-axistra-green hover:underline">{r.recharge_code}</Link>
                      <div className="text-xs text-gray-500">{r.customer?.full_name || r.magnus_username || 'Customer'}</div>
                    </td>
                    <td><Badge className="badge-neutral">Direct client payment</Badge></td>
                    <td><Badge className="badge-neutral">{r.payment_gateway}</Badge></td>
                    <td className="font-mono">{fmtMoney(r.amount, r.currency)}</td>
                    <td className="font-mono">{rechargeCryptoLabel(r)}</td>
                    <td><Hash value={r.tx_hash} /></td>
                    <td><Badge className={RECHARGE_STATUS_META[r.status]?.cls}>{RECHARGE_STATUS_META[r.status]?.label}</Badge></td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={(ev) => { ev.stopPropagation(); deleteReceipt(r); }}
                        className="rounded-md p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete this recharge"
                        data-testid={`treasury-receipt-delete-${r.id}`}
                      >
                        <Trash size={14} />
                      </button>
                    </td>
                  </tr>
                      );
                    }
                    // expense
                    const e = item.row;
                    return (
                  <tr key={`expense-${e.id}`} onClick={() => setActiveExpense(e)} className="cursor-pointer hover:bg-[var(--axistra-bg)]">
                    <td><Badge className="badge-warning">Expense</Badge></td>
                    <td>
                      <div className="font-mono text-axistra-green">{e.expense_code || e.id.slice(0, 8)}</div>
                      <div className="text-xs text-gray-500">{fmtDate(e.expense_date)}</div>
                    </td>
                    <td><Badge className="badge-neutral">Expense module</Badge></td>
                    <td><Badge className="badge-neutral">{e.payment_method || activeExchangeName}</Badge></td>
                    <td>
                      <div className="font-medium">{e.vendor_name}</div>
                      <div className="text-xs text-gray-500">{e.category}</div>
                    </td>
                    <td className="font-mono text-red-700">-{fmtLedgerAmount(e.amount, e.currency)}</td>
                    <td><Hash value={e.tx_hash} /></td>
                    <td><Badge className="badge-warning">Expense</Badge></td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={(ev) => { ev.stopPropagation(); deleteExpenseRow(e); }}
                        className="rounded-md p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete this expense"
                        data-testid={`treasury-expense-delete-${e.id}`}
                      >
                        <Trash size={14} />
                      </button>
                    </td>
                  </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'aed' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card-axistra p-5">
            <div className="label-xs mb-1">AED Conversion Queue</div>
            <h2 className="font-display text-xl font-bold text-gray-900 mb-4">USDT ready for AED/Wio deposit</h2>
            <div className="space-y-3">
              {batches.filter((b) => ['converted_to_usdt', 'converted_to_aed'].includes(b.status)).map((b) => (
                <button key={b.id} onClick={() => openBatch(b)} className="w-full rounded-md border border-gray-200 p-4 text-left hover:border-axistra-green">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-axistra-green">{b.batch_code}</div>
                      <div className="text-sm text-gray-600">{b.usdt_amount || b.crypto_converted || '0'} USDT from {b.destination_exchange || 'exchange'}</div>
                    </div>
                    <BatchStatus status={b.status} />
                  </div>
                </button>
              ))}
              {batches.filter((b) => ['converted_to_usdt', 'converted_to_aed'].includes(b.status)).length === 0 && (
                <div className="text-sm text-gray-500">No transfers waiting for AED or Wio deposit.</div>
              )}
            </div>
          </div>
          <div className="card-axistra p-5">
            <div className="label-xs mb-1">Bank Evidence</div>
            <h2 className="font-display text-xl font-bold text-gray-900 mb-4">Recent Wio deposits</h2>
            <div className="space-y-3">
              {batches.filter((b) => b.bank_reference).map((b) => (
                <div key={b.id} className="rounded-md border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-axistra-green">{b.batch_code}</div>
                      <div className="text-sm text-gray-600">Ref {b.bank_reference}</div>
                      <div className="text-xs text-gray-500">{fmtDate(b.bank_deposit_date)} · Fee AED {b.bank_fee_aed || '0.00'}</div>
                    </div>
                    <div className="font-mono text-sm">{b.net_bank_deposit_amount || b.fiat_received || '0.00'} AED</div>
                  </div>
                </div>
              ))}
              {batches.filter((b) => b.bank_reference).length === 0 && (
                <div className="text-sm text-gray-500">No Wio bank references recorded yet.</div>
              )}
            </div>
          </div>
        </div>
      )}

      <Modal open={batchOpen} onClose={() => setBatchOpen(false)} title="Create Source Transfer" size="lg" testId="treasury-batch-modal">
        <form onSubmit={submitBatch} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2 rounded-md bg-[var(--axistra-gold-light)] px-4 py-3 text-sm text-gray-700">
            Selected receipts: <strong>{selectedIds.length}</strong>. This links customer invoices/TXIDs into one treasury transfer record.
          </div>
          <Field label="Transfer Name" span={2}><input className="input-axistra" value={batchForm.name} onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })} required /></Field>
          <Field label="Source Gateway">
            <select className="input-axistra" value={batchForm.source_gateway} onChange={(e) => setBatchForm({ ...batchForm, source_gateway: e.target.value })}>
              <option>Mixed</option><option>BTCPay</option><option>OxaPay</option><option>Binance</option><option>OKX</option><option>Direct</option><option>Manual</option>
            </select>
          </Field>
          <Field label="Destination Exchange">
            <select className="input-axistra" value={batchForm.destination_exchange} onChange={(e) => setBatchForm({ ...batchForm, destination_exchange: e.target.value })}>
              <option>OKX</option><option>Binance</option><option>Other</option>
            </select>
          </Field>
          <Field label="Source Wallet / Processor"><input className="input-axistra font-mono" value={batchForm.source_wallet} onChange={(e) => setBatchForm({ ...batchForm, source_wallet: e.target.value })} placeholder="BTCPay wallet / OxaPay / direct wallet" /></Field>
          <Field label="Exchange Deposit Wallet"><input className="input-axistra font-mono" value={batchForm.destination_wallet} onChange={(e) => setBatchForm({ ...batchForm, destination_wallet: e.target.value })} /></Field>
          <Field label="Coin"><input className="input-axistra" value={batchForm.coin} onChange={(e) => setBatchForm({ ...batchForm, coin: e.target.value })} placeholder="Auto from receipts if empty" /></Field>
          <Field label="Network"><input className="input-axistra" value={batchForm.network} onChange={(e) => setBatchForm({ ...batchForm, network: e.target.value })} placeholder="BTC / TRC20 / ERC20" /></Field>
          <Field label="Transfer TXID" span={2}><input className="input-axistra font-mono" value={batchForm.settlement_tx_hash} onChange={(e) => setBatchForm({ ...batchForm, settlement_tx_hash: e.target.value })} placeholder="Add after sending, or leave empty and update from Open" /></Field>
          <Field label="Transfer Fee"><input className="input-axistra" value={batchForm.transfer_fee_crypto} onChange={(e) => setBatchForm({ ...batchForm, transfer_fee_crypto: e.target.value })} placeholder="Auto from BTC mempool verification" /></Field>
          <Field label="Received at Exchange"><input className="input-axistra" value={batchForm.received_crypto_amount} onChange={(e) => setBatchForm({ ...batchForm, received_crypto_amount: e.target.value })} placeholder="Auto from BTC mempool verification" /></Field>
          <Field label="Period Start"><input type="date" className="input-axistra" value={batchForm.period_start} onChange={(e) => setBatchForm({ ...batchForm, period_start: e.target.value })} /></Field>
          <Field label="Period End"><input type="date" className="input-axistra" value={batchForm.period_end} onChange={(e) => setBatchForm({ ...batchForm, period_end: e.target.value })} /></Field>
          <Field label="Notes" span={2}><textarea rows={2} className="input-axistra" value={batchForm.notes} onChange={(e) => setBatchForm({ ...batchForm, notes: e.target.value })} /></Field>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setBatchOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading || selectedIds.length === 0} className="btn-primary">{loading ? 'Creating...' : 'Create Transfer'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!activeBatch} onClose={() => { setActiveBatch(null); setBatchDetail(null); }} title={activeBatch ? `Treasury Transfer - ${activeBatch.batch_code}` : 'Treasury Transfer'} size="xl" testId="treasury-settlement-modal">
        {activeBatch && (
          <form onSubmit={updateSettlement} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-md border border-gray-200 p-3">
                <div className="label-xs">Receipts</div>
                <div className="font-display text-xl font-bold">{batchDetail?.recharges?.length || activeBatch.movements_count || 0}</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3">
                <div className="label-xs">Invoice Total</div>
                <div className="font-mono text-sm">{activeBatch.total_invoice_amount || '0.00'} {activeBatch.invoice_currency || ''}</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3">
                <div className="label-xs">Crypto Total</div>
                <div className="font-mono text-sm">{activeBatch.total_crypto_amount || '0'} {activeBatch.coin || ''}</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3">
                <div className="label-xs">Status</div>
                <div className="mt-1"><BatchStatus status={activeBatch.status} /></div>
              </div>
            </div>

            {batchDetail?.recharges?.length > 0 && (
              <div className="rounded-md border border-gray-200 p-4">
                <div className="label-xs mb-3">Customer receipts in this transfer</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {batchDetail.recharges.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 text-sm">
                      <span><span className="font-mono text-axistra-green">{r.recharge_code}</span> · {r.customer?.full_name || r.magnus_username}</span>
                      <span className="font-mono text-xs">{fmtCrypto(r.crypto_amount)} {r.crypto_coin}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="rounded-md border border-gray-200 p-4">
                <h3 className="font-display text-lg font-semibold text-gray-900 mb-1">1. Sweep to OKX/Binance <span className="text-xs font-normal text-gray-500">— required</span></h3>
                <p className="text-[11px] text-gray-500 mb-3">Moves the coin from your processor wallet (BTCPay / OxaPay) to the exchange. After saving this step the coin is <strong>held at the exchange</strong>. Convert / cashout later, when ready.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Source Wallet / Processor"><input className="input-axistra font-mono" value={settlementForm.source_wallet || ''} onChange={(e) => setSettlementForm({ ...settlementForm, source_wallet: e.target.value })} /></Field>
                  <Field label="Destination Exchange"><select className="input-axistra" value={settlementForm.destination_exchange || 'OKX'} onChange={(e) => setSettlementForm({ ...settlementForm, destination_exchange: e.target.value })}><option>OKX</option><option>Binance</option><option>Other</option></select></Field>
                  <Field label="Exchange Deposit Wallet" span={2}><input className="input-axistra font-mono" value={settlementForm.destination_wallet || ''} onChange={(e) => setSettlementForm({ ...settlementForm, destination_wallet: e.target.value })} /></Field>
                  <Field label="Treasury Transfer TXID" span={2}><input className="input-axistra font-mono" value={settlementForm.settlement_tx_hash || ''} onChange={(e) => setSettlementForm({ ...settlementForm, settlement_tx_hash: e.target.value })} /></Field>
                  {(activeBatch.coin || '').toUpperCase() === 'BTC' && (
                    <div className="md:col-span-2 flex justify-end">
                      <button type="button" onClick={verifyActiveBtcTransfer} disabled={verifyingId === activeBatch.id} className="btn-secondary text-xs disabled:opacity-50">
                        {verifyingId === activeBatch.id ? 'Verifying mempool...' : 'Verify BTC Transfer from Mempool'}
                      </button>
                    </div>
                  )}
                  <Field label="Transfer Fee Crypto"><input className="input-axistra" value={settlementForm.transfer_fee_crypto || ''} onChange={(e) => setSettlementForm({ ...settlementForm, transfer_fee_crypto: e.target.value })} placeholder="0.00005" /></Field>
                  <Field label="Received At Exchange"><input type="date" className="input-axistra" value={settlementForm.exchange_received_at || ''} onChange={(e) => setSettlementForm({ ...settlementForm, exchange_received_at: e.target.value })} /></Field>
                  <Field label="Exchange Received Amount"><input className="input-axistra" value={settlementForm.received_crypto_amount || ''} onChange={(e) => setSettlementForm({ ...settlementForm, received_crypto_amount: e.target.value })} /></Field>
                  <Field label="Exchange Reference"><input className="input-axistra" value={settlementForm.settlement_reference || ''} onChange={(e) => setSettlementForm({ ...settlementForm, settlement_reference: e.target.value })} /></Field>
                </div>
              </div>

              <div className="rounded-md border border-gray-200 p-4">
                <button type="button" onClick={() => setShowStep2(!showStep2)} className="w-full flex items-center justify-between text-left" data-testid="treasury-step2-toggle">
                  <div>
                    <h3 className="font-display text-lg font-semibold text-gray-900">2. Convert or Hold as USDT <span className="text-xs font-normal text-gray-500">— optional</span></h3>
                    {!showStep2 && <p className="text-[11px] text-gray-500 mt-1">Skip if you're keeping the coin as-is at the exchange. Click to expand if you converted to USDT.</p>}
                  </div>
                  <span className="text-xs text-axistra-green font-semibold">{showStep2 ? '▲ Hide' : '▼ Expand'}</span>
                </button>
                {showStep2 && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="USDT Amount"><input className="input-axistra" value={settlementForm.usdt_amount || ''} onChange={(e) => setSettlementForm({ ...settlementForm, usdt_amount: e.target.value, crypto_converted: settlementForm.crypto_converted || e.target.value })} /></Field>
                  <Field label={`${activeBatch.coin || 'Crypto'} to USDT Rate`}><input className="input-axistra" value={settlementForm.usdt_conversion_rate || ''} onChange={(e) => setSettlementForm({ ...settlementForm, usdt_conversion_rate: e.target.value })} placeholder={(activeBatch.coin || '').toUpperCase() === 'USDT' ? 'Leave empty for USDT' : 'USDT per coin'} /></Field>
                  <Field label="USDT Conversion Date"><input type="date" className="input-axistra" value={settlementForm.usdt_conversion_date || ''} onChange={(e) => setSettlementForm({ ...settlementForm, usdt_conversion_date: e.target.value })} /></Field>
                  <Field label="Conversion Reference"><input className="input-axistra" value={settlementForm.usdt_conversion_reference || ''} onChange={(e) => setSettlementForm({ ...settlementForm, usdt_conversion_reference: e.target.value })} /></Field>
                </div>
                )}
              </div>

              <div className="rounded-md border border-gray-200 p-4">
                <button type="button" onClick={() => setShowStep3(!showStep3)} className="w-full flex items-center justify-between text-left" data-testid="treasury-step3-toggle">
                  <div>
                    <h3 className="font-display text-lg font-semibold text-gray-900">3. Convert USDT to AED <span className="text-xs font-normal text-gray-500">— optional</span></h3>
                    {!showStep3 && <p className="text-[11px] text-gray-500 mt-1">Click to expand only when this transfer has been converted to AED on the exchange.</p>}
                  </div>
                  <span className="text-xs text-axistra-green font-semibold">{showStep3 ? '▲ Hide' : '▼ Expand'}</span>
                </button>
                {showStep3 && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="USDT Converted"><input className="input-axistra" value={settlementForm.crypto_converted || ''} onChange={(e) => setSettlementForm({ ...settlementForm, crypto_converted: e.target.value })} /></Field>
                  <Field label="AED Rate"><input className="input-axistra" value={settlementForm.conversion_rate || ''} onChange={(e) => setSettlementForm({ ...settlementForm, conversion_rate: e.target.value })} placeholder="3.67" /></Field>
                  <Field label="AED Received"><input className="input-axistra" value={settlementForm.fiat_received || ''} onChange={(e) => {
                    const fee = parseFloat(settlementForm.bank_fee_aed || '0');
                    const gross = parseFloat(e.target.value || '0');
                    setSettlementForm({ ...settlementForm, fiat_received: e.target.value, fiat_currency: 'AED', net_bank_deposit_amount: gross ? Math.max(0, gross - fee).toFixed(2) : settlementForm.net_bank_deposit_amount });
                  }} /></Field>
                  <Field label="Conversion Date"><input type="date" className="input-axistra" value={settlementForm.conversion_date || ''} onChange={(e) => setSettlementForm({ ...settlementForm, conversion_date: e.target.value })} /></Field>
                </div>
                )}
              </div>

              <div className="rounded-md border border-gray-200 p-4">
                <button type="button" onClick={() => setShowStep4(!showStep4)} className="w-full flex items-center justify-between text-left" data-testid="treasury-step4-toggle">
                  <div>
                    <h3 className="font-display text-lg font-semibold text-gray-900">4. Withdraw to Wio <span className="text-xs font-normal text-gray-500">— optional</span></h3>
                    {!showStep4 && <p className="text-[11px] text-gray-500 mt-1">Click to expand only when the AED has been wired from the exchange to your Wio bank account.</p>}
                  </div>
                  <span className="text-xs text-axistra-green font-semibold">{showStep4 ? '▲ Hide' : '▼ Expand'}</span>
                </button>
                {showStep4 && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Bank"><input className="input-axistra" value={settlementForm.bank_name || 'Wio Bank'} onChange={(e) => setSettlementForm({ ...settlementForm, bank_name: e.target.value })} /></Field>
                  <Field label="Wio Bank Reference"><input className="input-axistra font-mono" value={settlementForm.bank_reference || ''} onChange={(e) => setSettlementForm({ ...settlementForm, bank_reference: e.target.value })} /></Field>
                  <Field label="Deposit Date"><input type="date" className="input-axistra" value={settlementForm.bank_deposit_date || ''} onChange={(e) => setSettlementForm({ ...settlementForm, bank_deposit_date: e.target.value })} /></Field>
                  <Field label="Bank Fee AED"><input className="input-axistra" value={settlementForm.bank_fee_aed || ''} onChange={(e) => {
                    const gross = parseFloat(settlementForm.fiat_received || '0');
                    const fee = parseFloat(e.target.value || '0');
                    setSettlementForm({ ...settlementForm, bank_fee_aed: e.target.value, net_bank_deposit_amount: gross ? Math.max(0, gross - fee).toFixed(2) : settlementForm.net_bank_deposit_amount });
                  }} /></Field>
                  <Field label="Net Wio Deposit AED" span={2}><input className="input-axistra" value={settlementForm.net_bank_deposit_amount || ''} onChange={(e) => setSettlementForm({ ...settlementForm, net_bank_deposit_amount: e.target.value })} /></Field>
                </div>
                )}
              </div>
            </div>

            <Field label="Notes"><textarea rows={2} className="input-axistra" value={settlementForm.notes || ''} onChange={(e) => setSettlementForm({ ...settlementForm, notes: e.target.value })} /></Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setActiveBatch(null); setBatchDetail(null); }} className="btn-secondary">Cancel</button>
              <button
                type="button"
                onClick={async () => {
                  if (!activeBatch?.id) return;
                  try {
                    await api.post(`/treasury/batches/${activeBatch.id}/sync-ledger`);
                    toast.success('Wallet ledger re-synced — open Wallet Ledger to confirm balances.');
                    await load();
                  } catch (err) {
                    toast.error(err?.response?.data?.message || 'Sync failed');
                  }
                }}
                className="btn-secondary inline-flex items-center gap-1"
                data-testid="treasury-sync-ledger-btn"
                title="Re-create the wallet_ledger rows for this batch's sweep / conversions / bank deposit. Idempotent — safe to click multiple times."
              >
                Sync to Wallet Ledger
              </button>
              <button type="submit" disabled={loading} className="btn-primary inline-flex items-center gap-2">
                <DownloadSimple size={16} /> {loading ? 'Saving...' : 'Save Settlement'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!activeReceipt} onClose={() => setActiveReceipt(null)} title={activeReceipt ? `Wallet Receipt - ${activeReceipt.recharge_code}` : 'Wallet Receipt'} size="lg">
        {activeReceipt && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-md border border-gray-200 p-3">
                <div className="label-xs">Customer</div>
                <div className="font-semibold text-gray-900">{activeReceipt.customer?.full_name || activeReceipt.magnus_username || 'Customer'}</div>
                <div className="text-xs text-gray-500">{activeReceipt.magnus_username}</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3">
                <div className="label-xs">Invoice</div>
                <div className="font-mono text-sm text-axistra-green">{activeReceipt.invoice_number || '—'}</div>
                <div className="text-xs text-gray-500">{fmtMoney(activeReceipt.amount, activeReceipt.currency)}</div>
              </div>
              <div className="rounded-md border border-gray-200 p-3">
                <div className="label-xs">Wallet</div>
                <div className="font-semibold text-gray-900">{activeReceipt.payment_gateway || activeExchangeName}</div>
                <div className="text-xs text-gray-500">{fmtDate(activeReceipt.payment_date || activeReceipt.created_at)}</div>
              </div>
            </div>

            <div className="rounded-md border border-gray-200 p-4">
              <div className="label-xs mb-3">Payment Details</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div><div className="label-xs mb-1">Crypto Amount</div><div className="font-mono">{rechargeCryptoLabel(activeReceipt)}</div></div>
                <div><div className="label-xs mb-1">Treasury Batch</div><div>{activeReceipt.treasury?.treasury_batch_id ? <Badge className="badge-info">Batched</Badge> : <Badge className="badge-warning">Ready for grouping</Badge>}</div></div>
                <div className="md:col-span-2"><div className="label-xs mb-1">Wallet Address</div><Hash value={activeReceipt.wallet_address || activeReceipt.treasury?.receiving_wallet} /></div>
                <div className="md:col-span-2"><div className="label-xs mb-1">Customer TX Hash</div><Hash value={activeReceipt.tx_hash} /></div>
              </div>
            </div>

            <div className="rounded-md border border-gray-200 p-4">
              <div className="label-xs mb-3">Stored Chain Transactions</div>
              <div className="space-y-2">
                {(activeReceipt.crypto_transactions || []).length === 0 && <div className="text-sm text-gray-500">No detailed crypto transaction rows stored.</div>}
                {(activeReceipt.crypto_transactions || []).map((tx) => (
                  <div key={tx.id} className="rounded-md bg-gray-50 px-3 py-2 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-mono">{fmtCrypto(tx.crypto_amount || tx.received_amount)} {tx.coin} <span className="text-gray-400">{tx.network}</span></span>
                      <Badge className={String(tx.gateway_tx_status || '').toLowerCase() === 'confirmed' ? 'badge-success' : 'badge-neutral'}>{tx.gateway_tx_status || tx.status || 'received'}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-500">
                      <div className="md:col-span-2 min-w-0">Sender: <span className="font-mono break-all">{tx.sender_address || '—'}</span></div>
                      <div className="md:col-span-2 min-w-0">Receiver: <span className="font-mono break-all">{tx.receiving_wallet || '—'}</span></div>
                      <div>Final USDT: <span className="font-mono">{txFinalUsdt(tx) ? `${fmtCrypto(txFinalUsdt(tx))} USDT` : '—'}</span></div>
                      <div>Confirmations: <span className="font-mono">{tx.confirmations || '—'}</span></div>
                    </div>
                    <div className="mt-2"><Hash value={tx.tx_hash} /></div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Link to={`/recharges/${activeReceipt.id}`} className="btn-secondary">Open Recharge</Link>
              <button type="button" onClick={() => setActiveReceipt(null)} className="btn-primary">Close</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!activeExpense} onClose={() => setActiveExpense(null)} title={activeExpense ? `Wallet Expense - ${activeExpense.expense_code || activeExpense.vendor_name}` : 'Wallet Expense'} size="md">
        {activeExpense && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><div className="label-xs mb-1">Vendor</div><div className="font-semibold text-gray-900">{activeExpense.vendor_name}</div></div>
              <div><div className="label-xs mb-1">Date</div><div>{fmtDate(activeExpense.expense_date)}</div></div>
              <div><div className="label-xs mb-1">Category</div><div>{activeExpense.category}</div></div>
              <div><div className="label-xs mb-1">Amount</div><div className="font-mono text-red-700">-{fmtLedgerAmount(activeExpense.amount, activeExpense.currency)}</div></div>
              <div className="md:col-span-2"><div className="label-xs mb-1">Vendor Wallet</div><Hash value={activeExpense.vendor_wallet} /></div>
              <div className="md:col-span-2"><div className="label-xs mb-1">TX / Bank Reference</div><Hash value={activeExpense.tx_hash || activeExpense.bank_reference} /></div>
            </div>
            {activeExpense.notes && <div className="rounded-md bg-gray-50 p-3 text-gray-600">{activeExpense.notes}</div>}
            <div className="flex justify-end gap-2">
              <Link to="/expenses" className="btn-secondary">Open Expenses</Link>
              <button type="button" onClick={() => setActiveExpense(null)} className="btn-primary">Close</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={operationOpen}
        onClose={() => setOperationOpen(false)}
        title={
          operationType === 'to_usdt'
            ? `Convert ${operationForm.coin || 'Coin'} to USDT`
            : operationType === 'to_aed'
              ? 'Convert USDT to AED'
              : 'Cashout to Wio Bank'
        }
        size="lg"
      >
        <form onSubmit={submitOperation} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-700">
            Selected wallet entries: <strong>{selectedExchangeEntryCount}</strong>
            {operationForm.coin && <span> · Coin(s): <strong>{operationForm.coin}</strong></span>}
            {operationType === 'to_usdt' && (
              <span> · Transfers: <strong>{operationForm.batch_entries_count || 0}</strong> · Direct receipts: <strong>{operationForm.direct_receipts_count || 0}</strong></span>
            )}
            {operationType === 'to_usdt' && operationForm.coin && (() => {
              // Sanity-check the selected-items sum against the ACTUAL wallet
              // balance the user sees in the header chip. They may differ
              // because of manual ledger entries, orphan rows or earlier
              // conversions — exposing the gap up-front lets the user override
              // the input below to convert the full balance if that's what
              // they intended.
              const walletBalance = walletBalanceFor(exchangeWalletCode, operationForm.coin);
              const selectedSum = parseFloat(operationForm.total_crypto || '0');
              const gap = walletBalance - selectedSum;
              const showGap = Math.abs(gap) > 0.00000001;
              return (
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md bg-white border border-gray-200 px-2 py-1">
                    <div className="text-gray-500">Selected sum</div>
                    <div className="font-mono font-semibold">{selectedSum.toFixed(8)} {operationForm.coin}</div>
                  </div>
                  <div className="rounded-md bg-white border border-gray-200 px-2 py-1">
                    <div className="text-gray-500">{exchangeWalletCode} balance</div>
                    <div className="font-mono font-semibold text-axistra-green">{walletBalance.toFixed(8)} {operationForm.coin}</div>
                  </div>
                  <div className={`rounded-md border px-2 py-1 ${showGap ? 'bg-yellow-50 border-yellow-300' : 'bg-white border-gray-200'}`}>
                    <div className="text-gray-500">Other in wallet</div>
                    <div className={`font-mono font-semibold ${showGap ? 'text-yellow-700' : ''}`}>{gap.toFixed(8)} {operationForm.coin}</div>
                  </div>
                  {showGap && (
                    <div className="col-span-3 text-[11px] text-yellow-700">
                      {gap > 0 ? 'Wallet holds more than the selected items. Edit the Total Source Coin below to convert the full balance if needed.' : 'Selected items sum exceeds the wallet balance — check for double-counted rows.'}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {operationType === 'to_usdt' && (
            <>
              <Field label="Total Source Coin (editable)"><input className="input-axistra font-mono" value={operationForm.total_crypto || ''} onChange={(e) => {
                const totalCrypto = parseFloat(e.target.value || '0');
                const totalUsdt = parseFloat(operationForm.usdt_amount || '0');
                setOperationForm({
                  ...operationForm,
                  total_crypto: e.target.value,
                  usdt_conversion_rate: totalCrypto && totalUsdt ? (totalUsdt / totalCrypto).toFixed(8) : operationForm.usdt_conversion_rate,
                });
              }} /></Field>
              <Field label="Final USDT Received"><input required className="input-axistra" value={operationForm.usdt_amount || ''} onChange={(e) => {
                const totalCrypto = parseFloat(operationForm.total_crypto || '0');
                const totalUsdt = parseFloat(e.target.value || '0');
                setOperationForm({
                  ...operationForm,
                  usdt_amount: e.target.value,
                  usdt_conversion_rate: totalCrypto && totalUsdt ? (totalUsdt / totalCrypto).toFixed(8) : operationForm.usdt_conversion_rate,
                });
              }} /></Field>
              <Field label="Conversion Rate"><input className="input-axistra" value={operationForm.usdt_conversion_rate || ''} onChange={(e) => setOperationForm({ ...operationForm, usdt_conversion_rate: e.target.value })} /></Field>
              <Field label="Conversion Date"><input type="date" className="input-axistra" value={operationForm.usdt_conversion_date || ''} onChange={(e) => setOperationForm({ ...operationForm, usdt_conversion_date: e.target.value })} /></Field>
              <Field label="Reference / Order ID" span={2}><input className="input-axistra font-mono" value={operationForm.usdt_conversion_reference || ''} onChange={(e) => setOperationForm({ ...operationForm, usdt_conversion_reference: e.target.value })} /></Field>
            </>
          )}

          {operationType === 'to_aed' && (
            <>
              <Field label="USDT Converted"><input required className="input-axistra" value={operationForm.crypto_converted || ''} onChange={(e) => {
                const rate = parseFloat(operationForm.conversion_rate || '0');
                const usdt = parseFloat(e.target.value || '0');
                setOperationForm({
                  ...operationForm,
                  crypto_converted: e.target.value,
                  fiat_received: rate && usdt ? (rate * usdt).toFixed(2) : operationForm.fiat_received,
                });
              }} /></Field>
              <Field label="AED Rate"><input required className="input-axistra" value={operationForm.conversion_rate || ''} onChange={(e) => {
                const rate = parseFloat(e.target.value || '0');
                const usdt = parseFloat(operationForm.crypto_converted || '0');
                setOperationForm({
                  ...operationForm,
                  conversion_rate: e.target.value,
                  fiat_received: rate && usdt ? (rate * usdt).toFixed(2) : operationForm.fiat_received,
                });
              }} /></Field>
              <Field label="Total AED Received"><input required className="input-axistra" value={operationForm.fiat_received || ''} onChange={(e) => setOperationForm({ ...operationForm, fiat_received: e.target.value })} /></Field>
              <Field label="Conversion Date"><input type="date" className="input-axistra" value={operationForm.conversion_date || ''} onChange={(e) => setOperationForm({ ...operationForm, conversion_date: e.target.value })} /></Field>
            </>
          )}

          {operationType === 'cashout' && (
            <>
              <Field label="AED Cashout Amount"><input required className="input-axistra" value={operationForm.fiat_received || ''} onChange={(e) => {
                const gross = parseFloat(e.target.value || '0');
                const fee = parseFloat(operationForm.bank_fee_aed || '0');
                setOperationForm({
                  ...operationForm,
                  fiat_received: e.target.value,
                  net_bank_deposit_amount: gross ? Math.max(0, gross - fee).toFixed(2) : operationForm.net_bank_deposit_amount,
                });
              }} /></Field>
              <Field label="Bank / Transfer Fee AED"><input className="input-axistra" value={operationForm.bank_fee_aed || ''} onChange={(e) => {
                const gross = parseFloat(operationForm.fiat_received || '0');
                const fee = parseFloat(e.target.value || '0');
                setOperationForm({
                  ...operationForm,
                  bank_fee_aed: e.target.value,
                  net_bank_deposit_amount: gross ? Math.max(0, gross - fee).toFixed(2) : operationForm.net_bank_deposit_amount,
                });
              }} /></Field>
              <Field label="Net Wio Deposit"><input className="input-axistra" value={operationForm.net_bank_deposit_amount || ''} onChange={(e) => setOperationForm({ ...operationForm, net_bank_deposit_amount: e.target.value })} /></Field>
              <Field label="Deposit Date"><input type="date" className="input-axistra" value={operationForm.bank_deposit_date || ''} onChange={(e) => setOperationForm({ ...operationForm, bank_deposit_date: e.target.value })} /></Field>
              <Field label="Wio Reference / Receipt ID" span={2}><input required className="input-axistra font-mono" value={operationForm.bank_reference || ''} onChange={(e) => setOperationForm({ ...operationForm, bank_reference: e.target.value })} /></Field>
            </>
          )}

          <Field label="Notes / Receipt Link" span={2}><textarea rows={2} className="input-axistra" value={operationForm.notes || ''} onChange={(e) => setOperationForm({ ...operationForm, notes: e.target.value })} /></Field>
          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOperationOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </Modal>

    </div>
  );
}
