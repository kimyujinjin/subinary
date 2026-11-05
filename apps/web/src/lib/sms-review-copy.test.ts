import { describe, expect, it } from "vitest";

import {
  smsGroupTaskText,
  smsReviewReasonText,
  smsSourceLabel,
  smsSourceName,
  smsWaitTitle,
} from "./sms-review-copy";

describe("문자 줄 제목(보낸 곳)", () => {
  it("카드사 대표 번호면 이름을 쓴다", () => {
    expect(smsSourceLabel("16617654")).toBe("토스뱅크 문자");
    expect(smsSourceLabel("1588-1688")).toBe("KB국민카드 문자");
  });

  it("국가 번호가 붙은 번호와 번호@도메인 주소도 같은 번호로 본다", () => {
    expect(smsSourceName("+8216617654")).toBe("토스뱅크");
    expect(smsSourceName("16617654@botplatform.example")).toBe("토스뱅크");
  });

  it("표에 없는 번호는 문자에서 읽은 카드사를 쓰고, 그것도 없으면 지금처럼 번호로 보여 준다", () => {
    expect(smsSourceLabel("15990000", "신한카드")).toBe("신한카드 문자");
    expect(smsSourceLabel("15990000")).toBe("1599-0000에서 온 문자");
    expect(smsSourceLabel("kakao", null)).toBe("kakao에서 온 문자");
  });

  it("범용 파서가 넣는 '카드'는 이름으로 쓰지 않는다", () => {
    expect(smsSourceName("15990000", "카드")).toBeNull();
    expect(smsSourceLabel("15990000", " 카드 ")).toBe("1599-0000에서 온 문자");
  });

  it("대표 번호가 문자에서 읽은 카드사보다 먼저다(가맹점 이름 속 회사명 오인 방지)", () => {
    expect(smsSourceName("16617654", "신한카드")).toBe("토스뱅크");
  });
});

describe("묶음 줄 부제(할 동작)", () => {
  it("못 읽은 문자만 있으면 직접 입력을 안내한다", () => {
    expect(smsGroupTaskText({ parseFailed: 2, quarantined: 0 })).toBe(
      "받은 문자를 보고 금액·가맹점을 입력해 주세요"
    );
  });
  it("미리 읽어 둔 문자만 있으면 확인만 하면 된다고 말한다", () => {
    expect(smsGroupTaskText({ parseFailed: 0, quarantined: 1 })).toBe(
      "금액·가맹점이 맞는지 확인해 주세요"
    );
  });
  it("섞여 있으면 공통 동작만 말한다", () => {
    expect(smsGroupTaskText({ parseFailed: 1, quarantined: 1 })).toBe(
      "금액·가맹점을 확인해 주세요"
    );
  });
  it("내부 용어(원문·확정 대기·파싱)를 쓰지 않는다", () => {
    for (const text of [
      smsGroupTaskText({ parseFailed: 1, quarantined: 0 }),
      smsGroupTaskText({ parseFailed: 0, quarantined: 1 }),
      smsGroupTaskText({ parseFailed: 1, quarantined: 1 }),
    ]) {
      expect(text).not.toMatch(/원문|확정 대기|파싱|할 일에서/);
    }
  });
});

describe("반영을 기다리는 문자 줄 제목", () => {
  const base = { parseStatus: "parsed", transactionType: "approval" } as const;

  it("환율 대기는 무엇을 기다리는지와 통화를 말한다(시각은 제목에 넣지 않는다)", () => {
    const title = smsWaitTitle({
      ...base,
      currency: "USD",
      posting: {
        status: "pending",
        transactionId: null,
        transactionStatus: null,
        reason: "fx_snapshot_missing",
      },
    });
    expect(title).toBe("환율을 기다리는 중 · USD 결제");
    expect(title).not.toMatch(/전$/);
  });

  it("통화를 모르는 환율 대기는 외화 결제로 쓴다", () => {
    expect(
      smsWaitTitle({
        ...base,
        currency: null,
        posting: {
          status: "pending",
          transactionId: null,
          transactionStatus: null,
          reason: "fx_snapshot_missing",
        },
      })
    ).toBe("환율을 기다리는 중 · 외화 결제");
  });

  it("반영 중인 문자와 상태를 모르는 문자를 가른다", () => {
    expect(
      smsWaitTitle({
        ...base,
        currency: "KRW",
        posting: {
          status: "pending",
          transactionId: null,
          transactionStatus: null,
          reason: "processing",
        },
      })
    ).toBe("거래에 반영하는 중");
    expect(smsWaitTitle({ ...base, currency: "KRW" })).toBe(
      "반영 결과를 확인하는 중"
    );
  });
});

describe("확인 창의 이유 한 줄", () => {
  it("사용자가 할 일이 달라지는 판정만 우리말로 옮긴다", () => {
    expect(smsReviewReasonText("suspicious_content")).toContain(
      "바로 넣지 않았어요"
    );
    expect(
      smsReviewReasonText("payment aggregator; merchant unconfirmed")
    ).toContain("실제 가게 이름");
  });

  it("표에 없는 영문 판정 코드는 화면에 내지 않는다", () => {
    expect(smsReviewReasonText("no parseable card transaction")).toBeNull();
    expect(smsReviewReasonText("invariant violated: amount")).toBeNull();
    expect(smsReviewReasonText(null)).toBeNull();
  });
});
