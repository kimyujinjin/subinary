import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Db } from '@family/database';
import type { ConfigService } from '@nestjs/config';
import { FinanceVault } from '../finance-connections/finance-vault';
import { macBankCredentialSaveSchema, macBankCredentialResultSchema, macBankJobSchema } from '@family/contracts';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { MacBankRunnerService } from './mac-bank-runner.service';

const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const user = uuid(1), home = uuid(2), memberId = uuid(3), runnerId = uuid(4), jobId = uuid(5), claimId = uuid(6);
const now = new Date('2026-11-03T06:00:00.000Z'), joined = new Date('2026-11-01T00:00:00.000Z');
const secret = 'a'.repeat(64), userCode = 'b'.repeat(32);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const member = { id: memberId, joined_at: joined };
const runner = () => ({ id: runnerId, secret_hash: digest(secret), user_code_hash: digest(userCode), label: '합성 Mac',
  pair_expires_at: new Date(now.getTime() + 600_000), owner_user_id: user, household_id: home, member_id: memberId,
  member_joined_at: joined, grant_expires_at: new Date(now.getTime() + 86_400_000), revoked_at: null, last_seen_at: now, created_at: now });
const job = (state = 'claimed') => ({ id: jobId, runner_id: runnerId, owner_user_id: user, household_id: home,
  member_id: memberId, member_joined_at: joined, state, claim_id: claimId, claimed_at: now, expires_at: new Date(now.getTime() + 600_000),
  continue_version: 0, error_code: null, logout_confirmed: false, observations: [], completion_hash: null,
  created_at: now, updated_at: now, completed_at: null });
const capture = { formatVersion: 1, provider: 'shinhan', source: 'browser_assisted', origin: 'https://bank.shinhan.com',
  pageKind: 'deposit_account_list', capturedAt: now.toISOString(), accountFingerprint: 'c'.repeat(64), accountLast4: '1234',
  currency: 'KRW', balanceKind: 'ledger', balanceKrw: '0', bankAsOfDate: null };
const dialect = new PgDialect();

/** 실제 Drizzle 변환을 거쳐 날짜 객체가 raw SQL 바인딩에 남으면 고정 오류로 중단한다. */
function assertIsoBindings(query: SQL): void {
  if (dialect.sqlToQuery(query).params.some(value => value instanceof Date))
    throw new Error('raw_timestamp_requires_iso_string');
}

/** DB 경계 응답만 대체하고 실제 서비스의 승인·재전송·종료 분기를 실행한다. */
const testVault = () => new FinanceVault({ get: () => ({ enabled: true, activeKeyVersion: 1,
  keyring: { '1': 'ab'.repeat(32) } }) } as unknown as ConfigService);
function harness(answers: unknown[][], credentialAnswers: unknown[][] = [], vault = testVault()) {
  const execute = vi.fn(async (query: SQL) => { assertIsoBindings(query); return []; });
  const db = { transaction: async (work: (tx: { execute: typeof execute }) => Promise<unknown>) => work({ execute }) };
  const service = new MacBankRunnerService(db as unknown as Db, vault);
  const queue = [[{ ready: true }], [{ now }], ...answers];
  const rows = vi.spyOn(service as unknown as { rows: (tx: unknown, query: unknown) => Promise<unknown[]> }, 'rows')
    .mockImplementation(async (_tx, query) => {
      assertIsoBindings(query as SQL);
      if (/^select \* from mac_bank_runner_credentials/i.test(dialect.sqlToQuery(query as SQL).sql))
        return credentialAnswers.shift() ?? [];
      return queue.shift() ?? [];
    });
  return { service, execute, rows, vault };
}
const authorized = () => [[{ id: user }], [{ id: home }], [member]];
const worker = () => [[runner()], ...authorized(), [runner()]];

