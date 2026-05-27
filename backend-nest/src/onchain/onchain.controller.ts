import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@UseGuards(AuthGuard('jwt'))
@Controller('onchain')
export class OnchainController {
  // Verify a transaction on the relevant public blockchain.
  // network: tron (TRC20 USDT), btc, eth (ETH + ERC20)
  @Get('verify/:network/:hash')
  async verify(@Param('network') network: string, @Param('hash') hash: string) {
    network = network.toLowerCase();
    if (!hash) throw new BadRequestException('Missing hash');
    if (network === 'tron' || network === 'trc20') return this.verifyTron(hash);
    if (network === 'btc')                          return this.verifyBtc(hash);
    if (network === 'eth' || network === 'erc20')   return this.verifyEth(hash);
    throw new BadRequestException(`Unsupported network: ${network}`);
  }

  private async fetchJson(url: string) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'AxistraPortal/1.0' }, signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      try { return JSON.parse(text); } catch { return { raw: text }; }
    } catch (e: any) {
      return { error: e.message };
    }
  }

  private async verifyTron(hash: string) {
    const data = await this.fetchJson(`https://apilist.tronscanapi.com/api/transaction-info?hash=${hash}`);
    if (data?.error) return { ok: false, network: 'tron', hash, error: data.error };
    const transfers = data.trc20TransferInfo || [];
    const primary = transfers[0];
    return {
      ok: !!data?.hash,
      network: 'tron',
      hash,
      confirmed: data?.confirmed || false,
      confirmations: data?.confirmations || 0,
      block: data?.block,
      timestamp: data?.timestamp,
      from: primary?.from_address || data?.ownerAddress,
      to: primary?.to_address || data?.toAddress,
      amount: primary?.amount_str ? (parseFloat(primary.amount_str) / Math.pow(10, primary.decimals || 6)).toString() : null,
      token: primary?.symbol || (transfers.length ? 'TRC20' : 'TRX'),
      contract: primary?.contract_address,
      raw_url: `https://tronscan.org/#/transaction/${hash}`,
      raw: data,
    };
  }

  private async verifyBtc(hash: string) {
    const tx = await this.fetchJson(`https://blockstream.info/api/tx/${hash}`);
    if (tx?.error || !tx?.txid) return { ok: false, network: 'btc', hash, error: tx?.error || 'Not found' };
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
      raw: tx,
    };
  }

  private async verifyEth(hash: string) {
    const key = process.env.ETHERSCAN_API_KEY || 'YourApiKeyToken'; // free tier without key has very low rate-limit
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
      raw: result,
    };
  }
}
