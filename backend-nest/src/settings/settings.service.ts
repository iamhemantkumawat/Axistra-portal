import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReceivingWallet } from '../entities/receiving-wallet.entity';
import { Vendor } from '../entities/vendor.entity';
import { AuditService } from '../audit/audit.service';

export const GATEWAYS = ['Binance', 'OKX', 'OxaPay', 'BTCPay'] as const;
export type GatewayCode = (typeof GATEWAYS)[number];

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(ReceivingWallet) private wallets: Repository<ReceivingWallet>,
    @InjectRepository(Vendor) private vendors: Repository<Vendor>,
    private audit: AuditService,
  ) {}

  // ---------- Receiving Wallets ----------
  listWallets() {
    return this.wallets.find({ order: { gateway: 'ASC', coin: 'ASC', network: 'ASC' } });
  }

  async findWalletByAddress(address?: string): Promise<ReceivingWallet | null> {
    if (!address?.trim()) return null;
    return this.wallets
      .createQueryBuilder('w')
      .where('LOWER(w.address) = LOWER(:a)', { a: address.trim() })
      .andWhere('w.is_active = true')
      .getOne();
  }

  async createWallet(body: any, actor?: any) {
    const gateway = (body.gateway || '').trim();
    if (!GATEWAYS.includes(gateway as GatewayCode)) throw new BadRequestException('Invalid gateway. Allowed: Binance, OKX, OxaPay, BTCPay');
    if (!body.coin?.trim()) throw new BadRequestException('Coin is required');
    if (!body.network?.trim()) throw new BadRequestException('Network is required');
    if (!body.address?.trim()) throw new BadRequestException('Address is required');
    const dupe = await this.wallets.findOne({ where: { gateway, coin: body.coin.trim().toUpperCase(), network: body.network.trim().toUpperCase(), address: body.address.trim() } });
    if (dupe) throw new BadRequestException('This wallet address is already saved for the same gateway/coin/network');
    const saved = await this.wallets.save(this.wallets.create({
      gateway,
      coin: body.coin.trim().toUpperCase(),
      network: body.network.trim().toUpperCase(),
      address: body.address.trim(),
      label: body.label?.trim() || null,
      notes: body.notes?.trim() || null,
      is_active: body.is_active !== false,
    }));
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'create_receiving_wallet', entity_type: 'receiving_wallet', entity_id: saved.id,
      details: `${saved.gateway} ${saved.coin}/${saved.network} ${saved.address}`,
    });
    return saved;
  }

  async updateWallet(id: string, body: any, actor?: any) {
    const w = await this.wallets.findOne({ where: { id } });
    if (!w) throw new NotFoundException();
    if (body.gateway !== undefined) {
      if (!GATEWAYS.includes(body.gateway)) throw new BadRequestException('Invalid gateway');
      w.gateway = body.gateway;
    }
    if (body.coin !== undefined) w.coin = String(body.coin).trim().toUpperCase();
    if (body.network !== undefined) w.network = String(body.network).trim().toUpperCase();
    if (body.address !== undefined) w.address = String(body.address).trim();
    if (body.label !== undefined) w.label = body.label?.trim() || null;
    if (body.notes !== undefined) w.notes = body.notes?.trim() || null;
    if (body.is_active !== undefined) w.is_active = !!body.is_active;
    const saved = await this.wallets.save(w);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_receiving_wallet', entity_type: 'receiving_wallet', entity_id: id,
    });
    return saved;
  }

  async deleteWallet(id: string, actor?: any) {
    const w = await this.wallets.findOne({ where: { id } });
    if (!w) throw new NotFoundException();
    await this.wallets.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'delete_receiving_wallet', entity_type: 'receiving_wallet', entity_id: id,
      details: `${w.gateway} ${w.coin}/${w.network} ${w.address}`,
    });
    return { success: true };
  }

  // ---------- Vendors ----------
  listVendors() {
    return this.vendors.find({ order: { name: 'ASC' } });
  }

  async createVendor(body: any, actor?: any) {
    if (!body.name?.trim()) throw new BadRequestException('Vendor name is required');
    const saved = await this.vendors.save(this.vendors.create({
      name: body.name.trim(),
      type: body.type?.trim() || null,
      contact: body.contact?.trim() || null,
      default_wallet: body.default_wallet?.trim() || null,
      default_payment_method: body.default_payment_method?.trim() || null,
      notes: body.notes?.trim() || null,
      is_active: body.is_active !== false,
    }));
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'create_vendor', entity_type: 'vendor', entity_id: saved.id,
      details: saved.name,
    });
    return saved;
  }

  async updateVendor(id: string, body: any, actor?: any) {
    const v = await this.vendors.findOne({ where: { id } });
    if (!v) throw new NotFoundException();
    if (body.name !== undefined) v.name = String(body.name).trim();
    if (body.type !== undefined) v.type = body.type?.trim() || null;
    if (body.contact !== undefined) v.contact = body.contact?.trim() || null;
    if (body.default_wallet !== undefined) v.default_wallet = body.default_wallet?.trim() || null;
    if (body.default_payment_method !== undefined) v.default_payment_method = body.default_payment_method?.trim() || null;
    if (body.notes !== undefined) v.notes = body.notes?.trim() || null;
    if (body.is_active !== undefined) v.is_active = !!body.is_active;
    const saved = await this.vendors.save(v);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'update_vendor', entity_type: 'vendor', entity_id: id,
    });
    return saved;
  }

  async deleteVendor(id: string, actor?: any) {
    const v = await this.vendors.findOne({ where: { id } });
    if (!v) throw new NotFoundException();
    await this.vendors.delete(id);
    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'delete_vendor', entity_type: 'vendor', entity_id: id,
      details: v.name,
    });
    return { success: true };
  }
}
