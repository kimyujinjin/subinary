import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HouseholdSwitcher } from "./household-switcher";

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn(), refreshMemberships: vi.fn() }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({
    householdId: "h-1",
    setHouseholdId: vi.fn(),
    activeMembership: {
      householdId: "h-1",
      name: "우리집",
      role: "viewer",
      status: "active",
    },
    memberships: [
      { householdId: "h-1", name: "우리집", role: "viewer", status: "active" },
    ],
  }),
}));

// 메뉴·입력 창은 포털 안이라 정적 렌더로 그릴 수 없어 문구·버튼은 소스로 확인한다(sheet-layout.test.ts와 같은 방식).
const source = readFileSync(
  join(process.cwd(), "src/components/household-switcher.tsx"),
  "utf8"
);

describe("가족 전환", () => {
  it("머리 버튼은 글자 토큰(text-caption)을 쓴다 — 임의 크기 text-[13px] 금지", () => {
    const html = renderToStaticMarkup(<HouseholdSwitcher />);
    const trigger = html.match(/<button[^>]*>/)?.[0] ?? "";
    expect(trigger).toContain("text-caption");
    expect(trigger).toContain("min-h-11");
    expect(html).toContain("우리집");
    expect(source).not.toMatch(/text-\[13px\]|(?<![\w-])text-xs(?![\w-])/);
  });

  it("문구는 해요체이고, 보기 전용 역할은 '뷰어'라 부르지 않는다", () => {
    expect(source).not.toMatch(/습니다|합니다|만듭니다/);
    expect(source).toContain("가족을 만들지 못했어요.");
    expect(source).not.toContain("뷰어");
  });

  it("새 가족 만들기 창에는 X 말고도 '닫기' 버튼이 있다", () => {
    const footer = source.slice(source.indexOf("<DialogFooter"));
    expect(footer).toMatch(/variant="ghost"[\s\S]*?닫기/);
    expect(footer).toContain('form="create-household-form"');
  });

  it("지금 가족은 라디오 항목의 체크로 보인다(menuitemradio — 지금 값을 스크린 리더도 읽는다)", () => {
    expect(source).toContain("DropdownMenuPrimitive.RadioGroup");
    expect(source).toContain("DropdownMenuPrimitive.ItemIndicator");
  });
});
