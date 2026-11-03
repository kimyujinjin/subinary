import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@family/database';
import {
  bankConnectionDisconnectSchema, bankConnectionRefreshSchema, bankConnectionRegisterSchema, bankObservationSchema,
  bankConnectionConsentVersionSchema, bankCaptureMatchesSelector, bankSelectorSchema,
  type AssetConnectionCatalog, type BankConnection, type BankConnectionDisconnect, type BankConnectionError,
  type BankConnectionList, type BankConnectionRefresh, type BankConnectionRegister, type BankConnectionResult, type BankObservation, type BankSelector,
} from '@family/contracts';
import { DB } from '../database/database.constants';
import { FinanceVault, type VaultContext } from '../finance-connections/finance-vault';
import { BankBrowserClient, BankBrowserError, type BankCredentials } from './bank-browser';
import { BANK_REFRESH_INTERVAL_MS, bankLoginFingerprint, projectBankState } from './bank-connections.policy';

const connections = schema.bankConnections, snapshots = schema.bankConnectionSnapshots;
type Row = typeof connections.$inferSelect;
type Tx = Pick<Db, 'select' | 'insert' | 'update' | 'execute'>;
const writers = new Set(['owner', 'admin', 'member']);
const conflict = () => new ConflictException('연결 상태가 바뀌었어요. 현재 상태를 확인해 주세요.');
const absent = () => new NotFoundException('은행 연결을 찾을 수 없습니다.');
const disabled = () => new ServiceUnavailableException('은행 자동조회를 준비하고 있어요. 로그인 정보를 입력하지 않아도 돼요.');
function parse<T>(contract: z.ZodType<T>, value: unknown): T {
  const result = contract.safeParse(value);
  if (!result.success) throw new BadRequestException('은행 연결 정보와 동의 항목을 확인해 주세요.');
  return result.data;
}
const ids = (userId: string, householdId: string) => parse(z.object({ userId: z.string().uuid(), householdId: z.string().uuid() }), { userId, householdId });
const context = (row: Row): VaultContext => ({ ownerUserId: row.ownerUserId, provider: row.provider, connectionId: row.id, purpose: 'credentials' });
const credentialsSchema = z.object({ loginId: z.string(), password: z.string() }).strict();
const selectorOf = (row: Row): BankSelector => bankSelectorSchema.parse(row.accountType === 'deposit'
  ? { accountLast4: row.accountLast4, accountType: 'deposit' }
  : { accountLast4: row.accountLast4, loanType: row.loanType });

