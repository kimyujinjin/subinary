import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HouseholdSwitcher } from "./household-switcher";

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

// 메뉴는 포털 안이라 정적 렌더로 그릴 수 없어 항목은 소스로 확인한다(sheet-layout.test.ts와 같은 방식).
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
    expect(source).toContain("ROLE_LABEL[m.role]");
    expect(source).not.toContain("뷰어");
  });

  // 여기 있던 '새 가족 만들기'는 구성원 추가로 읽혔고, 만들면 빈 가족으로 곧바로 넘어갔다 —
  // 가족 화면 맨 아래 줄로 옮겼다(household/create-household.tsx, 2026-11-06 결정 ③).
  it("머리 메뉴에는 가족 고르기만 있다 — 새 가족 만들기 항목·입력 창이 없다", () => {
    const code = source.slice(source.indexOf("export function HouseholdSwitcher"));
    expect(code).not.toContain("새 가족 만들기");
    expect(code).not.toMatch(/<Dialog\b|DropdownMenuItem\b|DropdownMenuSeparator/);
    expect(source).not.toContain("api.households.create");
    expect(code.match(/setHouseholdId\(/g)).toHaveLength(1);
  });

  it("지금 가족은 라디오 항목의 체크로 보인다(menuitemradio — 지금 값을 스크린 리더도 읽는다)", () => {
    expect(source).toContain("DropdownMenuPrimitive.RadioGroup");
    expect(source).toContain("DropdownMenuPrimitive.ItemIndicator");
  });
});
