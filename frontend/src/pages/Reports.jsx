import React, { useState } from 'react';
import api, { API_BASE } from '../lib/api';
import { PageHeader, KpiCard } from '../components/Atoms';
import { FilePdf, FileXls, FileCsv, ChartBar } from '@phosphor-icons/react';
import { downloadBlob, fmtMoney } from '../lib/format';

const REPORTS = [
  { key: 'monthly-sales', name: 'Monthly Sales' },
  { key: 'quarterly-sales', name: 'Quarterly Sales' },
  { key: 'yearly-pl', name: 'Yearly P&L' },
  { key: 'customer-recharge', name: 'Customer Recharge' },
  { key: 'crypto-to-aed', name: 'Crypto → AED Conversion' },
  { key: 'bank-reconciliation', name: 'Bank Reconciliation' },
  { key: 'vat-threshold', name: 'VAT Threshold' },
  { key: 'corporate-tax', name: 'Corporate Tax' },
  { key: 'expenses', name: 'Expense Report' },
  { key: 'suspicious', name: 'Suspicious Activity' },
];

export default function Reports() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState('');

  const view = async (key) => {
    setLoading(key);
    try {
      const { data } = await api.get(`/reports/${key}?year=${year}`);
      setPreview({ key, data });
    } finally { setLoading(''); }
  };

  const csv = (key) => downloadBlob(`${API_BASE}/reports/export/csv?report=${key}&year=${year}`, `${key}-${year}.csv`);
  const excel = (key) => downloadBlob(`${API_BASE}/reports/export/excel?report=${key}&year=${year}`, `${key}-${year}.xlsx`);

  return (
    <div>
      <PageHeader
        eyebrow="Audit & Accountant Ready"
        title="Reports"
        subtitle="Generate accountant-ready exports for sales, P&L, treasury, tax, and compliance."
        actions={
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className="input-axistra w-32" data-testid="reports-year">
            {[year + 1, year, year - 1, year - 2].map((y) => <option key={y}>{y}</option>)}
          </select>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
        {REPORTS.map((r) => (
          <div key={r.key} className="card-axistra p-5" data-testid={`report-card-${r.key}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="label-xs">Report</div>
                <h3 className="font-display text-lg font-semibold mt-0.5">{r.name}</h3>
              </div>
              <ChartBar size={22} weight="duotone" className="text-axistra-green" />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => view(r.key)} disabled={loading === r.key} className="btn-secondary text-xs flex-1" data-testid={`report-view-${r.key}`}>
                {loading === r.key ? 'Loading…' : 'View'}
              </button>
              <button onClick={() => csv(r.key)} className="btn-secondary text-xs inline-flex items-center gap-1" data-testid={`report-csv-${r.key}`}><FileCsv size={14} /> CSV</button>
              <button onClick={() => excel(r.key)} className="btn-accent text-xs inline-flex items-center gap-1" data-testid={`report-excel-${r.key}`}><FileXls size={14} /> Excel</button>
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <div className="card-axistra p-6" data-testid="report-preview">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-display text-lg font-semibold">Preview — {preview.key}</h3>
            <button onClick={() => setPreview(null)} className="text-xs text-gray-500 hover:text-gray-900">Close</button>
          </div>
          <pre className="bg-gray-50 border border-gray-200 rounded-md p-4 text-xs overflow-x-auto max-h-96 font-mono">
            {JSON.stringify(preview.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
