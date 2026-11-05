/**
 * 월 이동(`‹ 2026년 11월 ›`) — 화살표가 32px이라 HIG 최소 누르는 영역(44px)에 모자랐고,
 * 라벨은 임의 글자 크기(text-[13px])였다(2026-11-05 HIG 검수).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MonthSwitcher } from "./month-switcher";

function render(month: string, months?: readonly string[]) {
  return renderToStaticMarkup(
    <MonthSwitcher month={month} months={months} onChange={() => undefined} />
  );
}

function buttonClasses(html: string, label: string): string[] {
  const m = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html);
  if (!m) throw new Error(`${label} 버튼이 없다`);
  const cls = /class="([^"]*)"/.exec(m[0]);
  return cls ? cls[1]!.split(/\s+/) : [];
}

describe("MonthSwitcher", () => {
  it("화살표는 누르는 영역 44px, 아이콘 20px이다", () => {
    const html = render("2026-11", ["2026-10", "2026-11", "2026-12"]);
    for (const label of ["이전 달", "다음 달"]) {
      const cls = buttonClasses(html, label);
      expect(cls).toContain("size-11");
      expect(cls).not.toContain("size-8");
    }
    expect(html.match(/<svg[^>]*class="[^"]*size-5/g)).toHaveLength(2);
  });

  it("라벨은 글자 토큰이고 폭이 고정이라 달이 바뀌어도 화살표가 움직이지 않는다", () => {
    const html = render("2026-11", ["2026-11"]);
    const label = /<span[^>]*class="([^"]*)"[^>]*>2026년 11월<\/span>/.exec(
      html
    );
    expect(label).not.toBeNull();
    const cls = label![1]!.split(/\s+/);
    expect(cls).toEqual(
      expect.arrayContaining([
        "text-body",
        "font-medium",
        "tabular-nums",
        "min-w-26",
      ])
    );
    expect(label![1]).not.toMatch(/text-\[/);
  });

  it("거래가 있는 달 목록 끝에서는 그쪽 화살표가 잠긴다", () => {
    const html = render("2026-11", ["2026-10", "2026-11"]);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="다음 달"/);
    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="이전 달"/
    );
  });
});
