import React from 'react';
import { Link } from 'react-router-dom';
import {
  CurrencyCircleDollar, ChartLineUp, ArrowsClockwise, Receipt, TrendUp, TrendDown,
  Briefcase, Fire, Wallet, Bank, Warning, Users, FileText, ShieldWarning,
} from '@phosphor-icons/react';
import { fmtNumber } from '../../lib/format';
import { SectionLabel, StatCard, CurrencyBreakdown, VatBar } from './Atoms';

/**
 * Dashboard KPI rows. Each row is one logical grouping shown as a 4-card
 * grid. Split from Dashboard.jsx so the page reads as composition.
 */

export function RevenueRow({ kpis, format }) {
  return (
    <>
      <SectionLabel icon={CurrencyCircleDollar}>Revenue (FX-converted to AED)</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <StatCard
          testId="kpi-today" icon={CurrencyCircleDollar} label="Today's Sales"
          value={format(kpis.daily.sales_aed, 'AED')} delta={kpis.daily.delta_pct}
          sub={<CurrencyBreakdown items={kpis.daily.currencies} count={kpis.daily.count} />}
        />
        <StatCard
          testId="kpi-month" icon={ChartLineUp} label="This Month"
          value={format(kpis.monthly.sales_aed, 'AED')} delta={kpis.monthly.delta_pct}
          sub={<span>{kpis.monthly.count} recharges · Prev: {format(kpis.prev_month.sales_aed, 'AED')}</span>}
        />
        <StatCard
          testId="kpi-30d" icon={ArrowsClockwise} label="Last 30 Days"
          value={format(kpis.thirty_day.sales_aed, 'AED')}
          sub={<CurrencyBreakdown items={kpis.thirty_day.currencies} count={kpis.thirty_day.count} />}
        />
        <StatCard
          testId="kpi-year" icon={ChartLineUp} label="Year-to-Date"
          value={format(kpis.yearly.sales_aed, 'AED')}
          sub={<span>Gross profit {format(kpis.yearly.gross_profit_aed, 'AED')}</span>}
          accent
        />
      </div>
    </>
  );
}

export function ObligationsRow({ kpis, format }) {
  return (
    <>
      <SectionLabel icon={Receipt}>Obligations &amp; cashflow</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <StatCard
          testId="kpi-month-expense" icon={Receipt} label="Monthly Expenses"
          value={format(kpis.monthly.expenses_aed, 'AED')}
          sub={<span>Prev: {format(kpis.prev_month.expenses_aed, 'AED')}</span>}
        />
        <StatCard
          testId="kpi-month-profit"
          icon={kpis.monthly.profit_aed >= 0 ? TrendUp : TrendDown}
          label="Monthly Profit"
          value={format(kpis.monthly.profit_aed, 'AED')}
          accent={kpis.monthly.profit_aed >= 0}
          sub={<span className={kpis.monthly.profit_aed >= 0 ? 'text-axistra-green' : 'text-red-600'}>
            {kpis.monthly.profit_aed >= 0 ? 'In profit' : 'In loss'}
          </span>}
        />
        <StatCard
          testId="kpi-payroll-due" icon={Briefcase} label="Payroll Due"
          value={format(kpis.payroll.due_aed, 'AED')}
          sub={kpis.payroll.due_period
            ? <span><Link className="text-axistra-green hover:underline" to="/payroll">{kpis.payroll.due_period}</Link> · {kpis.payroll.due_status}</span>
            : <span>No pending run</span>}
        />
        <StatCard
          testId="kpi-burn" icon={Fire} label="Burn Rate (30d)"
          value={format(kpis.cashflow.burn_rate_monthly_aed, 'AED')}
          sub={<span>≈ {format(kpis.cashflow.avg_daily_expense_aed, 'AED')} / day</span>}
        />
      </div>
    </>
  );
}

export function TreasuryRow({ kpis, format }) {
  return (
    <>
      <SectionLabel icon={Wallet}>Treasury &amp; bank</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        <StatCard
          testId="kpi-crypto" icon={Wallet} label="Crypto Received (USDT)"
          value={fmtNumber(kpis.treasury.total_crypto_received_usdt)}
          sub={<span>{fmtNumber(kpis.treasury.total_aed_converted)} AED converted</span>}
        />
        <StatCard
          testId="kpi-wio-deposits" icon={Bank} label="Wio Deposits"
          value={format(kpis.treasury.total_wio_deposits, 'AED')}
          sub={<span>Bank reconciled</span>}
          accent
        />
        <StatCard
          testId="kpi-drift" icon={Warning} label="Drift to Settle"
          value={format(kpis.treasury.drift_to_settle, 'AED')}
          sub={kpis.treasury.drift_to_settle > 0
            ? <span className="text-amber-700">AED sitting on exchanges</span>
            : <span>All settled to bank</span>}
        />
        <StatCard
          testId="kpi-bank-balance" icon={Bank} label="Bank Balance (opening)"
          value={format(kpis.banks.total_aed, 'AED')}
          sub={<span>{kpis.banks.active_count} active account(s)</span>}
        />
      </div>
    </>
  );
}

export function PostureRow({ kpis, format }) {
  const vatPct = kpis.vat.pct.toFixed(1);
  return (
    <>
      <SectionLabel icon={ShieldWarning}>Posture</SectionLabel>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard
          testId="kpi-customers" icon={Users} label="Customers"
          value={kpis.customers.total}
          sub={<span>{kpis.customers.new_this_month} new this month · {kpis.customers.high_risk} high-risk</span>}
        />
        <StatCard
          testId="kpi-pending-recon" icon={Warning} label="Pending Reconciliation"
          value={kpis.reconciliation.pending}
          sub={<span>{kpis.reconciliation.mismatch} mismatches</span>}
        />
        <StatCard
          testId="kpi-invoices-open" icon={FileText} label="Open Invoices"
          value={kpis.invoices.open_count}
          sub={<span>{format(kpis.invoices.open_value_aed, 'AED')} outstanding</span>}
        />
        <StatCard
          testId="kpi-vat" icon={ShieldWarning} label="VAT Threshold YTD"
          value={`${vatPct}%`}
          sub={<VatBar pct={kpis.vat.pct} ytd={kpis.vat.ytd_aed} cap={kpis.vat.threshold_aed} />}
        />
      </div>
    </>
  );
}
