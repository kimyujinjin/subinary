/**
 * 시트 손잡이 — 놓았을 때 닫을지 판단(2026-11-05 사용자 결정: 끌어내리면 닫힌다).
 * node 환경이라 실제 끌기는 재현할 수 없어, 판단 함수만 고정한다.
 */
import { describe, expect, it } from "vitest";

import { shouldDismissSheet } from "./sheet-handle";

describe("시트 손잡이 — 닫을지 판단", () => {
  it("끌지 않았거나 위로 끌었으면 닫지 않는다", () => {
    expect(shouldDismissSheet(0, 300, 600)).toBe(false);
    expect(shouldDismissSheet(-40, 300, 600)).toBe(false);
  });

  it("천천히 끌어도 120px(또는 시트 높이의 1/4) 이상 내리면 닫는다", () => {
    expect(shouldDismissSheet(130, 1000, 700)).toBe(true);
    expect(shouldDismissSheet(100, 1000, 700)).toBe(false);
    // 짧은 시트(높이 200px)는 1/4인 50px만 내려도 닫힌다.
    expect(shouldDismissSheet(60, 1000, 200)).toBe(true);
  });

  it("빠르게 튕기면 짧아도 닫지만, 손 떨림 정도로는 닫지 않는다", () => {
    expect(shouldDismissSheet(40, 50, 700)).toBe(true);
    expect(shouldDismissSheet(8, 4, 700)).toBe(false);
  });
});
