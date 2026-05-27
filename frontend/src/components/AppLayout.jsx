import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  ChartPieSlice, Users, CurrencyCircleDollar, FileText, Wallet, Receipt,
  ChartLineUp, FileCsv, Shield, Plug, Gear, UserCircleGear, ClockCounterClockwise,
  SignOut, List, Bell, IdentificationCard, ChatCircleDots,
} from '@phosphor-icons/react';
import CurrencyToggle from './CurrencyToggle';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: ChartPieSlice, tid: 'sidebar-nav-dashboard' },
  { to: '/customers', label: 'Customers', icon: Users, tid: 'sidebar-nav-customers' },
  { to: '/recharges', label: 'Recharges', icon: CurrencyCircleDollar, tid: 'sidebar-nav-recharges' },
  { to: '/invoices', label: 'Invoices', icon: FileText, tid: 'sidebar-nav-invoices' },
  { to: '/treasury', label: 'Crypto Treasury', icon: Wallet, tid: 'sidebar-nav-treasury' },
  { to: '/wallets', label: 'Wallet Ledger', icon: Wallet, tid: 'sidebar-nav-wallets' },
  { to: '/audit-chain', label: 'Audit Chain', icon: Shield, tid: 'sidebar-nav-audit-chain' },
  { to: '/expenses', label: 'Expenses', icon: Receipt, tid: 'sidebar-nav-expenses' },
  { to: '/profit-loss', label: 'Profit & Loss', icon: ChartLineUp, tid: 'sidebar-nav-profit-loss' },
  { to: '/reports', label: 'Reports', icon: FileCsv, tid: 'sidebar-nav-reports' },
  { to: '/compliance', label: 'Compliance', icon: Shield, tid: 'sidebar-nav-compliance' },
  { to: '/magnus', label: 'Magnus Sync', icon: Plug, tid: 'sidebar-nav-magnus' },
  { to: '/magnus-users', label: 'Magnus Users', icon: IdentificationCard, tid: 'sidebar-nav-magnus-users' },
  { to: '/leads', label: 'Leads', icon: ChatCircleDots, tid: 'sidebar-nav-leads' },
  { to: '/webhook-logs', label: 'Webhook Logs', icon: Plug, tid: 'sidebar-nav-webhook-logs' },
  { to: '/settings', label: 'Settings', icon: Gear, tid: 'sidebar-nav-settings' },
  { to: '/admins', label: 'Admin Users', icon: UserCircleGear, tid: 'sidebar-nav-admins' },
  { to: '/audit-logs', label: 'Audit Logs', icon: ClockCounterClockwise, tid: 'sidebar-nav-audit-logs' },
];

const LOGO_URL = '/axistra-logo.png';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = useNavigate();

  return (
    <div className="min-h-screen bg-[var(--axistra-bg)]">
      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-screen w-64 bg-[var(--axistra-sidebar)] text-white flex flex-col z-40 transform transition-transform sidebar-scroll overflow-y-auto ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        data-testid="app-sidebar"
      >
        <div className="px-5 py-6 border-b border-[#117852] flex items-center gap-3">
          <img src={LOGO_URL} alt="Axistra" className="w-11 h-11 rounded bg-white p-1" />
          <div>
            <div className="font-display text-lg font-bold tracking-tight leading-none">AXISTRA</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--axistra-gold)] mt-0.5">Compliance Portal</div>
          </div>
        </div>

        <nav className="flex-1 py-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                data-testid={item.tid}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-5 py-2.5 text-sm border-l-2 transition-colors ${
                    isActive
                      ? 'bg-[var(--axistra-sidebar-active)] border-[var(--axistra-gold)] text-[var(--axistra-gold)] font-semibold'
                      : 'border-transparent text-gray-200 hover:bg-[var(--axistra-sidebar-active)] hover:text-white'
                  }`
                }
              >
                <Icon size={18} weight="duotone" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#117852] text-[11px] text-gray-300 leading-relaxed">
          <div className="font-display text-white text-sm">{user?.full_name || 'Admin'}</div>
          <div className="text-gray-300">{user?.email}</div>
          <button
            data-testid="logout-btn"
            onClick={logout}
            className="mt-3 flex items-center gap-2 text-[var(--axistra-gold)] hover:underline"
          >
            <SignOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <header className="md:hidden sticky top-0 z-30 bg-white border-b border-gray-200 flex items-center justify-between px-4 h-14">
        <button onClick={() => setMobileOpen(true)} data-testid="sidebar-toggle"><List size={22} /></button>
        <div className="font-display font-bold text-[var(--axistra-green)]">Axistra Portal</div>
        <div className="w-6" />
      </header>

      {/* Main content */}
      <main className="md:ml-64 min-h-screen">
        <div className="hidden md:flex items-center justify-between px-8 py-4 border-b border-gray-200 bg-white">
          <div className="font-display text-sm text-gray-500">
            <span className="text-axistra-green font-semibold">Axistra Technologies FZCO</span>
            <span className="mx-2 text-gray-300">|</span>
            <span>Compliance + Accounting Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <CurrencyToggle />
            <Bell size={18} className="text-gray-500" />
            <div className="text-right">
              <div className="text-xs font-semibold text-gray-900" data-testid="topbar-user-name">{user?.full_name}</div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500">{user?.role}</div>
            </div>
          </div>
        </div>
        <div className="p-6 md:p-8 fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
