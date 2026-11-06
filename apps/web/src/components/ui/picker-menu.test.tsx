/**
 * 값 고르기 메뉴(PickerMenu). 여는 순간(터치는 손을 뗄 때, 마우스는 누르는 순간)은 공용 드롭다운이 정한다 —
 * `dropdown-menu.test.tsx`. 2026-11-06 사용자 지적("거래 상세만이 아니고 전체적으로 다 그래")으로 거래 상세에만
 * 있던 openOn="release"를 공용 부품의 기본 동작으로 옮겼다. 여기서는 PickerMenu가 그 부품을 그대로 쓰는지와
 * 정적 모양이 그대로인지를 본다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PickerMenu } from "./picker-menu";

const props = {
  label: "카테고리",
  options: [
    { value: "food", label: "식비" },
    { value: "cafe", label: "카페" },
  ],
  value: "food",
  onSelect: () => undefined,
  trigger: <button type="button">카테고리</button>,
};

describe("PickerMenu — 정적 모양은 그대로", () => {
  it("닫힌 트리거에 Radix가 메뉴 표시와 열림 상태를 붙인다", () => {
    const html = renderToStaticMarkup(<PickerMenu {...props} />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-state="closed"');
  });

  it("잠그면 Radix 트리거까지 꺼진다", () => {
    const html = renderToStaticMarkup(<PickerMenu {...props} disabled />);
    expect(html).toContain('data-disabled=""');
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
  });
});

describe("앱 전체 드롭다운은 터치에서 뗄 때 연다 — PickerMenu도 공용 부품 그대로", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/ui/picker-menu.tsx"),
    "utf8"
  );

  it("공용 DropdownMenu·DropdownMenuTrigger를 쓰고, 열림을 따로 쥐거나 여는 순간을 바꾸지 않는다", () => {
    expect(source).toMatch(
      /import \{[^}]*\bDropdownMenuTrigger\b[^}]*\} from "@\/components\/ui\/dropdown-menu";/
    );
    expect(source).toContain("<DropdownMenu>");
    expect(source).toContain(
      "<DropdownMenuTrigger asChild disabled={disabled}>"
    );
    // 예전 거래 상세 전용 옵션과 자체 제어(open·onOpenChange·pointerdown 가로채기)가 남지 않는다.
    for (const gone of [
      "openOn",
      "onOpenChange",
      "onPointerDown",
      "useState",
      "DropdownMenuPrimitive.Root",
      "DropdownMenuPrimitive.Trigger",
    ]) {
      expect(source).not.toContain(gone);
    }
  });
});
