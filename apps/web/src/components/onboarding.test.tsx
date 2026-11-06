/**
 * 온보딩에서 가족을 만들었는데 가족 목록만 못 받으면 홈으로 보내지 않는다(2026-11-06).
 * 예전에는 성공 토스트 + 홈 이동을 했는데, 목록이 빈 채로 남아 같은 자리에 온보딩이 다시 그려지고
 * 이름이 남은 폼에서 또 누르면 같은 가족이 하나 더 생겼다(서버에 중복 방지 없음).
 *
 * 이 저장소의 웹 테스트는 정적 렌더만 쓴다 — 상태 전이는 함수로, 화면은 정적 렌더와 소스로 확인한다.
 */
import type { HouseholdSummary } from "@family/contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CreatedUnlistedCard,
  Onboarding,
  RELOAD_CREATED_FAILED,
  createdUnlistedMessage,
  reloadCreatedHousehold,
  submitOnboardingCreate,
  type OnboardingCreateEffects,
} from "./onboarding";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  apiCreate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    authedFetch: vi.fn(),
    refreshMemberships: vi.fn(),
    user: { id: "u-me", name: "수빈" },
  }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      households: { ...actual.api.households, create: mocks.apiCreate },
    },
  };
});

const CREATED: HouseholdSummary = {
  id: "h-new",
  name: "둘째네",
  createdAt: "2026-11-06T00:00:00.000Z",
  myRole: "owner",
  sharedColor: null,
};

function effects() {
  return {
    push: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    setNameError: vi.fn(),
    showCreatedUnlisted: vi.fn(),
  } satisfies OnboardingCreateEffects;
}

