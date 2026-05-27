import React, { createContext, useContext, useState } from 'react';
import { API_BASE } from './api';

// Rates are stored as: 1 unit = X AED.
export const DEFAULT_RATES_TO_AED = {
  AED: 1,
  USD: 3.6725,
  EUR: 3.99,
  INR: 0.0435,
  USDT: 3.6725,
  GBP: 4.65,
};

const CurrencyContext = createContext(null);

export const CurrencyProvider = ({ children }) => {
  const [display, setDisplay] = useState(() => localStorage.getItem('axistra_currency') || 'USD');
  const [rates, setRates] = useState(DEFAULT_RATES_TO_AED);
  const [meta, setMeta] = useState({ source: 'fallback', reference_date: null, refreshed_at: null });

  React.useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/fx/rates`)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`FX HTTP ${res.status}`)))
      .then((data) => {
        if (cancelled || !data?.rates_to_aed) return;
        setRates((prev) => ({ ...prev, ...data.rates_to_aed }));
        setMeta({
          source: data.source || 'ECB',
          reference_date: data.reference_date || null,
          refreshed_at: data.refreshed_at || null,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
    <CurrencyContext.Provider value={{ display, change, convert, format, rates, setRates, meta }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => useContext(CurrencyContext);
