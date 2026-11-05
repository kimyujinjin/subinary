/**
 * 금액 입력(2026-11-05 HIG 검수 3·4단계): 자릿수 콤마로 0 하나 차이를 알아보게 하고, 값은 콤마 없는 문자열로 주고받는다.
 * node 환경이라 커서는 순수 함수(applyAmountEdit)로 재고, 모양·속성 전달은 정적 렌더로 본다.
 */
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AmountInput,
  amountDecimals,
  amountUnit,
  applyAmountEdit,
  formatAmountInput,
  normalizeAmountInput,
} from "./amount-input";

const noop = () => {};

describe("normalizeAmountInput — 숫자만, 앞자리 0 정리", () => {
  it("숫자 외 글자는 버린다(붙여넣은 '13,380원'도 그대로 읽는다)", () => {
    expect(normalizeAmountInput("13,380원")).toBe("13380");
    expect(normalizeAmountInput("₩ 1 234")).toBe("1234");
    expect(normalizeAmountInput("abc")).toBe("");
    expect(normalizeAmountInput("")).toBe("");
  });

  it("음수 기호는 버리고, 원화는 첫 소수점부터 버린다(점만 빼고 이으면 100배가 된다)", () => {
    expect(normalizeAmountInput("-500")).toBe("500");
    expect(normalizeAmountInput("12.5")).toBe("12");
    expect(normalizeAmountInput("12.50")).toBe("12");
    expect(normalizeAmountInput("1,234.56")).toBe("1234");
    expect(normalizeAmountInput("1.2.3")).toBe("1");
    expect(normalizeAmountInput(".5")).toBe("");
  });

  it("앞자리 0을 정리하되 0 한 자리는 남긴다('0원'은 빈칸과 다른 값)", () => {
    expect(normalizeAmountInput("007")).toBe("7");
    expect(normalizeAmountInput("000")).toBe("0");
    expect(normalizeAmountInput("0")).toBe("0");
  });

  it("decimals가 있으면 소수점 하나와 그 자리 수까지만 받는다", () => {
    expect(normalizeAmountInput("1.234", 2)).toBe("1.23");
    expect(normalizeAmountInput(".5", 2)).toBe("0.5");
    expect(normalizeAmountInput("12.", 2)).toBe("12.");
    expect(normalizeAmountInput("1.2.3", 2)).toBe("1.23");
    expect(normalizeAmountInput("0012.50", 2)).toBe("12.50");
  });

  it("자리 수는 minor units로 바꿔도 안전한 정수 안(정수+소수 15자리)에서 멈춘다", () => {
    expect(normalizeAmountInput("9".repeat(20))).toBe("9".repeat(15));
    expect(normalizeAmountInput(`${"9".repeat(20)}.99`, 2)).toBe(
      `${"9".repeat(13)}.99`
    );
    expect(Number.isSafeInteger(Number("9".repeat(15)))).toBe(true);
  });

  it("두 번 정리해도 같다(다시 그릴 때 칸 글자가 바뀌지 않아야 커서가 남는다)", () => {
    for (const [text, decimals] of [
      ["007", 0],
      ["1,234,000", 0],
      ["0.50", 2],
      ["12.", 2],
    ] as const) {
      const once = normalizeAmountInput(text, decimals);
      expect(normalizeAmountInput(once, decimals)).toBe(once);
    }
  });
});

describe("formatAmountInput — 세 자리 콤마", () => {
  it("정수 부분에만 콤마를 붙인다", () => {
    expect(formatAmountInput("1234000")).toBe("1,234,000");
    expect(formatAmountInput("100")).toBe("100");
    expect(formatAmountInput("1000")).toBe("1,000");
    expect(formatAmountInput("1234.5")).toBe("1,234.5");
    expect(formatAmountInput("0.")).toBe("0.");
    expect(formatAmountInput("")).toBe("");
  });
});

