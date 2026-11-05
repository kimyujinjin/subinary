import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { TransactionSummary } from "@family/contracts";
import { describe, expect, it, vi } from "vitest";

import { newActivityToastMessage } from "./activity-provider";

vi.mock("@/lib/auth-context", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/household-context", () => ({ useHousehold: vi.fn() }));

type Item = Parameters<typeof newActivityToastMessage>[0][number];

function item(
  overrides: Partial<Item> & Pick<TransactionSummary, "transactionType">
): Item {
  return {
    masked: false,
    merchantNormalized: "쿠팡",
    merchantRaw: "쿠팡(주)",
    amount: 13380,
    currency: "KRW",
    ...overrides,
  };
}

const approval = item({ transactionType: "approval" });
const refund = item({ transactionType: "cancellation" });

describe("새 거래 토스트 문구", () => {
  it("취소로 생긴 기록은 목록 칩과 같이 '환불'이라 부르고 조사를 맞춘다", () => {
    expect(newActivityToastMessage([refund], false)).toBe(
      "쿠팡 13,380원 환불이 기록됐어요"
    );
    expect(newActivityToastMessage([approval], false)).toBe(
      "쿠팡 13,380원 거래가 기록됐어요"
    );
  });

  it("가맹점을 숨긴 기록은 건수만 말한다", () => {
    expect(
      newActivityToastMessage(
        [item({ transactionType: "cancellation", masked: true })],
        false
      )
    ).toBe("새 환불 1건이 기록됐어요");
  });

  it("여러 건은 모두 환불일 때만 '환불'이다 — 맨 앞 한 건만 보고 정하지 않는다", () => {
    expect(newActivityToastMessage([refund, refund], false)).toBe(
      "새 환불 2건이 기록됐어요"
    );
    expect(newActivityToastMessage([refund, approval, approval], false)).toBe(
      "새 거래 3건이 기록됐어요"
    );
  });

  it("상한에 닿으면 넘어간 거래를 모르니 '거래'라고 하고 '+'를 붙인다", () => {
    expect(newActivityToastMessage(Array(50).fill(refund), true)).toBe(
      "새 거래 50+건이 기록됐어요"
    );
  });

  it("코드에 옛 이름 '결제 취소'가 남지 않는다", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/activity-provider.tsx"),
      "utf8"
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("결제 취소");
  });
});
