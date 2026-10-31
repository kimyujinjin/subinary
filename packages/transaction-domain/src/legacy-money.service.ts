/**
 * Explicit v1 money commands used while legacy/shadow compatibility is retained.
 *
 * These commands intentionally keep the old KRW/display-rate calculation and
 * cancellation matching rules. They do not acquire v2 snapshots. API ownership,
 * visibility and card/category decisions remain with the calling application;
 * money validation, row locking, idempotent claims and cumulative writes live here.
 */
import { schema, type Db, type DbExecutor } from '@family/database';
import { and, desc, eq, inArray, isNull, lt, type SQL } from 'drizzle-orm';

import type { MoneyStatus } from './plan.js';
import type { MoneyCommandOptions, TransactionMetadata } from './transaction-money.service.js';

export type LegacyMoneyRejection =
  | 'invalid_amount' | 'currency_mismatch' | 'cancellation_exceeds_approval'
  | 'transaction_not_found' | 'transaction_type_mismatch' | 'household_mismatch'
  | 'cancellation_already_linked' | 'transaction_has_cancellations'
  | 'transaction_not_pending_review' | 'transaction_changed'
  | 'money_contract_version_mismatch';

type LegacyMoneyFailure = { readonly ok: false; readonly reason: LegacyMoneyRejection };
export type LegacyMoneyResult<T> =
  | { readonly ok: true; readonly value: T }
  | LegacyMoneyFailure;

/** Already-converted legacy/display money, never treated as a v2 FX snapshot. */
export interface LegacyConvertedMoney {
  readonly amount: number;
  readonly currency: string;
  readonly originalAmount: number | null;
  readonly originalCurrency: string | null;
  readonly exchangeRate: number | null;
}

export interface LegacyCreateApprovalCommand {
  readonly metadata: TransactionMetadata;
  readonly money: LegacyConvertedMoney;
  readonly occurredAt: Date | null;
  readonly status?: 'approved' | 'pending_review' | 'duplicate_suspected';
}

export interface LegacyCreateReviewedCommand {
  readonly metadata: TransactionMetadata;
  readonly minorUnits: number;
  readonly currency: string;
  readonly transactionType: 'approval' | 'cancellation';
  readonly occurredAt: Date | null;
}

export interface LegacyCreateCancellationCommand {
  readonly metadata: TransactionMetadata;
  readonly money: LegacyConvertedMoney;
  readonly occurredAt: Date | null;
}

export interface LegacyCancellationOutcome {
  readonly transactionId: string | null;
  readonly alreadyPromoted: boolean;
  readonly linked: boolean;
  /** The legacy worker reports the parent status when a cancellation links. */
  readonly status: MoneyStatus;
}

type LegacyRow = typeof schema.cardTransactions.$inferSelect;

class LegacyMoneyRollback extends Error {
  constructor(readonly result: LegacyMoneyFailure) { super('legacy_money_rejected'); }
}

const rejected = (reason: LegacyMoneyRejection): LegacyMoneyFailure => ({ ok: false, reason });
const safeAmount = (value: number) => Number.isSafeInteger(value) && value >= 0;
const validDate = (value: Date | null) => value === null || (value instanceof Date && Number.isFinite(value.getTime()));

function validMoney(money: LegacyConvertedMoney): boolean {
  return safeAmount(money.amount) && /^[A-Z]{3}$/.test(money.currency)
    && (money.originalAmount === null || safeAmount(money.originalAmount))
    && (money.originalCurrency === null || /^[A-Z]{3}$/.test(money.originalCurrency))
    && (money.exchangeRate === null || (Number.isFinite(money.exchangeRate) && money.exchangeRate > 0));
}

function metadataValues(metadata: TransactionMetadata) {
  return {
    householdId: metadata.householdId, memberId: metadata.memberId,
    cardId: metadata.cardId, sourceEventId: metadata.sourceEventId,
    merchantRaw: metadata.merchantRaw, merchantNormalized: metadata.merchantNormalized,
    categoryId: metadata.categoryId, authorizationCode: metadata.authorizationCode,
    installmentMonths: metadata.installmentMonths, visibility: metadata.visibility, memo: metadata.memo,
  };
}