describe("applyAmountEdit — 커서는 사용자가 친 자리 뒤에 남는다", () => {
  it("끝에 치면 콤마가 붙어도 커서는 끝", () => {
    expect(
      applyAmountEdit({ text: "1234", caret: 4, previousRaw: "123" })
    ).toEqual({ raw: "1234", text: "1,234", caret: 5 });
  });

  it("가운데에 치면 친 숫자 바로 뒤", () => {
    // '1,|234'에서 5를 친다 → '15,234'의 '15|'
    expect(
      applyAmountEdit({ text: "1,5234", caret: 3, previousRaw: "1234" })
    ).toEqual({ raw: "15234", text: "15,234", caret: 2 });
  });

  it("가운데 숫자를 지워 콤마가 빠져도 지운 자리에 남는다", () => {
    // '12,3|45'에서 Backspace → 브라우저는 '12,45'(커서 3) → 콤마가 옮겨 '1,245'가 되어도 지운 자리 '1,2|45'
    expect(
      applyAmountEdit({
        text: "12,45",
        caret: 3,
        previousRaw: "12345",
        inputType: "deleteContentBackward",
      })
    ).toEqual({ raw: "1245", text: "1,245", caret: 3 });
  });

  it("콤마 바로 뒤 Backspace는 그 앞 숫자를 지운다", () => {
    // '1,|234' → 브라우저는 콤마만 지워 '1234'(커서 1)를 준다
    expect(
      applyAmountEdit({
        text: "1234",
        caret: 1,
        previousRaw: "1234",
        inputType: "deleteContentBackward",
      })
    ).toEqual({ raw: "234", text: "234", caret: 0 });
  });

  it("콤마 바로 앞 Delete는 그 뒤 숫자를 지운다", () => {
    // '1|,234' → 브라우저는 콤마만 지워 '1234'(커서 1)를 준다
    expect(
      applyAmountEdit({
        text: "1234",
        caret: 1,
        previousRaw: "1234",
        inputType: "deleteContentForward",
      })
    ).toEqual({ raw: "134", text: "134", caret: 1 });
  });

  it("숫자 아닌 글자는 무시하고 커서도 제자리", () => {
    expect(
      applyAmountEdit({ text: "12a3", caret: 3, previousRaw: "123" })
    ).toEqual({ raw: "123", text: "123", caret: 2 });
  });

  it("0 뒤에 치면 앞자리 0이 빠지고 커서는 친 숫자 뒤", () => {
    expect(applyAmountEdit({ text: "05", caret: 2, previousRaw: "0" })).toEqual(
      { raw: "5", text: "5", caret: 1 }
    );
    // 맨 앞에 0을 쳐도 생기지 않고 커서는 맨 앞
    expect(applyAmountEdit({ text: "05", caret: 1, previousRaw: "5" })).toEqual(
      { raw: "5", text: "5", caret: 0 }
    );
  });

  it("붙여넣기는 정리된 값 끝으로", () => {
    expect(
      applyAmountEdit({
        text: "13,380원",
        caret: 7,
        previousRaw: "",
        inputType: "insertFromPaste",
      })
    ).toEqual({ raw: "13380", text: "13,380", caret: 6 });
  });

  it("원화 칸에 붙여넣은 '1,234.56'은 소수 부분을 버려 '1,234'(100배가 되지 않는다)", () => {
    expect(
      applyAmountEdit({
        text: "1,234.56",
        caret: 8,
        previousRaw: "",
        inputType: "insertFromPaste",
      })
    ).toEqual({ raw: "1234", text: "1,234", caret: 5 });
  });

  it("원화 칸 가운데에 붙여넣은 소수도 그 부분만 버리고 뒤의 기존 숫자는 남긴다", () => {
    // '|1,000'에 '5.5' 붙여넣기 → 브라우저는 '5.51,000'(커서 3) → '51,000'의 '5|'
    expect(
      applyAmountEdit({
        text: "5.51,000",
        caret: 3,
        previousRaw: "1000",
        inputType: "insertFromPaste",
      })
    ).toEqual({ raw: "51000", text: "51,000", caret: 1 });
  });

  it("원화 칸 가운데에 친 '.'는 무시하고 뒤 숫자를 자르지 않는다", () => {
    // '1,2|34'에서 '.'를 친다 → '1,2.34'(커서 4) → 값 그대로, 커서 제자리
    expect(
      applyAmountEdit({
        text: "1,2.34",
        caret: 4,
        previousRaw: "1234",
        inputType: "insertText",
      })
    ).toEqual({ raw: "1234", text: "1,234", caret: 3 });
  });

  it("외화(통화에서 끌어온 자리 수) 한 글자 고쳐도 소수점이 남는다", () => {
    // '12|.50'에서 3을 친다 → '123.50'. 통화만 넘겨도 자리 수가 2라 점이 빠져 '12350'이 되지 않는다.
    expect(
      applyAmountEdit({
        text: "123.50",
        caret: 3,
        previousRaw: "12.50",
        inputType: "insertText",
        decimals: amountDecimals("USD"),
      })
    ).toEqual({ raw: "123.50", text: "123.50", caret: 3 });
  });

  it("외화 소수: 점을 치면 남고 자리 수를 넘는 숫자는 받지 않는다", () => {
    expect(
      applyAmountEdit({
        text: "1234.",
        caret: 5,
        previousRaw: "1234",
        decimals: 2,
      })
    ).toEqual({ raw: "1234.", text: "1,234.", caret: 6 });
    expect(
      applyAmountEdit({
        text: "1,234.567",
        caret: 9,
        previousRaw: "1234.56",
        decimals: 2,
      })
    ).toEqual({ raw: "1234.56", text: "1,234.56", caret: 8 });
  });
});

