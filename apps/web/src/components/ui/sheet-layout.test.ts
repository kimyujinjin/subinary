/**
 * 하단 시트 배치 — 대화상자·확인창·선택 시트는 화면 폭과 상관없이 아래에 붙는다.
 *
 * 2026-11-05 사용자 지적: 가계부 거래 상세가 넓은 화면(PC·태블릿·펼친 폴드폰)에서 가운데 대화상자로 떴다.
 * 결정은 "시트는 폭과 상관없이 바텀 시트"다. 누가 sm 이상 가운데 배치를 되살리면 이 테스트가 잡는다.
 * (node 환경이라 Radix 포털 안을 렌더할 수 없어, 공용 클래스와 소스를 직접 확인한다.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";
import { DIALOG_SHEET, SHEET_POSITION } from "./sheet-layout";

const SRC = join(process.cwd(), "src");

/** 넓은 화면에서 시트를 화면 가운데로 옮기던 예전 클래스들. */
const CENTERING = [
  "sm:bottom-auto",
  "sm:top-[50%]",
  "sm:top-1/2",
  "sm:translate-y-[-50%]",
  "sm:-translate-y-1/2",
  "sm:rounded-card",
  "zoom-in-95",
  "zoom-out-95",
];

/** 아래에 붙이고 넓은 화면에서 가로 가운데 정렬만 하는 클래스들. */
const ANCHORED = [
  "bottom-0",
  "rounded-t-card",
  "data-[state=open]:slide-in-from-bottom",
  "sm:left-[50%]",
  "sm:translate-x-[-50%]",
];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith(".tsx") && !name.includes(".test.") ? [full] : [];
  });
}

describe("하단 시트 배치", () => {
  it("폭과 상관없이 아래에 붙고, 넓은 화면에서는 가운데 정렬만 더한다", () => {
    expect(SHEET_POSITION.split(" ")).toEqual(expect.arrayContaining(ANCHORED));
    for (const centering of CENTERING) {
      expect(DIALOG_SHEET).not.toContain(centering);
    }
  });

  it("화면이 크기·여백을 덮어써도 시트 위치 클래스는 남는다", () => {
    // 실제 호출부가 넘기는 값들(거래 추가, 직접 입력 자산, 카드 끝자리 고치기).
    for (const override of [
      "max-h-[90dvh] max-w-md",
      "max-h-[calc(100dvh-2rem)] p-0 [&>button]:top-1 sm:max-w-xl",
      "p-4 [&>button]:top-1 sm:p-6",
    ]) {
      expect(cn(DIALOG_SHEET, override).split(" ")).toEqual(
        expect.arrayContaining(ANCHORED)
      );
    }
  });

  it("대화상자·확인창·선택 시트가 모두 공용 배치를 쓰고 가운데 배치 클래스가 없다", () => {
    for (const [file, constant] of [
      ["components/ui/dialog.tsx", "DIALOG_SHEET"],
      ["components/ui/alert-dialog.tsx", "DIALOG_SHEET"],
      ["components/widgets/bottom-sheet.tsx", "SHEET_POSITION"],
    ] as const) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source, file).toContain(constant);
      for (const centering of CENTERING) {
        expect(source, `${file}: ${centering}`).not.toContain(centering);
      }
    }
  });

  it("어떤 화면도 대화상자·확인창에 가운데 배치 클래스를 넘기지 않는다", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /<(AlertDialogContent|DialogContent)\b/g
      )) {
        // 여는 태그 = 첫 자식의 `<` 직전까지(className의 `[&>*]` 때문에 `>`로는 끝을 못 찾는다).
        const start = match.index ?? 0;
        const tag = source.slice(start, source.indexOf("<", start + 1));
        for (const centering of CENTERING) {
          if (tag.includes(centering)) offenders.push(`${file}: ${centering}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