/** Compatibility operations are explicit money commands, not a generic update port. */
export class LegacyTransactionMoneyService {
  constructor(private readonly db: Db) {}

  async createApproval(
    command: LegacyCreateApprovalCommand,
    options?: MoneyCommandOptions,
  ): Promise<LegacyMoneyResult<{ transactionId: string; alreadyPromoted: boolean }>> {
    if (!validMoney(command.money) || !validDate(command.occurredAt)) return rejected('invalid_amount');
    return this.run(options, async (tx) => {
      const [inserted] = await tx.insert(schema.cardTransactions).values({
        ...metadataValues(command.metadata), ...command.money,
        transactionType: 'approval', status: command.status ?? 'approved',
        cancelledAmount: 0, netAmount: command.money.amount,
        originalCancelledAmount: null, fxRateSnapshotId: null, moneyContractVersion: 1,
        approvedAt: command.occurredAt, cancelledAt: null, parentTransactionId: null,
      }).onConflictDoNothing({ target: schema.cardTransactions.sourceEventId })
        .returning({ id: schema.cardTransactions.id });
      return this.createdOrExisting(tx, command.metadata.sourceEventId, inserted?.id);
    });
  }

  /** Human review historically records an unlinked cancellation as cancelled. */
  async createReviewedTransaction(
    command: LegacyCreateReviewedCommand,
    options?: MoneyCommandOptions,
  ): Promise<LegacyMoneyResult<{ transactionId: string; alreadyPromoted: boolean }>> {
    if (!safeAmount(command.minorUnits) || !/^[A-Z]{3}$/.test(command.currency)
      || !validDate(command.occurredAt)) return rejected('invalid_amount');
    if (command.transactionType !== 'approval' && command.transactionType !== 'cancellation') {
      return rejected('transaction_type_mismatch');
    }
    return this.run(options, async (tx) => {
      const cancellation = command.transactionType === 'cancellation';
      const [inserted] = await tx.insert(schema.cardTransactions).values({
        ...metadataValues(command.metadata), transactionType: command.transactionType,
        status: cancellation ? 'cancelled' : 'approved', amount: command.minorUnits,
        cancelledAmount: 0, netAmount: cancellation ? 0 : command.minorUnits,
        currency: command.currency, originalAmount: null, originalCurrency: null, exchangeRate: null,
        originalCancelledAmount: null, fxRateSnapshotId: null, moneyContractVersion: 1,
        approvedAt: cancellation ? null : command.occurredAt,
        cancelledAt: cancellation ? command.occurredAt : null, parentTransactionId: null,
      }).onConflictDoNothing({ target: schema.cardTransactions.sourceEventId })
        .returning({ id: schema.cardTransactions.id });
      return this.createdOrExisting(tx, command.metadata.sourceEventId, inserted?.id);
    });
  }

