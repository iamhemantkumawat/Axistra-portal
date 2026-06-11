import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentWebhook } from '../entities/payment-webhook.entity';
import { RechargesService } from '../recharges/recharges.service';

type Source = 'btcpay' | 'oxapay' | 'telegram_manual' | 'manual';

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(PaymentWebhook) private repo: Repository<PaymentWebhook>,
    private recharges: RechargesService,
  ) {}

  async ingest(source: Source, payload: any) {
    const normalized = this.normalize(source, payload);
    const externalId = normalized.external_event_id || normalized.gateway_invoice_id || normalized.tx_hash;
    const webhook = await this.repo.save(this.repo.create({
      source,
      external_event_id: externalId,
      gateway_invoice_id: normalized.gateway_invoice_id,
      tx_hash: normalized.tx_hash,
      raw_payload: JSON.stringify(payload),
    }));

    try {
      if (!normalized.amount && !normalized.should_ignore) {
        webhook.error_message = 'Payment amount is required';
        await this.repo.save(webhook);
        throw new BadRequestException(webhook.error_message);
      }

      const prior = externalId
        ? await this.repo.findOne({
          where: { source, external_event_id: externalId, processed: true },
          order: { created_at: 'DESC' },
        })
        : null;
      if (prior && prior.id !== webhook.id) {
        webhook.processed = true;
        webhook.recharge_id = prior.recharge_id;
        webhook.error_message = `Duplicate delivery. Original webhook: ${prior.id}`;
        await this.repo.save(webhook);
        if (source === 'oxapay' && prior.recharge_id && normalized.paid) {
          this.scheduleOxaPayEnrichment(prior.recharge_id, normalized);
        }
        return { ok: true, duplicate: true, webhook_id: webhook.id, original_webhook_id: prior.id, recharge_id: prior.recharge_id };
      }

      if (normalized.should_ignore) {
        if (
          source === 'btcpay'
          && String(normalized.event_type || '').toLowerCase() === 'invoicecreated'
          && normalized.magnus_username
        ) {
          await this.recharges.ensureCustomerFromGatewayPayment(normalized, {
            email: `${source}-webhook@axistra.local`,
          });
        }
        webhook.processed = true;
        await this.repo.save(webhook);
        return {
          ok: true,
          source,
          webhook_id: webhook.id,
          ignored: true,
          event_type: normalized.event_type,
          reason: normalized.ignore_reason || 'No customer payment data on this event',
        };
      }

      const existingInvoiceWebhook = normalized.gateway_invoice_id
        ? await this.repo.findOne({
          where: { source, gateway_invoice_id: normalized.gateway_invoice_id, processed: true },
          order: { created_at: 'DESC' },
        })
        : null;

      const result = existingInvoiceWebhook?.recharge_id
        ? await this.recharges.applyGatewayPayment(existingInvoiceWebhook.recharge_id, normalized, {
          email: `${source}-webhook@axistra.local`,
        })
        : await this.recharges.createFromGatewayPayment(normalized, {
        email: `${source}-webhook@axistra.local`,
      });
      webhook.recharge_id = result.id;
      webhook.processed = true;
      await this.repo.save(webhook);
      if (source === 'oxapay' && normalized.paid) {
        this.scheduleOxaPayEnrichment(result.id, normalized);
      }
      return {
        ok: true,
        source,
        webhook_id: webhook.id,
        customer_id: result.customer_id,
        recharge_id: result.id,
        invoice_number: result.invoice_number,
        status: result.status,
      };
    } catch (e: any) {
      webhook.error_message = e.message;
      await this.repo.save(webhook);
      throw e;
    }
  }

  async listLogs(options: { source?: string; processed?: string; q?: string; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(options.limit || 100, 1), 500);
    const offset = Math.max(options.offset || 0, 0);
    const qb = this.repo.createQueryBuilder('w').orderBy('w.created_at', 'DESC').take(limit).skip(offset);

    if (options.source && options.source !== 'all') {
      qb.andWhere('w.source = :source', { source: options.source });
    }
    if (options.processed === 'true' || options.processed === 'false') {
      qb.andWhere('w.processed = :processed', { processed: options.processed === 'true' });
    }
    if (options.q) {
      qb.andWhere(
        '(w.external_event_id ILIKE :q OR w.gateway_invoice_id ILIKE :q OR w.tx_hash ILIKE :q OR w.recharge_id ILIKE :q OR w.raw_payload ILIKE :q)',
        { q: `%${options.q}%` },
      );
    }

    const [rows, total] = await qb.getManyAndCount();
    return {
      rows: rows.map((row) => this.serializeWebhook(row, false)),
      total,
      limit,
      offset,
    };
  }

  async stats() {
    const raw = await this.repo
      .createQueryBuilder('w')
      .select('w.source', 'source')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(CASE WHEN w.processed = true THEN 1 ELSE 0 END)', 'processed')
      .addSelect('SUM(CASE WHEN w.error_message IS NOT NULL THEN 1 ELSE 0 END)', 'errors')
      .groupBy('w.source')
      .orderBy('w.source', 'ASC')
      .getRawMany();

    const total = raw.reduce((sum, row) => sum + Number(row.count || 0), 0);
    return {
      total,
      by_source: raw.map((row) => ({
        source: row.source,
        count: Number(row.count || 0),
        processed: Number(row.processed || 0),
        errors: Number(row.errors || 0),
      })),
    };
  }

  async getLog(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Webhook log not found');
    return this.serializeWebhook(row, true);
  }

  private scheduleOxaPayEnrichment(rechargeId: string, normalized: any) {
    const delay = Number(process.env.OXAPAY_HISTORY_DELAY_MS || 300000);
    const safeDelay = Number.isFinite(delay) && delay >= 0 ? delay : 300000;
    setTimeout(() => {
      this.enrichOxaPayPayment(rechargeId, normalized).catch((e) => {
        // Delayed history fetch should never break webhook delivery.
        console.error(`OxaPay history enrichment failed for ${normalized.gateway_track_id || normalized.gateway_invoice_id}: ${e.message}`);
      });
    }, safeDelay).unref?.();
  }

  private async enrichOxaPayPayment(rechargeId: string, normalized: any) {
    const trackId = this.first(normalized.gateway_track_id, normalized.gateway_invoice_id);
    if (!trackId) return;
    const merchantKey = this.oxaPayMerchantKey(normalized);
    if (!merchantKey) return;

    const historyItem = await this.fetchOxaPayHistory(trackId, merchantKey);
    if (!historyItem) return;
    const historyPayload = {
      ...historyItem,
      description: historyItem.description || normalized.description,
      amount: historyItem.amount || normalized.amount,
      currency: historyItem.currency || normalized.currency,
      order_id: historyItem.order_id || normalized.gateway_order_id || normalized.gateway_invoice_id,
      track_id: historyItem.track_id || trackId,
      module_name: historyItem.module_name || normalized.module_name,
      email: historyItem.email || normalized.email,
    };
    const enriched = this.normalize('oxapay', historyPayload);
    await this.recharges.applyGatewayPayment(rechargeId, {
      ...normalized,
      ...enriched,
      gateway_invoice_id: normalized.gateway_invoice_id || enriched.gateway_invoice_id,
      gateway_track_id: normalized.gateway_track_id || enriched.gateway_track_id,
      admin_notes: [
        normalized.admin_notes,
        `OxaPay history synced by track_id ${trackId}`,
      ].filter(Boolean).join('\n'),
    }, { email: 'oxapay-history@axistra.local' });
  }

  private oxaPayMerchantKey(normalized: any) {
    const moduleName = String(normalized.module_name || '').toLowerCase();
    if (moduleName.includes('bot')) {
      return process.env.OXAPAY_CALLS_BOT_MERCHANT_KEY || process.env.OXAPAY_MERCHANT_KEY;
    }
    return process.env.OXAPAY_PORTAL_MERCHANT_KEY || process.env.OXAPAY_MERCHANT_KEY || process.env.OXAPAY_CALLS_BOT_MERCHANT_KEY;
  }

  private async fetchOxaPayHistory(trackId: string, merchantKey: string) {
    const base = (process.env.OXAPAY_API_BASE || 'https://api.oxapay.com/v1').replace(/\/$/, '');
    const url = new URL(`${base}/payment`);
    url.searchParams.set('track_id', String(trackId));
    const res = await fetch(url.toString(), {
      headers: { merchant_api_key: merchantKey },
    });
    if (!res.ok) throw new BadRequestException(`OxaPay history lookup failed: ${res.status}`);
    const body: any = await res.json();
    const rows = body?.data?.list || body?.data?.rows || body?.data || body?.list || body?.rows;
    if (Array.isArray(rows)) return rows[0];
    if (rows && typeof rows === 'object') return rows;
    return null;
  }

  private serializeWebhook(row: PaymentWebhook, includePayload: boolean) {
    const base: any = {
      id: row.id,
      source: row.source,
      external_event_id: row.external_event_id,
      gateway_invoice_id: row.gateway_invoice_id,
      tx_hash: row.tx_hash,
      recharge_id: row.recharge_id,
      processed: row.processed,
      error_message: row.error_message,
      created_at: row.created_at,
      raw_payload_size: row.raw_payload?.length || 0,
    };
    if (includePayload) {
      base.raw_payload = row.raw_payload;
      base.payload = this.safeJson(row.raw_payload);
    }
    return base;
  }

  private safeJson(value?: string) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private normalize(source: Source, p: any) {
    const meta = p.metadata || p.meta || p.order || {};
    const customer = p.customer || p.buyer || {};
    const oxapayTxs = source === 'oxapay' ? this.normalizeOxaPayTxs(p) : [];
    const oxapayTx = oxapayTxs[0] || null;
    const btcpayTxs = source === 'btcpay' ? this.normalizeBtcPayTxs(p) : [];
    const btcpayTx = btcpayTxs[0] || null;
    const oxapayDescription = source === 'oxapay' ? this.parseOxaPayDescription(p.description) : null;
    const eventType = String(this.first(p.type, p.event, p.name, p.kind, '') || '');
    const status = String(this.first(p.status, p.payment?.status, eventType, p.invoiceStatus, p.paymentStatus, '') || '');
    const amount = this.first(
      p.amount,
      p.price,
      p.fiat_amount,
      p.invoiceAmount,
      p.amountFiat,
      meta.amount,
      meta.price,
      meta.fiat_amount,
      meta.originalAmount,
      oxapayDescription?.amount,
    );
    const cryptoAmount = this.first(
      p.crypto_amount,
      p.cryptoAmount,
      p.amountCrypto,
      p.paymentAmount,
      p.payAmount,
      p.receivedAmount,
      p.btcPaid,
      p.coin_amount,
      p.payment?.value,
      btcpayTx?.received_amount,
      oxapayTx?.final_usdt_amount,
      oxapayTx?.auto_convert_amount,
      oxapayTx?.received_amount,
      oxapayTx?.sent_amount,
      oxapayTx?.value,
      p.value,
      p.sent_value,
    );
    const txHash = this.firstTxHash(p);
    const gatewayInvoiceId = this.first(p.invoice_id, p.invoiceId, p.id, p.order_id, p.orderId, p.track_id, p.trackId, p.uuid);
    const eventIdBase = this.first(
      p.event_id,
      p.eventId,
      p.deliveryId,
      p.originalDeliveryId,
      p.webhook_id,
      p.webhookId,
      p.payment?.id && eventType ? `${eventType}:${gatewayInvoiceId || 'invoice'}:${p.payment.id}` : null,
      eventType && gatewayInvoiceId ? `${eventType}:${gatewayInvoiceId}` : null,
    );
    const oxapayTxFingerprint = oxapayTxs
      .map((tx) => tx.tx_hash || `${tx.currency || 'coin'}:${tx.received_amount || tx.sent_amount || tx.value || ''}:${tx.date || ''}`)
      .filter(Boolean)
      .join(',');
    const paymentGatewayRaw = String(this.first(p.payment_gateway, p.gateway, '') || '');
    // Split payment detection: a single on-chain TX shared across N
    // Magnus accounts arrives as N separate Telegram webhooks with the
    // SAME tx_hash but DIFFERENT magnus_username. Without disambiguation
    // we'd dedupe the 2nd, 3rd, … halves and silently drop them. Adding
    // the magnus_username to the event_id makes each share unique while
    // still deduping true retransmits (same tx + same username).
    const isTelegramSplit = source === 'telegram_manual'
      && /^BTC\s*Split/i.test(paymentGatewayRaw);
    const splitMagnusUser = String(this.first(
      p.magnus_username, p.magnusUser, p.username, p.user, p.login,
      meta.magnus_username, meta.username, meta.sipUsername,
    ) || '').trim().toLowerCase();
    const eventId = source === 'oxapay' && gatewayInvoiceId
      ? `${gatewayInvoiceId}:${status || eventType || 'event'}:${oxapayTxFingerprint || txHash || this.first(p.track_id, p.trackId, p.date, oxapayTx?.date, Date.now())}`
      : source === 'btcpay' && gatewayInvoiceId
        ? `${gatewayInvoiceId}:${eventType || status || 'event'}:${btcpayTx?.tx_hash || btcpayTx?.payment_id || p.deliveryId || p.originalDeliveryId || p.timestamp || Date.now()}`
      : isTelegramSplit && txHash && splitMagnusUser
        ? `split:${txHash}:${splitMagnusUser}`
      : eventIdBase;
    const paid = this.isPaid(source, p);
    const shouldIgnore = this.shouldIgnoreEvent(source, p, { eventType, txHash, cryptoAmount, amount });
    const description = this.first(p.description, p.desc, p.note, p.notes, meta.description, meta.note);
    const walletTag = this.first(p.wallet_tag, p.walletTag, meta.wallet_tag, meta.walletTag);
    const exchangeGateway = this.exchangeGatewayFromWalletTag(walletTag);
    const gatewayName = source === 'btcpay'
      ? 'BTCPay'
      : source === 'oxapay'
        ? 'OxaPay'
        : source === 'telegram_manual'
        ? exchangeGateway || 'Binance'
        : this.first(p.payment_gateway, p.gateway, 'Binance');

    return {
      external_event_id: eventId || gatewayInvoiceId || txHash,
      event_type: eventType || status || undefined,
      gateway_invoice_id: gatewayInvoiceId,
      gateway_order_id: this.first(p.order_id, p.orderId),
      payment_gateway: gatewayName,
      customer_id: this.first(p.customer_id, meta.customer_id),
      magnus_username: this.first(
        p.magnus_username,
        p.magnusUser,
        p.username,
        p.user,
        p.login,
        meta.magnus_username,
        meta.username,
        meta.sipUsername,
        oxapayDescription?.username,
        customer.username,
      ),
      full_name: this.first(p.full_name, p.name, meta.full_name, customer.name),
      first_name: this.first(p.first_name, meta.first_name, customer.firstName),
      last_name: this.first(p.last_name, meta.last_name, customer.lastName),
      company_name: this.first(p.company_name, meta.company_name),
      email: this.first(p.email, meta.email, customer.email, p.buyerEmail),
      phone: this.first(p.phone, meta.phone),
      telegram: this.first(p.telegram, meta.telegram, p.telegram_username),
      country: this.first(p.country, meta.country),
      ip_address: this.first(p.ip, p.ip_address, p.buyerIp),
      amount: String(amount || ''),
      currency: String(this.first(
        p.currency,
        p.fiat_currency,
        p.priceCurrency,
        p.currencyCode,
        meta.currency,
        meta.fiat_currency,
        meta.originalCurrency,
        oxapayDescription?.currency,
        'USD',
      )).toUpperCase(),
      crypto_amount: cryptoAmount ? String(cryptoAmount) : undefined,
      crypto_coin: this.first(
        p.crypto_coin,
        p.coin,
        p.asset,
        p.payCurrency,
        p.currencyPaid,
        oxapayTx?.final_usdt_amount ? 'USDT' : undefined,
        oxapayTx?.auto_convert_currency,
        oxapayTx?.currency,
        btcpayTx?.currency,
        source === 'btcpay' ? 'BTC' : undefined,
      ),
      crypto_network: this.first(
        p.crypto_network,
        p.network,
        p.chain,
        p.blockchain,
        this.normalizeNetworkName(oxapayTx?.network),
        btcpayTx?.network,
        source === 'btcpay' ? 'BTC' : undefined,
      ),
      wallet_address: this.first(p.wallet_address, p.address, p.paymentAddress, p.destinationAddress, p.payment?.destination, oxapayTx?.address, btcpayTx?.address),
      wallet_tag: walletTag,
      receiving_wallet: this.first(p.receiving_wallet, p.wallet_address, p.address, p.paymentAddress, p.destinationAddress, p.payment?.destination, oxapayTx?.address, btcpayTx?.address),
      tx_hash: paid ? txHash : undefined,
      gateway_track_id: this.first(p.track_id, p.trackId),
      module_name: this.first(p.module_name, p.moduleName),
      gateway_transactions: source === 'btcpay' ? btcpayTxs : oxapayTxs,
      payment_date: this.toDate(this.first(p.paid_at, p.paidAt, p.payDate, p.date, p.timestamp, p.payment?.receivedDate, oxapayTx?.date, btcpayTx?.date)) || new Date(),
      aed_rate_at_payment: this.first(p.aed_rate_at_payment, p.aed_rate, meta.aed_rate_at_payment, meta.aed_rate),
      aed_value: this.first(p.aed_value, meta.aed_value),
      magnus_credit_added: this.first(p.magnus_credit_added, p.credit_added, p.credit, meta.magnus_credit_added, paid ? amount : undefined),
      magnus_reference_id: this.first(p.magnus_reference_id, meta.magnus_reference_id),
      description,
      paid,
      should_ignore: shouldIgnore,
      ignore_reason: shouldIgnore ? `Ignored ${eventType || 'event'} without usable payment movement` : undefined,
      admin_notes: [
        `${source} webhook invoice ${gatewayInvoiceId || 'unknown'}${paid ? '' : ' (not marked paid)'}`,
        source === 'oxapay' && oxapayTxs.length ? `OxaPay TX count: ${oxapayTxs.length}` : null,
        source === 'btcpay' && btcpayTxs.length ? `BTCPay BTC TX count: ${btcpayTxs.length}` : null,
        p.afterExpiration === true ? 'BTCPay payment received after expiration' : null,
        description ? `Description: ${description}` : null,
      ].filter(Boolean).join('\n'),
    };
  }

  private isPaid(source: Source, p: any) {
    const status = String(this.first(p.status, p.payment?.status, p.type, p.event, p.invoiceStatus, p.paymentStatus, '')).toLowerCase();
    if (source === 'telegram_manual' || source === 'manual') return true;
    if (source === 'btcpay') {
      const event = String(this.first(p.type, p.event, '')).toLowerCase();
      const hasPayment = Boolean(p.payment?.id && p.payment?.value);
      return ['settled', 'invoicepaymentsettled', 'invoicesettled'].includes(status)
        || (['invoicereceivedpayment', 'invoiceprocessing'].includes(event) && hasPayment);
    }
    return ['paid', 'settled', 'confirmed', 'complete', 'completed', 'invoicepaymentsettled', 'invoicepaymentreceived'].includes(status)
      || p.paid === true
      || p.confirmed === true;
  }

  private shouldIgnoreEvent(source: Source, payload: any, state: { eventType: string; txHash: any; cryptoAmount: any; amount: any }) {
    if (source !== 'btcpay') return false;
    const event = String(state.eventType || '').toLowerCase();
    const hasPaymentMovement = Boolean(payload.payment || state.txHash || state.cryptoAmount);
    if (hasPaymentMovement) return false;
    return [
      'invoicecreated',
      'invoiceinvalid',
      'invoiceexpired',
      'invoiceexpiredpaidpartial',
      'invoiceexpiredpaidlate',
    ].includes(event);
  }

  private first(...values: any[]) {
    return values.find((v) => v !== undefined && v !== null && v !== '');
  }

  private firstTxHash(p: any) {
    const txids = this.first(p.txs, p.txids, p.tx_ids, p.transaction_ids, p.transactions, p.payment?.txids, p.payment?.transactions);
    const fromList = Array.isArray(txids)
      ? txids.map((item) => this.first(item?.tx_hash, item?.txHash, item?.txid, item?.hash, item)).find(Boolean)
      : typeof txids === 'string'
        ? txids.split(/[,\s]+/).find(Boolean)
        : undefined;
    return this.first(
      p.tx_hash,
      p.txID,
      p.txHash,
      p.txid,
      p.transactionHash,
      p.hash,
      p.payment?.txid,
      p.payment?.txHash,
      this.cleanBtcPayPaymentId(p.payment?.id),
      fromList,
    );
  }

  private cleanBtcPayPaymentId(value: any) {
    const text = String(value || '').trim();
    if (!text) return undefined;
    const match = text.match(/^([a-fA-F0-9]{64})(?:-\d+)?$/);
    return match ? match[1] : text;
  }

  private positive(value: any) {
    const n = parseFloat(String(value || '0'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  private resolveOxaPayFinalUsdt(tx: any) {
    const autoCurrency = String(this.first(tx?.auto_convert_currency, tx?.auto_convert?.currency)).toUpperCase();
    const txCurrency = String(tx?.currency || '').toUpperCase();
    const autoAmount = this.positive(this.first(tx?.auto_convert_amount, tx?.auto_convert?.amount));
    if (autoCurrency === 'USDT' && autoAmount > 0) return autoAmount.toFixed(8);
    if (txCurrency === 'USDT') {
      const received = this.positive(this.first(tx?.received_amount, tx?.receivedAmount, tx?.amount));
      if (received > 0) return received.toFixed(8);
      const value = this.positive(this.first(tx?.value, tx?.sent_value, tx?.sentValue));
      if (value > 0) return value.toFixed(8);
    }
    return autoAmount > 0 ? autoAmount.toFixed(8) : undefined;
  }

  private normalizeOxaPayTxs(payload: any) {
    const txs = Array.isArray(payload?.txs) ? payload.txs : [];
    return txs
      .map((tx) => ({
        status: tx?.status,
        tx_hash: this.first(tx?.tx_hash, tx?.txHash, tx?.txid, tx?.hash),
        sent_amount: this.first(tx?.sent_amount, tx?.sentAmount, tx?.amount),
        sent_value: this.first(tx?.sent_value, tx?.sentValue, tx?.value),
        received_amount: this.first(tx?.received_amount, tx?.receivedAmount, tx?.amount),
        value: this.first(tx?.value, tx?.amount),
        currency: tx?.currency,
        network: this.normalizeNetworkName(tx?.network),
        raw_network: tx?.network,
        sender_address: this.first(tx?.sender_address, tx?.senderAddress),
        address: tx?.address,
        memo: tx?.memo,
        rate: tx?.rate,
        confirmations: tx?.confirmations,
        auto_convert_amount: this.first(tx?.auto_convert_amount, tx?.auto_convert?.amount),
        auto_convert_currency: this.first(tx?.auto_convert_currency, tx?.auto_convert?.currency),
        final_usdt_amount: this.resolveOxaPayFinalUsdt(tx),
        date: tx?.date,
        raw: tx,
      }))
      .filter((tx) => tx.tx_hash || tx.final_usdt_amount || tx.received_amount || tx.sent_amount);
  }

  private normalizeBtcPayTxs(payload: any) {
    const payment = payload?.payment;
    if (!payment) return [];
    const txHash = this.cleanBtcPayPaymentId(this.first(payment.txid, payment.txHash, payment.id));
    return [{
      status: payment.status || payload.type,
      tx_hash: txHash,
      payment_id: payment.id,
      sent_amount: payment.value,
      received_amount: payment.value,
      value: payment.value,
      currency: 'BTC',
      network: 'BTC',
      address: payment.destination,
      fee: payment.fee,
      confirmations: payment.confirmations,
      date: payment.receivedDate || payload.timestamp,
      raw: {
        payment,
        afterExpiration: payload.afterExpiration,
        eventType: payload.type,
        invoiceId: payload.invoiceId,
        storeId: payload.storeId,
        metadata: payload.metadata,
      },
    }].filter((tx) => tx.tx_hash || tx.received_amount);
  }

  private toDate(value: any) {
    if (!value) return undefined;
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value < 10000000000 ? value * 1000 : value);
    if (/^\d+$/.test(String(value))) {
      const n = Number(value);
      return new Date(n < 10000000000 ? n * 1000 : n);
    }
    return value;
  }

  private pickOxaPayTx(payload: any) {
    const txs = this.normalizeOxaPayTxs(payload);
    return txs.find((tx) => String(tx?.status || '').toLowerCase() === 'confirmed')
      || txs[0]
      || null;
  }

  private parseOxaPayDescription(description: any) {
    const text = String(description || '').trim();
    if (!text) return null;

    const parts = text.split('|').map((part) => part.trim());
    if (parts.length >= 4 && parts[0].toLowerCase() === 'oxapay') {
      return {
        username: parts[1] || undefined,
        currency: parts[2] || undefined,
        amount: parts[3] || undefined,
      };
    }

    const portalMatch = text.match(/^Deposit for\s+(.+?)\s+\|\s+Tracking ID:\s+(.+)$/i);
    if (portalMatch) {
      return {
        username: portalMatch[1]?.trim() || undefined,
        trackingId: portalMatch[2]?.trim() || undefined,
      };
    }

    return null;
  }

  private normalizeNetworkName(value: any) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return undefined;
    if (text.includes('ethereum')) return 'ERC20';
    if (text.includes('tron')) return 'TRC20';
    if (text.includes('bsc') || text.includes('binance smart chain') || text.includes('binance')) return 'BEP20';
    if (text.includes('polygon')) return 'Polygon';
    if (text.includes('bitcoin')) return 'BTC';
    return String(value).trim();
  }

  private exchangeGatewayFromWalletTag(value: any) {
    const text = String(value || '').trim().toLowerCase();
    if (text.includes('binance')) return 'Binance';
    if (text.includes('okx')) return 'OKX';
    return undefined;
  }
}
