import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TreasuryMovement } from '../entities/treasury-movement.entity';
import { Recharge } from '../entities/recharge.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TreasuryService {
  constructor(
    @InjectRepository(TreasuryMovement) private repo: Repository<TreasuryMovement>,
    @InjectRepository(Recharge) private rechargeRepo: Repository<Recharge>,
    private audit: AuditService,
  ) {}

  async list() {
    return this.repo.find({ order: { created_at: 'DESC' } });
  }

  async reconciliation() {
    const all = await this.rechargeRepo.find({ relations: ['customer'], order: { created_at: 'DESC' } });
    const totals = {
      total_recharges: all.length,
      pending: all.filter((r) => !r.reconciled && r.status !== 'mismatch' && r.status !== 'refunded').length,
      mismatch: all.filter((r) => r.status === 'mismatch').length,
      reconciled: all.filter((r) => r.reconciled).length,
    };
    return { totals, recharges: all };
  }

  async upsertMovement(rechargeId: string, data: Partial<TreasuryMovement>, actor?: any) {
    const recharge = await this.rechargeRepo.findOne({ where: { id: rechargeId } });
    if (!recharge) throw new NotFoundException('Recharge not found');
    let m = await this.repo.findOne({ where: { recharge_id: rechargeId } });
    if (!m) {
      m = this.repo.create({ recharge_id: rechargeId, customer_id: recharge.customer_id });
    }
    Object.assign(m, data);
    const saved = await this.repo.save(m);

    // Advance recharge status based on movement state
    if (saved.transferred_to_wio && saved.converted_to_aed && saved.transferred_to_okx) {
      recharge.status = 'fully_reconciled';
      recharge.reconciled = true;
    } else if (saved.transferred_to_wio) {
      recharge.status = 'deposited_to_wio';
    } else if (saved.converted_to_aed) {
      recharge.status = 'converted_to_aed';
    } else if (saved.transferred_to_okx) {
      recharge.status = 'sent_to_okx';
    }
    await this.rechargeRepo.save(recharge);

    await this.audit.log({
      actor_id: actor?.id, actor_email: actor?.email,
      action: 'treasury_movement', entity_type: 'recharge', entity_id: rechargeId,
      details: 'Treasury movement updated',
    });
    return saved;
  }
}
