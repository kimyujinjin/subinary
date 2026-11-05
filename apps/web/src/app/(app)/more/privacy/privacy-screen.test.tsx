import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_HOUSEHOLD_CONSENT_VERSION,
  type PrivacyOverview,
} from "@family/contracts";

const state = vi.hoisted(() => ({
  overview: undefined as PrivacyOverview | undefined,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/more/privacy",
  useRouter: () => ({ back: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ authedFetch: vi.fn() }),
}));
vi.mock("@/lib/household-context", () => ({
  useHousehold: () => ({ householdId: "00000000-0000-4000-8000-000000000001" }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({
    isLoading: false,
    data: state.overview,
    refetch: vi.fn(),
  }),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import PrivacyPage from "./page";

const thisYear = new Date().getFullYear();
const consent: PrivacyOverview["history"][number] = {
  id: "00000000-0000-4000-8000-000000000010",
  consentType: "household_join",
  version: CURRENT_HOUSEHOLD_CONSENT_VERSION,
  status: "granted",
  consentedAt: `${thisYear}-01-20T03:00:00.000Z`,
  revokedAt: null,
  revokedReason: null,
  documentAvailable: true,
};

const base: PrivacyOverview = {
  householdId: "00000000-0000-4000-8000-000000000001",
  currentVersion: CURRENT_HOUSEHOLD_CONSENT_VERSION,
  activeConsent: consent,
  needsRenewal: false,
  history: [consent],
  retention: {
    policy: "none",
    smsEventCount: 1280,
    storedBytes: 4_096_000,
    oldestReceivedAt: `${thisYear}-03-02T03:00:00.000Z`,
    newestReceivedAt: `${thisYear}-11-01T03:00:00.000Z`,
    objectKeyPrefix: "card-sms/00000000-0000-4000-8000-000000000001/",
  },
  myMemberId: "00000000-0000-4000-8000-000000000002",
  myActiveDeviceCount: 2,
};

beforeEach(() => {
  state.overview = base;
});

describe("개인정보 화면", () => {
  it("동의 중이면 한 줄씩만 보여 주고 저장 경로·용량·버전·개발 용어를 드러내지 않는다", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(html).toContain("문자 보내는 기기 2대");
    expect(html).toContain("카드 문자 1,280건 보관 중 · 3월부터");
    expect(html).toContain(
      "동의를 철회해도 이미 보관된 문자는 지워지지 않아요"
    );
    expect(html).toContain(">자세히</button>");
    for (const jargon of [
      "card-sms/",
      "KB",
      "MB",
      "데이터베이스",
      "파일 저장소",
      "원문",
      CURRENT_HOUSEHOLD_CONSENT_VERSION,
    ]) {
      expect(html).not.toContain(jargon);
    }
    // 동의 문구 전문은 시트로 접혀 있고, 동의 버튼도 없다.
    expect(html).toContain("동의 내용");
    expect(html).not.toContain(">동의하기<");
  });

  it("철회는 화면에 버튼으로 두지 않는다(⋯ 메뉴 안)", () => {
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(html).not.toContain("동의 철회하기");
    expect(html).toContain('aria-label="더보기"');
  });

  it("동의가 없으면 문구 전문을 펼치고 동의 버튼을 보여 준다", () => {
    state.overview = { ...base, activeConsent: null };
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(html).toContain("동의하지 않은 상태예요");
    expect(html).toContain("카드 문자 수집");
    expect(html).toContain(">동의하기</button>");
    expect(html).not.toContain('aria-label="더보기"');
  });

  it("문구가 바뀌었으면 버전 이름 없이 다시 동의를 묻는다", () => {
    state.overview = { ...base, needsRenewal: true };
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(html).toContain(
      "문구가 바뀌어 다시 동의가 필요하지만, 확인 전에도 수집은 계속돼요"
    );
    expect(html).toContain(">새 문구에 동의하기</button>");
    expect(html).not.toMatch(/\(v\d\)/);
  });

  it("보관한 문자가 없으면 그렇게 말한다", () => {
    state.overview = {
      ...base,
      retention: {
        ...base.retention,
        smsEventCount: 0,
        oldestReceivedAt: null,
      },
    };
    expect(renderToStaticMarkup(<PrivacyPage />)).toContain(
      "보관 중인 카드 문자가 없어요"
    );
  });
});