/** No GET provider calls, no family aggregates, no plaintext credentials in any response or audit. */
@Injectable()
export class BankConnectionsService {
  constructor(@Inject(DB) private readonly db: Db, private readonly vault: FinanceVault, private readonly browser: BankBrowserClient) {}
  private get enabled() { return this.vault.enabled && this.browser.available; }
  private async tx<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
    try { return await this.db.transaction(run); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      let cause: unknown = error;
      for (let i = 0; i < 4 && cause && typeof cause === 'object'; i++) {
        const value = cause as { code?: unknown; cause?: unknown };
        if (['23505','40001','40P01','55P03'].includes(String(value.code))) throw conflict();
        cause = value.cause;
      }
      throw new InternalServerErrorException('결과를 확인하지 못했어요. 은행 연결 상태를 다시 확인해 주세요.');
    }
  }
  private async member(tx: Tx, userId: string, householdId: string, write = false) {
    const [member] = await tx.select({ id: schema.householdMembers.id, role: schema.householdMembers.role })
      .from(schema.householdMembers).innerJoin(schema.users, eq(schema.users.id, schema.householdMembers.userId))
      .where(and(eq(schema.householdMembers.userId, userId), eq(schema.householdMembers.householdId, householdId),
        eq(schema.householdMembers.status, 'active'), isNull(schema.users.deletedAt)))
      .for(write ? 'update' : 'share', { of: schema.householdMembers }).limit(1);
    if (!member || (write && !writers.has(member.role))) throw new ForbiddenException('은행 연결 권한이 없습니다.');
    const [household] = await tx.select({ id: schema.households.id }).from(schema.households)
      .where(and(eq(schema.households.id, householdId), isNull(schema.households.deletedAt))).for('share').limit(1);
    if (!household) throw new ForbiddenException('은행 연결 권한이 없습니다.');
    return member;
  }
  private scope(userId: string, householdId: string) {
    return and(eq(connections.ownerUserId, userId), eq(connections.householdId, householdId),
      sql`exists(select 1 from ${schema.householdMembers} where ${schema.householdMembers.id} = ${connections.memberId}
        and ${schema.householdMembers.userId} = ${connections.ownerUserId} and ${schema.householdMembers.householdId} = ${connections.householdId}
        and ${schema.householdMembers.status} = 'active' and ${schema.householdMembers.joinedAt} = ${connections.memberJoinedAt})`);
  }
  private async storage(tx: Tx): Promise<boolean> {
    const rows = await tx.execute(sql`select to_regclass('public.bank_connections') is not null
      and to_regclass('public.bank_connection_snapshots') is not null
      and exists(select 1 from pg_attribute where attrelid = to_regclass('public.bank_connections')
        and attname = 'account_type' and not attisdropped)
      and exists(select 1 from pg_constraint where conrelid = to_regclass('public.bank_connections')
        and conname = 'bank_connections_account_version_check' and convalidated)
      and (select count(*) from (values
        ('household_members','bank_membership_revoke','revoke_bank_membership()'),
        ('users','bank_user_revoke','revoke_bank_deleted_scope()'),
        ('households','bank_household_revoke','revoke_bank_deleted_scope()'),
        ('bank_connection_snapshots','bank_snapshot_guard','guard_bank_snapshot()')
      ) required(table_name,trigger_name,function_name)
      join pg_trigger t on t.tgrelid = to_regclass('public.' || required.table_name)
        and t.tgname = required.trigger_name and t.tgfoid = to_regprocedure('public.' || required.function_name)
      where not t.tgisinternal and t.tgenabled in ('O','A')) = 4 as available`);
    return (rows as unknown as { available: boolean }[])[0]?.available === true;
  }
  private async owned(tx: Tx, userId: string, householdId: string, id: string) {
    const [row] = await tx.select().from(connections).where(and(eq(connections.id, id), this.scope(userId, householdId))).for('update').limit(1);
    if (!row) throw absent();
    return row;
  }
  private async dto(tx: Tx, row: Row): Promise<BankConnection> {
    let snapshot: BankObservation | null = null;
    const selector = selectorOf(row);
    const projection = projectBankState(row, this.enabled);
    if (row.lastSnapshotId && !row.disconnectedAt) {
      const [saved] = await tx.select({ payload: snapshots.payload }).from(snapshots).where(and(eq(snapshots.id, row.lastSnapshotId),
        eq(snapshots.connectionId, row.id), eq(snapshots.ownerUserId, row.ownerUserId), eq(snapshots.householdId, row.householdId), eq(snapshots.state, 'succeeded'))).limit(1);
      const parsed = bankObservationSchema.safeParse(saved?.payload);
      if (parsed.success && bankCaptureMatchesSelector(selector, parsed.data)
        && (!row.selectedFingerprint || parsed.data.accountFingerprint === row.selectedFingerprint)) snapshot = parsed.data;
      else { projection.status = 'error'; projection.errorCode = 'unsupported_layout'; projection.canRefresh = false; }
    }
    return { id: row.id, householdId: row.householdId, ownerUserId: row.ownerUserId, provider: row.provider, version: row.version,
      ...projection, selector, visibility: 'owner_only', includedInTotals: false,
      refreshOnOpen: row.refreshOnOpen, credentialsStored: !!row.credentials && !row.disconnectedAt,
      consentVersion: bankConnectionConsentVersionSchema.parse(row.consentVersion), consentedAt: row.consentedAt.toISOString(), lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null, snapshot, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
  async catalog(user: string, household: string): Promise<AssetConnectionCatalog> {
    const { userId, householdId } = ids(user, household);
    return this.tx(async tx => {
      await this.member(tx, userId, householdId);
      const ready = this.enabled && await this.storage(tx);
      return { items: [
        { provider: 'shinhan_bank', method: 'web_login', credentialInputAvailable: ready, state: ready ? 'available' : 'runtime_required' },
        { provider: 'toss_securities', method: 'official_api', credentialInputAvailable: this.vault.enabled, state: this.vault.enabled ? 'available' : 'runtime_required' },
        { provider: 'toss_bank', method: 'unverified', credentialInputAvailable: false, state: 'integration_unverified' },
        { provider: 'kb_bank', method: 'web_login', credentialInputAvailable: false, state: 'account_verification_required' },
      ] };
    });
  }
  async list(user: string, household: string): Promise<BankConnectionList> {
    const { userId, householdId } = ids(user, household);
    return this.tx(async tx => {
      await this.member(tx, userId, householdId);
      if (!await this.storage(tx)) return { enabled: false, disabledReason: 'not_configured', items: [] };
      const rows = await tx.select().from(connections).where(this.scope(userId, householdId)).orderBy(asc(connections.createdAt), asc(connections.id));
      const items: BankConnection[] = [];
      for (const row of rows) items.push(await this.dto(tx, row));
      return { enabled: this.enabled, disabledReason: this.enabled ? null : this.browser.configured ? 'runtime_unavailable' : 'not_configured', items };
    });
  }
  private async result(userId: string, householdId: string, id: string): Promise<BankConnectionResult> {
    return this.tx(async tx => { await this.member(tx, userId, householdId); return { item: await this.dto(tx, await this.owned(tx, userId, householdId, id)) }; });
  }
  async register(user: string, request: BankConnectionRegister): Promise<BankConnectionResult> {
    const input = parse(bankConnectionRegisterSchema, request), { userId, householdId } = ids(user, input.householdId);
    try {
      await this.tx(async tx => {
        const member = await this.member(tx, userId, householdId, true);
        if (!this.enabled || !await this.storage(tx)) throw disabled();
        const [existing] = await tx.select().from(connections).where(eq(connections.id, input.connectionId)).for('update').limit(1);
        if (existing) {
          const row = await this.owned(tx, userId, householdId, input.connectionId);
          if (row.disconnectedAt || !row.credentials || row.consentVersion !== input.consentVersion
            || JSON.stringify(selectorOf(row)) !== JSON.stringify(input.selector)) throw conflict();
          const saved = credentialsSchema.parse(this.vault.decrypt(row.credentials, context(row)));
          const digest = (id: string, secret: string) => createHash('sha256').update(JSON.stringify([id, secret])).digest();
          const equal = timingSafeEqual(digest(saved.loginId, saved.password), digest(input.loginId, input.password));
          saved.loginId = ''; saved.password = '';
          if (!equal) throw conflict();
          return;
        }
        await tx.insert(connections).values({ id: input.connectionId, householdId, ownerUserId: userId, memberId: member.id,
          memberJoinedAt: sql`(select ${schema.householdMembers.joinedAt} from ${schema.householdMembers} where ${schema.householdMembers.id} = ${member.id})`,
          provider: 'shinhan_bank', consentVersion: input.consentVersion, loginFingerprint: bankLoginFingerprint(input.loginId), accountLast4: input.selector.accountLast4,
          accountType: 'accountType' in input.selector ? 'deposit' : 'loan',
          loanType: 'loanType' in input.selector ? input.selector.loanType : null, status: 'stored', credentials: this.vault.encrypt({ loginId: input.loginId, password: input.password },
            { ownerUserId: userId, connectionId: input.connectionId, provider: 'shinhan_bank', purpose: 'credentials' }) });
      });
      return this.result(userId, householdId, input.connectionId);
    } finally { input.loginId = ''; input.password = ''; request.loginId = ''; request.password = ''; }
  }
  private async active(userId: string, householdId: string, id: string, operationId: string, version: number) {
    try { return await this.tx(async tx => {
      await this.member(tx, userId, householdId, true);
      const row = await this.owned(tx, userId, householdId, id);
      return !row.disconnectedAt && row.operationId === operationId && row.version === version;
    }); } catch { return false; }
  }
  async refresh(user: string, id: string, request: BankConnectionRefresh): Promise<BankConnectionResult> {
    const input = parse(bankConnectionRefreshSchema, request), { userId, householdId } = ids(user, input.householdId);
    const claim = await this.tx(async tx => {
      await this.member(tx, userId, householdId, true);
      if (!this.enabled || !await this.storage(tx)) throw disabled();
      const row = await this.owned(tx, userId, householdId, id);
      const [previous] = await tx.select({ id: snapshots.id }).from(snapshots).where(and(eq(snapshots.id, input.requestId), eq(snapshots.connectionId, id), eq(snapshots.ownerUserId, userId))).limit(1);
      if (previous) return { row, fresh: false };
      if (row.version !== input.expectedVersion || !projectBankState(row, true).canRefresh) throw conflict();
      // Serialize the same bank login across connections/instances without holding a DB transaction during browser I/O.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${row.loginFingerprint},0))`);
      const [busy] = await tx.select({ id: connections.id }).from(connections).where(and(eq(connections.loginFingerprint, row.loginFingerprint), isNotNull(connections.operationId))).limit(1);
      if (busy) throw conflict();
      const [recent] = await tx.select({ id: connections.id }).from(connections).where(and(eq(connections.loginFingerprint, row.loginFingerprint),
        gte(connections.lastAttemptAt, new Date(Date.now() - BANK_REFRESH_INTERVAL_MS)))).limit(1);
      if (recent) throw conflict();
      const now = new Date(), version = row.version + 1;
      await tx.insert(snapshots).values({ id: input.requestId, connectionId: id, householdId, ownerUserId: userId, connectionVersion: version });
      const [updated] = await tx.update(connections).set({ status: 'refreshing', version, operationId: input.requestId,
        operationStartedAt: now, lastAttemptAt: now, updatedAt: now, errorCode: null }).where(eq(connections.id, id)).returning();
      if (!updated) throw conflict();
      return { row: updated, fresh: true };
    });
    if (!claim.fresh) return this.result(userId, householdId, id);
    let capture: BankObservation | null = null, errorCode: BankConnectionError | null = null, credentials: BankCredentials | null = null;
    const controller = new AbortController();
    let checking = false, stopped = false;
    const monitor = setInterval(() => {
      if (checking || stopped) return;
      checking = true;
      void this.active(userId, householdId, id, input.requestId, claim.row.version).then(active => { if (!active && !stopped) controller.abort(); })
        .finally(() => { checking = false; });
    }, 1500);
    monitor.unref();
    try {
      if (!await this.active(userId, householdId, id, input.requestId, claim.row.version) || !claim.row.credentials) throw new BankBrowserError('operation_unknown');
      credentials = credentialsSchema.parse(this.vault.decrypt(claim.row.credentials, context(claim.row)));
      const selector = selectorOf(claim.row);
      capture = bankObservationSchema.parse(await this.browser.read(credentials, selector, controller.signal));
      if (!bankCaptureMatchesSelector(selector, capture)
        || claim.row.selectedFingerprint && capture.accountFingerprint !== claim.row.selectedFingerprint) { capture = null; errorCode = 'account_changed'; }
    } catch (error) { errorCode = error instanceof BankBrowserError ? error.code : 'operation_unknown'; }
    finally { stopped = true; clearInterval(monitor); if (credentials) { credentials.loginId = ''; credentials.password = ''; } }
    await this.tx(async tx => {
      await this.member(tx, userId, householdId, true);
      const row = await this.owned(tx, userId, householdId, id);
      if (row.disconnectedAt || row.version !== claim.row.version || row.operationId !== input.requestId) return;
      const now = new Date();
      if (capture && !errorCode) {
        await tx.update(snapshots).set({ state: 'succeeded', payload: capture, completedAt: now }).where(and(eq(snapshots.id, input.requestId), eq(snapshots.state, 'pending')));
        await tx.update(connections).set({ status: 'ready', version: row.version + 1, lastSnapshotId: input.requestId,
          selectedFingerprint: capture.accountFingerprint, lastSuccessAt: now, operationId: null, operationStartedAt: null, errorCode: null, updatedAt: now }).where(eq(connections.id, id));
      } else {
        const failure = errorCode ?? 'operation_unknown';
        await tx.update(snapshots).set({ state: 'failed', errorCode: failure, completedAt: now }).where(and(eq(snapshots.id, input.requestId), eq(snapshots.state, 'pending')));
        await tx.update(connections).set({ status: ['credentials_invalid','authentication_required'].includes(failure) ? 'reauth_required' : 'error',
          version: row.version + 1, operationId: null, operationStartedAt: null, errorCode: failure, updatedAt: now }).where(eq(connections.id, id));
      }
    });
    return this.result(userId, householdId, id);
  }
  async disconnect(user: string, id: string, request: BankConnectionDisconnect): Promise<BankConnectionResult> {
    const input = parse(bankConnectionDisconnectSchema, request), { userId, householdId } = ids(user, input.householdId);
    await this.tx(async tx => {
      await this.member(tx, userId, householdId, true);
      const row = await this.owned(tx, userId, householdId, id);
      if (row.disconnectedAt) return;
      if (row.version !== input.expectedVersion) throw conflict();
      const now = new Date();
      await tx.update(connections).set({ status: 'disconnected', disconnectedAt: now, credentials: null,
        operationId: null, operationStartedAt: null, selectedFingerprint: null, refreshOnOpen: false, errorCode: null,
        version: Math.min(row.version + 1, 2_147_483_647), updatedAt: now }).where(eq(connections.id, id));
    });
    return this.result(userId, householdId, id);
  }
}
