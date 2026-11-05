/**
 * 여러 줄 입력(2026-11-05 HIG 검수 3·4단계): 메모·문자 붙여넣기 칸이 Input과 같은 모양이어야 한다.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Textarea } from "./textarea";

const classesOf = (html: string) =>
  /class="([^"]+)"/.exec(html)?.[1]?.split(/\s+/) ?? [];

describe("Textarea", () => {
  it("Input과 같은 모양 — 회색 채움 · 본문 글자 · 컨트롤 모서리 · 포커스는 1px 테두리 색만", () => {
    const cls = classesOf(renderToStaticMarkup(<Textarea />));
    expect(cls).toEqual(
      expect.arrayContaining([
        "bg-muted",
        "text-body",
        "rounded-control",
        "border",
        "border-transparent",
        "focus-visible:border-primary",
        "aria-invalid:border-destructive",
        "min-h-24",
      ])
    );
    // 옛 모양(3px 링·text-sm·rounded-md)은 없다
    expect(cls.some((c) => /ring-\[|^focus-visible:ring/.test(c))).toBe(false);
    expect(cls).not.toContain("text-sm");
    expect(cls).not.toContain("rounded-md");
  });

  it("textarea 속성을 그대로 넘기고 호출부 className이 이긴다", () => {
    const html = renderToStaticMarkup(
      <Textarea
        id="memo-input"
        rows={4}
        maxLength={1000}
        placeholder="예: 아이 생일 케이크"
        aria-invalid
        aria-describedby="memo-error"
        className="bg-background min-h-32"
        defaultValue="메모"
      />
    );
    expect(html).toContain('id="memo-input"');
    expect(html).toContain('rows="4"');
    expect(html).toContain('maxLength="1000"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="memo-error"');
    expect(html).toContain(">메모</textarea>");
    const cls = classesOf(html);
    expect(cls).toEqual(expect.arrayContaining(["bg-background", "min-h-32"]));
    expect(cls).not.toContain("bg-muted");
    expect(cls).not.toContain("min-h-24");
  });
});
