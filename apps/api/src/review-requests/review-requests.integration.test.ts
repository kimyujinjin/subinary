/**
 * 가족에게 결제 물어보기(확인 요청) — 실제 Postgres 대조 검증.
 *
 * 유닛 테스트(`review-requests.service.test.ts`)는 DB 경계를 대체해 분기만 본다.
 * 여기서는 순수 유닛으로 증명할 수 없는 것을 **마이그레이션이 만든 실제 스키마**로 본다:
 *  1. 서비스 SQL의 열·조인이 실제 테이블과 맞는가(이름 하나 틀리면 운영에서만 500).
 *  2. `ON CONFLICT (transaction_id, assignee_member_id) WHERE resolved_at IS NULL`이
 *     0072의 부분 유니크 인덱스로 추론되는가 — 같은 사람에게 두 번 물어도 한 건, 알림 한 번.
 *  3. 닫힌 요청 뒤에는 같은 사람에게 다시 물을 수 있는가(부분 인덱스라서 가능해야 한다).
 *  4. 나중에 '나만 보기'로 바뀐 결제의 요청은 목록에서 사라지는가.
 *  5. CHECK 제약(본인 지정 금지, 닫힘 시각·닫은 사람 짝)이 DB에서도 막는가.
 *
 * DB가 필요하므로 `REVIEW_REQUESTS_TEST_DATABASE_URL`이 있을 때만 돈다(CI 기본 skip).
 * 전체 마이그레이션을 적용한 **일회용** DB를 가리킨다. 예:
 *   docker run -d --rm --name fma-scratch-pg -e POSTGRES_USER=family -e POSTGRES_PASSWORD=verify \
 *     -e POSTGRES_DB=verify -v "$PWD/infrastructure/postgres/init:/docker-entrypoint-initdb.d:ro" \
 *     -p 127.0.0.1:55432:5432 pgvector/pgvector:pg16
 *   DATABASE_URL=postgres://family:verify@127.0.0.1:55432/verify pnpm --filter @family/database migrate
 *   REVIEW_REQUESTS_TEST_DATABASE_URL=postgres://family:verify@127.0.0.1:55432/verify \
 *     pnpm --filter @family/api test
 *
 * ⚠️ 운영 DB를 절대 가리키지 말 것 — 시드는 FK 사슬(카드 문자 → 기기 → 구성원)을 세우지 않으려고
 * `session_replication_role = replica`(superuser 필요)로 FK를 건너뛰어 넣는다. 끝나면 이 실행이
 * 만든 행만 지운다.
 */
import { randomUUID } from "node:crypto";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Queue } from "bullmq";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createDbClient, type Db } from "@family/database";
import { reviewRequestSummarySchema } from "@family/contracts";

import { ReviewRequestsService } from "./review-requests.service";

