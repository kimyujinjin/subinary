/**
 * 카드 수정의 소유자 처리 — 소유자가 가족을 떠난 카드도 별칭·결제일은 고칠 수 있어야 한다.
 *
 * 예전 웹은 수정할 때마다 지금 소유자를 그대로 다시 보냈고, 서버는 그 값을 '새 소유자'로 보고
 * 활성 구성원 검사를 했다. 소유자가 나간 카드는 그래서 무엇을 고쳐도 400이었다.
 * 진짜 DB 없이 Drizzle이 만든 SQL을 합성 행으로 받아 확인한다(card-last4-correction.test.ts와 같은 방식).
 */
import "reflect-metadata";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { schema } from "@family/database";
import { CardService } from "./card.service";

const H = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const LEFT = "33333333-3333-4333-8333-333333333333";
const NEXT = "44444444-4444-4444-8444-444444444444";
const C = "55555555-5555-4555-8555-555555555555";
const U = "66666666-6666-4666-8666-666666666666";
const DATE = "2026-11-01T00:00:00.000Z";
type Row = Record<string, unknown>;

const memberRow = (changes: Row): Row => ({
  householdId: H,
  role: "member",
  status: "active",
  color: null,
  joinedAt: DATE,
  createdAt: DATE,
  updatedAt: DATE,
  ...changes,
});

function setup(options: { card?: Row; actorRole?: string } = {}) {
  const members: Row[] = [
    memberRow({ id: ADMIN, userId: U, role: options.actorRole ?? "admin" }),
    memberRow({
      id: LEFT,
      userId: "77777777-7777-4777-8777-777777777777",
      status: "removed",
    }),
    memberRow({ id: NEXT, userId: "88888888-8888-4888-8888-888888888888" }),
  ];
  const card: Row = {
    id: C,
    householdId: H,
    ownerMemberId: LEFT,
    issuer: "테스트카드",
    alias: "합성 카드",
    maskedNumber: "1234",
    cardFingerprint: null,
    visibility: "household",
    isShared: false,
    status: "active",
    billingDay: null,
    createdBy: U,
    createdAt: DATE,
    updatedAt: DATE,
    ...(options.card ?? {}),
  };
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const columnKey = (table: typeof schema.paymentCards) =>
    new Map(
      Object.entries(getTableColumns(table)).map(([key, column]) => [
        column.name,
        key,
      ])
    );
  const rowValues = (
    table: typeof schema.paymentCards | typeof schema.householdMembers,
    row: Row
  ) => Object.keys(getTableColumns(table)).map((key) => row[key] ?? null);
  const unsafe = (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
    const result = Promise.resolve().then((): unknown[][] => {
      if (sql.startsWith('update "payment_cards"')) {
        // set 절의 "열" = $n 쌍을 그대로 행에 반영해 돌려준다(returning).
        const keys = columnKey(schema.paymentCards);
        for (const [, name, index] of sql
          .split(" where ")[0]!
          .matchAll(/"([a-z_0-9]+)" = \$(\d+)/g)) {
          const key = keys.get(name!);
          if (key) card[key] = params[Number(index) - 1];
        }
        return [rowValues(schema.paymentCards, card)];
      }
      if (sql.includes('from "payment_cards"'))
        return params[0] === C ? [rowValues(schema.paymentCards, card)] : [];
      if (sql.startsWith('select "id" from "household_members"')) {
        // assertActiveMember(memberId, householdId, 'active')
        return members
          .filter(
            (m) =>
              m.id === params[0] &&
              m.householdId === params[1] &&
              m.status === "active"
          )
          .map((m) => [m.id]);
      }
      if (sql.includes('from "household_members"')) {
        // requireMembership(householdId, userId, 'active')
        return members
          .filter(
            (m) =>
              m.householdId === params[0] &&
              m.userId === params[1] &&
              m.status === "active"
          )
          .map((m) => rowValues(schema.householdMembers, m));
      }
      throw new Error(`unexpected synthetic query: ${sql}`);
    });
    return Object.assign(result, { values: () => result });
  };
  const driver = { options: { parsers: {}, serializers: {} }, unsafe };
  const db = drizzle(driver as unknown as postgres.Sql, { schema });
  return { service: new CardService(db), queries, card };
}

const updates = (queries: Array<{ sql: string }>) =>
  queries.filter((q) => q.sql.startsWith("update "));
const ownerChecks = (queries: Array<{ sql: string }>) =>
  queries.filter((q) =>
    q.sql.startsWith('select "id" from "household_members"')
  );

describe("card update keeps a departed owner editable", () => {
  it("saves alias and billing day when the unchanged departed owner is resent (old clients)", async () => {
    const { service, queries } = setup();
    const result = await service.update(U, C, {
      alias: "새 별칭",
      ownerMemberId: LEFT,
      billingDay: 15,
    });
    expect(result).toMatchObject({
      id: C,
      alias: "새 별칭",
      ownerMemberId: LEFT,
      billingDay: 15,
    });
    expect(ownerChecks(queries)).toEqual([]);
    expect(updates(queries)).toHaveLength(1);
    expect(updates(queries)[0]!.sql.split(" where ")[0]).not.toContain(
      "owner_member_id"
    );
  });

  it("treats a differently cased copy of the current owner id as unchanged", async () => {
    const { service, queries } = setup();
    await expect(
      service.update(U, C, {
        ownerMemberId: LEFT.toUpperCase(),
        alias: "대문자",
      })
    ).resolves.toMatchObject({ ownerMemberId: LEFT, alias: "대문자" });
    expect(ownerChecks(queries)).toEqual([]);
  });

  it("saves without any owner field (current web client)", async () => {
    const { service, queries } = setup();
    await expect(
      service.update(U, C, { alias: "별칭만" })
    ).resolves.toMatchObject({ alias: "별칭만", ownerMemberId: LEFT });
    expect(ownerChecks(queries)).toEqual([]);
  });

  it("still checks membership and reassigns to another active member", async () => {
    const { service, queries } = setup();
    await expect(
      service.update(U, C, { ownerMemberId: NEXT })
    ).resolves.toMatchObject({ ownerMemberId: NEXT });
    expect(ownerChecks(queries)).toHaveLength(1);
    expect(updates(queries)[0]!.sql.split(" where ")[0]).toContain(
      "owner_member_id"
    );
  });

  it("still refuses to hand a card to a member who left, before writing", async () => {
    const { service, queries } = setup({ card: { ownerMemberId: NEXT } });
    await expect(
      service.update(U, C, { ownerMemberId: LEFT })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updates(queries)).toEqual([]);
  });

  it("keeps the permission gate: a plain member cannot edit someone else’s card", async () => {
    const { service, queries } = setup({ actorRole: "member" });
    await expect(
      service.update(U, C, { alias: "권한 없음", ownerMemberId: LEFT })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(updates(queries)).toEqual([]);
  });
});
