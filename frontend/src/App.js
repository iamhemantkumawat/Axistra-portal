import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';

import { AuthProvider, useAuth } from './lib/auth';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/Login';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Recharges from './pages/Recharges';
import RechargeDetail from './pages/RechargeDetail';
import Invoices from './pages/Invoices';
import Treasury from './pages/Treasury';
import Expenses from './pages/Expenses';
import ProfitLoss from './pages/ProfitLoss';
import Reports from './pages/Reports';
import Compliance from './pages/Compliance';
import MagnusSync from './pages/MagnusSync';
import AuditLogs from './pages/AuditLogs';
import AdminUsers from './pages/AdminUsers';
import Settings from './pages/Settings';

import './App.css';

const ProtectedRoutes = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout />;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoutes />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/recharges" element={<Recharges />} />
            <Route path="/recharges/:id" element={<RechargeDetail />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/treasury" element={<Treasury />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/profit-loss" element={<ProfitLoss />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/compliance" element={<Compliance />} />
            <Route path="/magnus" element={<MagnusSync />} />
            <Route path="/audit-logs" element={<AuditLogs />} />
            <Route path="/admins" element={<AdminUsers />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
