import type { HouseholdSummary } from "@family/contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";

import {
  CREATE_HOUSEHOLD_FAILED,
  CreateHouseholdSection,
  announceCreatedHousehold,
  createHousehold,
} from "./create-household";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn(), refreshMemberships: vi.fn() }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({ setHouseholdId: vi.fn() }),
}));

const CREATED: HouseholdSummary = {
  id: "h-new",
  name: "둘째네",
  createdAt: "2026-11-06T00:00:00.000Z",
  myRole: "owner",
  sharedColor: null,
};

beforeEach(() => {
  toastSuccess.mockReset();
});

describe("새 가족 만들기 — 만들기 흐름", () => {
  it("만들고 가족 목록을 새로 받는다(넘어가지는 않는다)", async () => {
    const refresh = vi.fn(async () => undefined);
    const result = await createHousehold(async () => CREATED, refresh);
    expect(result).toEqual({ ok: true, household: CREATED, listed: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("만들지 못하면 서버가 준 한국어 문구를, 모르는 오류면 해요체 기본 문구를 돌려준다", async () => {
    const refresh = vi.fn(async () => undefined);
    const apiFailed = await createHousehold(async () => {
      throw new ApiError(400, "가족 이름을 확인해 주세요.");
    }, refresh);
    expect(apiFailed).toEqual({
      ok: false,
      message: "가족 이름을 확인해 주세요.",
    });

    const networkFailed = await createHousehold(async () => {
      throw new TypeError("Failed to fetch");
    }, refresh);
    expect(networkFailed).toEqual({
      ok: false,
      message: CREATE_HOUSEHOLD_FAILED,
    });
    expect(CREATE_HOUSEHOLD_FAILED).toBe(
      "가족을 만들지 못했어요. 잠시 후 다시 시도해 주세요."
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("가족 목록만 못 받았으면 실패로 돌려주지 않는다 — 다시 누르면 같은 가족이 하나 더 생긴다", async () => {
    const result = await createHousehold(
      async () => CREATED,
      async () => {
        throw new Error("me failed");
      }
    );
    expect(result).toEqual({ ok: true, household: CREATED, listed: false });
  });
});

describe("새 가족 만들기 — 알림", () => {
  it("만든 뒤 자동으로 넘어가지 않고, 토스트의 '그 가족으로 가기'를 눌러야 바꾼다", () => {
    const goTo = vi.fn();
    announceCreatedHousehold(
      { ok: true, household: CREATED, listed: true },
      goTo
    );
    expect(goTo).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    const [message, options] = toastSuccess.mock.calls[0];
    expect(message).toBe("'둘째네' 가족을 만들었어요.");
    expect(options.action.label).toBe("그 가족으로 가기");
    options.action.onClick();
    expect(goTo).toHaveBeenCalledWith("h-new");
  });

  it("가족 목록에 아직 없으면 넘어가는 동작을 달지 않고 앱을 다시 열라고 알린다", () => {
    const goTo = vi.fn();
    announceCreatedHousehold(
      { ok: true, household: CREATED, listed: false },
      goTo
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "'둘째네' 가족을 만들었어요. 앱을 다시 열면 가족 목록에 보여요."
    );
    expect(toastSuccess.mock.calls[0]).toHaveLength(1);
    expect(goTo).not.toHaveBeenCalled();
  });
});

describe("새 가족 만들기 — 줄과 입력 폼", () => {
  it("창을 여는 줄(›, 44px 이상)과 줄 아래 안내 — 소유자에게는 위의 초대하기를 가리킨다", () => {
    const html = renderToStaticMarkup(<CreateHouseholdSection isOwner />);
    const row = html.match(/<button[^>]*>/)?.[0] ?? "";
    expect(row).toContain('aria-haspopup="dialog"');
    expect(row).toContain("min-h-12");
    expect(row).toMatch(/active:/);
    expect(html).toContain("새 가족 만들기");
    expect(html).toContain(
      "기록이 따로 관리되는 새 가족을 만들어요. 지금 가족에 사람을 더하려면 위의 초대하기를 써 주세요."
    );
  });

  it("초대하기 버튼이 없는 역할에게는 소유자에게 초대를 부탁하라고 적는다", () => {
    const html = renderToStaticMarkup(
      <CreateHouseholdSection isOwner={false} />
    );
    expect(html).toContain("소유자에게 초대를 부탁해 주세요.");
    expect(html).not.toContain("위의 초대하기");
  });

  // 입력 폼은 포털 안이라 정적 렌더로 그릴 수 없어 소스로 확인한다(sheet-layout.test.ts와 같은 방식).
  const source = readFileSync(
    join(process.cwd(), "src/app/(app)/household/create-household.tsx"),
    "utf8"
  );

  it("입력 폼(DialogContent 기본 모양)에 이름 칸 + '만들기'(주) + '닫기'(글자 버튼)", () => {
    expect(source).toMatch(/<DialogContent>/);
    expect(source).not.toContain('layout="sheet"');
    expect(source).toContain("<FormLabel>가족 이름</FormLabel>");
    const footer = source.slice(source.indexOf("<DialogFooter"));
    expect(footer).toMatch(/form="create-household-form"[\s\S]*?"만들기"/);
    expect(footer).toMatch(/variant="ghost"[\s\S]*?닫기/);
  });

  it("만들기에서 직접 넘어가지 않는다 — 전환 함수는 알림의 동작으로만 넘긴다", () => {
    expect(source).not.toMatch(/setHouseholdId\(/);
    expect(source).toContain(
      "announceCreatedHousehold(result, setHouseholdId)"
    );
  });

  it("문구는 해요체이고 내부 용어를 쓰지 않는다", () => {
    expect(source).not.toMatch(/습니다|합니다|가구|멤버십/);
  });
});
