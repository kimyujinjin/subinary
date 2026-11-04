import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CONNECTED_ACCOUNT_SHARING_CONSENT_VERSION,
  connectedAccountSharingRequestSchema,
  financeConnectionSnapshotSchema,
  type ConnectedAccountHolding,
  type ConnectedAccountsResponse,
} from '@family/contracts';
import { schema, type Db } from '@family/database';

import { DB } from '../database/database.constants';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Executor = Db | Tx;

const householdIdSchema = z.string().uuid();

/** Mac 조회 관측 한 건 중 합계에 필요한 필드만. 나머지(지문 원문 등)는 응답에 싣지 않는다. */
const observationSchema = z.object({
  pageKind: z.enum(['deposit_account_list', 'loan_account_list']),
  accountFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  accountLast4: z.string().regex(/^\d{4}$/),
  capturedAt: z.string().datetime(),
  balanceKrw: z.string().regex(/^-?\d+$/).optional(),
  outstandingPrincipalKrw: z.string().regex(/^\d+$/).optional(),
  loanType: z.enum(['interim', 'jeonse']).optional(),
}).passthrough();

interface MemberRow { user_id: string; name: string; consented_at: Date | string | null; revoked_at: Date | string | null }
interface TossRow { id: string; owner_user_id: string; status: string; payload: unknown }
interface JobRow { id: string; owner_user_id: string; observations: unknown }

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** 신한 Mac 조회 관측 → 자산 목록 행. 통장은 통장·현금, 대출은 대출 묶음에 들어간다. */
export function shinhanHoldings(job: JobRow, ownerName: string, own: boolean): ConnectedAccountHolding[] {
  const parsed = z.array(observationSchema).safeParse(job.observations);
  if (!parsed.success) return [];
  return parsed.data.flatMap((o): ConnectedAccountHolding[] => {
    const base = { ownerUserId: job.owner_user_id, ownerName, own, provider: 'shinhan_bank' as const, usd: null, observedAt: o.capturedAt, stale: false };
    if (o.pageKind === 'deposit_account_list' && o.balanceKrw !== undefined) {
      return [{ ...base, id: `${job.id}:${o.accountFingerprint}`, kind: 'account', label: `신한 통장 · 끝 ${o.accountLast4}`, krw: o.balanceKrw }];
    }
    if (o.pageKind === 'loan_account_list' && o.outstandingPrincipalKrw !== undefined) {
      const name = o.loanType === 'jeonse' ? '전세대출' : '중도금대출';
      return [{ ...base, id: `${job.id}:${o.accountFingerprint}`, kind: 'loan', label: `신한 ${name} · 끝 ${o.accountLast4}`, krw: o.outstandingPrincipalKrw }];
    }
    return [];
  });
}

/** 토스 최근 성공 조회 → 주식 행(원화·달러 따로, 환산은 화면이 한다). */
export function tossHolding(row: TossRow, ownerName: string, own: boolean): ConnectedAccountHolding | null {
  const parsed = financeConnectionSnapshotSchema.safeParse(row.payload);
  if (!parsed.success) return null;
  const total = (currency: 'KRW' | 'USD') => parsed.data.totals.find((item) => item.currency === currency)?.marketValue ?? null;
  return {
    id: row.id, ownerUserId: row.owner_user_id, ownerName, own, provider: 'toss_securities', kind: 'stock', label: '토스증권',
    krw: total('KRW'), usd: total('USD'), observedAt: parsed.data.observedAt, stale: row.status !== 'ready',
  };
}

/**
 * 가족 합산용 연결 계좌(§8). 본인 것은 항상, 다른 구성원 것은 그 사람이 공유에 동의했을 때만 보인다.
 * 현재 가입 세대(member_id·joined_at)로 기록된 조회만 쓴다 — 탈퇴·재가입 전 기록은 나오지 않는다.
 */
