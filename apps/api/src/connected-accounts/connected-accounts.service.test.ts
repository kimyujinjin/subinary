import { describe, expect, it } from "vitest";
import { shinhanHoldings, tossHolding } from "./connected-accounts.service";

const owner = "00000000-0000-4000-8000-000000000001";
const fp = "a".repeat(64);

describe("shinhanHoldings", () => {
  it("maps deposit balances to 통장·현금 and loans to 대출 without exposing fingerprints in labels", () => {
    const rows = shinhanHoldings(
      {
        id: "job1",
        owner_user_id: owner,
        observations: [
          {
            pageKind: "deposit_account_list",
            accountFingerprint: fp,
            accountLast4: "9029",
            capturedAt: "2026-11-03T12:17:00.000Z",
            balanceKrw: "2612734",
          },
          {
            pageKind: "loan_account_list",
            accountFingerprint: "b".repeat(64),
            accountLast4: "0444",
            capturedAt: "2026-11-03T12:17:00.000Z",
            outstandingPrincipalKrw: "111440000",
            loanType: "interim",
          },
        ],
      },
      "이수빈",
      true
    );
    expect(rows.map((row) => [row.kind, row.label, row.krw])).toEqual([
      ["account", "신한 통장 · 끝 9029", "2612734"],
      ["loan", "신한 중도금대출 · 끝 0444", "111440000"],
    ]);
    expect(JSON.stringify(rows.map((row) => row.label))).not.toContain(fp);
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
