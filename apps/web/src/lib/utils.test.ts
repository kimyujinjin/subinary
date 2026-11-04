import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn — 리뉴얼 글자 토큰 병합", () => {
  it("글자 크기 토큰을 색으로 오인해 색을 지우지 않는다", () => {
    expect(cn("text-muted-foreground", "text-caption")).toBe("text-muted-foreground text-caption");
    expect(cn("text-body min-h-11", "text-destructive")).toBe("text-body min-h-11 text-destructive");
  });

  it("크기끼리는 나중 것 하나만 남긴다", () => {
    expect(cn("text-lg font-semibold", "text-heading")).toBe("font-semibold text-heading");
    expect(cn("text-muted-foreground text-sm", "text-caption")).toBe("text-muted-foreground text-caption");
  });

  it("기본 Tailwind 크기·색 병합은 그대로다", () => {
    expect(cn("text-red-500 text-xs", "text-blue-500 text-2xl")).toBe("text-blue-500 text-2xl");
  });
});
