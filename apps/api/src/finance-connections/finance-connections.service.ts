import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable,
  InternalServerErrorException, NotFoundException, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  financeConnectionDisconnectSchema, financeConnectionErrorSchema, financeConnectionQuerySchema,
  financeConnectionRefreshSchema, financeConnectionRegisterSchema, financeConnectionSelectAccountSchema,
  financeConnectionSnapshotSchema,
  type FinanceConnection, type FinanceConnectionDisconnect, type FinanceConnectionError,
  type FinanceConnectionList, type FinanceConnectionRefresh, type FinanceConnectionRegister,
  type FinanceConnectionResult, type FinanceConnectionSelectAccount, type FinanceConnectionSnapshot,
} from '@family/contracts';
import { schema, type Db } from '@family/database';
import { DB } from '../database/database.constants';
import { FinanceVault, type VaultContext } from './finance-vault';
import { ProviderError, TossProviderClient } from './toss-provider';
import { financeAccountId, financeClientFingerprint, financeRetryNotBefore, projectFinanceState } from './finance-connections.policy';

type Tx = Pick<Db, 'select' | 'insert' | 'update'>;
type Row = typeof schema.financeConnections.$inferSelect;
type Member = { id: string; role: string };
type Account = { id: string; accountKey: string; type: 'BROKERAGE'; label: string };
const connections = schema.financeConnections;
const snapshots = schema.financeConnectionSnapshots;
const writers = new Set(['owner', 'admin', 'member']);
const conflict = () => new ConflictException({ code: 'finance_connection_conflict', message: '연결 상태가 바뀌었어요. 현재 상태를 먼저 확인해 주세요.' });
const absent = () => new NotFoundException('연결을 찾을 수 없습니다.');
const disabled = () => new ServiceUnavailableException({ code: 'finance_connections_disabled', message: '계좌 연결을 준비하고 있어요.' });
const accountStorage = z.array(z.object({ id: z.string().regex(/^[0-9a-f]{64}$/), accountKey: z.string().min(1).max(100),
  type: z.literal('BROKERAGE'), label: z.string().max(100) }).strict()).max(100);
function parse<T>(contract: z.ZodType<T>, value: unknown): T {
  const result = contract.safeParse(value);
  if (!result.success) throw new BadRequestException('연결 정보와 확인 항목을 다시 확인해 주세요.');
  return result.data;
}
function actor(value: string): string {
  if (!z.string().uuid().safeParse(value).success) throw new UnauthorizedException('unauthorized');
  return value.toLowerCase();
}
function bump(row: Row): number {
  if (row.version >= 2_147_483_647) throw conflict();
  return row.version + 1;
}
function context(row: Pick<Row, 'id' | 'ownerUserId' | 'provider'>, purpose: VaultContext['purpose']): VaultContext {
  return { connectionId: row.id, ownerUserId: row.ownerUserId, provider: row.provider, purpose };
}

/**
 * One-shot user-triggered reads only. No cron/worker/GET side effects. Persist a
 * claim before external I/O; every result is fenced by the same claim and grant.
 * Nothing in this service publishes private provider data to household SSE.
 */
@Injectable()
export class FinanceConnectionsService {
  constructor(@Inject(DB) private readonly db: Db, private readonly vault: FinanceVault,
    private readonly provider: TossProviderClient) {}

