/**
 * 규칙 목록·적용 이력의 읽기 경로를 고정한다.
 *
 *  - 규칙 목록은 규칙마다 거래를 다시 읽지 않는다(예전에는 규칙 300개면 쿼리 600번이었다).
 *    그래도 숫자는 미리보기와 같은 정의(원문 재해석 + 별칭)로 센다.
 *  - 적용 이력의 `revertable`은 `revert`의 권한 규칙과 같다 — 되돌릴 수 없는 사람에게
 *    버튼을 보여 놓고 403을 돌려주면 화면이 거짓말을 한 것이 된다.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";

import { schema } from "@family/database";

import { RecategorizeService } from "./recategorize.service";

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-000000000003";
const OTHER_USER = "00000000-0000-4000-8000-000000000004";
const CAFE = "00000000-0000-4000-8000-000000000005";
const FOOD = "00000000-0000-4000-8000-000000000006";
const NOW = "2026-11-05T00:00:00.000Z";

/** 운영 식별자를 쓰지 않는 합성 데이터로 실제 서비스와 Drizzle을 실행한다. */
function setup(role: "owner" | "member" = "owner") {
  const queries: string[] = [];

  function execute(query: string): unknown[][] {
    if (query.includes('from "household_members"')) return [[MEMBER, role]];
    if (query.includes('from "merchant_category_rules"')) {
      // id, merchantPattern, categoryId, source, confirmedAt, updatedAt, categoryName
      return [
        ["r1", "합성카페", CAFE, "human_confirmed", NOW, NOW, "카페"],
        ["r2", "합성마트", FOOD, "model_prediction", null, NOW, "식비"],
        ["r3", "거래없는가게", CAFE, "human_confirmed", NOW, NOW, "카페"],
      ];
    }
    // householdId, alias, canonical
    if (query.includes('from "merchant_aliases"'))
      return [[HOUSEHOLD, "합성카페본관", "합성카페"]];
    if (query.includes('from "card_transactions"')) {
      // id, categoryId, netAmount, approvedAt, createdAt, merchantRaw, merchantNormalized
      return [
        ["t1", CAFE, 1000, NOW, NOW, "합성카페", "합성카페"],
        // 별칭 원문 — 저장된 이름이 옛 이름이어도 대표로 다시 해석돼 센다.
        ["t2", FOOD, 1000, NOW, NOW, "합성카페본관", "합성카페본관"],
        ["t3", null, 1000, NOW, NOW, "합성마트", "합성마트"],
        ["t4", FOOD, 1000, NOW, NOW, "합성마트", "합성마트"],
      ];
    }
    if (query.includes('from "category_recategorize_batches"')) {
      // id, merchantCanonical, appliedCount, appliedBy, appliedAt, revertedAt, revertedCount, categoryName
      return [
        ["b1", "합성카페", 2, USER, NOW, null, null, "카페"],
        ["b2", "합성마트", 3, OTHER_USER, NOW, null, null, "식비"],
        ["b3", "거래없는가게", 1, USER, NOW, NOW, 1, "카페"],
      ];
    }
    throw new Error("예상하지 않은 검증용 SQL입니다.");
  }

  const driver = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string) {
      queries.push(query);
      const response = Promise.resolve().then(() => execute(query));
      return Object.assign(response, { values: () => response });
    },
    async begin(): Promise<never> {
      throw new Error("읽기 경로는 트랜잭션을 열지 않는다.");
    },
  };
  const service = new RecategorizeService(
    drizzle(driver as unknown as postgres.Sql, { schema })
  );
  return { service, queries };
}

describe("규칙 목록은 거래를 한 번만 읽는다", () => {
  it("규칙이 여럿이어도 거래·별칭 조회는 한 번이고, 숫자는 별칭까지 해석해 센다", async () => {
    const { service, queries } = setup();
    const { items } = await service.listRules(USER, HOUSEHOLD);

    expect(
      items.map((item) => [item.merchantPattern, item.staleTransactionCount])
    ).toEqual([
      ["합성카페", 1],
      ["합성마트", 1],
      ["거래없는가게", 0],
    ]);
    expect(
      queries.filter((query) => query.includes('from "card_transactions"'))
    ).toHaveLength(1);
    expect(
      queries.filter((query) => query.includes('from "merchant_aliases"'))
    ).toHaveLength(1);
  });
});

describe("되돌리기 가능 여부는 되돌리기 권한과 같다", () => {
  it("일반 구성원에게는 직접 적용했고 아직 안 되돌린 기록만 되돌릴 수 있다", async () => {
    const { service } = setup("member");
    const { items } = await service.listBatches(USER, HOUSEHOLD);
    expect(items.map((item) => [item.id, item.revertable])).toEqual([
      ["b1", true],
      ["b2", false],
      ["b3", false],
    ]);
  });

  it("관리자는 다른 사람이 적용한 기록도 되돌릴 수 있다", async () => {
    const { service } = setup("owner");
    const { items } = await service.listBatches(USER, HOUSEHOLD);
    expect(items.map((item) => [item.id, item.revertable])).toEqual([
      ["b1", true],
      ["b2", true],
      ["b3", false],
    ]);
  });
});
