import { Injectable, Logger } from '@nestjs/common';

export type OnchainResult = {
  ok: boolean;
  network: string;
  hash: string;
  confirmed?: boolean;
  confirmations?: number;
  block?: any;
  timestamp?: any;
  from?: string;
  to?: string;
  amount?: string;
  token?: string;
  contract?: string;
  raw_url?: string;
  error?: string;
};

/**
 * Lightweight, dependency-free on-chain verifier.
 * Networks: tron / trc20, btc, eth / erc20.
 * Returns `{ ok:false, error }` on failure (never throws) so callers can use
 * it in a fire-and-forget manner without breaking the main flow.
 */
@Injectable()
export class OnchainService {
  private logger = new Logger('Onchain');

  static OFF_CHAIN_NETWORKS = ['OFF_CHAIN', 'OFFCHAIN', 'INTERNAL', 'BINANCE_PAY', 'BINANCEPAY'];

  static isOffChain(network?: string) {
    if (!network) return false;
    return OnchainService.OFF_CHAIN_NETWORKS.includes(network.toUpperCase().replace(/[-_\s]/g, ''));
  }

  async verify(network: string, hash: string): Promise<OnchainResult> {
    if (!hash) return { ok: false, network, hash, error: 'Missing hash' };
    const n = (network || '').toLowerCase();
    try {
      if (OnchainService.isOffChain(network)) return { ok: true, network, hash, confirmed: true, token: 'OFF_CHAIN' };
      if (n === 'tron' || n === 'trc20') return await this.verifyTron(hash);
      if (n === 'btc') return await this.verifyBtc(hash);
      if (n === 'eth' || n === 'erc20') return await this.verifyEth(hash);
      return { ok: false, network, hash, error: `Unsupported network: ${network}` };
    } catch (e: any) {
      this.logger.warn(`Onchain verify failed for ${network}/${hash}: ${e?.message || e}`);
      return { ok: false, network, hash, error: e?.message || String(e) };
    }
  }

  private async fetchJson(url: string) {
    const r = await fetch(url, { headers: { 'User-Agent': 'AxistraPortal/1.0' }, signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  private async verifyTron(hash: string): Promise<OnchainResult> {
    const data = await this.fetchJson(`https://apilist.tronscanapi.com/api/transaction-info?hash=${hash}`);
    if (!data?.hash) return { ok: false, network: 'tron', hash, error: data?.error || 'Not found' };
    const transfers = data.trc20TransferInfo || [];
    const primary = transfers[0];
    return {
      ok: true, network: 'tron', hash,
      confirmed: !!data?.confirmed,
      confirmations: data?.confirmations || 0,
      block: data?.block,
      timestamp: data?.timestamp,
      from: primary?.from_address || data?.ownerAddress,
      to: primary?.to_address || data?.toAddress,
      amount: primary?.amount_str ? (parseFloat(primary.amount_str) / Math.pow(10, primary.decimals || 6)).toString() : null,
      token: primary?.symbol || (transfers.length ? 'TRC20' : 'TRX'),
      contract: primary?.contract_address,
      raw_url: `https://tronscan.org/#/transaction/${hash}`,
    };
  }

  private async verifyBtc(hash: string): Promise<OnchainResult> {
    const tx = await this.fetchJson(`https://blockstream.info/api/tx/${hash}`);
    if (!tx?.txid) return { ok: false, network: 'btc', hash, error: tx?.error || 'Not found' };
    const totalOut = (tx.vout || []).reduce((s: number, o: any) => s + (o.value || 0), 0) / 1e8;
    return {
      ok: true, network: 'btc', hash,
      confirmed: !!tx?.status?.confirmed,
      confirmations: tx?.status?.block_height ? 1 : 0,
      block: tx?.status?.block_height,
      timestamp: tx?.status?.block_time,
      from: tx.vin?.[0]?.prevout?.scriptpubkey_address,
      to: tx.vout?.[0]?.scriptpubkey_address,
      amount: totalOut.toString(),
      token: 'BTC',
      raw_url: `https://mempool.space/tx/${hash}`,
    };
  }

  private async verifyEth(hash: string): Promise<OnchainResult> {
    const key = process.env.ETHERSCAN_API_KEY || 'YourApiKeyToken';
    const tx = await this.fetchJson(`https://api.etherscan.io/api?module=proxy&action=eth_getTransactionByHash&txhash=${hash}&apikey=${key}`);
    const result = tx?.result;
    if (!result) return { ok: false, network: 'eth', hash, error: 'Not found' };
    const value = result.value ? (parseInt(result.value, 16) / 1e18).toString() : '0';
    return {
      ok: true, network: 'eth', hash,
      confirmed: !!result.blockNumber,
      block: result.blockNumber ? parseInt(result.blockNumber, 16) : null,
      from: result.from,
      to: result.to,
      amount: value,
      token: 'ETH',
      raw_url: `https://etherscan.io/tx/${hash}`,
    };
  }
}