/** 정적 렌더는 작은따옴표를 &#x27;로 바꾼다. */
function decode(html: string): string {
  return html.replace(/&#x27;/g, "'");
}

function buttons(html: string): string[] {
  return html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

const source = readFileSync(
  join(process.cwd(), "src/components/onboarding.tsx"),
  "utf8"
);
const onboardingBody = source.slice(
  source.indexOf("export function Onboarding")
);

beforeEach(() => {
  mocks.push.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
  mocks.apiCreate.mockReset();
});

describe("온보딩 가족 만들기 — 목록을 못 받았을 때", () => {
  it("① 만들었는데 목록을 못 받으면 홈으로 가지 않고 성공 토스트도 없이 '다시 불러오기' 안내로 바꾼다", async () => {
    const create = vi.fn(async () => CREATED);
    const refresh = vi.fn(async () => {
      throw new Error("me failed");
    });
    const fx = effects();

    await submitOnboardingCreate(create, refresh, fx);

    expect(create).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fx.showCreatedUnlisted).toHaveBeenCalledWith("둘째네");
    expect(fx.push).not.toHaveBeenCalled();
    expect(fx.toastSuccess).not.toHaveBeenCalled();
    expect(fx.toastError).not.toHaveBeenCalled();
    expect(fx.setNameError).not.toHaveBeenCalled();

    // 바뀐 자리에는 안내와 '다시 불러오기'만 있다 — 만들기 버튼·입력 칸이 없어 두 번째 만들기 요청이 나갈 수 없다.
    const html = decode(
      renderToStaticMarkup(
        <CreatedUnlistedCard
          name="둘째네"
          reloading={false}
          error={null}
          onReload={vi.fn()}
        />
      )
    );
    expect(html).toContain(
      "'둘째네' 가족은 만들었어요. 목록을 불러오지 못했어요."
    );
    expect(createdUnlistedMessage("둘째네")).toBe(
      "'둘째네' 가족은 만들었어요. 목록을 불러오지 못했어요."
    );
    expect(buttons(html)).toHaveLength(1);
    expect(buttons(html)[0]).toContain("다시 불러오기");
    expect(html).not.toMatch(/만들기|<form|<input|다른 방법/);
  });

  it("목록을 못 받은 동안 온보딩은 방법 고르기·만들기 폼 대신 안내 카드만 그린다", () => {
    expect(onboardingBody).toMatch(
      /\{createdUnlisted \? \([\s\S]*?<CreatedUnlistedCard[\s\S]*?\/>\s*\) : mode === null \?/
    );
    // 목록을 받았는지와 상관없이 곧바로 홈으로 보내던 줄이 다시 들어오지 않는다.
    expect(onboardingBody).not.toContain('router.push("/dashboard")');
    expect(onboardingBody).toContain("await submitOnboardingCreate(");
  });

  it("② 그 상태에서 다시 불러오기에 성공하면 홈으로 간다", async () => {
    const refresh = vi.fn(async () => undefined);
    const push = vi.fn();

    await expect(reloadCreatedHousehold(refresh, push)).resolves.toBeNull();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("다시 불러오기도 실패하면 홈으로 가지 않고 안내는 그대로, 짧은 오류 문구를 붙인다", async () => {
    const refresh = vi.fn(async () => {
      throw new Error("me failed");
    });
    const push = vi.fn();

    await expect(reloadCreatedHousehold(refresh, push)).resolves.toBe(
      RELOAD_CREATED_FAILED
    );
    expect(push).not.toHaveBeenCalled();
    expect(RELOAD_CREATED_FAILED).toBe(
      "아직 불러오지 못했어요. 잠시 후 다시 눌러 주세요."
    );

    const html = decode(
      renderToStaticMarkup(
        <CreatedUnlistedCard
          name="둘째네"
          reloading={false}
          error={RELOAD_CREATED_FAILED}
          onReload={vi.fn()}
        />
      )
    );
    expect(html).toContain("'둘째네' 가족은 만들었어요.");
    expect(html).toMatch(
      /<p role="alert"[^>]*>아직 불러오지 못했어요\. 잠시 후 다시 눌러 주세요\.<\/p>/
    );
    expect(buttons(html)).toHaveLength(1);
    expect(buttons(html)[0]).toContain("다시 불러오기");
  });

  it("'다시 불러오기'는 44px 이상이고, 불러오는 동안에는 막아 두 번 보내지 않는다", () => {
    const idle = buttons(
      renderToStaticMarkup(
        <CreatedUnlistedCard
          name="둘째네"
          reloading={false}
          error={null}
          onReload={vi.fn()}
        />
      )
    )[0];
    // size="lg"는 h-13(52px).
    expect(idle).toMatch(/class="[^"]*\bh-13\b/);
    expect(idle).not.toMatch(/<button[^>]*\sdisabled=""/);

    const busy = buttons(
      renderToStaticMarkup(
        <CreatedUnlistedCard
          name="둘째네"
          reloading
          error={null}
          onReload={vi.fn()}
        />
      )
    )[0];
    expect(busy).toMatch(/<button[^>]*\sdisabled=""/);
    expect(busy).toContain("불러오는 중…");
  });
});

describe("온보딩 가족 만들기 — 지금처럼 동작하는 경우", () => {
  it("③ 목록까지 받으면 성공 토스트를 띄우고 홈으로 간다", async () => {
    const create = vi.fn(async () => CREATED);
    const refresh = vi.fn(async () => undefined);
    const fx = effects();

    await submitOnboardingCreate(create, refresh, fx);

    expect(create).toHaveBeenCalledTimes(1);
    expect(fx.toastSuccess).toHaveBeenCalledWith("'둘째네' 가족을 만들었어요.");
    expect(fx.push).toHaveBeenCalledWith("/dashboard");
    expect(fx.showCreatedUnlisted).not.toHaveBeenCalled();
    expect(fx.toastError).not.toHaveBeenCalled();
  });

  it("만들지 못하면 이름 칸 오류 + 오류 토스트, 홈으로 가지 않고 목록도 받지 않는다", async () => {
    const create = vi.fn(async (): Promise<HouseholdSummary> => {
      throw new TypeError("Failed to fetch");
    });
    const refresh = vi.fn(async () => undefined);
    const fx = effects();

    await submitOnboardingCreate(create, refresh, fx);

    const message = "가족을 만들지 못했어요. 잠시 후 다시 시도해 주세요.";
    expect(fx.setNameError).toHaveBeenCalledWith(message);
    expect(fx.toastError).toHaveBeenCalledWith(message);
    expect(refresh).not.toHaveBeenCalled();
    expect(fx.push).not.toHaveBeenCalled();
    expect(fx.toastSuccess).not.toHaveBeenCalled();
    expect(fx.showCreatedUnlisted).not.toHaveBeenCalled();
  });

  it("처음 화면은 방법 고르기 두 장이고 안내 카드는 없다 — 그리기만 해서는 아무 요청도 나가지 않는다", () => {
    const html = renderToStaticMarkup(<Onboarding />);
    expect(html).toContain("새 가족 만들기");
    expect(html).toContain("초대로 참여하기");
    expect(html).toContain("수빈님, 반가워요.");
    expect(html).not.toContain("다시 불러오기");
    expect(mocks.apiCreate).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
