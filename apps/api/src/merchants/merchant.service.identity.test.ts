/**
 * 잘린 이름 제안의 "다른 가게예요"가 **실제로 다음 목록에서 빠지는가**를 고정한다.
 *
 * 거절 기록의 신원은 이름 집합 해시다. 거절이 저장하는 키와 목록이 거르는 키가 한 글자라도
 * 갈리면 "거절했는데 또 뜬다"로만 드러난다 — 그래서 저장(reject)과 필터(list)를 같은
 * 이름으로 왕복시켜 본다. DB 없이 실제 서비스와 Drizzle을 돌린다(합성 데이터).
 */
import { BadRequestException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";

import { schema } from "@family/database";
import { createMerchantIdentityTargetId } from "@family/shared";

import { MerchantService } from "./merchant.service";

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-000000000003";
const NOW = "2026-11-05T00:00:00.000Z";

interface Captured {
  sql: string;
  params: unknown[];
}

function setup(rejectedTargetIds: string[] = []) {
  const queries: Captured[] = [];

  function execute(query: string): unknown[][] {
    if (query.startsWith('insert into "feedback_events"')) return [];
    if (query.includes('from "household_members"')) return [[MEMBER, "owner"]];
    if (query.includes('from "card_transactions"')) {
      // name, transactionCount, netTotal, lastTransactionAt, firstTransactionAt
      return [
        ["합성상점본점", "4", "50000", NOW, NOW],
        ["합성상점", "2", "18000", NOW, NOW],
        ["다른가게", "5", "30000", NOW, NOW],
      ];
    }
    if (query.includes('from "merchant_aliases"')) return [];
    if (query.includes('from "merchant_category_rules"')) return [];
    if (query.includes('from "feedback_events"'))
      return rejectedTargetIds.map((id) => [id]);
    throw new Error("예상하지 않은 검증용 SQL입니다.");
  }

  const driver = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: unknown[]) {
      queries.push({ sql: query, params });
      const response = Promise.resolve().then(() => execute(query));
      return Object.assign(response, { values: () => response });
    },
    async begin(): Promise<never> {
      throw new Error("이 경로는 트랜잭션을 열지 않는다.");
    },
  };
  const service = new MerchantService(
    drizzle(driver as unknown as postgres.Sql, { schema })
  );
  return { service, queries };
}

describe("잘린 이름 제안은 서버가 계산해 거절한 묶음을 거른다", () => {
  it("거절이 없으면 잘린 이름 묶음을 내려준다", async () => {
    const { service } = setup();
    const { truncationCandidates } = await service.listMerchants(
      USER,
      HOUSEHOLD
    );
    expect(truncationCandidates).toEqual([
      {
        canonical: "합성상점본점",
        aliases: ["합성상점"],
        transactionCount: 6,
        netTotal: 68000,
      },
    ]);
  });

  it("거절이 저장한 키로 다음 목록에서 그 묶음이 빠진다", async () => {
    const rejecting = setup();
    await rejecting.service.rejectIdentityCandidate(USER, {
      householdId: HOUSEHOLD,
      names: ["합성상점본점", "합성상점"],
      reason: "truncation",
    });
    const insert = rejecting.queries.find((q) =>
      q.sql.startsWith('insert into "feedback_events"')
    );
    const storedTargetId = insert?.params.find(
      (p) =>
        p ===
        createMerchantIdentityTargetId(HOUSEHOLD, ["합성상점본점", "합성상점"])
    );
    expect(storedTargetId).toBeDefined();
    // 잘린 이름 제안에는 브랜드가 없다 — label에 빈 brand를 남기지 않는다.
    const label = insert?.params.find(
      (p) => typeof p === "string" && p.includes('"decision"')
    );
    expect(JSON.parse(label as string)).toEqual({
      decision: "rejected",
      reason: "truncation",
      nameCount: 2,
    });

    const listing = setup([storedTargetId as string]);
    const { truncationCandidates } = await listing.service.listMerchants(
      USER,
      HOUSEHOLD
    );
    expect(truncationCandidates).toEqual([]);
  });

  it("브랜드 제안 거절은 브랜드 없이 받지 않는다", async () => {
    const { service, queries } = setup();
    await expect(
      service.rejectIdentityCandidate(USER, {
        householdId: HOUSEHOLD,
        names: ["합성상점본점", "합성상점"],
        reason: "brand_notation",
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queries.some((q) => q.sql.startsWith("insert into"))).toBe(false);
  });
});
