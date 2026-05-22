import React, { createContext, useContext, useState } from 'react';

// Static fallback FX rates (1 unit = X AED). Override at any time via setRates.
// Approx market rates Q1 2026 — display-only, not used for accounting.
export const DEFAULT_RATES_TO_AED = {
  AED: 1,
  USD: 3.6725,
  EUR: 3.99,
  USDT: 3.6725,
  GBP: 4.65,
};

const CurrencyContext = createContext(null);

export const CurrencyProvider = ({ children }) => {
  const [display, setDisplay] = useState(() => localStorage.getItem('axistra_currency') || 'USD');
  const [rates, setRates] = useState(DEFAULT_RATES_TO_AED);

  const change = (c) => {
    setDisplay(c);
    localStorage.setItem('axistra_currency', c);
  };

  // Convert any (amount, currency) to current display currency
  const convert = (amount, fromCurrency) => {
    if (amount === null || amount === undefined || amount === '') return 0;
    const n = parseFloat(amount);
    if (isNaN(n)) return 0;
    const from = (fromCurrency || 'USD').toUpperCase();
    const to = display;
    if (from === to) return n;
    const aedAmount = n * (rates[from] || 1);
    return aedAmount / (rates[to] || 1);
  };

  const format = (amount, fromCurrency) => {
    const converted = convert(amount, fromCurrency);
    return `${display} ${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <CurrencyContext.Provider value={{ display, change, convert, format, rates, setRates }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => useContext(CurrencyContext);