  /** Preserve the legacy worker's same-stored-currency and unique-candidate rules. */
  async createCancellation(
    command: LegacyCreateCancellationCommand,
    options?: MoneyCommandOptions,
  ): Promise<LegacyMoneyResult<LegacyCancellationOutcome>> {
    if (!validMoney(command.money) || !validDate(command.occurredAt)) return rejected('invalid_amount');
    return this.run(options, async (tx) => {
      const metadata = command.metadata;
      const amount = command.money.amount;
      const [inserted] = await tx.insert(schema.cardTransactions).values({
        ...metadataValues(metadata), ...command.money,
        transactionType: 'cancellation', status: 'pending_review',
        cancelledAmount: 0, netAmount: 0, parentTransactionId: null,
        originalCancelledAmount: null, fxRateSnapshotId: null, moneyContractVersion: 1,
        approvedAt: null, cancelledAt: command.occurredAt,
      }).onConflictDoNothing({ target: schema.cardTransactions.sourceEventId })
        .returning({ id: schema.cardTransactions.id });
      if (!inserted) return { ok: true, value: {
        status: 'pending_review', linked: false, alreadyPromoted: true, transactionId: null,
      } };

      const pending = (): LegacyMoneyResult<LegacyCancellationOutcome> => ({ ok: true, value: {
        status: 'pending_review', linked: false, alreadyPromoted: false, transactionId: inserted.id,
      } });
      const conditions: SQL[] = [
        eq(schema.cardTransactions.householdId, metadata.householdId),
        eq(schema.cardTransactions.transactionType, 'approval'),
        eq(schema.cardTransactions.currency, command.money.currency),
        eq(schema.cardTransactions.moneyContractVersion, 1),
        inArray(schema.cardTransactions.status, ['approved', 'partially_cancelled']),
      ];
      if (metadata.cardId) conditions.push(eq(schema.cardTransactions.cardId, metadata.cardId));
      else conditions.push(isNull(schema.cardTransactions.cardId), eq(schema.cardTransactions.memberId, metadata.memberId));
      if (metadata.merchantNormalized) conditions.push(eq(schema.cardTransactions.merchantNormalized, metadata.merchantNormalized));
      if (command.occurredAt) conditions.push(lt(schema.cardTransactions.approvedAt, command.occurredAt));
      const candidates = await tx.select().from(schema.cardTransactions)
        .where(and(...conditions)).orderBy(desc(schema.cardTransactions.approvedAt));
      const matches = candidates.filter((approval) => approval.amount - approval.cancelledAmount >= amount);
      if (matches.length !== 1) return pending();

      const [approval] = await tx.select().from(schema.cardTransactions)
        .where(eq(schema.cardTransactions.id, matches[0]!.id)).for('update').limit(1);
      if (!approval || !this.matchesAutomaticApproval(approval, command)
        || approval.amount - approval.cancelledAmount < amount) return pending();
      const cancelledAmount = approval.cancelledAmount + amount;
      const netAmount = approval.amount - cancelledAmount;
      if (!safeAmount(cancelledAmount) || !safeAmount(netAmount)) return rejected('invalid_amount');
      const status = cancelledAmount >= approval.amount ? 'cancelled' : 'partially_cancelled';
      const now = new Date();
      const [claimed] = await tx.update(schema.cardTransactions).set({
        parentTransactionId: approval.id, status: 'approved', updatedAt: now,
      }).where(and(eq(schema.cardTransactions.id, inserted.id), isNull(schema.cardTransactions.parentTransactionId)))
        .returning({ id: schema.cardTransactions.id });
      if (!claimed) return pending();
      await tx.update(schema.cardTransactions).set({ cancelledAmount, netAmount, status, updatedAt: now })
        .where(eq(schema.cardTransactions.id, approval.id));
      return { ok: true, value: { status, linked: true, alreadyPromoted: false, transactionId: inserted.id } };
    });
  }

  async amendTransaction(
    input: { transactionId: string; amount?: number; occurredAt?: Date | null },
    options?: MoneyCommandOptions,
  ): Promise<LegacyMoneyResult<{ transactionId: string }>> {
    if ((input.amount !== undefined && !safeAmount(input.amount))
      || (input.occurredAt !== undefined && !validDate(input.occurredAt))) return rejected('invalid_amount');
    return this.run(options, async (tx) => {
      const row = await this.lockRow(tx, input.transactionId);
      if (!row) return rejected('transaction_not_found');
      if (row.moneyContractVersion !== 1) return rejected('money_contract_version_mismatch');
      if (row.transactionType !== 'approval' && row.transactionType !== 'cancellation') return rejected('transaction_type_mismatch');
      if (input.amount !== undefined && (row.cancelledAmount !== 0 || row.parentTransactionId !== null)) {
        return rejected('transaction_has_cancellations');
      }
      const values: Partial<typeof schema.cardTransactions.$inferInsert> = { updatedAt: new Date() };
      if (input.amount !== undefined) {
        values.amount = input.amount;
        values.netAmount = row.transactionType === 'approval' ? input.amount : 0;
      }
      if (input.occurredAt !== undefined) {
        if (row.transactionType === 'approval') values.approvedAt = input.occurredAt;
        else values.cancelledAt = input.occurredAt;
      }
      await tx.update(schema.cardTransactions).set(values).where(eq(schema.cardTransactions.id, row.id));
      return { ok: true, value: { transactionId: row.id } };
    });
  }

