/**
 * 목록 줄(2026-11-05 HIG 검수): ›를 640px 미만에서 숨겨 폰에서는 결제 카드·카테고리·할 일·분석 줄이
 * 눌리는 줄인지 보이지 않았다. 터치 화면에는 hover가 없어 눌린 느낌도 없었다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ListRow } from "./list-row";

function chevronClass(html: string): string {
  const m = /<svg[^>]*class="([^"]*lucide-chevron-right[^"]*)"/.exec(html);
  if (!m) throw new Error(`› 아이콘이 없다: ${html}`);
  return m[1]!;
}

describe("ListRow", () => {
  it("›는 모든 폭에서 보이고 20px이다", () => {
    const cls = chevronClass(
      renderToStaticMarkup(
        <ListRow title="식비" value="12,000원" href="/transactions" chevron />
      )
    ).split(/\s+/);
    expect(cls).toContain("size-5");
    expect(cls).not.toContain("hidden");
    expect(cls.some((c) => c.endsWith(":block"))).toBe(false);
  });

  it("링크 줄과 버튼 줄은 눌린 동안 배경이 짙어진다", () => {
    const link = renderToStaticMarkup(
      <ListRow title="식비" href="/transactions" chevron />
    );
    expect(link).toMatch(/^<a [^>]*class="[^"]*active:bg-muted/);
    const button = renderToStaticMarkup(
      <ListRow title="식비" onClick={() => undefined} chevron />
    );
    expect(button).toMatch(/^<button [^>]*class="[^"]*active:bg-muted/);
  });

  it("읽기 전용 줄은 눌림 표시도 ›도 없다", () => {
    const html = renderToStaticMarkup(
      <ListRow title="식비" value="12,000원" />
    );
    expect(html).toMatch(/^<div /);
    expect(html).not.toContain("active:");
    expect(html).not.toContain("hover:");
    expect(html).not.toContain("lucide-chevron-right");
  });
});
