/**
 * 공용 부품의 손가락 기준(2026-11-05 애플 HIG 디자인 검수 2단계).
 * - 누르는 영역은 최소 44px. 보이는 크기가 작아야 하면 터치 영역만 넓힌다.
 * - 폰에서는 Tailwind v4의 hover:가 켜지지 않아 눌림은 active:로 보여야 한다.
 * - 글자·모서리는 리뉴얼 토큰만(text-display…micro, rounded-card/control/full).
 * node 환경이라 Radix 포털 안을 렌더할 수 없어 buttonVariants는 직접 부르고 나머지는 소스를 읽는다
 * (sheet-layout.test.ts와 같은 방식). 색 대비는 lib/color-contrast.test.ts가 잰다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

import { buttonVariants, touchTarget } from "./button";

const UI = join(process.cwd(), "src/components/ui");
const read = (file: string) => readFileSync(join(UI, file), "utf8");
const classes = (value: string) => value.split(/\s+/).filter(Boolean);

function capture(source: string, pattern: RegExp): string {
  const m = pattern.exec(source);
  if (!m) throw new Error(`${pattern}을 찾지 못했다`);
  return m[1]!;
}

describe("Button", () => {
  it("sm은 보이는 높이 36을 두고 누르는 영역만 44로 넓힌다", () => {
    const sm = classes(buttonVariants({ size: "sm" }));
    expect(sm).toContain("h-9");
    expect(sm).toEqual(expect.arrayContaining(classes(touchTarget)));
    // 44px(2.75rem)보다 작을 때만 넓힌다 — 호출부가 h-7·h-8로 줄여도 44를 지킨다.
    expect(touchTarget).toContain(
      "before:inset-[min(0px,calc((100%_-_2.75rem)/2))]"
    );
  });

  it("기본·큰·아이콘 버튼은 그 자체로 44px 이상이다", () => {
    expect(classes(buttonVariants())).toContain("h-11");
    expect(classes(buttonVariants({ size: "lg" }))).toContain("h-13");
    expect(classes(buttonVariants({ size: "icon" }))).toContain("size-11");
  });

  it("모든 변형에 눌림(active:) 표시가 있다", () => {
    for (const variant of [
      "default",
      "weak",
      "destructive",
      "tint",
      "secondary",
      "outline",
      "ghost",
      "link",
    ] as const) {
      expect(buttonVariants({ variant }), variant).toMatch(/(^|\s)active:/);
    }
  });

  it("호출부의 위치·높이 덮어쓰기가 여전히 이긴다", () => {
    const merged = classes(
      cn(buttonVariants({ size: "sm", className: "absolute h-8" }))
    );
    expect(merged).toEqual(expect.arrayContaining(["absolute", "h-8"]));
    expect(merged).not.toContain("relative");
    expect(merged).not.toContain("h-9");
  });
});

describe("Dialog 닫기 X", () => {
  const close = capture(
    read("dialog.tsx"),
    /<DialogPrimitive\.Close\s+ref=\{closeRef\}\s+className="([^"]+)"/
  );

  it("누르는 영역 44 · 아이콘 20", () => {
    expect(classes(close)).toEqual(
      expect.arrayContaining([
        "size-11",
        "inline-flex",
        "items-center",
        "justify-center",
        "[&_svg:not([class*='size-'])]:size-5",
      ])
    );
  });

  it("오른쪽 위라 가운데 위의 시트 손잡이와 겹치지 않는다", () => {
    expect(classes(close)).toEqual(
      expect.arrayContaining(["absolute", "top-2.5", "right-2"])
    );
    expect(close).not.toMatch(/(^|\s)(left-|inset-x-)/);
  });
});

describe("메뉴·선택·폼", () => {
  it("메뉴 줄(일반·체크·라디오)은 44 높이 · 본문 글자 · 컨트롤 모서리 · muted 하이라이트", () => {
    const menu = read("dropdown-menu.tsx");
    const item = classes(capture(menu, /const MENU_ITEM =\s*"([^"]+)"/));
    expect(item).toEqual(
      expect.arrayContaining([
        "min-h-11",
        "text-body",
        "rounded-control",
        "focus:bg-muted",
      ])
    );
    expect(menu.match(/cn\(\s*MENU_ITEM,/g)).toHaveLength(3);
    expect(menu).toContain("rounded-control border p-1 shadow-md");
  });

  it("SelectTrigger 기본 높이는 Input과 같다", () => {
    const inputHeight = capture(read("input.tsx"), /\b(h-\d+)\b/);
    const trigger = classes(
      capture(read("select.tsx"), /data-slot="select-trigger"[\s\S]*?"([^"]+)"/)
    );
    expect(trigger).toContain(inputHeight);
    // data-[size=default]: 높이는 호출부의 h-11보다 선택자가 세서 덮어쓰기를 막았다.
    expect(trigger.some((c) => c.startsWith("data-[size=default]:h-"))).toBe(
      false
    );
  });

  it("SelectItem은 44 높이 · 본문, SelectLabel은 caption", () => {
    const select = read("select.tsx");
    const item = classes(
      capture(select, /data-slot="select-item"[\s\S]*?"([^"]+)"/)
    );
    expect(item).toEqual(expect.arrayContaining(["min-h-11", "text-body"]));
    expect(select).toMatch(/data-slot="select-label"[\s\S]*?text-caption/);
  });

  it("FormDescription·FormMessage는 caption", () => {
    const form = read("form.tsx");
    expect(form).toMatch(/data-slot="form-description"[\s\S]*?text-caption/);
    expect(form).toMatch(/data-slot="form-message"[\s\S]*?text-caption/);
  });
});

describe("Switch·Checkbox", () => {
  it("스위치는 꺼짐 트랙에 control-off, 손잡이 그림자, 누르는 영역 44", () => {
    const sw = read("switch.tsx");
    expect(sw).toContain("data-[state=unchecked]:bg-control-off");
    expect(sw).toMatch(/touchTarget,\s*className,/);
    expect(sw).toMatch(/data-slot="switch-thumb"[\s\S]*?shadow-sm/);
  });

  it("체크박스 테두리는 control-off", () => {
    expect(read("checkbox.tsx")).toContain("peer border-control-off");
  });
});

describe("AlertDialog·떠 있는 면", () => {
  it("AlertDialogAction은 variant로 위험 동작을 고르고 기본은 그대로다", () => {
    const alert = read("alert-dialog.tsx");
    expect(alert).toContain('variant?: "default" | "destructive"');
    expect(alert).toMatch(
      /function AlertDialogAction\(\{[\s\S]*?variant = "default"/
    );
    expect(alert).toContain("buttonVariants({ variant })");
  });

  it("Dialog·AlertDialog·BottomSheet 바탕은 떠 있는 면 + 다크 위쪽 1px 경계", () => {
    for (const file of [
      "dialog.tsx",
      "alert-dialog.tsx",
      "../widgets/bottom-sheet.tsx",
    ]) {
      // 창 바탕 클래스 문자열(fixed z-50이 함께 있는 줄)에 셋이 같이 있어야 한다.
      const surface = classes(capture(read(file), /"([^"]*\bfixed z-50\b[^"]*)"/));
      expect(surface, file).toEqual(
        expect.arrayContaining([
          "bg-elevated",
          "dark:border-t",
          "dark:border-white/10",
        ])
      );
    }
  });
});

describe("옛 글자 크기·모서리 값", () => {
  it("공용 부품에 text-xs/sm/lg·rounded-sm/md/lg/xl·text-[Npx]가 없다", () => {
    for (const file of [
      "button.tsx",
      "dialog.tsx",
      "alert-dialog.tsx",
      "dropdown-menu.tsx",
      "select.tsx",
      "form.tsx",
      "switch.tsx",
      "checkbox.tsx",
    ]) {
      const old =
        read(file).match(
          /\b(?:text-(?:xs|sm|lg|xl)|rounded-(?:xs|sm|md|lg|xl))\b|text-\[\d+px\]/g
        ) ?? [];
      expect(old, file).toEqual([]);
    }
  });
});
