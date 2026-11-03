import { describe, expect, it } from "vitest";
import {
  assetConnectionCatalogSchema,
  assetConnectionProviderSchema,
} from "@family/contracts";

import {
  CONNECTABLE_PROVIDERS,
  CONNECTABLE_PROVIDER_LABEL,
  UPCOMING_PROVIDERS,
  isConnectableProvider,
  selectedProvider,
} from "./providers";
import { providerStatusLabel } from "./provider-hub";

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
});

describe("선택 카드 상태 한 줄", () => {
  it("연결 준비가 끝나면 둘 다 '연결 가능'이다", () => {
    const ready = assetConnectionCatalogSchema.parse(
      catalog("available", "available")
    );
    expect(providerStatusLabel("shinhan_bank", ready, false)).toBe("연결 가능");
    expect(providerStatusLabel("toss_securities", ready, false)).toBe(
      "연결 가능"
    );
  });

  it("runtime_required의 뜻을 금융사별로 구분한다", () => {
    // 신한은 사용자가 할 수 있는 일(Mac 켜기)이고 토스증권은 운영자 대기다.
    // 같은 문구로 뭉뚱그리면 사용자가 기다려야 하는지 조치해야 하는지 알 수 없다.
    const waiting = assetConnectionCatalogSchema.parse(
      catalog("runtime_required", "runtime_required")
    );
    expect(providerStatusLabel("shinhan_bank", waiting, false)).toBe(
      "연결한 Mac 확인 필요"
    );
    expect(providerStatusLabel("toss_securities", waiting, false)).toBe(
      "운영자 설정 대기"
    );
  });

  it("조회 전과 조회 실패를 '연결 가능'으로 쓰지 않는다", () => {
    const ready = assetConnectionCatalogSchema.parse(
      catalog("available", "available")
    );
    expect(providerStatusLabel("shinhan_bank", null, false)).toBe("확인 중…");
    expect(providerStatusLabel("shinhan_bank", ready, true)).toBe(
      "상태 확인 필요"
    );
  });
});
