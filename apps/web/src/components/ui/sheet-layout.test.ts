/**
 * 창 모양 — 용도마다 하나(2026-11-05 전수조사, 표는 sheet-layout.ts).
 *
 * 같은 날 대화상자·확인창·선택 목록을 모두 바텀 시트로 바꿨다가 "모든 걸 다 바텀 시트로 만들라고 한 건
 * 아니었다"는 지적으로 정리했다. 바텀 시트는 상세 보기(거래 상세)와 선택지·안내(BottomSheet 위젯)뿐이다.
 * 확인은 가운데 작은 창, 입력 폼은 폰에서 아래·넓은 화면에서 가운데, 값 고르기는 드롭다운이다.
 * node 환경이라 Radix 포털 안을 렌더할 수 없어, 공용 클래스와 소스를 직접 확인한다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ALERT_CENTERED,
  DIALOG_RESPONSIVE,
  DIALOG_SHEET,
  SHEET_MAX_HEIGHT,
  SHEET_POSITION,
} from "./sheet-layout";

const SRC = join(process.cwd(), "src");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");
const classes = (value: string) => value.split(/\s+/);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith(".tsx") && !name.includes(".test.") ? [full] : [];
  });
}

describe("창 모양 — 용도마다 하나", () => {
  it("바텀 시트는 모든 폭에서 아래에 붙고 최대 85%다(상세 보기·선택지·안내)", () => {
    expect(classes(SHEET_POSITION)).toEqual(
      expect.arrayContaining([
        "bottom-0",
        "rounded-t-card",
        "data-[state=open]:slide-in-from-bottom",
      ])
    );
    expect(SHEET_MAX_HEIGHT).toBe("max-h-[85dvh]");
    expect(classes(DIALOG_SHEET)).toEqual(
      expect.arrayContaining([SHEET_MAX_HEIGHT])
    );
    expect(DIALOG_SHEET).not.toContain("sm:top-[50%]");
  });

  it("입력 폼은 폰에서 아래, 넓은 화면에서 가운데다", () => {
    expect(classes(DIALOG_RESPONSIVE)).toEqual(
      expect.arrayContaining([
        "bottom-0",
        "sm:bottom-auto",
        "sm:top-[50%]",
        "sm:translate-y-[-50%]",
      ])
    );
  });

  it("확인은 모든 폭에서 화면 가운데 작은 창이다", () => {
    expect(classes(ALERT_CENTERED)).toEqual(
      expect.arrayContaining([
        "top-[50%]",
        "left-[50%]",
        "translate-y-[-50%]",
        "sm:max-w-sm",
      ])
    );
    for (const sheetClass of [
      "bottom-0",
      "rounded-t-card",
      "slide-in-from-bottom",
    ]) {
      expect(ALERT_CENTERED).not.toContain(sheetClass);
    }
  });

  it('Dialog 기본은 입력 폼 모양이고, 손잡이는 layout="sheet"일 때만 단다', () => {
    const dialog = read("components/ui/dialog.tsx");
    expect(dialog).toContain('layout = "auto"');
    expect(dialog).toContain(
      'layout === "sheet" ? DIALOG_SHEET : DIALOG_RESPONSIVE'
    );
    expect(dialog).toMatch(/layout === "sheet" \? \(\s*<SheetHandle/);
    const alert = read("components/ui/alert-dialog.tsx");
    expect(alert).toContain("ALERT_CENTERED");
    expect(alert).not.toContain("SheetHandle");
    const sheet = read("components/widgets/bottom-sheet.tsx");
    for (const used of ["SHEET_POSITION", "SHEET_MAX_HEIGHT", "<SheetHandle"]) {
      expect(sheet).toContain(used);
    }
  });

  it("바텀 시트로 뜨는 창은 가계부 거래 상세 하나뿐이다", () => {
    const users = tsxFiles(SRC)
      .filter((file) => !file.includes("/components/ui/")) // 부품 정의·설명 주석은 사용처가 아니다
      .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return (source.match(/layout="sheet"/g) ?? []).map(() =>
        file.slice(SRC.length + 1)
      );
    });
    expect(users).toEqual(["app/(app)/transactions/page.tsx"]);
  });

  it("확인(…할까요?)을 바텀 시트로 띄우지 않는다 — 가운데 확인창을 쓴다", () => {
    const offenders = tsxFiles(SRC).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/<BottomSheet\b/g)].flatMap((match) => {
        const start = match.index ?? 0;
        const tag = source.slice(
          start,
          source.indexOf(">", source.indexOf("title=", start)) + 1
        );
        return /할까요\?/.test(tag) ? [file.slice(SRC.length + 1)] : [];
      });
    });
    expect(offenders).toEqual([]);
  });

  it("값 고르기는 선택 시트가 아니라 드롭다운이다", () => {
    const sheets = tsxFiles(SRC).filter((file) =>
      /PickerSheet|picker-sheet/.test(readFileSync(file, "utf8"))
    );
    expect(sheets).toEqual([]);
  });
});