  /** Approval first, then cancellation; all conflict checks happen before writes. */
  async linkCancellation(
    input: { cancellationId: string; approvalId: string; householdId: string },
    options?: MoneyCommandOptions,
  ): Promise<LegacyMoneyResult<{ approvalId: string }>> {
    return this.run(options, async (tx) => {
      const approval = await this.lockRow(tx, input.approvalId);
      if (!approval) return rejected('transaction_not_found');
      const cancellation = await this.lockRow(tx, input.cancellationId);
      if (!cancellation) return rejected('transaction_not_found');
      if (approval.moneyContractVersion !== 1 || cancellation.moneyContractVersion !== 1) return rejected('money_contract_version_mismatch');
      if (approval.transactionType !== 'approval' || cancellation.transactionType !== 'cancellation') return rejected('transaction_type_mismatch');
      if (approval.householdId !== input.householdId || cancellation.householdId !== input.householdId) return rejected('household_mismatch');
      if (approval.currency !== cancellation.currency) return rejected('currency_mismatch');
      if (cancellation.parentTransactionId !== null) return rejected('cancellation_already_linked');
      if (cancellation.amount > approval.amount - approval.cancelledAmount) return rejected('cancellation_exceeds_approval');
      const cancelledAmount = approval.cancelledAmount + cancellation.amount;
      const netAmount = approval.amount - cancelledAmount;
      if (!safeAmount(cancelledAmount) || !safeAmount(netAmount)) return rejected('invalid_amount');
      const now = new Date();
      const [claimed] = await tx.update(schema.cardTransactions).set({
        parentTransactionId: approval.id, status: 'approved', updatedAt: now,
      }).where(and(eq(schema.cardTransactions.id, cancellation.id), isNull(schema.cardTransactions.parentTransactionId)))
        .returning({ id: schema.cardTransactions.id });
      if (!claimed) return rejected('cancellation_already_linked');
      await tx.update(schema.cardTransactions).set({
        cancelledAmount, netAmount,
        status: cancelledAmount >= approval.amount ? 'cancelled' : 'partially_cancelled', updatedAt: now,
      }).where(eq(schema.cardTransactions.id, approval.id));
      return { ok: true, value: { approvalId: approval.id } };
    });
  }

  /** Legacy review flags retain the pre-v2 status semantics, including cancellations. */
  async setReviewFlag(
    input: { transactionId: string; flag: 'duplicate_suspected' | null },
    options?: MoneyCommandOptions,
  ): Promise<LegacyMoneyResult<{ transactionId: string }>> {
    return this.run(options, async (tx) => {
      const row = await this.lockRow(tx, input.transactionId);
      if (!row) return rejected('transaction_not_found');
      if (row.moneyContractVersion !== 1) return rejected('money_contract_version_mismatch');
      if (input.flag === 'duplicate_suspected') {
        await tx.update(schema.cardTransactions).set({ status: input.flag, updatedAt: new Date() })
          .where(eq(schema.cardTransactions.id, row.id));
      } else {
        if (row.status !== 'duplicate_suspected' && row.status !== 'pending_review') return rejected('transaction_not_pending_review');
        const netAmount = row.transactionType === 'approval' ? row.amount - row.cancelledAmount : 0;
        if (!safeAmount(netAmount)) return rejected('invalid_amount');
        const status = row.transactionType === 'approval'
          ? row.cancelledAmount >= row.amount ? 'cancelled' : row.cancelledAmount > 0 ? 'partially_cancelled' : 'approved'
          : 'approved';
        await tx.update(schema.cardTransactions).set({ status, netAmount, updatedAt: new Date() })
          .where(eq(schema.cardTransactions.id, row.id));
      }
      return { ok: true, value: { transactionId: row.id } };
    });
  }

