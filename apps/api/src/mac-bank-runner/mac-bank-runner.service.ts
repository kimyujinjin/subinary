import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, InternalServerErrorException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@family/database';
import { macBankPairSchema, macBankApproveSchema, macBankScopeSchema, macBankJobRequestSchema, macBankClaimSchema,
  macBankProgressSchema, macBankCompleteSchema, macBankJobSchema, macBankCredentialSaveSchema, macBankCredentialDeleteSchema,
  macBankCredentialRequestSchema, macBankCredentialResultSchema, type MacBankCredentialState, type MacBankCredentialResult,
  type MacBankJob, type MacBankRunnerState,
  type MacBankHeartbeat, type MacBankJobState, type BankConnectionError } from '@family/contracts';
import { DB } from '../database/database.constants';
import { FinanceVault, type VaultEnvelope } from '../finance-connections/finance-vault';
import { MAC_BANK_ONLINE_MS, MAC_BANK_JOB_TTL_MS, macBankActive, macBankTransition,
  macBankClaimLive, macBankMembershipMatches, macBankRequestMatches, macBankObservations, macBankGrantActive } from './mac-bank-runner.policy';

type Tx = Pick<Db, 'execute'>;
type Time = Date | string;
type Member = { id: string; joined_at: Time };
type RunnerRow = { id: string; secret_hash: string; user_code_hash: string; label: string; pair_expires_at: Time;
  owner_user_id: string | null; household_id: string | null; member_id: string | null; member_joined_at: Time | null;
  grant_expires_at: Time | null; revoked_at: Time | null; last_seen_at: Time | null; created_at: Time };
type JobRow = { id: string; runner_id: string; household_id: string; owner_user_id: string; member_id: string; member_joined_at: Time;
  state: MacBankJobState; claim_id: string | null; claimed_at: Time | null; expires_at: Time; continue_version: number;
  error_code: BankConnectionError | null; logout_confirmed: boolean; observations: unknown; completion_hash: string | null;
  created_at: Time; updated_at: Time; completed_at: Time | null; credential_version?: number | null; credential_delivered_at?: Time | null; consent_version?: 1 | 2 };
type CredentialRow = { id: string; runner_id: string; household_id: string; owner_user_id: string; member_id: string;
  member_joined_at: Time; version: number; envelope: VaultEnvelope | null; updated_at: Time };
const credentialPayload = macBankCredentialResultSchema.extend({ householdId: z.string().uuid(), memberId: z.string().uuid(),
  memberJoinedAt: z.string().datetime({ offset: true }), runnerId: z.string().uuid() }).strict();
const credentialContext = (row: Pick<CredentialRow, 'id' | 'owner_user_id'>) =>
  ({ ownerUserId: row.owner_user_id, provider: 'shinhan_bank' as const, connectionId: row.id, purpose: 'credentials' as const });
const date = (value: Time): Date => value instanceof Date ? value : new Date(value);
const iso = (value: Time): string => date(value).toISOString();
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const equal = (left: string, right: string): boolean => timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
const conflict = () => new ConflictException('Mac 조회 작업 상태가 바뀌었어요. 현재 상태를 확인해 주세요.');
const active = sql`('queued','claimed','running','authentication_required','reading','logging_out')`;

/** ChatGPT 인증정보 없이 별도 Mac grant와 본인 조회 작업만 관리한다. */
@Injectable()
export class MacBankRunnerService {
  constructor(@Inject(DB) private readonly db: Db, private readonly vault: FinanceVault) {}

