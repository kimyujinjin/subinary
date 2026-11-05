/**
 * 카테고리 삭제 — 실제 Postgres 대조 검증(2026-11-05).
 *
 * 1. 예산에 쓰는 카테고리를 지우면 예산도 지워진다 → 예산을 만들 수 있는 소유자·관리자만.
 * 2. '지난 거래 다시 분류' 기록(category_recategorize_batches/items)과 학습 자료
 *    (dataset_snapshot_items → merchant_category_rules)는 FK NO ACTION으로 카테고리를 가리킨다.
 *    예전에는 그런 카테고리를 지우면 FK 위반 500이 났다. 기록을 지키려고 409로 막는다.
 *
 * `CATEGORY_DELETE_TEST_DATABASE_URL`이 있을 때만 돈다(CI 기본 skip). 전체 마이그레이션을 적용한
 * **일회용** DB를 가리킨다(review-requests.integration.test.ts 주석의 준비 절차와 같다).
 * ⚠️ 운영 DB 금지 — 시드는 `session_replication_role = replica`(superuser)로 FK를 건너뛴다.
 */
import { randomUUID } from "node:crypto";

import { ConflictException, ForbiddenException } from "@nestjs/common";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDbClient, type Db } from "@family/database";

import type { RealtimePublisherService } from "../realtime/realtime-publisher.service";
import { CategoryService } from "./category.service";

const DATABASE_URL = process.env.CATEGORY_DELETE_TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)("카테고리 삭제 — 실제 Postgres", () => {
  const home = randomUUID();
  const owner = randomUUID();
  const member = randomUUID();
  const withBudget = randomUUID();
  const withHistory = randomUUID();
  const plain = randomUUID();

  let seed: postgres.Sql;
  let client: postgres.Sql;
  let service: CategoryService;

  beforeAll(async () => {
    seed = postgres(DATABASE_URL as string, { max: 1, onnotice: () => {} });
    await seed`set session_replication_role = replica`;
    await seed`insert into users (id, email, password_hash, name) values
      (${owner}, ${`${owner}@example.test`}, 'x', '소유자'),
      (${member}, ${`${member}@example.test`}, 'x', '구성원')`;
    await seed`insert into households (id, name, created_by) values (${home}, '검증 가구', ${owner})`;
    await seed`insert into household_members (household_id, user_id, role) values
      (${home}, ${owner}, 'owner'), (${home}, ${member}, 'member')`;
    await seed`insert into expense_categories (id, household_id, slug, name) values
      (${withBudget}, ${home}, ${`b-${withBudget}`}, '예산 걸린 분류'),
      (${withHistory}, ${home}, ${`h-${withHistory}`}, '기록 있는 분류'),
      (${plain}, ${home}, ${`p-${plain}`}, '그냥 분류')`;
    await seed`insert into budgets (household_id, scope_type, scope_ref_id, amount, created_by, effective_month)
      values (${home}, 'category', ${withBudget}, 100000, ${owner}, '2026-11-01')`;
    await seed`insert into category_recategorize_batches (household_id, merchant_canonical, to_category_id, applied_count, applied_by)
      values (${home}, '스타벅스', ${withHistory}, 1, ${owner})`;

    ({ client } = createDbClient(DATABASE_URL as string, { max: 2 }));
    const { db } = createDbClient(DATABASE_URL as string, { max: 2 });
    service = new CategoryService(
      db as Db,
      { publish: async () => undefined } as unknown as RealtimePublisherService
    );
  });

  afterAll(async () => {
    if (seed) {
      await seed`delete from category_recategorize_batches where household_id = ${home}`;
      await seed`delete from budgets where household_id = ${home}`;
      await seed`delete from expense_categories where household_id = ${home}`;
      await seed`delete from household_members where household_id = ${home}`;
      await seed`delete from households where id = ${home}`;
      await seed`delete from users where id in ${seed([owner, member])}`;
      await seed.end();
    }
    await client?.end();
  });

  it("예산에 쓰는 카테고리는 일반 구성원이 못 지우고, 소유자는 예산과 함께 지운다", async () => {
    await expect(
      service.deleteCategory(member, withBudget)
    ).rejects.toBeInstanceOf(ForbiddenException);
    await service.deleteCategory(owner, withBudget);
    const [{ count }] =
      await seed`select count(*)::int as count from budgets where scope_ref_id = ${withBudget}`;
    expect(count).toBe(0);
  });

  it("'지난 거래 다시 분류' 기록이 가리키는 카테고리는 500 대신 409로 막고 기록을 지킨다", async () => {
    await expect(
      service.deleteCategory(owner, withHistory)
    ).rejects.toBeInstanceOf(ConflictException);
    const [{ count }] =
      await seed`select count(*)::int as count from category_recategorize_batches where to_category_id = ${withHistory}`;
    expect(count).toBe(1);
  });

  it("걸린 것이 없는 카테고리는 일반 구성원도 지운다", async () => {
    await service.deleteCategory(member, plain);
    const [{ count }] =
      await seed`select count(*)::int as count from expense_categories where id = ${plain}`;
    expect(count).toBe(0);
  });
});
