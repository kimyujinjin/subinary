import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UsageBar, usageStatus } from "./usage-bar";

describe("예산 막대 상태 글자(usageStatus)", () => {
  it("넘으면 넘은 금액을 '초과'로 말한다", () => {
    expect(
      usageStatus({ spent: 512_000, amount: 500_000, usageRate: 1.024 })
    ).toEqual({ text: "12,000원 초과", tone: "over" });
  });

  it("딱 한도만큼 쓰면 넘은 금액이 없으니 쓴 비율을 말한다", () => {
    expect(
      usageStatus({ spent: 500_000, amount: 500_000, usageRate: 1 })
    ).toEqual({ text: "100.0% 사용", tone: "over" });
  });

  it("80% 이상은 경고, 그 아래는 보통 — 둘 다 쓴 비율을 글자로 말한다", () => {
    expect(
      usageStatus({ spent: 410_000, amount: 500_000, usageRate: 0.82 })
    ).toEqual({ text: "82.0% 사용", tone: "warn" });
    expect(
      usageStatus({ spent: 100_000, amount: 500_000, usageRate: 0.2 })
    ).toEqual({ text: "20.0% 사용", tone: "ok" });
  });

  it("비율을 모르면 '—'만 쓴다", () => {
    expect(
      usageStatus({ spent: 0, amount: 0, usageRate: Number.NaN }).text
    ).toBe("—");
  });
});

describe("UsageBar", () => {
  it("초과를 색만이 아니라 글자로도 보여 준다", () => {
    const html = renderToStaticMarkup(
      <UsageBar
        label="식비"
        spent={512_000}
        amount={500_000}
        usageRate={1.024}
      />
    );
    expect(html).toContain("512,000원 / 500,000원");
    expect(html).toMatch(/text-destructive[^"]*">12,000원 초과</);
  });

  it("80% 이상은 경고 색과 함께 쓴 비율을 쓴다", () => {
    const html = renderToStaticMarkup(
      <UsageBar
        label="식비"
        spent={410_000}
        amount={500_000}
        usageRate={0.82}
      />
    );
    expect(html).toMatch(/text-warning-strong[^"]*">82.0% 사용</);
  });

  it("링크 이름을 덮어쓰지 않는다 — 예산 이름·금액이 읽히고 행동은 뒤에 붙는다", () => {
    const html = renderToStaticMarkup(
      <UsageBar
        label="식비"
        spent={100_000}
        amount={500_000}
        usageRate={0.2}
        href="/transactions?categoryId=c1"
        hrefLabel="어디서 썼는지 보기"
      />
    );
    expect(html).not.toContain("aria-label=");
    expect(html).toContain('<span class="sr-only">어디서 썼는지 보기</span>');
    // 폰에는 hover가 없다 — 눌림 표시가 있어야 한다.
    expect(html).toContain("active:bg-muted");
  });

  it("글자·모서리는 토큰만 쓴다", () => {
    const html = renderToStaticMarkup(
      <UsageBar
        label="식비"
        meta="카테고리"
        spent={100_000}
        amount={500_000}
        usageRate={0.2}
        href="/transactions"
      />
    );
    expect(html).not.toMatch(/\btext-(xs|sm|lg)\b|rounded-(md|lg|xl)\b/);
    expect(html).toContain("text-caption");
    expect(html).toContain("rounded-control");
  });
});