  private async transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
    try { return await this.db.transaction(run); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      let cause: unknown = error;
      for (let depth = 0; depth < 4 && cause !== null && typeof cause === 'object'; depth++) {
        const item = cause as { code?: unknown; cause?: unknown };
        if (['23505', '40001', '40P01', '55P03'].includes(String(item.code))) throw conflict();
        cause = item.cause;
      }
      // SQL bind values, provider errors, crypto input and their causes are never logged or returned.
      throw new InternalServerErrorException({ code: 'finance_connection_result_unknown', message: '결과를 확인하지 못했어요. 현재 연결 상태를 다시 확인해 주세요.' });
    }
  }

  private async member(tx: Tx, householdId: string, userId: string, write = false): Promise<Member> {
    const [member] = await tx.select({ id: schema.householdMembers.id, role: schema.householdMembers.role })
      .from(schema.householdMembers).innerJoin(schema.users, eq(schema.users.id, schema.householdMembers.userId))
      .where(and(eq(schema.householdMembers.householdId, householdId), eq(schema.householdMembers.userId, userId),
        eq(schema.householdMembers.status, 'active'), isNull(schema.users.deletedAt)))
      .for(write ? 'update' : 'share', { of: schema.householdMembers }).limit(1);
    if (!member || (write && !writers.has(member.role))) throw new ForbiddenException('계좌 연결 권한이 없습니다.');
    const [household] = await tx.select({ id: schema.households.id }).from(schema.households)
      .where(and(eq(schema.households.id, householdId), isNull(schema.households.deletedAt))).for('share').limit(1);
    if (!household) throw new ForbiddenException('계좌 연결 권한이 없습니다.');
    return member;
  }

  private scope(userId: string, householdId: string) {
    return and(eq(connections.ownerUserId, userId), eq(connections.householdId, householdId),
      sql`exists (select 1 from ${schema.householdMembers} where ${schema.householdMembers.id} = ${connections.memberId}
        and ${schema.householdMembers.userId} = ${connections.ownerUserId}
        and ${schema.householdMembers.householdId} = ${connections.householdId}
        and ${schema.householdMembers.joinedAt} = ${connections.memberJoinedAt}
        and ${schema.householdMembers.status} = 'active')`);
  }

  private async owned(tx: Tx, userId: string, householdId: string, id: string): Promise<Row> {
    const [row] = await tx.select().from(connections).where(and(eq(connections.id, id), this.scope(userId, householdId)))
      .for('update').limit(1);
    if (!row) throw absent();
    return row;
  }

  private accounts(row: Row): Account[] {
    if (!row.accounts || !this.vault.enabled || row.disconnectedAt) return [];
    return accountStorage.parse(this.vault.decrypt(row.accounts, context(row, 'accounts')));
  }

  private async dto(tx: Tx, row: Row): Promise<FinanceConnection> {
    const projection = projectFinanceState(row, this.vault.enabled);
    let options: Account[] = [];
    try { options = this.accounts(row); }
    catch { projection.canRefresh = false; projection.errorCode = 'configuration_unavailable'; }
    const accountOptions: FinanceConnection['accountOptions'] = options.map(({ id, type, label }) => ({ id, type, label }));
    if (!row.disconnectedAt && row.selectedAccountId && !accountOptions.some(option => option.id === row.selectedAccountId)) {
      // Allow an owner to disconnect even while the vault/key version is unavailable.
      // This is a previously verified opaque choice, never an invented provider key.
      accountOptions.push({ id: row.selectedAccountId, type: 'BROKERAGE', label: '선택한 계좌' });
    }
    let snapshot: FinanceConnectionSnapshot | null = null;
    if (row.lastSnapshotId && !row.disconnectedAt) {
      const [observation] = await tx.select({ payload: snapshots.payload }).from(snapshots).where(and(
        eq(snapshots.id, row.lastSnapshotId), eq(snapshots.connectionId, row.id),
        eq(snapshots.ownerUserId, row.ownerUserId), eq(snapshots.householdId, row.householdId), eq(snapshots.state, 'succeeded'),
      )).limit(1);
      if (observation) snapshot = financeConnectionSnapshotSchema.parse(observation.payload);
    }
    return { id: row.id, householdId: row.householdId, ownerUserId: row.ownerUserId, provider: 'toss_securities',
      version: row.version, ...projection, visibility: 'owner_only', includedInTotals: false,
      refreshOnOpen: row.refreshOnOpen, consentedAt: row.consentedAt.toISOString(),
      accountOptions, selectedAccountId: row.selectedAccountId,
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null, lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      snapshot, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async list(user: string, household: string): Promise<FinanceConnectionList> {
    const userId = actor(user), householdId = parse(financeConnectionQuerySchema, { householdId: household }).householdId.toLowerCase();
    return this.transaction(async tx => {
      await this.member(tx, householdId, userId);
      const rows = await tx.select().from(connections).where(this.scope(userId, householdId)).orderBy(asc(connections.createdAt), asc(connections.id));
      const items: FinanceConnection[] = [];
      for (const row of rows) items.push(await this.dto(tx, row));
      return { enabled: this.vault.enabled, disabledReason: this.vault.enabled ? null : 'not_configured', items };
    });
  }

  async register(user: string, request: FinanceConnectionRegister): Promise<FinanceConnectionResult> {
    const userId = actor(user), input = parse(financeConnectionRegisterSchema, request);
    const householdId = input.householdId.toLowerCase(), id = input.connectionId.toLowerCase();
    if (!this.vault.enabled) throw disabled();
    const clientFingerprint = financeClientFingerprint(input.clientId);
    const claim = await this.transaction(async tx => {
      const member = await this.member(tx, householdId, userId, true);
      const [existing] = await tx.select().from(connections).where(eq(connections.id, id)).for('update').limit(1);
      if (existing) {
        const row = await this.owned(tx, userId, householdId, id);
        if (row.clientFingerprint !== clientFingerprint || !row.credentials || row.disconnectedAt) throw conflict();
        const saved = z.object({ clientId: z.string(), clientSecret: z.string() }).strict()
          .parse(this.vault.decrypt(row.credentials, context(row, 'credentials')));
        const digest = (idValue: string, secret: string) => createHash('sha256').update(JSON.stringify([idValue, secret])).digest();
        if (!timingSafeEqual(digest(saved.clientId, saved.clientSecret), digest(input.clientId, input.clientSecret))) throw conflict();
        return { row, fresh: false };
      }
      const now = new Date();
      const [row] = await tx.insert(connections).values({ id, householdId, ownerUserId: userId, memberId: member.id,
        memberJoinedAt: sql`(select ${schema.householdMembers.joinedAt} from ${schema.householdMembers} where ${schema.householdMembers.id} = ${member.id})`,
        clientFingerprint, status: 'connecting', operationId: id, operationStartedAt: now,
        credentials: this.vault.encrypt({ clientId: input.clientId, clientSecret: input.clientSecret },
          { connectionId: id, ownerUserId: userId, provider: 'toss_securities', purpose: 'credentials' }),
        consentedAt: now, createdAt: now, updatedAt: now }).returning();
      if (!row) throw conflict();
      return { row, fresh: true };
    });
    if (!claim.fresh) return this.result(userId, householdId, id);

    let token: { accessToken: string; expiresAt: Date };
    let accounts: Account[];
    let tokenAttempted = false;
    try {
      // The durable connecting claim is committed before token issuance. Crash/timeout never retries it.
      if (!await this.claimActive(userId, householdId, id, id, claim.row.version)) {
        await this.recordIssuance(id, clientFingerprint, 'complete');
        return this.result(userId, householdId, id);
      }
      tokenAttempted = true;
      token = await this.provider.issueToken(input.clientId, input.clientSecret);
      await this.recordIssuance(id, clientFingerprint, 'complete');
      if (!await this.claimActive(userId, householdId, id, id, claim.row.version)) return this.result(userId, householdId, id);
      const offered = await this.provider.listAccounts(token.accessToken);
      accounts = offered.filter(account => account.type === 'BROKERAGE').map((account, index) => ({
        id: financeAccountId(id, account.accountKey), accountKey: account.accountKey, type: 'BROKERAGE' as const,
        label: `종합매매 계좌 ${index + 1}${account.last4 ? ` · ${account.last4}` : ''}`,
      }));
      if (!accounts.length || accounts.length > 100 || new Set(accounts.map(account => account.id)).size !== accounts.length) {
        return this.finishFailure(userId, householdId, id, id, claim.row.version, 'account_unavailable', false);
      }
    } catch (error) {
      if (!tokenAttempted) await this.recordIssuance(id, clientFingerprint, 'complete');
      if (error instanceof HttpException) throw error;
      const known = error instanceof ProviderError ? error : null;
      // Only a definite rejection releases the issuance claim. Unknown failures
      // retain it even after disconnect; use a newly issued provider client ID.
      await this.recordIssuance(id, clientFingerprint, known && !known.issuanceUncertain ? 'complete' : 'uncertain');
      const code = known?.issuanceUncertain ? 'token_uncertain' : known?.code ?? 'provider_unavailable';
      return this.finishFailure(userId, householdId, id, id, claim.row.version, code, false, known?.retryAfterSeconds ?? null);
    }
    // A persistence error after provider success is an unknown result, never another external request.
    return this.transaction(async tx => {
      await this.member(tx, householdId, userId, true);
      const current = await this.owned(tx, userId, householdId, id);
      if (!this.matches(current, id, claim.row.version)) return { item: await this.dto(tx, current) };
      const [row] = await tx.update(connections).set({ status: 'select_account', version: bump(current),
        token: this.vault.encrypt({ accessToken: token.accessToken }, context(current, 'token')), tokenExpiresAt: token.expiresAt,
        accounts: this.vault.encrypt(accounts, context(current, 'accounts')), operationId: null, operationStartedAt: null,
        errorCode: null, updatedAt: new Date() }).where(and(eq(connections.id, id), eq(connections.version, current.version))).returning();
      if (!row) throw conflict();
      return { item: await this.dto(tx, row) };
    });
  }

  private matches(row: Row, operationId: string, version: number): boolean {
    return !row.disconnectedAt && row.operationId === operationId && row.version === version;
  }

  private async recordIssuance(id: string, fingerprint: string, state: 'complete' | 'uncertain'): Promise<void> {
    await this.transaction(async tx => {
      // This only settles the durable authority marker. It cannot restore keys,
      // consent, status, membership or an already-disconnected connection.
      await tx.update(connections).set({ tokenIssuance: state }).where(and(eq(connections.id, id),
        eq(connections.clientFingerprint, fingerprint), eq(connections.tokenIssuance, 'started')));
    });
  }

  private async claimActive(userId: string, householdId: string, id: string, operationId: string, version: number): Promise<boolean> {
    return this.transaction(async tx => {
      await this.member(tx, householdId, userId, true);
      return this.matches(await this.owned(tx, userId, householdId, id), operationId, version);
    });
  }

  private async result(userId: string, householdId: string, id: string): Promise<FinanceConnectionResult> {
    return this.transaction(async tx => {
      await this.member(tx, householdId, userId);
      return { item: await this.dto(tx, await this.owned(tx, userId, householdId, id)) };
    });
  }

  async selectAccount(user: string, idValue: string, request: FinanceConnectionSelectAccount): Promise<FinanceConnectionResult> {
    const userId = actor(user), id = actor(idValue), input = parse(financeConnectionSelectAccountSchema, request), householdId = input.householdId.toLowerCase();
    if (!this.vault.enabled) throw disabled();
    return this.transaction(async tx => {
      await this.member(tx, householdId, userId, true);
      const current = await this.owned(tx, userId, householdId, id);
      if (current.disconnectedAt) throw conflict();
      if (current.selectedAccountId === input.accountId) return { item: await this.dto(tx, current) };
      if (current.version !== input.expectedVersion || current.status !== 'select_account' || current.operationId) throw conflict();
      const account = this.accounts(current).find(item => item.id === input.accountId);
      if (!account) throw new BadRequestException('조회할 계좌를 목록에서 선택해 주세요.');
      const [row] = await tx.update(connections).set({ selectedAccountId: account.id, status: 'ready',
        // Discard unselected provider identifiers once the user has chosen.
        accounts: this.vault.encrypt([account], context(current, 'accounts')),
        version: bump(current), updatedAt: new Date() }).where(and(eq(connections.id, id), eq(connections.version, current.version))).returning();
      if (!row) throw conflict();
      return { item: await this.dto(tx, row) };
    });
  }

  async refresh(user: string, idValue: string, request: FinanceConnectionRefresh): Promise<FinanceConnectionResult> {
    const userId = actor(user), id = actor(idValue), input = parse(financeConnectionRefreshSchema, request);
    const householdId = input.householdId.toLowerCase(), requestId = input.requestId.toLowerCase();
    if (!this.vault.enabled) throw disabled();
    const claim = await this.transaction(async tx => {
      await this.member(tx, householdId, userId, true);
      const current = await this.owned(tx, userId, householdId, id);
      const [prior] = await tx.select({ id: snapshots.id }).from(snapshots).where(and(eq(snapshots.id, requestId),
        eq(snapshots.connectionId, id), eq(snapshots.ownerUserId, userId), eq(snapshots.householdId, householdId))).limit(1);
      if (prior || current.operationId || current.disconnectedAt) return { row: current, fresh: false, renew: false };
      if (current.version !== input.expectedVersion) throw conflict();
      // Reserve both the durable claim and its terminal result before any I/O.
      // Consent withdrawal has a separate saturating path and never gets stuck here.
      if (current.version >= 2_147_483_646) throw conflict();
      const projected = projectFinanceState(current, this.vault.enabled);
      if (!projected.canRefresh) return { row: current, fresh: false, renew: false };
      const now = new Date(), version = bump(current);
      const renew = Boolean(current.tokenExpiresAt && current.tokenExpiresAt.getTime() <= now.getTime());
      await tx.insert(snapshots).values({ id: requestId, connectionId: id, householdId, ownerUserId: userId, connectionVersion: version, state: 'pending', createdAt: now });
      const [row] = await tx.update(connections).set({ status: 'refreshing', operationId: requestId,
        operationStartedAt: now, lastAttemptAt: now, errorCode: null, version, updatedAt: now })
        .where(and(eq(connections.id, id), eq(connections.version, current.version))).returning();
      if (!row) throw conflict();
      if (renew) {
        const [renewing] = await tx.update(connections).set({ tokenIssuance: 'started', token: null, tokenExpiresAt: null })
          .where(and(eq(connections.id, id), eq(connections.version, version))).returning();
        if (!renewing) throw conflict();
        return { row: renewing, fresh: true, renew: true };
      }
      return { row, fresh: true, renew: false };
    });
    if (!claim.fresh) return this.result(userId, householdId, id);
    let payload: FinanceConnectionSnapshot;
    let renewalEntered = false;
    try {
      if (!await this.claimActive(userId, householdId, id, requestId, claim.row.version)) {
        if (claim.renew) await this.recordIssuance(id, claim.row.clientFingerprint, 'complete');
        return this.result(userId, householdId, id);
      }
      const account = this.accounts(claim.row).find(item => item.id === claim.row.selectedAccountId);
      if (!account || (!claim.renew && !claim.row.token)) {
        if (claim.renew) await this.recordIssuance(id, claim.row.clientFingerprint, 'complete');
        return this.finishFailure(userId, householdId, id, requestId, claim.row.version, 'account_unavailable', true);
      }
      renewalEntered = claim.renew;
      const accessToken = claim.renew
        ? await this.renewToken(userId, householdId, claim.row, requestId)
        : z.object({ accessToken: z.string().min(1).max(32_768) }).strict()
          .parse(this.vault.decrypt(claim.row.token!, context(claim.row, 'token'))).accessToken;
      if (accessToken === null || !await this.claimActive(userId, householdId, id, requestId, claim.row.version)) return this.result(userId, householdId, id);
      payload = financeConnectionSnapshotSchema.parse(await this.provider.holdings(accessToken, account.accountKey));
    } catch (error) {
      if (claim.renew && !renewalEntered) await this.recordIssuance(id, claim.row.clientFingerprint, 'complete');
      if (error instanceof HttpException) throw error;
      const code = error instanceof ProviderError ? (error.issuanceUncertain ? 'token_uncertain' : error.code) : 'configuration_unavailable';
      return this.finishFailure(userId, householdId, id, requestId, claim.row.version, code, true,
        error instanceof ProviderError ? error.retryAfterSeconds : null);
    }
    return this.transaction(async tx => {
      await this.member(tx, householdId, userId, true);
      const current = await this.owned(tx, userId, householdId, id);
      if (!this.matches(current, requestId, claim.row.version)) return { item: await this.dto(tx, current) };
      const now = new Date();
      const [observation] = await tx.update(snapshots).set({ state: 'succeeded', payload,
        completedAt: now }).where(and(eq(snapshots.id, requestId), eq(snapshots.connectionId, id), eq(snapshots.state, 'pending'))).returning({ id: snapshots.id });
      if (!observation) throw conflict();
      const [row] = await tx.update(connections).set({ status: 'ready', operationId: null, operationStartedAt: null,
        lastSnapshotId: requestId, lastSuccessAt: new Date(payload.observedAt), errorCode: null, retryNotBefore: null,
        version: bump(current), updatedAt: now }).where(and(eq(connections.id, id), eq(connections.version, current.version))).returning();
      if (!row) throw conflict();
      return { item: await this.dto(tx, row) };
    });
  }

  private async renewToken(userId: string, householdId: string, row: Row, requestId: string): Promise<string | null> {
    let attempted = false;
    let token: { accessToken: string; expiresAt: Date };
    try {
      if (!row.credentials) throw new Error('credential unavailable');
      const credential = z.object({ clientId: z.string().min(1).max(512), clientSecret: z.string().min(1).max(2048) }).strict()
        .parse(this.vault.decrypt(row.credentials, context(row, 'credentials')));
      if (!await this.claimActive(userId, householdId, row.id, requestId, row.version)) {
        await this.recordIssuance(row.id, row.clientFingerprint, 'complete');
        return null;
      }
      attempted = true;
      token = await this.provider.issueToken(credential.clientId, credential.clientSecret);
    } catch (error) {
      const definite = !attempted || (error instanceof ProviderError && !error.issuanceUncertain);
      await this.recordIssuance(row.id, row.clientFingerprint, definite ? 'complete' : 'uncertain');
      throw error;
    }
    await this.recordIssuance(row.id, row.clientFingerprint, 'complete');
    return this.transaction(async tx => {
      await this.member(tx, householdId, userId, true);
      const current = await this.owned(tx, userId, householdId, row.id);
      if (!this.matches(current, requestId, row.version)) return null;
      const [saved] = await tx.update(connections).set({ token: this.vault.encrypt({ accessToken: token.accessToken }, context(current, 'token')),
        tokenExpiresAt: token.expiresAt }).where(and(eq(connections.id, row.id), eq(connections.version, row.version), eq(connections.operationId, requestId)))
        .returning({ id: connections.id });
      return saved ? token.accessToken : null;
    });
  }

  private async finishFailure(userId: string, householdId: string, id: string, operationId: string, version: number,
    error: FinanceConnectionError, readAttempt: boolean, retryAfterSeconds: number | null = null): Promise<FinanceConnectionResult> {
    const code = financeConnectionErrorSchema.parse(error);
    return this.transaction(async tx => {
      await this.member(tx, householdId, userId, true);
      const current = await this.owned(tx, userId, householdId, id);
      if (!this.matches(current, operationId, version)) return { item: await this.dto(tx, current) };
      const now = new Date();
      const retryAt = financeRetryNotBefore(retryAfterSeconds, now);
      const retryNotBefore = retryAt ? new Date(Math.max(retryAt.getTime(), current.retryNotBefore?.getTime() ?? 0)) : current.retryNotBefore;
      if (readAttempt) await tx.update(snapshots).set({ state: 'failed', errorCode: code, completedAt: now })
        .where(and(eq(snapshots.id, operationId), eq(snapshots.connectionId, id), eq(snapshots.state, 'pending')));
      const [row] = await tx.update(connections).set({ status: ['token_expired', 'token_uncertain'].includes(code) ? 'reauth_required' : 'error',
        operationId: null, operationStartedAt: null, errorCode: code, retryNotBefore, version: bump(current), updatedAt: now })
        .where(and(eq(connections.id, id), eq(connections.version, current.version))).returning();
      if (!row) throw conflict();
      return { item: await this.dto(tx, row) };
    });
  }

  async disconnect(user: string, idValue: string, request: FinanceConnectionDisconnect): Promise<FinanceConnectionResult> {
    const userId = actor(user), id = actor(idValue), input = parse(financeConnectionDisconnectSchema, request), householdId = input.householdId.toLowerCase();
    // Disconnection and secret purge remain available when provider access is disabled.
    return this.transaction(async tx => {
      await this.member(tx, householdId, userId, true);
      const current = await this.owned(tx, userId, householdId, id);
      if (current.disconnectedAt) return { item: await this.dto(tx, current) };
      if (current.version !== input.expectedVersion) throw conflict();
      const now = new Date();
      await tx.update(snapshots).set({ state: 'failed', errorCode: 'operation_unknown', completedAt: now })
        .where(and(eq(snapshots.connectionId, id), eq(snapshots.state, 'pending')));
      const [row] = await tx.update(connections).set({ status: 'disconnected', disconnectedAt: now, refreshOnOpen: false,
        credentials: null, token: null, tokenExpiresAt: null, accounts: null, selectedAccountId: null,
        operationId: null, operationStartedAt: null, errorCode: null,
        version: Math.min(current.version + 1, 2_147_483_647), updatedAt: now })
        .where(and(eq(connections.id, id), eq(connections.version, current.version))).returning();
      if (!row) throw conflict();
      return { item: await this.dto(tx, row) };
    });
  }
}
