/**
 * 금융사 표시 정보의 단일 출처.
 *
 * 연결 화면과 진입점 3곳(자산 추가 시트·자산 관리 링크·설정 목록)이 같은 문구를 각자
 * 들고 있었다. 그 결과 실제로는 둘만 연결되는데 네 곳이 가능한 것처럼 읽혔다 —
 * `docs/family-finance-renewal-2026-11.md`가 금지한 "미지원 기관의 연결 버튼"이다.
 *
 * **선택지는 서버가 `available`을 줄 수 있는 금융사만이다.**
 * `apps/api/src/bank-connections/bank-connections.service.ts`의 `catalog()`는
 * `toss_bank`를 항상 `integration_unverified`, `kb_bank`를 항상
 * `account_verification_required`로 내려보내며 둘 다 `credentialInputAvailable: false`다.
 * 즉 이 둘은 어떤 운영 설정으로도 연결될 수 없다 — 선택 카드가 아니라 안내 문장이다.
 *
 * 금융사가 늘거나 지원 상태가 바뀌면 **이 파일만 고친다**. 분류를 빠뜨리면
 * `providers.test.ts`가 계약 enum과 대조해 실패한다.
 */
import type { AssetConnectionProvider } from "@family/contracts";

export interface ConnectableProvider {
  id: Extract<AssetConnectionProvider, "shinhan_bank" | "toss_securities">;
  label: string;
  /** 선택 카드의 부제. 조회 수단과 가져오는 항목을 한 줄로. */
  method: string;
}

/** 서버 카탈로그가 `available`을 줄 수 있는 금융사. 순서가 곧 화면 순서다. */
export const CONNECTABLE_PROVIDERS: ReadonlyArray<ConnectableProvider> = [
  {
    id: "shinhan_bank",
    label: "신한은행",
    method: "웹 로그인 · 통장 잔액·대출",
  },
  {
    id: "toss_securities",
    label: "토스증권",
    method: "공식 API · 국내·미국 주식",
  },
];

interface UpcomingProvider {
  id: Exclude<AssetConnectionProvider, ConnectableProvider["id"]>;
  label: string;
  /** 왜 아직 연결할 수 없는지. 추측이 아니라 확인한 사실만 쓴다. */
  reason: string;
}

/** 연결할 수 없는 금융사. 선택 카드로 그리지 않고 안내 문장으로만 둔다. */
export const UPCOMING_PROVIDERS: ReadonlyArray<UpcomingProvider> = [
  {
    id: "kb_bank",
    label: "국민은행",
    reason:
      "공식 웹의 아이디 로그인과 보안 입력 방식까지 확인했어요. 실제 계좌 조회와 읽어올 항목을 검증한 뒤 열 수 있어요.",
  },
  {
    id: "toss_bank",
    label: "토스뱅크",
    reason:
      "개인계좌는 토스 앱 중심으로 제공돼요. 무료로 쓸 수 있는 외부 조회 방식이 아직 확인되지 않았어요.",
  },
];

/**
 * 진입점 설명 문구의 단일 출처.
 *
 * 화면마다 금융사 이름을 다시 나열하지 않는다 — 지원 범위가 바뀔 때 한 곳만
 * 고쳐도 모든 진입점이 같이 따라와야 한다.
 */
export const CONNECTABLE_PROVIDER_LABEL = CONNECTABLE_PROVIDERS.map(
  (provider) => provider.label
).join(" · ");

export function isConnectableProvider(
  value: string | null
): value is ConnectableProvider["id"] {
  return CONNECTABLE_PROVIDERS.some((provider) => provider.id === value);
}

/** 딥링크나 옛 링크가 미지원 금융사를 가리키면 첫 번째 지원 금융사로 돌린다. */
export function selectedProvider(
  value: string | null
): ConnectableProvider["id"] {
  return isConnectableProvider(value) ? value : CONNECTABLE_PROVIDERS[0].id;
}
