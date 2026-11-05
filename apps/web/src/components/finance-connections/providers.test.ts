import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assetConnectionCatalogSchema,
  assetConnectionProviderSchema,
  type MacBankJob,
  type MacBankRunnerState,
} from "@family/contracts";

import {
  CONNECTABLE_PROVIDERS,
  CONNECTABLE_PROVIDER_LABEL,
  UPCOMING_PROVIDERS,
  isConnectableProvider,
  selectedProvider,
} from "./providers";
import { CONNECTIONS_TITLE, shinhanRunnerStatus, tossCatalogStatus } from "./provider-hub";

const catalog = (
  shinhan: "available" | "runtime_required",
  toss: "available" | "runtime_required"
) =>
  ({
    items: [
      {
        provider: "shinhan_bank",
        method: "web_login",
        credentialInputAvailable: shinhan === "available",
        state: shinhan,
      },
      {
        provider: "toss_securities",
        method: "official_api",
        credentialInputAvailable: toss === "available",
        state: toss,
      },
      {
        provider: "toss_bank",
        method: "unverified",
        credentialInputAvailable: false,
        state: "integration_unverified",
      },
      {
        provider: "kb_bank",
        method: "web_login",
        credentialInputAvailable: false,
        state: "account_verification_required",
      },
    ],
  } as const);

describe("금융사 분류", () => {
  it("계약의 모든 금융사가 연결 가능 또는 준비 중 하나로 분류된다", () => {
    // 금융사가 늘었는데 분류를 빠뜨리면 여기서 멈춘다 — 미분류 금융사가 조용히
    // 화면에서 사라지거나(진입 불가) 선택 카드로 섞여 들어가는(과장) 것을 막는다.
    const classified = [
      ...CONNECTABLE_PROVIDERS.map((provider) => provider.id),
      ...UPCOMING_PROVIDERS.map((provider) => provider.id),
    ].sort();
    expect(classified).toEqual(
      [...assetConnectionProviderSchema.options].sort()
    );
  });

  it("두 분류는 겹치지 않는다", () => {
    const upcoming = new Set<string>(
      UPCOMING_PROVIDERS.map((provider) => provider.id)
    );
    for (const provider of CONNECTABLE_PROVIDERS)
      expect(upcoming.has(provider.id)).toBe(false);
  });

  it("준비 중 금융사는 연결 가능으로 판정되지 않는다", () => {
    for (const provider of UPCOMING_PROVIDERS)
      expect(isConnectableProvider(provider.id)).toBe(false);
    for (const provider of CONNECTABLE_PROVIDERS)
      expect(isConnectableProvider(provider.id)).toBe(true);
  });

  it("미지원·없는 금융사를 가리키는 링크는 첫 지원 금융사로 돌아간다", () => {
    expect(selectedProvider("toss_bank")).toBe("shinhan_bank");
    expect(selectedProvider("kb_bank")).toBe("shinhan_bank");
    expect(selectedProvider(null)).toBe("shinhan_bank");
    expect(selectedProvider("nope")).toBe("shinhan_bank");
    expect(selectedProvider("toss_securities")).toBe("toss_securities");
  });
});

describe("진입점 문구", () => {
  it("연결할 수 있는 금융사만 나열한다", () => {
    expect(CONNECTABLE_PROVIDER_LABEL).toBe("신한은행 · 토스증권");
    for (const provider of UPCOMING_PROVIDERS) {
      expect(CONNECTABLE_PROVIDER_LABEL).not.toContain(provider.label);
    }
  });

  it("준비 중 사유는 비어 있지 않다", () => {
    // 이유 없이 "준비 중"만 적으면 사용자는 언제 되는지 묻게 된다.
    for (const provider of UPCOMING_PROVIDERS)
      expect(provider.reason.trim().length).toBeGreaterThan(10);
  });

  it("부제와 준비 중 사유에 서버의 분류 이름·개발 용어를 쓰지 않는다", () => {
    // '공식 API'·'웹 로그인'은 서버 분류 이름이라 사용자가 무엇을 하는지 알 수 없었다(2026-11-05 HIG 검수).
    const copy = [
      ...CONNECTABLE_PROVIDERS.map((provider) => provider.method),
      ...UPCOMING_PROVIDERS.map((provider) => provider.reason),
    ];
    for (const text of copy) expect(text).not.toMatch(/API|웹 로그인|공식|토큰|스크래핑/);
  });

  it("준비 중 사유는 화면에 보이는 caption 문장이라 폰에서 두 줄 안팎으로 짧다", () => {
    for (const provider of UPCOMING_PROVIDERS) expect(provider.reason.length).toBeLessThanOrEqual(40);
  });
});