const DATABASE_URL = process.env.REVIEW_REQUESTS_TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)("가족에게 결제 물어보기 — 실제 Postgres", () => {
  const home = randomUUID();
  const users = {
    me: randomUUID(),
    partner: randomUUID(),
    child: randomUUID(),
  };
  const members = {
    me: randomUUID(),
    partner: randomUUID(),
    child: randomUUID(),
  };
  const txn = randomUUID();
  const privateTxn = randomUUID();

  let seed: postgres.Sql;
  let client: postgres.Sql;
  let db: Db;
  const queue = { add: vi.fn(async () => ({})) };
  let service: ReviewRequestsService;

  beforeAll(async () => {
    seed = postgres(DATABASE_URL as string, { max: 1, onnotice: () => {} });
    await seed`set session_replication_role = replica`;
    await seed`insert into users (id, email, password_hash, name) values
      (${users.me}, ${`${users.me}@example.test`}, 'x', '이수빈'),
      (${users.partner}, ${`${users.partner}@example.test`}, 'x', '배우자'),
      (${users.child}, ${`${users.child}@example.test`}, 'x', '아이')`;
    await seed`insert into households (id, name, created_by) values (${home}, '검증 가구', ${users.me})`;
    await seed`insert into household_members (id, household_id, user_id, role) values
      (${members.me}, ${home}, ${users.me}, 'owner'),
      (${members.partner}, ${home}, ${users.partner}, 'member'),
      (${members.child}, ${home}, ${users.child}, 'member')`;
    await seed`insert into card_transactions
      (id, household_id, member_id, source_event_id, transaction_type, status, amount, net_amount,
       merchant_raw, merchant_normalized, visibility, approved_at)
      values
      (${txn}, ${home}, ${
      members.me
    }, ${randomUUID()}, 'approval', 'approved', 5600, 5600,
       'STARBUCKS', '스타벅스', 'household', '2026-11-03T03:00:00Z'),
      (${privateTxn}, ${home}, ${
      members.me
    }, ${randomUUID()}, 'approval', 'approved', 9900, 9900,
       '쿠팡', null, 'private', '2026-11-03T04:00:00Z')`;

    ({ db, client } = createDbClient(DATABASE_URL as string, { max: 2 }));
    service = new ReviewRequestsService(db, queue as unknown as Queue);
  });

  beforeEach(() => queue.add.mockClear());

  afterAll(async () => {
    if (seed) {
      await seed`delete from transaction_review_requests where household_id = ${home}`;
      await seed`delete from card_transactions where household_id = ${home}`;
      await seed`delete from household_members where household_id = ${home}`;
      await seed`delete from households where id = ${home}`;
      await seed`delete from users where id in ${seed([
        users.me,
        users.partner,
        users.child,
      ])}`;
      await seed.end();
    }
    await client?.end();
  });

  const input = {
    householdId: home,
    transactionId: txn,
    assigneeMemberId: members.partner,
  };

  it("같은 사람에게 두 번 물어도 열린 요청은 한 건이고 알림은 한 번이다", async () => {
    const first = await service.create(users.me, input);
    const second = await service.create(users.me, input);
    expect(second.id).toBe(first.id);
    expect(reviewRequestSummarySchema.parse(first)).toMatchObject({
      direction: "sent",
      merchant: "스타벅스",
      amount: 5600,
      currency: "KRW",
      requesterName: "이수빈",
      assigneeName: "배우자",
      occurredAt: "2026-11-03T03:00:00.000Z",
    });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      "dispatch",
      expect.objectContaining({
        kind: "review",
        phase: "requested",
        userId: users.partner,
      }),
      { jobId: `notif_review_${first.id}_requested`, removeOnComplete: true }
    );
    const [{ count }] =
      await seed`select count(*)::int as count from transaction_review_requests
      where transaction_id = ${txn} and resolved_at is null`;
    expect(count).toBe(1);
  });

  it("받은 사람·보낸 사람 기준으로 방향을 붙이고, 관계없는 가족에게는 보이지 않는다", async () => {
    const received = await service.list(users.partner, home);
    expect(received.items.map((item) => item.direction)).toEqual(["received"]);
    const sent = await service.list(users.me, home, txn);
    expect(sent.items.map((item) => item.direction)).toEqual(["sent"]);
    expect((await service.list(users.child, home)).items).toEqual([]);
  });

  it("나만 보기 결제는 물어볼 수 없다", async () => {
    await expect(
      service.create(users.me, { ...input, transactionId: privateTxn })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("관계없는 가족은 닫지 못하고, 받은 사람이 확인하면 닫히고 물어본 사람에게 알린다", async () => {
    const [open] = (await service.list(users.partner, home)).items;
    await expect(
      service.resolve(users.child, open.id, { householdId: home })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.resolve(users.partner, open.id, { householdId: home })
    ).resolves.toEqual({ resolved: true });
    expect(queue.add).toHaveBeenCalledWith(
      "dispatch",
      expect.objectContaining({
        kind: "review",
        phase: "resolved",
        userId: users.me,
        actorName: "배우자",
      }),
      { jobId: `notif_review_${open.id}_resolved`, removeOnComplete: true }
    );
    expect((await service.list(users.partner, home)).items).toEqual([]);
    // 이미 닫힌 요청을 다시 닫아도 성공이고 알림은 더 가지 않는다.
    queue.add.mockClear();
    await expect(
      service.resolve(users.partner, open.id, { householdId: home })
    ).resolves.toEqual({ resolved: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("닫힌 뒤에는 같은 사람에게 다시 물을 수 있고, 물어본 사람의 취소는 알리지 않는다", async () => {
    const again = await service.create(users.me, input);
    expect(queue.add).toHaveBeenCalledTimes(1);
    queue.add.mockClear();
    await expect(
      service.resolve(users.me, again.id, { householdId: home })
    ).resolves.toEqual({ resolved: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("결제가 나중에 나만 보기로 바뀌면 열린 요청도 목록에서 빠진다", async () => {
    await service.create(users.me, input);
    expect((await service.list(users.partner, home)).items).toHaveLength(1);
    await seed`update card_transactions set visibility = 'private' where id = ${txn}`;
    try {
      expect((await service.list(users.partner, home)).items).toEqual([]);
    } finally {
      await seed`update card_transactions set visibility = 'household' where id = ${txn}`;
    }
  });

  it("DB 제약이 본인 지정과 짝 없는 닫힘을 막는다", async () => {
    await expect(
      seed`insert into transaction_review_requests (household_id, transaction_id, requester_member_id, assignee_member_id)
        values (${home}, ${txn}, ${members.me}, ${members.me})`
    ).rejects.toMatchObject({
      constraint_name: "transaction_review_requests_distinct_check",
    });
    await expect(
      seed`insert into transaction_review_requests (household_id, transaction_id, requester_member_id, assignee_member_id, resolved_at)
        values (${home}, ${txn}, ${members.me}, ${members.child}, now())`
    ).rejects.toMatchObject({
      constraint_name: "transaction_review_requests_resolved_check",
    });
  });
});
