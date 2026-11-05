/**
 * DialogContent 배치 — 640px 미만은 언제나 하단 시트이고, sm 이상은 `layout`이 정한다.
 *
 * 2026-11-05: 가계부 거래 상세가 넓은 화면(PC·태블릿·펼친 폴드폰)에서 가운데 대화상자로 떴다.
 * 사용자 결정은 "가계부 상세 내역은 바텀 시트"다. 상세가 `layout="sheet"`를 잃으면 이 테스트가 잡는다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { dialogContentLayoutClassName } from "./dialog";

/** sm 이상에서 시트를 화면 가운데로 옮기는 클래스들. */
const CENTERING = [
  "sm:bottom-auto",
  "sm:top-[50%]",
  "sm:translate-y-[-50%]",
  "sm:rounded-card",
  "sm:data-[state=open]:zoom-in-95",
];

describe("DialogContent 배치", () => {
  it("auto(기본)는 모바일에서 하단 시트, sm 이상에서 가운데 대화상자다", () => {
    const classes = dialogContentLayoutClassName("auto").split(" ");
    expect(classes).toEqual(
      expect.arrayContaining(["bottom-0", "rounded-t-card", ...CENTERING])
    );
  });

  it("sheet는 폭과 상관없이 아래에 붙고, 넓은 화면에서는 가운데 정렬·최대 폭만 더한다", () => {
    const classes = dialogContentLayoutClassName("sheet").split(" ");
    expect(classes).toEqual(
      expect.arrayContaining([
        "bottom-0",
        "rounded-t-card",
        "data-[state=open]:slide-in-from-bottom",
        "sm:left-[50%]",
        "sm:translate-x-[-50%]",
        "sm:max-w-lg",
      ])
    );
    for (const centering of CENTERING) {
      expect(classes).not.toContain(centering);
    }
  });

  it("가계부 거래 상세는 sheet 배치를 쓴다", () => {
    const source = readFileSync(
      join(process.cwd(), "src/app/(app)/transactions/page.tsx"),
      "utf8"
    );
    const start = source.indexOf("function TransactionDetailDialog(");
    expect(start).toBeGreaterThan(-1);
    // 여는 태그 = `<DialogContent`부터 첫 자식의 `<` 직전까지. className의 `[&>*]` 때문에
    // `>`로는 태그 끝을 찾을 수 없다.
    const open = source.indexOf("<DialogContent", start);
    expect(open).toBeGreaterThan(start);
    const tag = source.slice(open, source.indexOf("<", open + 1));
    expect(tag).toContain('layout="sheet"');
  });
});
