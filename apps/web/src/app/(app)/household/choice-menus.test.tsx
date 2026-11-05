import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MEMBER_COLOR_KEYS, MEMBER_COLOR_LABELS } from "@/lib/member-color";

import { ColorChoices, ColorMenu } from "./color-menu";
import { RoleChoices, RoleMenu } from "./role-menu";

/**
 * 메뉴 내용은 평소 포털 안이라 정적 렌더로 그릴 수 없다. 열린 Radix 메뉴(포털 없음) 안에
 * 항목만 넣어 그린다 — 화면에서 펼쳐지는 항목과 같은 마크업이다.
 */
function renderInOpenMenu(children: ReactNode): string {
  return renderToStaticMarkup(
    <DropdownMenuPrimitive.Root open>
      <DropdownMenuPrimitive.Trigger>열기</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Content>{children}</DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Root>
  );
}

/** role="menuitemradio" 항목의 여는 태그들. */
function radioItems(html: string): string[] {
  return html.match(/<div[^>]*role="menuitemradio"[^>]*>/g) ?? [];
}

describe("색 고르기 메뉴", () => {
  it("견본마다 색 이름과 선택 여부(aria-checked)를 스크린 리더에 알린다", () => {
    const html = renderInOpenMenu(
      <ColorChoices value="sky" onSelect={vi.fn()} noneLabel="자동 색상" />
    );
    const items = radioItems(html);
    // 견본 8개 + '고르지 않음' 한 줄.
    expect(items).toHaveLength(MEMBER_COLOR_KEYS.length + 1);
    const checked = items.filter((item) =>
      item.includes('aria-checked="true"')
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain(`aria-label="${MEMBER_COLOR_LABELS.sky}"`);
    expect(html).toContain("자동 색상");
  });

  it("견본의 누르는 칸은 44px(size-11)이고 보이는 점은 24px이다", () => {
    const html = renderInOpenMenu(
      <ColorChoices value={null} onSelect={vi.fn()} noneLabel="회색" />
    );
    const swatches = radioItems(html).filter((item) =>
      item.includes("aria-label=")
    );
    expect(swatches).toHaveLength(MEMBER_COLOR_KEYS.length);
    for (const swatch of swatches) {
      expect(swatch).toContain("size-11");
      expect(swatch).toContain('aria-checked="false"');
    }
    expect(html).toContain("size-6 rounded-full");
    // 고르지 않음(null)이면 '회색' 줄이 선택돼 있다.
    const none = radioItems(html).find((item) => !item.includes("aria-label="));
    expect(none).toContain('aria-checked="true"');
    expect(none).toContain("min-h-11");
  });
});

describe("역할 고르기 메뉴", () => {
  it("역할마다 이름과 한 줄 설명을 보이고, 보기 전용은 '뷰어'라 부르지 않는다", () => {
    const html = renderInOpenMenu(
      <RoleChoices value="viewer" onSelect={vi.fn()} />
    );
    const items = radioItems(html);
    expect(items).toHaveLength(3);
    for (const item of items) expect(item).toContain("min-h-11");
    for (const text of [
      "구성원",
      "지출을 함께 기록하고 볼 수 있어요",
      "관리자",
      "예산·분류 같은 가족 설정까지 바꿀 수 있어요",
      "보기 전용",
      "기록을 볼 수만 있어요",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("뷰어");
    expect(html).not.toContain("소유자");
    // 지금 역할만 선택돼 있다.
    expect(
      items.filter((item) => item.includes('aria-checked="true"'))
    ).toHaveLength(1);
    expect(html.indexOf('aria-checked="true"')).toBeGreaterThan(
      html.indexOf("관리자")
    );
  });
});

describe("메뉴 잠금(저장 중)", () => {
  // 꺼진 트리거 버튼만으로는 잠기지 않는다 — Chromium(Android 웹뷰)은 꺼진 버튼에도 pointerdown을 보내고
  // Radix 트리거는 자기 disabled prop만 본다. data-disabled는 그 prop에서만 붙으므로 넘겨졌는지의 증거다.
  it("disabled를 Radix 트리거에도 넘긴다", () => {
    const role = renderToStaticMarkup(
      <RoleMenu
        label="민수 역할"
        value="member"
        onSelect={vi.fn()}
        disabled
        trigger={
          <button type="button" disabled>
            구성원
          </button>
        }
      />
    );
    const color = renderToStaticMarkup(
      <ColorMenu
        label="공용 카드 색상"
        value={null}
        noneLabel="회색"
        onSelect={vi.fn()}
        disabled
        trigger={
          <button type="button" disabled>
            회색
          </button>
        }
      />
    );
    for (const html of [role, color]) {
      const trigger = html.match(/<button[^>]*aria-haspopup="menu"[^>]*>/)?.[0];
      expect(trigger).toBeDefined();
      expect(trigger).toContain('data-disabled=""');
      expect(trigger).toContain('disabled=""');
    }
  });

  it("잠그지 않으면 data-disabled가 없다", () => {
    const html = renderToStaticMarkup(
      <RoleMenu
        label="역할"
        value="member"
        onSelect={vi.fn()}
        trigger={<button type="button">구성원</button>}
      />
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("data-disabled");
  });
});
