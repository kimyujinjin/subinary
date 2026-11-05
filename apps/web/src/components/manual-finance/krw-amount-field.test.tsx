/**
 * 수동 기록 금액 칸 — AmountInput을 쓰되, 계약(20자리)보다 짧은 AmountInput 상한(15자리)을 넘는 저장값은
 * 잘라 보여 주지 않고 예전 글자 칸으로 연다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { normalizeAmountInput } from "@/components/ui/amount-input";

import {
  AMOUNT_INPUT_MAX_DIGITS,
  KrwAmountField,
  fitsAmountInput,
} from "./krw-amount-field";

describe("KrwAmountField", () => {
  it("상한은 AmountInput이 실제로 자르는 자리 수와 같다", () => {
    const max = "9".repeat(AMOUNT_INPUT_MAX_DIGITS);
    expect(normalizeAmountInput(max)).toBe(max);
    expect(normalizeAmountInput(`${max}9`)).toBe(max);
  });

  it("빈 칸·0·상한 이하는 AmountInput, 그보다 긴 저장값은 아니다", () => {
    expect(fitsAmountInput("")).toBe(true);
    expect(fitsAmountInput("0")).toBe(true);
    expect(fitsAmountInput("1,234,000")).toBe(true);
    expect(fitsAmountInput("9".repeat(AMOUNT_INPUT_MAX_DIGITS))).toBe(true);
    expect(fitsAmountInput("9".repeat(AMOUNT_INPUT_MAX_DIGITS + 1))).toBe(
      false
    );
    expect(fitsAmountInput("-1")).toBe(false);
  });

  it("보통 금액은 콤마와 '원' 단위로 보이고, 빈 칸은 0으로 바뀌지 않는다", () => {
    const html = renderToStaticMarkup(
      <KrwAmountField id="a" value="1234000" onValueChange={() => {}} />
    );
    expect(html).toContain('value="1,234,000"');
    expect(html).toContain(">원<");
    expect(html).toContain('inputMode="numeric"');
    const empty = renderToStaticMarkup(
      <KrwAmountField
        id="b"
        value=""
        onValueChange={() => {}}
        placeholder="모르면 비워 두세요"
      />
    );
    expect(empty).toContain('value=""');
    expect(
      renderToStaticMarkup(
        <KrwAmountField id="z" value="0" onValueChange={() => {}} />
      )
    ).toContain('value="0"');
  });

  it("20자리 저장값은 자르지 않고 그대로 보여 준다", () => {
    const long = "12345678901234567890";
    const html = renderToStaticMarkup(
      <KrwAmountField id="c" value={long} onValueChange={() => {}} />
    );
    expect(html).toContain(`value="${long}"`);
    expect(html).not.toContain(">원<");
  });
});
