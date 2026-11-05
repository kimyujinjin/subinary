import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PLATFORM_LABEL, PlatformSegment } from "./platform-segment";

/*
 * 기기 종류 세그먼트 — 접힌 Select 대신 'Android · iPhone · 기타'가 한눈에 보이고(2026-11-05 HIG 검수),
 * 라디오 묶음으로 읽히며, 칸마다 누르는 영역이 44px이다.
 */
function render(value: "android" | "ios" | "other"): string {
  return renderToStaticMarkup(
    <PlatformSegment
      value={value}
      onChange={vi.fn()}
      labelledBy="platform-label"
    />
  );
}

describe("PlatformSegment", () => {
  it("세 종류를 Android · iPhone · 기타 순서로 한눈에 보인다", () => {
    const html = render("android");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-labelledby="platform-label"');
    const labels = [...html.matchAll(/role="radio"[^>]*>([^<]+)</g)].map(
      (m) => m[1]
    );
    expect(labels).toEqual(["Android", "iPhone", "기타"]);
    expect(PLATFORM_LABEL.ios).toBe("iPhone");
  });

  it("고른 칸만 aria-checked·탭 순서이고, 모든 칸이 44px이다", () => {
    const html = render("ios");
    const radios = [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map(
      (m) => m[0]
    );
    expect(radios).toHaveLength(3);
    const checked = radios.filter((tag) => tag.includes('aria-checked="true"'));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('data-platform="ios"');
    expect(checked[0]).toContain('tabindex="0"');
    for (const tag of radios) expect(tag).toContain("min-h-11");
    // 고른 칸은 색만이 아니라 굵기·바탕으로도 다르다.
    expect(checked[0]).toContain("font-semibold");
  });
});