  /** Re-read the parent relation under approval→cancellation locks before reversal. */
  async removeTransaction(
    input: { transactionId: string },
    options?: MoneyCommandOptions,
  ): Promise<LegacyMoneyResult<{ deleted: true }>> {
    return this.run(options, async (tx) => {
      const initial = await this.loadRow(tx, input.transactionId);
      // A repeated delete never reverses the parent a second time.
      if (!initial) return { ok: true, value: { deleted: true } };
      if (initial.moneyContractVersion !== 1) return rejected('money_contract_version_mismatch');
      if (initial.transactionType === 'approval') {
        const approval = await this.lockRow(tx, initial.id);
        if (!approval) return { ok: true, value: { deleted: true } };
        if (approval.moneyContractVersion !== 1) return rejected('money_contract_version_mismatch');
        const [child] = await tx.select({ id: schema.cardTransactions.id }).from(schema.cardTransactions)
          .where(eq(schema.cardTransactions.parentTransactionId, approval.id)).limit(1);
        if (child) return rejected('transaction_has_cancellations');
      } else if (initial.transactionType === 'cancellation') {
        const parent = initial.parentTransactionId ? await this.lockRow(tx, initial.parentTransactionId) : null;
        const cancellation = await this.lockRow(tx, initial.id);
        if (!cancellation) return { ok: true, value: { deleted: true } };
        if (cancellation.moneyContractVersion !== 1 || parent && parent.moneyContractVersion !== 1) return rejected('money_contract_version_mismatch');
        if (cancellation.parentTransactionId !== initial.parentTransactionId) return rejected('transaction_changed');
        if (parent && cancellation.parentTransactionId === parent.id) {
          if (parent.transactionType !== 'approval') return rejected('transaction_type_mismatch');
          if (parent.householdId !== cancellation.householdId) return rejected('household_mismatch');
          const cancelledAmount = Math.max(0, parent.cancelledAmount - cancellation.amount);
          const netAmount = parent.amount - cancelledAmount;
          if (!safeAmount(cancelledAmount) || !safeAmount(netAmount)) return rejected('invalid_amount');
          await tx.update(schema.cardTransactions).set({
            cancelledAmount, netAmount,
            status: cancelledAmount >= parent.amount ? 'cancelled' : cancelledAmount > 0 ? 'partially_cancelled' : 'approved',
            updatedAt: new Date(),
          }).where(eq(schema.cardTransactions.id, parent.id));
        }
      } else return rejected('transaction_type_mismatch');
      await tx.delete(schema.cardTransactions).where(eq(schema.cardTransactions.id, initial.id));
      return { ok: true, value: { deleted: true } };
    });
  }

  private matchesAutomaticApproval(row: LegacyRow, command: LegacyCreateCancellationCommand): boolean {
    const metadata = command.metadata;
    return row.householdId === metadata.householdId && row.transactionType === 'approval'
      && row.moneyContractVersion === 1
      && row.currency === command.money.currency && ['approved', 'partially_cancelled'].includes(row.status)
      && (metadata.cardId ? row.cardId === metadata.cardId : row.cardId === null && row.memberId === metadata.memberId)
      && (!metadata.merchantNormalized || row.merchantNormalized === metadata.merchantNormalized)
      && (!command.occurredAt || row.approvedAt !== null && row.approvedAt.getTime() < command.occurredAt.getTime());
  }

  private async createdOrExisting(tx: DbExecutor, sourceEventId: string, insertedId?: string): Promise<LegacyMoneyResult<{ transactionId: string; alreadyPromoted: boolean }>> {
    if (insertedId) return { ok: true, value: { transactionId: insertedId, alreadyPromoted: false } };
    const [existing] = await tx.select({ id: schema.cardTransactions.id }).from(schema.cardTransactions)
      .where(eq(schema.cardTransactions.sourceEventId, sourceEventId)).limit(1);
    return existing ? { ok: true, value: { transactionId: existing.id, alreadyPromoted: true } } : rejected('transaction_not_found');
  }

  private async loadRow(tx: DbExecutor, id: string): Promise<LegacyRow | null> {
    const [row] = await tx.select().from(schema.cardTransactions).where(eq(schema.cardTransactions.id, id)).limit(1);
    return row ?? null;
  }

  private async lockRow(tx: DbExecutor, id: string): Promise<LegacyRow | null> {
    const [row] = await tx.select().from(schema.cardTransactions).where(eq(schema.cardTransactions.id, id)).for('update').limit(1);
    return row ?? null;
  }

  private async run<T>(options: MoneyCommandOptions | undefined, body: (tx: DbExecutor) => Promise<LegacyMoneyResult<T>>): Promise<LegacyMoneyResult<T>> {
    if (options?.tx) return body(options.tx);
    try {
      return await this.db.transaction(async (tx) => {
        const result = await body(tx);
        if (!result.ok) throw new LegacyMoneyRollback(result);
        return result;
      });
    } catch (error) {
      if (error instanceof LegacyMoneyRollback) return error.result;
      throw error;
    }
  }
}