@Injectable()
export class ConnectedAccountsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private householdId(value: unknown): string {
    const parsed = householdIdSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException('가족 정보를 확인해 주세요.');
    return parsed.data;
  }

  private async members(db: Executor, userId: string, householdId: string): Promise<MemberRow[]> {
    const rows = await db.execute(sql`select m.user_id, u.name, s.consented_at, s.revoked_at
      from ${schema.householdMembers} m join ${schema.users} u on u.id = m.user_id
      left join ${schema.connectedAccountSharing} s on s.household_id = m.household_id and s.user_id = m.user_id
      where m.household_id = ${householdId} and m.status = 'active'`) as unknown as MemberRow[];
    if (!rows.some((row) => row.user_id === userId)) throw new ForbiddenException('가족 구성원만 볼 수 있어요.');
    return rows;
  }

  async list(userId: string, rawHouseholdId: unknown): Promise<ConnectedAccountsResponse> {
    const householdId = this.householdId(rawHouseholdId);
    const members = await this.members(this.db, userId, householdId);
    const me = members.find((row) => row.user_id === userId)!;
    const visible = new Map(
      members
        .filter((row) => row.user_id === userId || (row.consented_at !== null && row.revoked_at === null))
        .map((row) => [row.user_id, row.name])
    );
    const toss = await this.db.execute(sql`select c.id, c.owner_user_id, c.status, sn.payload
      from ${schema.financeConnections} c
      join ${schema.financeConnectionSnapshots} sn on sn.id = c.last_snapshot_id and sn.connection_id = c.id and sn.state = 'succeeded'
      join ${schema.householdMembers} m on m.id = c.member_id and m.user_id = c.owner_user_id and m.household_id = c.household_id
        and m.joined_at = c.member_joined_at and m.status = 'active'
      where c.household_id = ${householdId} and c.disconnected_at is null`) as unknown as TossRow[];
    const holdings: ConnectedAccountHolding[] = [];
    for (const row of toss) {
      const name = visible.get(row.owner_user_id);
      if (name === undefined) continue;
      const holding = tossHolding(row, name, row.owner_user_id === userId);
      if (holding) holdings.push(holding);
    }
    const [ready] = await this.db.execute(sql`select to_regclass('public.mac_bank_runner_jobs') is not null as ready`) as unknown as Array<{ ready: boolean }>;
    if (ready?.ready) {
      const jobs = await this.db.execute(sql`select distinct on (j.owner_user_id) j.id, j.owner_user_id, j.observations
        from mac_bank_runner_jobs j
        join ${schema.householdMembers} m on m.id = j.member_id and m.user_id = j.owner_user_id and m.household_id = j.household_id
          and m.joined_at = j.member_joined_at and m.status = 'active'
        where j.household_id = ${householdId} and j.state = 'succeeded'
        order by j.owner_user_id, j.completed_at desc, j.id desc`) as unknown as JobRow[];
      for (const job of jobs) {
        const name = visible.get(job.owner_user_id);
        if (name !== undefined) holdings.push(...shinhanHoldings(job, name, job.owner_user_id === userId));
      }
    }
    return {
      sharing: { shared: me.consented_at !== null && me.revoked_at === null, consentedAt: me.revoked_at === null ? iso(me.consented_at) : null },
      holdings,
    };
  }

  async setSharing(userId: string, input: unknown): Promise<ConnectedAccountsResponse> {
    const parsed = connectedAccountSharingRequestSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('공유 동의 내용을 확인해 주세요.');
    const { householdId, share } = parsed.data;
    await this.db.transaction(async (tx) => {
      await this.members(tx, userId, householdId);
      const table = schema.connectedAccountSharing;
      if (share) {
        await tx.insert(table)
          .values({ householdId, userId, consentVersion: CONNECTED_ACCOUNT_SHARING_CONSENT_VERSION })
          .onConflictDoUpdate({
            target: [table.householdId, table.userId],
            set: { consentVersion: CONNECTED_ACCOUNT_SHARING_CONSENT_VERSION, consentedAt: sql`now()`, revokedAt: null, updatedAt: sql`now()` },
          });
      } else {
        await tx.update(table).set({ revokedAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(eq(table.householdId, householdId), eq(table.userId, userId), sql`${table.revokedAt} is null`));
      }
    });
    return this.list(userId, householdId);
  }
}
