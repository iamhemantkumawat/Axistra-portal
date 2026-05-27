import { Injectable, Logger } from '@nestjs/common';

const ECB_DAILY_XML_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const USD_TO_AED = 3.6725;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type FxSnapshot = {
  source: string;
  reference_date: string | null;
  refreshed_at: string;
  pegged_usd_aed: number;
  rates_to_aed: Record<string, number>;
};

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private cache: FxSnapshot | null = null;
  private cacheFetchedAt = 0;

  private fallbackRates(): Record<string, number> {
    return {
      AED: 1,
      USD: USD_TO_AED,
      USDT: USD_TO_AED,
      EUR: 3.99,
      INR: 0.0435,
      GBP: 4.65,
    };
  }

  private buildSnapshot(ratesToAed: Record<string, number>, referenceDate: string | null): FxSnapshot {
    return {
      source: ECB_DAILY_XML_URL,
      reference_date: referenceDate,
      refreshed_at: new Date().toISOString(),
      pegged_usd_aed: USD_TO_AED,
      rates_to_aed: ratesToAed,
    };
  }

  private async fetchEcbRates(): Promise<FxSnapshot> {
    const response = await fetch(ECB_DAILY_XML_URL, {
      headers: { Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' },
    });
    if (!response.ok) {
      throw new Error(`ECB FX fetch failed with HTTP ${response.status}`);
    }

    const xml = await response.text();
    const referenceDate = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1] || null;
    const cubeRegex = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;
    const eurPairs: Record<string, number> = {};

    for (const match of xml.matchAll(cubeRegex)) {
      const [, currency, rate] = match;
      eurPairs[currency] = parseFloat(rate);
    }

    if (!eurPairs.USD || !eurPairs.INR) {
      throw new Error('ECB FX payload missing USD or INR');
    }

    const eurToAed = eurPairs.USD * USD_TO_AED;
    const ratesToAed: Record<string, number> = {
      AED: 1,
      USD: USD_TO_AED,
      USDT: USD_TO_AED,
      EUR: eurToAed,
    };

    for (const [currency, rate] of Object.entries(eurPairs)) {
      if (!Number.isFinite(rate) || rate <= 0) continue;
      ratesToAed[currency] = eurToAed / rate;
    }

    ratesToAed.USD = USD_TO_AED;
    ratesToAed.USDT = USD_TO_AED;
    ratesToAed.AED = 1;

    return this.buildSnapshot(ratesToAed, referenceDate);
  }

  async getRates(forceRefresh = false): Promise<FxSnapshot> {
    const now = Date.now();
    if (!forceRefresh && this.cache && now - this.cacheFetchedAt < CACHE_TTL_MS) {
      return this.cache;
    }

    try {
      const snapshot = await this.fetchEcbRates();
      this.cache = snapshot;
      this.cacheFetchedAt = now;
      return snapshot;
    } catch (error: any) {
      this.logger.warn(`Using fallback FX rates: ${error?.message || error}`);
      if (this.cache) return this.cache;
      const snapshot = this.buildSnapshot(this.fallbackRates(), null);
      this.cache = snapshot;
      this.cacheFetchedAt = now;
      return snapshot;
    }
  }

  async rateToAed(currency?: string | null): Promise<number> {
    const code = String(currency || 'AED').trim().toUpperCase();
    if (code === 'AED') return 1;
    if (code === 'USD' || code === 'USDT') return USD_TO_AED;
    const snapshot = await this.getRates();
    return snapshot.rates_to_aed[code] || 1;
  }

  async convertToAed(amount: string | number, currency?: string | null): Promise<number> {
    const numericAmount = typeof amount === 'number' ? amount : parseFloat(String(amount || '0'));
    if (!Number.isFinite(numericAmount)) return 0;
    const rate = await this.rateToAed(currency);
    return numericAmount * rate;
  }
}