describe("기관 행 상태 한 줄", () => {
  it("토스증권: 연결 준비가 끝나면 '연결 가능', 아니면 '준비 중'이다", () => {
    const ready = assetConnectionCatalogSchema.parse(catalog("available", "available"));
    const waiting = assetConnectionCatalogSchema.parse(catalog("available", "runtime_required"));
    expect(tossCatalogStatus(ready, false)).toEqual({ tone: "ok", label: "연결 가능" });
    expect(tossCatalogStatus(waiting, false)).toEqual({ tone: "pending", label: "준비 중" });
  });

  it("조회 전과 조회 실패를 '연결 가능'으로 쓰지 않는다", () => {
    const ready = assetConnectionCatalogSchema.parse(catalog("available", "available"));
    expect(tossCatalogStatus(null, false).label).toBe("확인 중…");
    expect(tossCatalogStatus(ready, true).label).toBe("상태 확인 필요");
    expect(shinhanRunnerStatus(null, false).label).toBe("확인 중…");
    expect(shinhanRunnerStatus(mac(), true).label).toBe("상태 확인 필요");
  });

  it("신한: 정상이면 칩 없이 `연결됨 · N분 전` 메타로 쓴다", () => {
    // 기본 상태는 배지로 그리지 않는다(§8) — 상태는 칩 + 메타(§3.5).
    expect(shinhanRunnerStatus(mac(), false)).toEqual({ tone: null, label: "연결됨 · 3분 전" });
    expect(shinhanRunnerStatus(mac({ previousResult: null }), false)).toEqual({ tone: null, label: "연결됨 · 조회 전" });
  });

  it("신한: 문제는 원인에 가까운 것부터 칩으로 쓴다", () => {
    const failed = { ...job, state: "failed" as const, errorCode: "credentials_invalid" as const };
    expect(shinhanRunnerStatus(mac({ runner: null }), false)).toEqual({ tone: "neutral", label: "연결 전" });
    // Mac이 꺼져 있으면 조회 실패보다 그것이 먼저다.
    expect(shinhanRunnerStatus(mac({ runner: { ...runner, online: false }, job: failed }), false).label).toBe("Mac 꺼짐");
    expect(shinhanRunnerStatus(mac({ job: { ...job, state: "authentication_required" } }), false).label).toBe("인증 필요");
    expect(shinhanRunnerStatus(mac({ job: { ...job, state: "running" } }), false)).toEqual({ tone: "pending", label: "조회 중" });
    expect(shinhanRunnerStatus(mac({ job: failed }), false)).toEqual({ tone: "attention", label: "확인 필요" });
    expect(shinhanRunnerStatus(mac({ credentials: null }), false).label).toBe("로그인 정보 필요");
  });

  it("화면 제목은 전체 메뉴의 항목 이름과 같다", () => {
    // 메뉴에서 '은행·증권 연결'을 눌렀는데 '자동 연결'이 뜨면 다른 화면으로 읽힌다.
    const more = readFileSync(join(process.cwd(), "src/app/(app)/more/page.tsx"), "utf8");
    const menuTitle = /href:\s*"\/more\/connections"[^}]*?title:\s*"([^"]+)"/.exec(more)?.[1];
    expect(menuTitle).toBe(CONNECTIONS_TITLE);
  });
});

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const runner: NonNullable<MacBankRunnerState["runner"]> = {
  id: "00000000-0000-4000-8000-000000000004", label: "이 Mac", online: true, lastSeenAt: ago(0), expiresAt: null,
};
const job: MacBankJob = {
  id: "00000000-0000-4000-8000-000000000001", householdId: "00000000-0000-4000-8000-000000000002",
  ownerUserId: "00000000-0000-4000-8000-000000000003", runnerId: runner.id,
  state: "queued", claimId: null, credentialVersion: null, consentVersion: 3, continueVersion: 0, errorCode: null, logoutConfirmed: false, observations: [],
  createdAt: ago(0), updatedAt: ago(0), expiresAt: ago(-600_000), claimedAt: null, completedAt: null,
};
/** 정상 상태: 온라인 Mac, 저장한 로그인 정보, 3분 전 성공한 조회. */
function mac(patch: Partial<MacBankRunnerState> = {}): MacBankRunnerState {
  return {
    runner,
    job: null,
    previousResult: {
      jobId: "00000000-0000-4000-8000-000000000005",
      completedAt: ago(3 * 60_000 + 5_000),
      observations: [{ formatVersion: 1, provider: "shinhan", source: "browser_assisted", origin: "https://bank.shinhan.com", pageKind: "deposit_account_list", capturedAt: ago(0), accountFingerprint: "a".repeat(64), accountLast4: "1234", currency: "KRW", balanceKind: "ledger", balanceKrw: "0", bankAsOfDate: null }],
    },
    credentials: { stored: true, runnerId: runner.id, version: 1, updatedAt: ago(0) },
    credentialStorageAvailable: true,
    ...patch,
  };
}