  private parse<T>(contract: z.ZodType<T>, input: unknown): T {
    const parsed = contract.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Mac 연결 요청 형식과 동의 항목을 확인해 주세요.');
    return parsed.data;
  }
  private async rows<T>(tx: Tx, query: SQL): Promise<T[]> {
    return await tx.execute(query) as unknown as T[];
  }
  private async tx<T>(work: (tx: Tx, now: Date) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(async tx => {
        const [ready] = await this.rows<{ ready: boolean }>(tx, sql`select to_regclass('public.mac_bank_runners') is not null
          and to_regclass('public.mac_bank_runner_jobs') is not null
          and exists(select 1 from public.mac_bank_runner_schema_migrations where version='mac-bank-runner-v3')
          and to_regclass('public.mac_bank_runner_credentials') is not null
          and exists(select 1 from pg_attribute where attrelid=to_regclass('public.mac_bank_runner_jobs') and attname='credential_version' and not attisdropped)
          and (select count(*) from pg_trigger where not tgisinternal and tgenabled in ('O','A')
            and tgname in ('mac_bank_job_credential_guard','mac_bank_credential_revoke'))=2
          and exists(select 1 from pg_attribute where attrelid=to_regclass('public.mac_bank_runner_jobs') and attname='completion_hash' and not attisdropped)
          and (select count(*) from pg_trigger where not tgisinternal and tgenabled in ('O','A') and tgname in
          ('mac_bank_job_guard','mac_bank_member_revoke','mac_bank_user_revoke','mac_bank_household_revoke'))=4 as ready`);
        if (!ready?.ready) throw new ServiceUnavailableException('Mac 연결 저장소를 준비하고 있어요.');
        const [clock] = await this.rows<{ now: Time }>(tx, sql`select now() as now`);
        return work(tx, date(clock.now));
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      let cause: unknown = error;
      for (let index = 0; index < 4 && cause && typeof cause === 'object'; index += 1) {
        const info = cause as { code?: unknown; cause?: unknown };
        if (['42P01', '42703'].includes(String(info.code))) throw new ServiceUnavailableException('Mac 연결 저장소를 준비하고 있어요.');
        if (['23505', '40001', '40P01', '55P03'].includes(String(info.code))) throw conflict();
        cause = info.cause;
      }
      throw new InternalServerErrorException('Mac 조회 결과를 확인하지 못했어요. 상태를 먼저 확인해 주세요.');
    }
  }
  private scope(input: unknown): string { return this.parse(macBankScopeSchema, input).householdId; }
  private async member(tx: Tx, user: string, household: string): Promise<Member> {
    this.parse(z.string().uuid(), user); this.parse(z.string().uuid(), household);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'mac-bank-owner:' + user},0))`);
    const users = await this.rows<{ id: string }>(tx, sql`select id from users where id=${user} and deleted_at is null for share`);
    const homes = await this.rows<{ id: string }>(tx, sql`select id from households where id=${household} and deleted_at is null for share`);
    const [member] = await this.rows<Member>(tx, sql`select id,joined_at from household_members where user_id=${user}
      and household_id=${household} and status='active' and role in ('owner','admin','member') for update`);
    if (!users.length || !homes.length || !member) throw new ForbiddenException('본인 Mac 연결 권한이 없습니다.');
    return member;
  }
  private async runner(tx: Tx, secret: string, now: Date, pending = false): Promise<RunnerRow> {
    if (!/^[0-9a-f]{64}$/.test(secret)) throw new UnauthorizedException('Mac 연결 인증을 확인해 주세요.');
    const [peek] = await this.rows<RunnerRow>(tx, sql`select * from mac_bank_runners where secret_hash=${hash(secret)}`);
    if (!peek || peek.revoked_at) throw new UnauthorizedException('Mac 연결 인증을 확인해 주세요.');
    if (!peek.owner_user_id || !peek.household_id) {
      if (pending && date(peek.pair_expires_at) > now) return peek;
      throw new UnauthorizedException('Mac 연결 승인이 필요합니다.');
    }
    const member = await this.member(tx, peek.owner_user_id, peek.household_id);
    const [row] = await this.rows<RunnerRow>(tx, sql`select * from mac_bank_runners where id=${peek.id} for update`);
    if (!row || !macBankGrantActive(!!row.owner_user_id && !!row.household_id, row.grant_expires_at ? date(row.grant_expires_at) : null, !!row.revoked_at, now)
      || !macBankMembershipMatches(row.member_id, row.member_joined_at ? date(row.member_joined_at) : null, member.id, date(member.joined_at)))
      throw new UnauthorizedException('Mac 연결 승인이 만료되었습니다.');
    return row;
  }
  private async expire(tx: Tx, user: string, now: Date): Promise<void> {
    await tx.execute(sql`update mac_bank_runner_jobs set state=case when state='queued' then 'expired' else 'operation_unknown' end,
      error_code=case when state='queued' then 'runtime_unavailable' else 'operation_unknown' end,completed_at=${now.toISOString()},updated_at=${now.toISOString()}
      where owner_user_id=${user} and state in ${active} and expires_at<=${now.toISOString()}`);
  }
  private dto(row: JobRow): MacBankJob {
    return macBankJobSchema.parse({ id: row.id, householdId: row.household_id, ownerUserId: row.owner_user_id, runnerId: row.runner_id,
      state: row.state, claimId: row.claim_id, credentialVersion: row.credential_version ?? null, consentVersion: row.consent_version ?? 1, continueVersion: row.continue_version, errorCode: row.error_code,
      logoutConfirmed: row.logout_confirmed, observations: row.observations, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      expiresAt: iso(row.expires_at), claimedAt: row.claimed_at ? iso(row.claimed_at) : null, completedAt: row.completed_at ? iso(row.completed_at) : null });
  }
  private async job(tx: Tx, id: string, user: string, household: string, member: Member): Promise<JobRow> {
    const [row] = await this.rows<JobRow>(tx, sql`select * from mac_bank_runner_jobs where id=${id} and owner_user_id=${user}
      and household_id=${household} and member_id=${member.id} and member_joined_at=${iso(member.joined_at)} for update`);
    if (!row) throw new NotFoundException('본인 Mac 조회 작업을 찾지 못했어요.');
    return row;
  }
  private async workerJob(tx: Tx, runner: RunnerRow, id: string, claim: string): Promise<JobRow> {
    const [row] = await this.rows<JobRow>(tx, sql`select * from mac_bank_runner_jobs where id=${id} and runner_id=${runner.id}
      and owner_user_id=${runner.owner_user_id} and household_id=${runner.household_id}
      and member_id=${runner.member_id} and member_joined_at=${runner.member_joined_at ? iso(runner.member_joined_at) : null} for update`);
    if (!row || row.claim_id !== claim) throw conflict();
    return row;
  }

  private async credential(tx: Tx, runner: RunnerRow): Promise<CredentialRow | null> {
    const [row] = await this.rows<CredentialRow>(tx, sql`select * from mac_bank_runner_credentials where runner_id=${runner.id}
      and owner_user_id=${runner.owner_user_id} and household_id=${runner.household_id}
      and member_id=${runner.member_id} and member_joined_at=${runner.member_joined_at ? iso(runner.member_joined_at) : null} for update`);
    return row ?? null;
  }
  private credentialDto(row: CredentialRow): MacBankCredentialState {
    return { stored: row.envelope !== null, runnerId: row.runner_id, version: row.version, updatedAt: iso(row.updated_at) };
  }
  private async ownedRunner(tx: Tx, user: string, householdId: string, runnerId: string, member: Member, now: Date): Promise<RunnerRow> {
    const [row] = await this.rows<RunnerRow>(tx, sql`select * from mac_bank_runners where id=${runnerId} and owner_user_id=${user}
      and household_id=${householdId} and member_id=${member.id} and member_joined_at=${iso(member.joined_at)} for update`);
    if (!row || !macBankGrantActive(true, row.grant_expires_at ? date(row.grant_expires_at) : null, !!row.revoked_at, now))
      throw new NotFoundException('본인 Mac 연결을 찾지 못했어요.');
    return row;
  }
  private async noActiveJob(tx: Tx, user: string, now: Date): Promise<void> {
    await this.expire(tx, user, now);
    const rows = await this.rows<{ id: string }>(tx, sql`select id from mac_bank_runner_jobs where owner_user_id=${user} and state in ${active} limit 1`);
    if (rows.length) throw conflict();
  }
  /** 명시적 동의와 본인 Mac 범위를 확인한 후 서버에는 인증된 암호문만 저장한다. */
  async saveCredentials(user: string, input: unknown): Promise<MacBankCredentialState> {
    const value = this.parse(macBankCredentialSaveSchema, input);
    try {
      if (!this.vault.enabled) throw new ServiceUnavailableException('로그인 정보 암호화 저장소를 사용할 수 없습니다.');
      return await this.tx(async (tx, now) => {
        const member = await this.member(tx, user, value.householdId);
        const runner = await this.ownedRunner(tx, user, value.householdId, value.runnerId, member, now);
        await this.noActiveJob(tx, user, now);
        const prior = await this.credential(tx, runner);
        if ((prior?.version ?? null) !== value.expectedVersion || (prior && prior.version >= 2_147_483_646)) throw conflict();
        const id = prior?.id ?? randomUUID(), version = (prior?.version ?? 0) + 1;
        const envelope = this.vault.encrypt({ loginId: value.loginId, password: value.password, credentialVersion: version,
          householdId: value.householdId, memberId: member.id, memberJoinedAt: iso(member.joined_at), runnerId: runner.id },
          credentialContext({ id, owner_user_id: user }));
        await tx.execute(sql`insert into mac_bank_runner_credentials(id,runner_id,household_id,owner_user_id,member_id,member_joined_at,version,envelope,updated_at)
          values(${id},${runner.id},${value.householdId},${user},${member.id},${iso(member.joined_at)},${version},${JSON.stringify(envelope)}::jsonb,${now.toISOString()})
          on conflict(runner_id) do update set version=excluded.version,envelope=excluded.envelope,consent_version=1,
            consented_at=${now.toISOString()},updated_at=excluded.updated_at`);
        return { stored: true, runnerId: runner.id, version, updatedAt: now.toISOString() };
      });
    } finally { value.loginId = ''; value.password = ''; }
  }
  /** 진행 작업이 없을 때만 암호문을 폐기하고 버전을 올려 낡은 요청을 무효화한다. */
  async deleteCredentials(user: string, input: unknown): Promise<MacBankCredentialState> {
    const value = this.parse(macBankCredentialDeleteSchema, input);
    return this.tx(async (tx, now) => {
      const member = await this.member(tx, user, value.householdId);
      const runner = await this.ownedRunner(tx, user, value.householdId, value.runnerId, member, now);
      await this.noActiveJob(tx, user, now);
      const row = await this.credential(tx, runner);
      if (!row || row.version !== value.expectedVersion || row.version >= 2_147_483_646) throw conflict();
      await tx.execute(sql`update mac_bank_runner_credentials set envelope=null,version=version+1,updated_at=${now.toISOString()} where id=${row.id}`);
      return { stored: false, runnerId: runner.id, version: row.version + 1, updatedAt: now.toISOString() };
    });
  }
  /** 본인 실행기의 최초 로그인 claim에만 한 번 전달한다. 응답 유실은 재로그인하지 않는다. */
  async retrieveCredentials(secret: string, id: string, input: unknown): Promise<MacBankCredentialResult> {
    const value = this.parse(macBankCredentialRequestSchema, input); this.parse(z.string().uuid(), id);
    if (!this.vault.enabled) throw new ServiceUnavailableException('로그인 정보 암호화 저장소를 사용할 수 없습니다.');
    return this.tx(async (tx, now) => {
      const runner = await this.runner(tx, secret, now);
      await this.expire(tx, runner.owner_user_id!, now);
      const job = await this.workerJob(tx, runner, id, value.claimId);
      if (!['claimed', 'running'].includes(job.state) || job.continue_version !== 0 || job.credential_delivered_at
        || job.credential_version !== value.credentialVersion || job.consent_version !== 2
        || !macBankClaimLive(job.state, job.claim_id, value.claimId, date(job.expires_at), now)) throw conflict();
      const row = await this.credential(tx, runner);
      if (!row?.envelope || row.version !== value.credentialVersion) throw conflict();
      const [delivered] = await this.rows<{ id: string }>(tx, sql`update mac_bank_runner_jobs set credential_delivered_at=${now.toISOString()}
        where id=${id} and runner_id=${runner.id} and claim_id=${value.claimId} and credential_version=${value.credentialVersion}
        and credential_delivered_at is null and continue_version=0 and state in ('claimed','running')
        and expires_at>${now.toISOString()} returning id`);
      if (!delivered) throw conflict();
      const decoded = credentialPayload.safeParse(this.vault.decrypt(row.envelope, credentialContext(row)));
      if (!decoded.success) throw new InternalServerErrorException('저장한 로그인 정보를 확인하지 못했어요.');
      const credentials = decoded.data;
      try {
        if (credentials.householdId !== runner.household_id || credentials.memberId !== runner.member_id
          || credentials.memberJoinedAt !== iso(runner.member_joined_at!) || credentials.runnerId !== runner.id
          || credentials.credentialVersion !== row.version) throw conflict();
        return { loginId: credentials.loginId, password: credentials.password, credentialVersion: credentials.credentialVersion };
      } finally { credentials.loginId = ''; credentials.password = ''; }
    });
  }
  /** 10분 페어링 요청을 생성하며 같은 ID의 다른 비밀값은 덮어쓰지 않는다. */
  async pair(input: unknown): Promise<{ runnerId: string; pairExpiresAt: string }> {
    const value = this.parse(macBankPairSchema, input);
    try { return await this.tx(async (tx, now) => {
      const secretHash = hash(value.secret), codeHash = hash(value.userCode);
      await tx.execute(sql`insert into mac_bank_runners(id,secret_hash,user_code_hash,label,pair_expires_at)
        values(${value.pairId},${secretHash},${codeHash},${value.label},${new Date(now.getTime() + MAC_BANK_JOB_TTL_MS).toISOString()}) on conflict(id) do nothing`);
      const [row] = await this.rows<RunnerRow>(tx, sql`select * from mac_bank_runners where id=${value.pairId} for update`);
      if (!row || !equal(row.secret_hash, secretHash) || !equal(row.user_code_hash, codeHash)) throw conflict();
      return { runnerId: row.id, pairExpiresAt: iso(row.pair_expires_at) };
    }); } finally { value.secret = ''; value.userCode = ''; }
  }
  /** 기본 승인은 7일이며 본인의 명시적 요청만 연결 해제 전까지로 확대한다. */
  async approve(user: string, input: unknown): Promise<{ runnerId: string; expiresAt: string | null }> {
    const value = this.parse(macBankApproveSchema, input);
    try { return await this.tx(async (tx, now) => {
      const member = await this.member(tx, user, value.householdId);
      const [row] = await this.rows<RunnerRow>(tx, sql`select * from mac_bank_runners where id=${value.pairId} for update`);
      if (!row || row.revoked_at || !equal(row.user_code_hash, hash(value.userCode))) throw new NotFoundException('Mac 연결 요청을 찾지 못했어요.');
      if (row.owner_user_id) {
        if (row.owner_user_id !== user || row.household_id !== value.householdId
          || !macBankMembershipMatches(row.member_id, row.member_joined_at ? date(row.member_joined_at) : null, member.id, date(member.joined_at))) throw conflict();
        if (value.grantMode === 'until_revoked' && row.grant_expires_at !== null) {
          await tx.execute(sql`update mac_bank_runners set grant_expires_at=null where id=${row.id}`);
          return { runnerId: row.id, expiresAt: null };
        }
        if (row.grant_expires_at !== null && date(row.grant_expires_at) <= now) throw conflict();
        return { runnerId: row.id, expiresAt: row.grant_expires_at ? iso(row.grant_expires_at) : null };
      }
      if (date(row.pair_expires_at) <= now) throw conflict();
      const until = value.grantMode === 'until_revoked' ? null : new Date(now.getTime() + 7 * 86_400_000);
      await tx.execute(sql`update mac_bank_runners set owner_user_id=${user},household_id=${value.householdId},member_id=${member.id},
        member_joined_at=${iso(member.joined_at)},grant_expires_at=${until?.toISOString() ?? null} where id=${row.id}`);
      return { runnerId: row.id, expiresAt: until?.toISOString() ?? null };
    }); } finally { value.userCode = ''; }
  }
  /** 미승인 페어링은 401 대신 대기 상태를 반환하고 승인된 실행기만 온라인으로 표시한다. */
  async heartbeat(secret: string): Promise<MacBankHeartbeat> {
    return this.tx(async (tx, now) => {
      const row = await this.runner(tx, secret, now, true);
      if (!row.owner_user_id) return { paired: false, runnerId: row.id, pairExpiresAt: iso(row.pair_expires_at), grantExpiresAt: null, job: null };
      await this.expire(tx, row.owner_user_id, now);
      await tx.execute(sql`update mac_bank_runners set last_seen_at=${now.toISOString()} where id=${row.id}`);
      const [job] = await this.rows<JobRow>(tx, sql`select * from mac_bank_runner_jobs where runner_id=${row.id} and state in ${active} order by created_at desc limit 1`);
      return { paired: true, runnerId: row.id, pairExpiresAt: iso(row.pair_expires_at), grantExpiresAt: row.grant_expires_at ? iso(row.grant_expires_at) : null, job: job ? this.dto(job) : null };
    });
  }
  /** 현재 본인 상태와 이전 성공 관측을 분리해 보여 주며 다른 가입 세대의 기록은 반환하지 않는다. */
  async state(user: string, input: unknown): Promise<MacBankRunnerState> {
    const household = this.scope(input);
    return this.tx(async (tx, now) => {
      const member = await this.member(tx, user, household); await this.expire(tx, user, now);
      const [runner] = await this.rows<RunnerRow>(tx, sql`select * from mac_bank_runners where owner_user_id=${user} and household_id=${household}
        and member_id=${member.id} and member_joined_at=${iso(member.joined_at)} and revoked_at is null
        and (grant_expires_at is null or grant_expires_at>${now.toISOString()}) order by created_at desc,id desc limit 1`);
      const [job] = await this.rows<JobRow>(tx, sql`select * from mac_bank_runner_jobs where owner_user_id=${user} and household_id=${household}
        and member_id=${member.id} and member_joined_at=${iso(member.joined_at)} order by created_at desc,id desc limit 1`);
      const [previous] = await this.rows<JobRow>(tx, sql`select * from mac_bank_runner_jobs where owner_user_id=${user} and household_id=${household}
        and member_id=${member.id} and member_joined_at=${iso(member.joined_at)} and state='succeeded' order by completed_at desc,id desc limit 1`);
      const credential = runner ? await this.credential(tx, runner) : null;
      return { credentials: credential ? this.credentialDto(credential) : null, credentialStorageAvailable: this.vault.enabled,
        runner: runner ? { id: runner.id, label: runner.label, online: !!runner.last_seen_at && now.getTime() - date(runner.last_seen_at).getTime() <= MAC_BANK_ONLINE_MS,
        lastSeenAt: runner.last_seen_at ? iso(runner.last_seen_at) : null, expiresAt: runner.grant_expires_at ? iso(runner.grant_expires_at) : null } : null,
        job: job ? this.dto(job) : null, previousResult: previous ? { jobId: previous.id, completedAt: iso(previous.completed_at!), observations: this.dto(previous).observations } : null };
    });
  }
  /** 같은 requestId를 재실행하지 않고 본인에게 온라인인 Mac 한 대로만 작업을 보낸다. */
  async enqueue(user: string, input: unknown): Promise<{ job: MacBankJob }> {
    const value = this.parse(macBankJobRequestSchema, input);
    return this.tx(async (tx, now) => {
      const member = await this.member(tx, user, value.householdId); await this.expire(tx, user, now);
      const [existing] = await this.rows<JobRow>(tx, sql`select * from mac_bank_runner_jobs where id=${value.requestId} for update`);
      if (existing) {
        if (!macBankRequestMatches(existing.owner_user_id, existing.household_id, user, value.householdId)
          || !macBankMembershipMatches(existing.member_id, date(existing.member_joined_at), member.id, date(member.joined_at))) throw conflict();
        return { job: this.dto(existing) };
      }
      // 한 사람의 진행 중 작업은 하나뿐이다. 조회 간격 제한은 두지 않는다 — 진행 중에는 앱 버튼이 막는다(2026-11-04 결정).
      const running = await this.rows<{ id: string }>(tx, sql`select id from mac_bank_runner_jobs where owner_user_id=${user} and state in ${active} limit 1`);
      if (running.length) throw conflict();
      const [runner] = await this.rows<RunnerRow>(tx, sql`select * from mac_bank_runners where owner_user_id=${user} and household_id=${value.householdId}
        and member_id=${member.id} and member_joined_at=${iso(member.joined_at)} and revoked_at is null
        and (grant_expires_at is null or grant_expires_at>${now.toISOString()})
        and last_seen_at>=${new Date(now.getTime() - MAC_BANK_ONLINE_MS).toISOString()} order by last_seen_at desc,id desc limit 1 for update`);
      if (!runner) throw new ServiceUnavailableException('연결한 Mac이 온라인인지 확인해 주세요.');
      const credentials = await this.credential(tx, runner);
      const [job] = await this.rows<JobRow>(tx, sql`insert into mac_bank_runner_jobs(id,runner_id,household_id,owner_user_id,member_id,member_joined_at,expires_at,credential_version,consent_version)
        values(${value.requestId},${runner.id},${value.householdId},${user},${member.id},${iso(member.joined_at)},${new Date(now.getTime() + MAC_BANK_JOB_TTL_MS).toISOString()},${value.consentVersion === 2 && credentials?.envelope ? credentials.version : null},${value.consentVersion ?? 1}) returning *`);
      return { job: this.dto(job) };
    });
  }
  /** 재전송은 같은 살아 있는 claim만 반환하며 만료된 실행은 새 워커에 넘기지 않는다. */
  async claim(secret: string, input: unknown): Promise<{ job: MacBankJob | null }> {
    const value = this.parse(macBankClaimSchema, input);
    return this.tx(async (tx, now) => {
      const runner = await this.runner(tx, secret, now); await this.expire(tx, runner.owner_user_id!, now);
      const [prior] = await this.rows<JobRow>(tx, sql`select * from mac_bank_runner_jobs where runner_id=${runner.id} and claim_id=${value.claimId} for update`);
      if (prior) return { job: macBankClaimLive(prior.state, prior.claim_id, value.claimId, date(prior.expires_at), now) ? this.dto(prior) : null };
      const [job] = await this.rows<JobRow>(tx, sql`select * from mac_bank_runner_jobs where runner_id=${runner.id} and state in ${active} order by created_at limit 1 for update`);
      if (!job || job.state !== 'queued') return { job: null };
      const [claimed] = await this.rows<JobRow>(tx, sql`update mac_bank_runner_jobs set state='claimed',claim_id=${value.claimId},claimed_at=${now.toISOString()},
        expires_at=${new Date(now.getTime() + MAC_BANK_JOB_TTL_MS).toISOString()},updated_at=${now.toISOString()} where id=${job.id} and state='queued' returning *`);
      return { job: this.dto(claimed) };
    });
  }
  /** 워커 진행 상태는 허용한 순서와 같은 claim에서만 바뀐다. */
  async progress(secret: string, id: string, input: unknown): Promise<{ job: MacBankJob }> {
    const value = this.parse(macBankProgressSchema, input); this.parse(z.string().uuid(), id);
    return this.tx(async (tx, now) => {
      const runner = await this.runner(tx, secret, now); await this.expire(tx, runner.owner_user_id!, now);
      const row = await this.workerJob(tx, runner, id, value.claimId);
      if (!macBankActive(row.state)) return { job: this.dto(row) };
      if (!macBankClaimLive(row.state, row.claim_id, value.claimId, date(row.expires_at), now) || !macBankTransition(row.state, value.state)) throw conflict();
      const [updated] = await this.rows<JobRow>(tx, sql`update mac_bank_runner_jobs set state=${value.state},
        error_code=${value.state === 'authentication_required' ? 'authentication_required' : null},updated_at=${now.toISOString()} where id=${id} returning *`);
      return { job: this.dto(updated) };
    });
  }
  /** 본인 앱의 확인만 인증 대기를 해제한다. 중복 확인은 counter를 다시 올리지 않는다. */
  async continue(user: string, id: string, input: unknown): Promise<{ job: MacBankJob }> {
    const household = this.scope(input); this.parse(z.string().uuid(), id);
    return this.tx(async (tx, now) => {
      const member = await this.member(tx, user, household); await this.expire(tx, user, now);
      const row = await this.job(tx, id, user, household, member);
      if (row.state === 'running') return { job: this.dto(row) };
      if (row.state !== 'authentication_required' || row.continue_version >= 2_147_483_647) throw conflict();
      const [updated] = await this.rows<JobRow>(tx, sql`update mac_bank_runner_jobs set state='running',continue_version=continue_version+1,error_code=null,updated_at=${now.toISOString()} where id=${id} returning *`);
      return { job: this.dto(updated) };
    });
  }
  /** 취소는 claim을 다시 쓸 수 없게 하는 종료 상태이며 뒤늦은 완료로 복구되지 않는다. */
  async cancel(user: string, id: string, input: unknown): Promise<{ job: MacBankJob }> {
    const household = this.scope(input); this.parse(z.string().uuid(), id);
    return this.tx(async (tx, now) => {
      const member = await this.member(tx, user, household); await this.expire(tx, user, now);
      const row = await this.job(tx, id, user, household, member);
      if (!macBankActive(row.state)) return { job: this.dto(row) };
      const [updated] = await this.rows<JobRow>(tx, sql`update mac_bank_runner_jobs set state='cancelled',error_code=null,completed_at=${now.toISOString()},updated_at=${now.toISOString()} where id=${id} returning *`);
      return { job: this.dto(updated) };
    });
  }
  /** 정상 로그아웃과 신선한 실제 관측이 함께 확인된 경우에만 성공 결과를 불변 저장한다. */
  async complete(secret: string, id: string, input: unknown): Promise<{ job: MacBankJob }> {
    const value = this.parse(macBankCompleteSchema, input); this.parse(z.string().uuid(), id);
    return this.tx(async (tx, now) => {
      const runner = await this.runner(tx, secret, now); await this.expire(tx, runner.owner_user_id!, now);
      const row = await this.workerJob(tx, runner, id, value.claimId), completionHash = hash(JSON.stringify(value));
      if (!macBankActive(row.state)) {
        if (row.completion_hash && row.completion_hash !== completionHash) throw conflict();
        return { job: this.dto(row) };
      }
      if (!macBankClaimLive(row.state, row.claim_id, value.claimId, date(row.expires_at), now)) throw conflict();
      if (value.outcome === 'authentication_required') {
        if (!macBankTransition(row.state, 'authentication_required')) throw conflict();
        const [waiting] = await this.rows<JobRow>(tx, sql`update mac_bank_runner_jobs set state='authentication_required',error_code='authentication_required',updated_at=${now.toISOString()} where id=${id} returning *`);
        return { job: this.dto(waiting) };
      }
      if (value.outcome === 'succeeded' && row.state !== 'logging_out') throw conflict();
      const observations = value.outcome === 'succeeded' ? macBankObservations(value.observations, now) : [];
      const [updated] = await this.rows<JobRow>(tx, sql`update mac_bank_runner_jobs set state=${value.outcome},
        error_code=${value.outcome === 'succeeded' ? null : value.errorCode ?? 'operation_unknown'},logout_confirmed=${value.logoutConfirmed},
        observations=${JSON.stringify(observations)}::jsonb,completion_hash=${completionHash},completed_at=${now.toISOString()},updated_at=${now.toISOString()} where id=${id} returning *`);
      return { job: this.dto(updated) };
    });
  }
  /** 본인 실행기를 철회하면 모든 진행 작업을 취소하되 이전 성공 관측은 보존한다. */
  async revoke(user: string, id: string, input: unknown): Promise<{ revoked: true }> {
    const household = this.scope(input); this.parse(z.string().uuid(), id);
    return this.tx(async (tx, now) => {
      const member = await this.member(tx, user, household);
      const [row] = await this.rows<RunnerRow>(tx, sql`select * from mac_bank_runners where id=${id} and owner_user_id=${user} and household_id=${household}
        and member_id=${member.id} and member_joined_at=${iso(member.joined_at)} for update`);
      if (!row) throw new NotFoundException('본인 Mac 연결을 찾지 못했어요.');
      await tx.execute(sql`update mac_bank_runners set revoked_at=coalesce(revoked_at,${now.toISOString()}) where id=${id}`);
      await tx.execute(sql`update mac_bank_runner_jobs set state='cancelled',error_code=null,completed_at=${now.toISOString()},updated_at=${now.toISOString()} where runner_id=${id} and state in ${active}`);
      return { revoked: true };
    });
  }
}
