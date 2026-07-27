import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';

import { AuthProvider, useAuth } from './lib/auth';
import { CurrencyProvider } from './lib/currency';
import AppLayout from './components/AppLayout';
import LandingPage from './pages/Landing';
import LoginPage from './pages/Login';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Recharges from './pages/Recharges';
import RechargeDetail from './pages/RechargeDetail';
import Invoices from './pages/Invoices';
import Treasury from './pages/Treasury';
import WalletLedger from './pages/WalletLedger';
import AuditChainSearch from './pages/AuditChainSearch';
import Expenses from './pages/Expenses';
import ProfitLoss from './pages/ProfitLoss';
import Reports from './pages/Reports';
import Compliance from './pages/Compliance';
import MagnusSync from './pages/MagnusSync';
import MagnusUsers from './pages/MagnusUsers';
import Leads from './pages/Leads';
import AuditLogs from './pages/AuditLogs';
import WebhookLogs from './pages/WebhookLogs';
import AdminUsers from './pages/AdminUsers';
import Settings from './pages/Settings';
import Payroll from './pages/Payroll';
import EmployeeDetail from './pages/EmployeeDetail';
import CorporateDocs from './pages/CorporateDocs';
import TaxVatCenter from './pages/TaxVatCenter';
import Contracts from './pages/Contracts';
import ConversionRegister from './pages/ConversionRegister';
import TwoFactorSetup from './pages/TwoFactorSetup';
import SignLetter from './pages/SignLetter';
import { PrivacyPolicy, TermsAndConditions } from './pages/LegalPage';

import './App.css';

const ProtectedRoutes = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout />;
};

/**
 * Guards a route so only the given roles can enter. CA (chartered accountant)
 * users are locked out of operational/config pages — they only need finance,
 * tax and compliance surfaces. Anyone else gets bounced to /dashboard.
 */
const RoleGate = ({ allow, children }) => {
  const { user } = useAuth();
  const role = user?.role || 'admin';
  if (allow && !allow.includes(role)) return <Navigate to="/dashboard" replace />;
  return children;
};

// Pages the CA account should NOT see (operational / infra / configuration).
const NON_CA_ONLY = ['admin', 'auditor'];

function App() {
  return (
    <AuthProvider>
      <CurrencyProvider>
        <BrowserRouter>
          <Toaster position="top-right" richColors closeButton />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/terms-and-conditions" element={<TermsAndConditions />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/sign/:token" element={<SignLetter />} />
            <Route element={<ProtectedRoutes />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/customers/:id" element={<CustomerDetail />} />
              <Route path="/recharges" element={<Recharges />} />
              <Route path="/recharges/:id" element={<RechargeDetail />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/treasury" element={<RoleGate allow={NON_CA_ONLY}><Treasury /></RoleGate>} />
              <Route path="/wallets" element={<WalletLedger />} />
              <Route path="/audit-chain" element={<AuditChainSearch />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/payroll" element={<Payroll />} />
              <Route path="/payroll/employees/:id" element={<EmployeeDetail />} />
              <Route path="/corporate-docs" element={<CorporateDocs />} />
              <Route path="/tax" element={<TaxVatCenter />} />
              <Route path="/contracts" element={<Contracts />} />
              <Route path="/conversion-register" element={<ConversionRegister />} />
              <Route path="/profit-loss" element={<ProfitLoss />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/compliance" element={<Compliance />} />
              <Route path="/magnus" element={<RoleGate allow={NON_CA_ONLY}><MagnusSync /></RoleGate>} />
              <Route path="/magnus-users" element={<RoleGate allow={NON_CA_ONLY}><MagnusUsers /></RoleGate>} />
              <Route path="/leads" element={<RoleGate allow={NON_CA_ONLY}><Leads /></RoleGate>} />
              <Route path="/webhook-logs" element={<RoleGate allow={NON_CA_ONLY}><WebhookLogs /></RoleGate>} />
              <Route path="/audit-logs" element={<RoleGate allow={NON_CA_ONLY}><AuditLogs /></RoleGate>} />
              <Route path="/admins" element={<RoleGate allow={['admin']}><AdminUsers /></RoleGate>} />
              <Route path="/settings" element={<RoleGate allow={NON_CA_ONLY}><Settings /></RoleGate>} />
              <Route path="/setup-2fa" element={<TwoFactorSetup />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </CurrencyProvider>
    </AuthProvider>
  );
}

export default App;
