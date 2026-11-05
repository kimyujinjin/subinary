/**
 * 거래 추가 창 — 직접 입력 검증·문자에서 읽은 값 옮기기, 그리고 화면 문구(2026-11-05 HIG 검수 3·4단계).
 * 창은 Radix 포털과 쿼리 훅이 있어 정적 렌더로 열 수 없으므로, 문구·부품은 소스에서 확인한다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MANUAL_FIELD_MESSAGES,
  manualFieldErrors,
  previewPrefill,
  toLocalInputValue,
} from "./add-transaction-form";

const valid = {
  amount: "13380",
  merchant: "가게",
  occurredAt: "2026-11-05T14:31",
};

describe("직접 입력 검증", () => {
  it("금액·가맹점·날짜가 있으면 오류가 없다", () => {
    expect(manualFieldErrors(valid)).toEqual({});
  });

  it("빈 금액과 0원은 '1원 이상'으로 알린다 — 빈 칸을 0으로 바꿔 통과시키지 않는다", () => {
    expect(manualFieldErrors({ ...valid, amount: "" }).amount).toBe(
      MANUAL_FIELD_MESSAGES.amount
    );
    expect(manualFieldErrors({ ...valid, amount: "0" }).amount).toBe(
      MANUAL_FIELD_MESSAGES.amount
    );
    // AmountInput은 콤마 없는 값을 주지만, 콤마가 섞여도 같은 금액으로 읽는다.
    expect(manualFieldErrors({ ...valid, amount: "1,234" })).toEqual({});
  });

  it("가맹점이 공백뿐이거나 날짜가 비면 그 칸에 알린다", () => {
    const errors = manualFieldErrors({
      amount: "1000",
      merchant: "   ",
      occurredAt: "",
    });
    expect(errors).toEqual({
      merchant: MANUAL_FIELD_MESSAGES.merchant,
      occurredAt: MANUAL_FIELD_MESSAGES.occurredAt,
    });
  });

  it("오류 문장은 해요체이고 '정수'·'시각' 같은 딱딱한 말을 쓰지 않는다", () => {
    for (const message of Object.values(MANUAL_FIELD_MESSAGES)) {
      expect(message).toMatch(/주세요\.$/);
      expect(message).not.toMatch(/정수|시각|니다/);
    }
  });
});

describe("문자에서 읽은 값을 직접 입력으로 옮기기", () => {
  it("원화 금액·가맹점·날짜를 칸에 채운다", () => {
    const occurred = new Date(2026, 10, 5, 14, 31);
    expect(
      previewPrefill({
        amount: 13380,
        currency: "KRW",
        merchantRaw: "가게",
        occurredAt: occurred.toISOString(),
      })
    ).toEqual({
      amount: "13380",
      merchant: "가게",
      occurredAt: "2026-11-05T14:31",
    });
  });

  it("외화 금액은 원화 칸에 넣지 않고 비운다 — minor units를 원으로 저장하면 다른 금액이 된다", () => {
    expect(
      previewPrefill({
        amount: 1250,
        currency: "USD",
        merchantRaw: null,
        occurredAt: null,
      })
    ).toEqual({ amount: "" });
  });

  it("통화가 없으면 원화로 보고, 0원·음수는 채우지 않는다", () => {
    expect(
      previewPrefill({
        amount: 5000,
        currency: null,
        merchantRaw: null,
        occurredAt: null,
      }).amount
    ).toBe("5000");
    expect(
      previewPrefill({
        amount: -5000,
        currency: "KRW",
        merchantRaw: null,
        occurredAt: null,
      }).amount
    ).toBe("");
  });

  it("읽지 못한 가맹점·잘못된 날짜는 칸 값을 그대로 둔다(키 없음)", () => {
    const next = previewPrefill({
      amount: null,
      currency: "KRW",
      merchantRaw: "",
      occurredAt: "날짜 아님",
    });
    expect(next).toEqual({ amount: "" });
  });

  it("datetime-local 값은 이 기기 시각으로 두 자리씩 채운다", () => {
    expect(toLocalInputValue(new Date(2026, 0, 2, 3, 4))).toBe(
      "2026-01-02T03:04"
    );
  });
});

describe("거래 추가 창 문구·부품", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src/app/(app)/transactions/add-transaction-dialog.tsx"
    ),
    "utf8"
  );

  it("금액은 AmountInput, 문자 칸은 Textarea다 — 맨 숫자 예시('13380')와 날 textarea를 쓰지 않는다", () => {
    expect(source).toContain("<AmountInput");
    expect(source).toContain("<Textarea");
    expect(source).not.toContain("<textarea");
    expect(source).not.toContain('placeholder="13380"');
    expect(source).not.toContain('inputMode="numeric"');
  });

  it("버튼은 '추가하기'·'닫기', 버리는 확인은 빨간 '버리기' / '계속 입력하기'다", () => {
    expect(source).toMatch(/"추가하기"/);
    expect(source).not.toMatch(/>\s*취소\s*</);
    expect(source).not.toMatch(/"등록"/);
    // 닫을지 묻는 확인에서 남는 쪽을 '닫기'라고 하면 뜻이 거꾸로 읽힌다(2026-11-06 최종 검토).
    expect(source).toContain("<AlertDialogCancel>계속 입력하기</AlertDialogCancel>");
    expect(source).toMatch(
      /<AlertDialogAction variant="destructive"[^\n]*>버리기<\/AlertDialogAction>/
    );
  });

  it("화면에 내부 용어·옛 표기를 쓰지 않는다", () => {
    for (const word of [
      "이 기기의 시간",
      "날짜/시각",
      "인식 중",
      "직접 입력으로 전환",
      "입력 버리기",
      "등록 중…",
    ]) {
      expect(source).not.toContain(word);
    }
    expect(source).toContain("날짜·시간");
    // 문자에서 읽은 결과 줄도 직접 입력 칸과 같은 이름을 쓴다(값에 시간까지 보이므로).
    expect(source).toContain('<FieldRow label="날짜·시간"');
    expect(source).not.toContain('<FieldRow label="날짜"');
  });

  it("옛 글자 크기·모서리를 쓰지 않는다", () => {
    expect(source).not.toMatch(
      /(?<![\w-])text-(?:xs|sm|base|lg|xl|2xl)(?![\w-])/
    );
    expect(source).not.toMatch(
      /(?<![\w-])rounded-(?:sm|md|lg|xl|2xl)(?![\w-])/
    );
  });
});
