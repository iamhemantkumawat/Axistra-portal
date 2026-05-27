import React from 'react';
import { PageHeader } from '../components/Atoms';
import { useCurrency } from '../lib/currency';

const COMPANY = {
  name: 'AXISTRA TECHNOLOGIES - FZCO',
  tagline: 'Innovate • Connect • Grow',
  trn: '105415374500001',
  giban: 'AE037350105415374500001',
  license: '86256',
  registrationNo: '79504',
  address: 'IFZA Business Park, DDP, Dubai Silicon Oasis, Dubai, UAE',
  authority: 'Dubai Silicon Oasis / IFZA',
  legalStructure: 'FZCO (Free Zone Company)',
  shareCapital: 'AED 100,000 divided into 100 shares',
  service: 'SaaS Platform Usage Credits',
};

export default function Settings() {
  const { rates, meta } = useCurrency();

  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        subtitle="Company details, invoice footer and audit-chain configuration."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card-axistra p-6">
          <h3 className="font-display text-lg font-semibold mb-4">Company Identity</h3>
          <div className="space-y-3 text-sm">
            <Row label="Legal Entity" value={COMPANY.name} />
            <Row label="Brand Line" value={COMPANY.tagline} />
            <Row label="Trade License" value={COMPANY.license} mono />
            <Row label="Registration No" value={COMPANY.registrationNo} mono />
            <Row label="Corporate TRN" value={COMPANY.trn} mono />
            <Row label="GIBAN" value={COMPANY.giban} mono />
            <Row label="Address" value={COMPANY.address} />
            <Row label="Authority" value={COMPANY.authority} />
            <Row label="Legal Structure" value={COMPANY.legalStructure} />
            <Row label="Share Capital" value={COMPANY.shareCapital} />
            <Row label="Primary Service" value={COMPANY.service} />
          </div>
        </div>

        <div className="card-axistra p-6">
          <h3 className="font-display text-lg font-semibold mb-4">Compliance Constants</h3>
          <div className="space-y-3 text-sm">
            <Row label="UAE VAT Threshold" value="AED 375,000" />
            <Row label="Corporate Tax Threshold" value="AED 375,000" />
            <Row label="Corporate Tax Rate" value="9%" />
            <Row label="AED / AED" value="1.0000" mono />
            <Row label="USD / AED (Peg)" value="3.6725" mono />
            <Row label="EUR / AED (Daily)" value={Number(rates.EUR || 0).toFixed(4)} mono />
            <Row label="INR / AED (Daily)" value={Number(rates.INR || 0).toFixed(4)} mono />
            <Row label="FX Source" value={meta.reference_date ? `ECB ${meta.reference_date}` : 'Fallback cache'} />
          </div>
          <p className="text-xs text-gray-500 mt-4 leading-relaxed">
            AED stays fixed, USD stays pegged at 3.6725, and EUR / INR are refreshed from the ECB daily reference feed.
          </p>
        </div>

        <div className="card-axistra p-6 lg:col-span-2">
          <h3 className="font-display text-lg font-semibold mb-4">Audit Chain</h3>
          <p className="text-sm text-gray-600 mb-4">Every payment is verified through this fixed six-step chain. Each step is gated and logged.</p>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center text-xs">
            {['Customer', 'Invoice', 'Crypto TX', 'Magnus Credit', 'OKX Conversion', 'Wio Bank Deposit'].map((s, i) => (
              <div key={s} className="p-3 rounded-md border border-gray-200 bg-gradient-to-b from-white to-[var(--axistra-green-light)]">
                <div className="text-axistra-green font-bold mb-1">{i + 1}</div>
                <div className="font-semibold text-gray-800">{s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, value, mono }) => (
  <div className="flex justify-between gap-3 border-b border-gray-100 last:border-0 pb-2 last:pb-0">
    <span className="text-gray-500 uppercase text-xs tracking-wider">{label}</span>
    <span className={`text-gray-900 text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
  </div>
);