describe('Mac 전용 grant와 본인 작업 서비스', () => {
  it('페어링 INSERT의 새 Date 만료 시각은 실제 PgDialect에서 ISO 문자열로 바인딩한다', async () => {
    const { service, execute } = harness([[runner()]]);
    await service.pair({ pairId: runnerId, secret, userCode, label: '합성 Mac' });
    const expected = new Date(now.getTime() + 600_000).toISOString();
    const capturedIso = execute.mock.calls.some(([query]) => dialect.sqlToQuery(query).params.includes(expected));
    // 실제 SQL과 매개변수를 assertion 출력에 포함하지 않는다.
    expect(capturedIso).toBe(true);
  });
  it('신규 작업의 가입 시점·온라인 경계·만료 Date는 모두 ISO 문자열이다', async () => {
    const queued = { ...job('queued'), claim_id: null, claimed_at: null };
    const { service, rows } = harness([...authorized(), [], [], [runner()], [queued]]);
    expect((await service.enqueue(user, { householdId: home, requestId: jobId })).job.state).toBe('queued');
    const parameters = rows.mock.calls.flatMap(([, query]) => dialect.sqlToQuery(query as SQL).params);
    expect(parameters.includes(joined.toISOString())).toBe(true);
    expect(parameters.includes(new Date(now.getTime() - 30_000).toISOString())).toBe(true);
    expect(parameters.includes(new Date(now.getTime() + 600_000).toISOString())).toBe(true);
  });
  it('첫 claim의 INSERT 이후 갱신 시각과 TTL은 ISO 문자열로 전달한다', async () => {
    const queued = { ...job('queued'), claim_id: null, claimed_at: null };
    const { service, rows } = harness([...worker(), [], [queued], [job()]]);
    expect((await service.claim(secret, { claimId })).job?.state).toBe('claimed');
    // 직전 claim 시각으로 막지 않는다(조회 간격 제한 없음).
    expect(rows.mock.calls.some(([, query]) => dialect.sqlToQuery(query as SQL).sql.includes('claimed_at>'))).toBe(false);
    const parameters = rows.mock.calls.flatMap(([, query]) => dialect.sqlToQuery(query as SQL).params);
    expect(parameters.includes(now.toISOString())).toBe(true);
    expect(parameters.includes(new Date(now.getTime() + 600_000).toISOString())).toBe(true);
  });
  it('미승인 heartbeat는 대기 상태를 반환하고 실행 작업을 주지 않는다', async () => {
    const pending = { ...runner(), owner_user_id: null, household_id: null, member_id: null, member_joined_at: null, grant_expires_at: null };
    const { service, execute } = harness([[pending]]);
    expect(await service.heartbeat(secret)).toMatchObject({ paired: false, runnerId, job: null, grantExpiresAt: null });
    expect(execute).not.toHaveBeenCalled();
  });
  it('페어링 재전송은 같은 hash만 허용하며 응답에 비밀값을 담지 않는다', async () => {
    const first = harness([[runner()]]);
    const result = await first.service.pair({ pairId: runnerId, secret, userCode, label: '합성 Mac' });
    expect(result.runnerId).toBe(runnerId);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(userCode);
    const changed = harness([[{ ...runner(), secret_hash: digest('d'.repeat(64)) }]]);
    await expect(changed.service.pair({ pairId: runnerId, secret, userCode, label: '합성 Mac' })).rejects.toBeInstanceOf(ConflictException);
  });
  it('가입 권한이 없으면 승인·작업 조회를 하지 않는다', async () => {
    const { service, rows } = harness([[], [{ id: home }], []]);
    await expect(service.approve(user, { householdId: home, pairId: runnerId, userCode })).rejects.toBeInstanceOf(ForbiddenException);
    expect(rows).toHaveBeenCalledTimes(5);
  });
  it('다른 가족 구성원의 승인된 grant는 덮어쓰지 않는다', async () => {
    const { service } = harness([...authorized(), [{ ...runner(), owner_user_id: uuid(20) }]]);
    await expect(service.approve(user, { householdId: home, pairId: runnerId, userCode })).rejects.toBeInstanceOf(ConflictException);
  });
  it('승인은 7일이고 반환값은 실행기 ID·만료 시각뿐이다', async () => {
    const pending = { ...runner(), owner_user_id: null, household_id: null, member_id: null, member_joined_at: null, grant_expires_at: null };
    const { service } = harness([...authorized(), [pending]]);
    expect(await service.approve(user, { householdId: home, pairId: runnerId, userCode }))
      .toEqual({ runnerId, expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString() });
  });
  it('최초 명시적 해제 전까지 승인은 소유 범위와 함께 null 만료를 저장한다', async () => {
    const pending = { ...runner(), owner_user_id: null, household_id: null, member_id: null, member_joined_at: null, grant_expires_at: null };
    const { service } = harness([...authorized(), [pending]]);
    expect(await service.approve(user, { householdId: home, pairId: runnerId, userCode, grantMode: 'until_revoked' }))
      .toEqual({ runnerId, expiresAt: null });
  });
  it('기존 7일 승인은 본인의 명시적 재승인에서만 만료 없음으로 확대한다', async () => {
    for (const grant of [runner(), { ...runner(), grant_expires_at: new Date(now.getTime() - 1) }]) {
      const { service, execute } = harness([...authorized(), [grant]]);
      expect(await service.approve(user, { householdId: home, pairId: runnerId, userCode, grantMode: 'until_revoked' }))
        .toEqual({ runnerId, expiresAt: null });
      expect(execute).toHaveBeenCalledTimes(2);
    }
  });
  it('생략 또는 7일 모드는 기존 승인 만료를 갱신하거나 영구 승인을 강등하지 않는다', async () => {
    for (const grantMode of [undefined, 'seven_days']) {
      for (const grant of [runner(), { ...runner(), grant_expires_at: null }]) {
        const { service, execute } = harness([...authorized(), [grant]]);
        const result = await service.approve(user, { householdId: home, pairId: runnerId, userCode, ...(grantMode ? { grantMode } : {}) });
        expect(result).toEqual({ runnerId, expiresAt: grant.grant_expires_at?.toISOString() ?? null });
        expect(execute).toHaveBeenCalledTimes(1);
      }
    }
  });
  it('만료된 7일 승인은 기본 재전송만으로 갱신되지 않는다', async () => {
    const { service } = harness([...authorized(), [{ ...runner(), grant_expires_at: now }]]);
    await expect(service.approve(user, { householdId: home, pairId: runnerId, userCode })).rejects.toBeInstanceOf(ConflictException);
  });
  it('철회·다른 owner·다른 가입 세대는 영구 모드 재승인으로 복구되지 않는다', async () => {
    for (const changed of [{ ...runner(), revoked_at: now }, { ...runner(), owner_user_id: uuid(20) },
      { ...runner(), member_joined_at: new Date(joined.getTime() - 1) }]) {
      const { service, execute } = harness([...authorized(), [changed]]);
      await expect(service.approve(user, { householdId: home, pairId: runnerId, userCode, grantMode: 'until_revoked' })).rejects.toThrow();
      expect(execute).toHaveBeenCalledTimes(1);
    }
  });
  it('영구 grant의 heartbeat는 paired true와 null 만료를 반환하지만 만료된 7일은 거부한다', async () => {
    const forever = { ...runner(), grant_expires_at: null };
    const live = harness([[forever], ...authorized(), [forever], []]);
    expect(await live.service.heartbeat(secret)).toMatchObject({ paired: true, grantExpiresAt: null });
    const expired = { ...runner(), grant_expires_at: now };
    const old = harness([[expired], ...authorized(), [expired]]);
    await expect(old.service.heartbeat(secret)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('영구 grant도 취소 뒤 도착한 완료와 철회 뒤 요청을 허용하지 않는다', async () => {
    const forever = { ...runner(), grant_expires_at: null };
    const late = harness([[forever], ...authorized(), [forever], [{ ...job('cancelled'), completed_at: now }]]);
    const result = await late.service.complete(secret, jobId, { claimId, outcome: 'succeeded', logoutConfirmed: true, observations: [capture] });
    expect(result.job.state).toBe('cancelled'); expect(result.job.observations).toEqual([]);
    const revoked = harness([[{ ...forever, revoked_at: now }]]);
    await expect(revoked.service.heartbeat(secret)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('상태와 신규 작업도 만료 없는 본인 grant를 처리한다', async () => {
    const forever = { ...runner(), grant_expires_at: null };
    const state = harness([...authorized(), [forever], [], []]);
    expect((await state.service.state(user, { householdId: home })).runner?.expiresAt).toBeNull();
    const queued = { ...job('queued'), claim_id: null, claimed_at: null };
    const next = harness([...authorized(), [], [], [forever], [queued]]);
    expect((await next.service.enqueue(user, { householdId: home, requestId: jobId })).job.state).toBe('queued');
  });
  it('조회 간격 제한 없이 진행 중인 작업만 새 요청을 막는다', async () => {
    const queued = { ...job('queued'), claim_id: null, claimed_at: null };
    const { service, rows } = harness([...authorized(), [], [], [runner()], [queued]]);
    expect((await service.enqueue(user, { householdId: home, requestId: jobId })).job.state).toBe('queued');
    expect(rows.mock.calls.some(([, query]) => dialect.sqlToQuery(query as SQL).sql.includes('claimed_at>'))).toBe(false);
    const busy = harness([...authorized(), [], [{ id: uuid(30) }]]);
    await expect(busy.service.enqueue(user, { householdId: home, requestId: jobId })).rejects.toBeInstanceOf(ConflictException);
  });
  it('동일 requestId의 기존 결과는 반환하고 새 작업을 생성하지 않는다', async () => {
    const { service, execute } = harness([...authorized(), [job()]]);
    expect((await service.enqueue(user, { householdId: home, requestId: jobId })).job.id).toBe(jobId);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('다른 owner 또는 재가입 세대의 requestId 재생은 거부한다', async () => {
    for (const changed of [{ ...job(), owner_user_id: uuid(20) }, { ...job(), member_joined_at: new Date(joined.getTime() - 1) }]) {
      const { service } = harness([...authorized(), [changed]]);
      await expect(service.enqueue(user, { householdId: home, requestId: jobId })).rejects.toBeInstanceOf(ConflictException);
    }
  });
  it('동일 살아 있는 claim은 반환하고 만료된 claim은 다시 실행하지 않는다', async () => {
    const live = harness([...worker(), [job()]]);
    expect((await live.service.claim(secret, { claimId })).job?.state).toBe('claimed');
    const stale = harness([...worker(), [{ ...job(), expires_at: now }]]);
    expect(await stale.service.claim(secret, { claimId })).toEqual({ job: null });
    expect(stale.execute).toHaveBeenCalledTimes(2);
  });
  it('철회된 grant는 claim과 결과 저장 전에 거부한다', async () => {
    const { service, execute } = harness([[{ ...runner(), revoked_at: now }]]);
    await expect(service.claim(secret, { claimId })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(execute).not.toHaveBeenCalled();
  });
  it('취소 뒤 도착한 정상 관측도 현재 작업을 성공으로 복구하지 않는다', async () => {
    const cancelled = { ...job('cancelled'), completed_at: now };
    const { service, execute } = harness([...worker(), [cancelled]]);
    const result = await service.complete(secret, jobId, { claimId, outcome: 'succeeded', logoutConfirmed: true, observations: [capture] });
    expect(result.job.state).toBe('cancelled'); expect(result.job.observations).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('로그아웃 단계가 아닌 성공은 저장하지 않는다', async () => {
    const { service } = harness([...worker(), [job('reading')]]);
    await expect(service.complete(secret, jobId, { claimId, outcome: 'succeeded', logoutConfirmed: true, observations: [capture] }))
      .rejects.toBeInstanceOf(ConflictException);
  });
  it('인증 대기 완료는 종료하지 않고 같은 claim을 유지한다', async () => {
    const waiting = { ...job('authentication_required'), error_code: 'authentication_required' };
    const { service } = harness([...worker(), [job('running')], [waiting]]);
    const result = await service.complete(secret, jobId, { claimId, outcome: 'authentication_required', logoutConfirmed: false, observations: [] });
    expect(result.job).toMatchObject({ state: 'authentication_required', claimId, completedAt: null, continueVersion: 0 });
  });
  it('저장소 미적용은 일반 오류 대신 정직한 503이다', async () => {
    const { service, rows } = harness([]);
    rows.mockResolvedValueOnce([{ ready: false }]);
    await expect(service.state(user, { householdId: home })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('정상 로그아웃 뒤 성공 관측을 저장하고 secret을 DTO에 포함하지 않는다', async () => {
    const success = { ...job('succeeded'), logout_confirmed: true, observations: [capture], completed_at: now };
    const { service } = harness([...worker(), [job('logging_out')], [success]]);
    const result = await service.complete(secret, jobId, { claimId, outcome: 'succeeded', logoutConfirmed: true, observations: [capture] });
    expect(result.job).toMatchObject({ state: 'succeeded', logoutConfirmed: true, observations: [{ balanceKrw: '0' }] });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('secret_hash');
  });
  it('사용자 확인은 인증 대기를 재개하고 중복 확인은 counter를 늘리지 않는다', async () => {
    const waiting = job('authentication_required'), resumed = { ...job('running'), continue_version: 1 };
    const first = harness([...authorized(), [waiting], [resumed]]);
    expect((await first.service.continue(user, jobId, { householdId: home })).job.continueVersion).toBe(1);
    const duplicate = harness([...authorized(), [resumed]]);
    expect((await duplicate.service.continue(user, jobId, { householdId: home })).job.continueVersion).toBe(1);
    expect(duplicate.execute).toHaveBeenCalledTimes(2);
  });
  it('실패한 최신 작업과 이전 성공 관측은 별도로 반환한다', async () => {
    const previous = { ...job('succeeded'), id: uuid(15), completed_at: now, observations: [capture], logout_confirmed: true };
    const failed = { ...job('failed'), completed_at: now, error_code: 'network_error' };
    const { service } = harness([...authorized(), [runner()], [failed], [previous]]);
    const result = await service.state(user, { householdId: home });
    expect(result.job).toMatchObject({ state: 'failed', observations: [] });
    expect(result.previousResult).toMatchObject({ jobId: uuid(15), observations: [{ balanceKrw: '0' }] });
  });
  it('본인 grant 철회는 진행 작업만 취소하며 다른 가족 grant는 찾지 못한다', async () => {
    const own = harness([...authorized(), [runner()]]);
    expect(await own.service.revoke(user, runnerId, { householdId: home })).toEqual({ revoked: true });
    expect(own.execute).toHaveBeenCalledTimes(3);
    const foreign = harness([...authorized(), []]);
    await expect(foreign.service.revoke(user, runnerId, { householdId: home })).rejects.toThrow('본인 Mac 연결');
    expect(foreign.execute).toHaveBeenCalledTimes(1);
  });
  it('이전 성공과 다른 완료 재전송은 결과를 덮어쓰지 않는다', async () => {
    const completed = { ...job('succeeded'), observations: [capture], completed_at: now, logout_confirmed: true,
      completion_hash: digest('different completed payload') };
    const { service } = harness([...worker(), [completed]]);
    await expect(service.complete(secret, jobId, { claimId, outcome: 'failed', logoutConfirmed: false, observations: [] }))
      .rejects.toBeInstanceOf(ConflictException);
  });
});

describe('Mac claim 전용 암호화 로그인 정보', () => {
  const login = { loginId: 'synthetic-login-private-canary', password: 'SyntheticPasswordPrivateCanary!' };
  const saveInput = { householdId: home, runnerId, ...login, consentVersion: 1, expectedVersion: null };
  const credentialId = uuid(70);
  function stored(vault: FinanceVault, version = 1) {
    return { id: credentialId, runner_id: runnerId, owner_user_id: user, household_id: home, member_id: memberId,
      member_joined_at: joined, version, updated_at: now,
      envelope: vault.encrypt({ ...login, credentialVersion: version, householdId: home, memberId,
        memberJoinedAt: joined.toISOString(), runnerId }, { ownerUserId: user, provider: 'shinhan_bank',
        connectionId: credentialId, purpose: 'credentials' }) };
  }
  const boundJob = (change: Record<string, unknown> = {}) => ({ ...job(), credential_version: 1, credential_delivered_at: null, consent_version: 2, ...change });
  it('별도 저장 동의·버전·길이·제어문자 계약을 엄격하게 검사한다', () => {
    expect(macBankCredentialSaveSchema.safeParse(saveInput).success).toBe(true);
    for (const input of [{ ...saveInput, consentVersion: undefined }, { ...saveInput, expectedVersion: undefined },
      { ...saveInput, password: '' }, { ...saveInput, loginId: ' ' }, { ...saveInput, password: 'x\n' },
      { ...saveInput, password: 'x'.repeat(201) }, { ...saveInput, extra: true }])
      expect(macBankCredentialSaveSchema.safeParse(input).success).toBe(false);
  });
  it('저장 SQL에는 AES-GCM envelope만 있고 상태 응답에 평문은 없다', async () => {
    const { service, execute } = harness([...authorized(), [runner()], []]);
    const result = await service.saveCredentials(user, saveInput);
    expect(result).toEqual({ stored: true, runnerId, version: 1, updatedAt: now.toISOString() });
    const parameters = execute.mock.calls.flatMap(([query]) => dialect.sqlToQuery(query).params);
    const leaked = parameters.some(value => typeof value === 'string' && (value.includes(login.loginId) || value.includes(login.password)));
    expect(leaked).toBe(false);
    expect(JSON.stringify(result).includes(login.password)).toBe(false);
  });
  it('저장·삭제는 active 작업과 오래된 expectedVersion을 거부한다', async () => {
    const vault = testVault(), row = stored(vault);
    for (const operation of ['save', 'delete']) {
      const busy = harness([...authorized(), [runner()], [{ id: jobId }]], [[row]], vault);
      const action = operation === 'save' ? busy.service.saveCredentials(user, saveInput)
        : busy.service.deleteCredentials(user, { householdId: home, runnerId, expectedVersion: 1 });
      await expect(action).rejects.toBeInstanceOf(ConflictException);
      const stale = harness([...authorized(), [runner()], []], [[row]], vault);
      const staleAction = operation === 'save' ? stale.service.saveCredentials(user, saveInput)
        : stale.service.deleteCredentials(user, { householdId: home, runnerId, expectedVersion: 2 });
      await expect(staleAction).rejects.toBeInstanceOf(ConflictException);
    }
  });
  it('삭제는 평문 조회 없이 암호문만 폐기하고 버전을 올린다', async () => {
    const vault = testVault(), row = stored(vault);
    const { service } = harness([...authorized(), [runner()], []], [[row]], vault);
    expect(await service.deleteCredentials(user, { householdId: home, runnerId, expectedVersion: 1 }))
      .toEqual({ stored: false, runnerId, version: 2, updatedAt: now.toISOString() });
  });
  it('철회되거나 다른 가입 세대인 실행기에는 저장할 수 없다', async () => {
    const denied = harness([...authorized(), []]);
    await expect(denied.service.saveCredentials(user, saveInput)).rejects.toBeInstanceOf(NotFoundException);
    const revoked = harness([...authorized(), [{ ...runner(), revoked_at: now }]]);
    await expect(revoked.service.saveCredentials(user, saveInput)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('새 작업만 현재 credentialVersion에 결박하고 DTO에는 비밀을 넣지 않는다', async () => {
    const vault = testVault(), row = stored(vault), queued = { ...boundJob(), state: 'queued', claim_id: null, claimed_at: null };
    const { service } = harness([...authorized(), [], [], [runner()], [queued]], [[row]], vault);
    const result = (await service.enqueue(user, { householdId: home, requestId: jobId, consentVersion: 2 })).job;
    expect(result.credentialVersion).toBe(1);
    expect(JSON.stringify(result).includes(login.loginId)).toBe(false);
    expect(macBankJobSchema.safeParse({ ...result, password: login.password }).success).toBe(false);
  });
  it('살아 있는 동일 claim 최초 전달은 한번만 원자 표시하고 복호화한다', async () => {
    const vault = testVault(), row = stored(vault);
    const { service, rows } = harness([...worker(), [boundJob()], [{ id: jobId }]], [[row]], vault);
    const result = await service.retrieveCredentials(secret, jobId, { claimId, credentialVersion: 1 });
    expect(result.loginId === login.loginId && result.password === login.password).toBe(true);
    expect(macBankCredentialResultSchema.safeParse(result).success).toBe(true);
    expect(rows.mock.calls.some(([, query]) => dialect.sqlToQuery(query as SQL).sql.includes('credential_delivered_at is null'))).toBe(true);
  });
  it('이미 전달됨·기존 수동작업·인증대기·재개·만료·다른 버전에는 전달하지 않는다', async () => {
    for (const change of [{ credential_delivered_at: now }, { credential_version: null }, { consent_version: 1 }, { state: 'authentication_required' },
      { continue_version: 1 }, { expires_at: new Date(now.getTime() - 1) }, { credential_version: 2 }, { state: 'cancelled' }]) {
      const { service } = harness([...worker(), [boundJob(change)]]);
      await expect(service.retrieveCredentials(secret, jobId, { claimId, credentialVersion: 1 })).rejects.toBeInstanceOf(ConflictException);
    }
  });
  it('전달 경합·다른 claim·삭제됨·버전 변경·암호문 범위 변경을 거부한다', async () => {
    const vault = testVault(), row = stored(vault);
    const raced = harness([...worker(), [boundJob()], []], [[row]], vault);
    await expect(raced.service.retrieveCredentials(secret, jobId, { claimId, credentialVersion: 1 })).rejects.toBeInstanceOf(ConflictException);
    const wrongClaim = harness([...worker(), [boundJob({ claim_id: uuid(88) })]], [[row]], vault);
    await expect(wrongClaim.service.retrieveCredentials(secret, jobId, { claimId, credentialVersion: 1 })).rejects.toBeInstanceOf(ConflictException);
    for (const changed of [{ ...row, envelope: null }, { ...row, version: 2 }]) {
      const invalid = harness([...worker(), [boundJob()]], [[changed]], vault);
      await expect(invalid.service.retrieveCredentials(secret, jobId, { claimId, credentialVersion: 1 })).rejects.toBeInstanceOf(ConflictException);
    }
    const tampered = harness([...worker(), [boundJob()], [{ id: jobId }]], [[{ ...row, id: uuid(71) }]], vault);
    await expect(tampered.service.retrieveCredentials(secret, jobId, { claimId, credentialVersion: 1 })).rejects.toThrow();
  });
  it('암호화 저장소가 비활성이면 저장과 전달을 명확히 거부한다', async () => {
    const disabled = new FinanceVault({ get: () => ({ enabled: false }) } as unknown as ConfigService);
    const { service } = harness([], [], disabled);
    await expect(service.saveCredentials(user, saveInput)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.retrieveCredentials(secret, jobId, { claimId, credentialVersion: 1 })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('철회·만료·재가입 세대는 credential 전달 전에 거부한다', async () => {
    const revoked = harness([[{ ...runner(), revoked_at: now }]]);
    await expect(revoked.service.retrieveCredentials(secret, jobId, { claimId, credentialVersion: 1 })).rejects.toBeInstanceOf(UnauthorizedException);
    for (const changed of [{ ...runner(), grant_expires_at: new Date(now.getTime() - 1) },
      { ...runner(), member_joined_at: new Date(joined.getTime() - 1) }]) {
      const { service } = harness([[runner()], ...authorized(), [changed]]);
      await expect(service.retrieveCredentials(secret, jobId, { claimId, credentialVersion: 1 })).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });
  it('state에는 저장 상태만 반환하고 envelope·ID·비밀번호를 제외한다', async () => {
    const vault = testVault(), row = stored(vault);
    const { service } = harness([...authorized(), [runner()], [], []], [[row]], vault);
    const result = await service.state(user, { householdId: home });
    expect(result.credentials).toEqual({ stored: true, runnerId, version: 1, updatedAt: now.toISOString() });
    const raw = JSON.stringify(result);
    expect(raw.includes(login.loginId) || raw.includes(login.password) || raw.includes('ciphertext')).toBe(false);
  });
});