describe("amountUnit", () => {
  it("원화·통화 없음은 '원', 외화는 코드", () => {
    expect(amountUnit()).toBe("원");
    expect(amountUnit("KRW")).toBe("원");
    expect(amountUnit("krw")).toBe("원");
    expect(amountUnit("usd")).toBe("USD");
    expect(amountUnit("JPY")).toBe("JPY");
  });
});

describe("amountDecimals — 소수 자리 수는 통화에서", () => {
  it("decimals를 주지 않으면 통화의 minor-unit 지수", () => {
    expect(amountDecimals()).toBe(0);
    expect(amountDecimals("")).toBe(0);
    expect(amountDecimals("KRW")).toBe(0);
    expect(amountDecimals("JPY")).toBe(0);
    expect(amountDecimals("USD")).toBe(2);
    expect(amountDecimals("usd")).toBe(2);
    expect(amountDecimals("KWD")).toBe(3);
  });

  it("decimals를 주면 그 값으로 덮어쓴다", () => {
    expect(amountDecimals("USD", 0)).toBe(0);
    expect(amountDecimals(undefined, 2)).toBe(2);
    expect(amountDecimals("KRW", -1)).toBe(0);
  });
});

describe("AmountInput 렌더", () => {
  const attr = (html: string, tag: RegExp) => {
    const m = tag.exec(html);
    if (!m) throw new Error(`${tag}를 찾지 못했다`);
    return m[0];
  };
  const visible = (html: string) =>
    attr(html, /<input(?![^>]*type="hidden")[^>]*>/);

  it("콤마 붙은 값 · 숫자 키패드 · 단위 '원'", () => {
    const html = renderToStaticMarkup(
      <AmountInput id="f-amount" value="1234000" onValueChange={noop} />
    );
    const input = visible(html);
    expect(input).toContain('value="1,234,000"');
    expect(input).toContain('type="text"');
    expect(input).toContain('inputMode="numeric"');
    expect(input).toContain('autoComplete="off"');
    expect(input).toContain('id="f-amount"');
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>원<\/span>/);
  });

  it("id·aria-invalid·aria-describedby·placeholder·disabled를 입력 칸에 넘기고 단위를 설명으로 잇는다", () => {
    const html = renderToStaticMarkup(
      <AmountInput
        id="f-amount"
        value=""
        onValueChange={noop}
        aria-invalid
        aria-describedby="f-amount-error"
        placeholder="0"
        disabled
      />
    );
    const input = visible(html);
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('placeholder="0"');
    expect(input).toContain('disabled=""');
    expect(input).toContain('value=""');
    const unitId = /<span[^>]*id="([^"]+)"/.exec(html)?.[1];
    expect(unitId).toBeTruthy();
    expect(input).toContain(`aria-describedby="${unitId} f-amount-error"`);
  });

  it("name은 숨은 칸이 콤마 없는 값으로 제출하고, 보이는 칸에는 붙지 않는다", () => {
    const html = renderToStaticMarkup(
      <AmountInput name="budget-amount" value="500000" onValueChange={noop} />
    );
    expect(html).toContain(
      '<input type="hidden" name="budget-amount" value="500000"/>'
    );
    expect(visible(html)).not.toContain("name=");
  });

  it("외화는 소수 키패드 · 통화 코드 단위", () => {
    const html = renderToStaticMarkup(
      <AmountInput
        value="1234.5"
        currency="USD"
        decimals={2}
        onValueChange={noop}
      />
    );
    expect(visible(html)).toContain('inputMode="decimal"');
    expect(visible(html)).toContain('value="1,234.5"');
    expect(html).toMatch(/>USD<\/span>/);
  });

  it("외화는 decimals 없이 통화만 넘겨도 소수 자리를 지킨다('12.50'이 '1,250'으로 보이지 않는다)", () => {
    const usd = renderToStaticMarkup(
      <AmountInput value="12.50" currency="USD" onValueChange={noop} />
    );
    expect(visible(usd)).toContain('value="12.50"');
    expect(visible(usd)).toContain('inputMode="decimal"');
    expect(usd).toMatch(/>USD<\/span>/);

    const kwd = renderToStaticMarkup(
      <AmountInput value="1.250" currency="KWD" onValueChange={noop} />
    );
    expect(visible(kwd)).toContain('value="1.250"');
  });

  it("원화 칸에 소수 값이 오면 소수 부분을 버린다(100배로 보이지 않는다)", () => {
    const html = renderToStaticMarkup(
      <AmountInput value="1234.56" onValueChange={noop} />
    );
    expect(visible(html)).toContain('value="1,234"');
    expect(visible(html)).toContain('inputMode="numeric"');
  });

  it("콤마가 섞인 값이 와도 정리해서 보여 준다", () => {
    const html = renderToStaticMarkup(
      <AmountInput value="13,380" onValueChange={noop} />
    );
    expect(visible(html)).toContain('value="13,380"');
  });

  it("Input과 같은 모양(회색 채움 · 48 높이 · 본문 글자 · 컨트롤 모서리 · 1px 포커스 테두리), 호출부 className은 칸에", () => {
    const html = renderToStaticMarkup(
      <AmountInput
        value=""
        onValueChange={noop}
        className="bg-background px-3"
        containerClassName="mt-2"
        ref={createRef<HTMLInputElement>()}
      />
    );
    const cls = /class="([^"]+)"/.exec(visible(html))?.[1]?.split(/\s+/) ?? [];
    expect(cls).toEqual(
      expect.arrayContaining([
        "h-12",
        "text-body",
        "rounded-control",
        "border-transparent",
        "focus-visible:border-primary",
        "tabular-nums",
        "bg-background",
        "px-3",
        // 단위 자리는 호출부 px-*보다 뒤라 살아 있다
        "pr-10",
      ])
    );
    expect(cls).not.toContain("bg-muted");
    expect(cls.some((c) => c.includes("ring-["))).toBe(false);
    expect(html).toMatch(/^<div data-slot="amount-input" class="[^"]*\bmt-2\b/);
  });
});
