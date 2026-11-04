import { describe, expect, it } from "vitest";
import { shinhanHoldings, tossHolding } from "./connected-accounts.service";

const owner = "00000000-0000-4000-8000-000000000001";
const fp = "a".repeat(64);
const common = {
  formatVersion: 1,
  provider: "shinhan",
  source: "browser_assisted",
  origin: "https://bank.shinhan.com",
  bankAsOfDate: null,
} as const;
// 저장된 관측은 시간대가 붙은 시각일 수 있다(2026-11-04 운영에서 이 차이로 행이 빠졌다).
const deposit = {
  ...common,
  pageKind: "deposit_account_list",
  capturedAt: "2026-11-03T21:17:00+09:00",
  accountFingerprint: fp,
  accountLast4: "9029",
  currency: "KRW",
  balanceKind: "ledger",
  balanceKrw: "2612734",
};
const loan = {
  ...common,
  pageKind: "loan_account_list",
  capturedAt: "2026-11-03T21:17:00+09:00",
  accountFingerprint: "b".repeat(64),
  accountLast4: "0444",
  loanType: "interim",
  outstandingPrincipalKrw: "111440000",
  maturityDate: "2029-04-30",
};

describe("shinhanHoldings", () => {
  it("maps offset-timestamped deposits to 통장·현금 and loans to 대출, normalizing time to UTC", () => {
    const rows = shinhanHoldings(
      { id: "job1", owner_user_id: owner, observations: [deposit, loan] },
      "이수빈",
      true
    );
    expect(
      rows.map((row) => [row.kind, row.label, row.krw, row.observedAt])
    ).toEqual([
      ["account", "신한은행 통장", "2612734", "2026-11-03T12:17:00.000Z"],
      ["loan", "신한은행 중도금대출", "111440000", "2026-11-03T12:17:00.000Z"],
    ]);
    expect(JSON.stringify(rows.map((row) => row.label))).not.toContain(fp);
  });

  it("adds the last four digits only when two accounts would share a name", () => {
    const second = {
      ...deposit,
      accountFingerprint: "c".repeat(64),
      accountLast4: "1111",
      balanceKrw: "5",
    };
    const rows = shinhanHoldings(
      { id: "j2", owner_user_id: owner, observations: [deposit, second, loan] },
      "이수빈",
      true
    );
    expect(rows.map((row) => row.label)).toEqual([
      "신한은행 통장 9029",
      "신한은행 통장 1111",
      "신한은행 중도금대출",
    ]);
  });

  it("drops malformed observations instead of inventing zero", () => {
    expect(
      shinhanHoldings(
        {
          id: "j",
          owner_user_id: owner,
          observations: [{ pageKind: "deposit_account_list" }],
        },
        "x",
        false
      )
    ).toEqual([]);
    expect(
      shinhanHoldings(
        { id: "j", owner_user_id: owner, observations: null },
        "x",
        false
      )
    ).toEqual([]);
  });
});

describe("tossHolding", () => {
  it("returns null for an unparseable snapshot", () => {
    expect(
      tossHolding(
        {
          id: "c",
          owner_user_id: owner,
          status: "ready",
          payload: { nope: true },
        },
        "x",
        true
      )
    ).toBeNull();
  });
});
