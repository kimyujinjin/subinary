/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 결제 카드 화면의 표시·요청 규칙(순수 함수)
 * ------------------------------------------------------------------------- */
import type {
  CardSummary,
  CardUpdateRequest,
  CardVisibility,
  MemberSummary,
} from "@family/contracts";

import type { ChipTone } from "@/components/widgets/status-chip";

/** '****1234' / '1234' 등 저장 포맷 차이를 흡수해 뒤 4자리만 뽑는다. */
export function lastFour(masked: string | null | undefined): string {
  if (!masked) return "";
  return masked.replace(/\D/g, "").slice(-4);
}

/** 소유자 선택지 항목(구성원 이름 + memberId). */
export interface OwnerOption {
  memberId: string;
  name: string;
  /** 고를 수 없는 항목(가족을 떠난 지금 소유자). */
  disabled?: boolean;
}

/**
 * 소유자 선택지 = **현재(활성) 구성원만.** 나간 구성원은 새 소유자로 고를 수 없다(서버도
 * 거절한다). 단, 지금 소유자가 나간 사람이면 그 이름은 선택된 값으로 계속 보여야 하므로
 * 고를 수 없는 항목으로 덧붙인다 — 빠뜨리면 선택칸이 비어 소유자가 없는 카드처럼 보인다.
 */
export function ownerOptionsFor(
  members: readonly MemberSummary[],
  myUserId: string | undefined,
  currentOwnerId?: string
): OwnerOption[] {
  const options: OwnerOption[] = members
    .filter((m) => m.status === "active")
    .map((m) => ({
      memberId: m.memberId,
      name: m.userId === myUserId ? `${m.name} (나)` : m.name,
    }));
  if (currentOwnerId && !options.some((o) => o.memberId === currentOwnerId)) {
    const former = members.find((m) => m.memberId === currentOwnerId);
    // 구성원 목록이 아직 없으면(로딩) 이름을 지어내지 않는다.
    if (former) {
      options.push({
        memberId: currentOwnerId,
        name: `${former.name} (나간 구성원)`,
        disabled: true,
      });
    }
  }
  return options;
}

/** 수정 창의 입력값. 결제일 ""은 '선택 안 함'. */
export interface CardEditDraft {
  alias: string;
  visibility: CardVisibility;
  ownerMemberId: string;
  isShared: boolean;
  billingDay: string;
}

/**
 * 수정 요청 본문. 소유자는 **바뀐 경우에만** 보낸다.
 *
 * 예전에는 늘 지금 소유자를 다시 보냈고, 서버는 새 소유자를 활성 구성원만 받으므로 소유자가
 * 가족을 떠난 카드는 별칭·결제일조차 고칠 수 없었다(400 '카드 소유자는 현재 가족 구성원이어야
 * 해요'). 서버도 같은 소유자는 재지정으로 보지 않지만, 바뀌지 않은 값을 보내지 않는 쪽이
 * 의도를 정확히 말한다.
 */
export function cardUpdateBody(
  card: Pick<CardSummary, "ownerMemberId">,
  draft: CardEditDraft
): CardUpdateRequest {
  const ownerChanged =
    draft.ownerMemberId !== "" && draft.ownerMemberId !== card.ownerMemberId;
  return {
    alias: draft.alias.trim(),
    visibility: draft.visibility,
    ...(ownerChanged ? { ownerMemberId: draft.ownerMemberId } : {}),
    isShared: draft.isShared,
    billingDay: draft.billingDay === "" ? null : Number(draft.billingDay),
  };
}

/** 행 부제 한 줄: `수빈 · 신한 •••• 1234`. */
export function cardRowSubtitle(
  card: Pick<CardSummary, "issuer" | "maskedNumber" | "ownerMemberId">,
  memberNames: ReadonlyMap<string, string>
): string {
  const owner = memberNames.get(card.ownerMemberId) ?? "소유자 확인 필요";
  const tail = lastFour(card.maskedNumber);
  return tail
    ? `${owner} · ${card.issuer} •••• ${tail}`
    : `${owner} · ${card.issuer} · 뒤 4자리 미등록`;
}

export interface CardChip {
  label: string;
  tone: ChipTone;
}

/**
 * 제목 옆 칩. 기본 상태(활성·가족 공개)는 그리지 않는다(§8). 공개 범위는 줄이되 지우지
 * 않는다(§3.5-5) — '나만 보기' 카드가 아무 표시 없이 섞이면 가족 합계에서 빠진 이유를 알 수 없다.
 */
export function cardRowChips(
  card: Pick<CardSummary, "status" | "isShared" | "visibility">
): CardChip[] {
  const chips: CardChip[] = [];
  if (card.status === "inactive")
    chips.push({ label: "비활성", tone: "neutral" });
  if (card.isShared) chips.push({ label: "공용", tone: "neutral" });
  if (card.visibility === "private") {
    chips.push({ label: "나만 보기", tone: "neutral" });
  } else if (card.visibility === "summary_only") {
    chips.push({ label: "요약만 공유", tone: "neutral" });
  }
  return chips;
}

/** 카드별 집계 응답 → cardId별 이번 달 순지출. 미연결 묶음(cardId=null)은 뺀다. */
export function spendByCardId(
  items: ReadonlyArray<{ cardId: string | null; net: number }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) if (item.cardId) map.set(item.cardId, item.net);
  return map;
}

/**
 * 행에 쓸 이번 달 사용액. `null`이면 금액 칸을 비운다.
 *
 * 집계는 보는 사람 기준이다 — 다른 구성원의 '나만 보기' 거래는 빠진다. 집계에 없는 카드를
 * 모두 0원으로 쓰면, 남의 '나만 보기' 카드는 "이번 달 안 썼다"는 거짓이 된다. 그래서 그런
 * 카드는 비우고, 내가 볼 수 있는 카드만 0원으로 쓴다. 집계를 아직 못 받았으면 모두 비운다.
 */
export function cardMonthSpend(
  card: Pick<CardSummary, "id" | "ownerMemberId" | "visibility">,
  spendByCard: ReadonlyMap<string, number> | null,
  myMemberId: string | null
): number | null {
  if (!spendByCard) return null;
  const net = spendByCard.get(card.id);
  if (net !== undefined) return net;
  if (card.visibility === "private" && card.ownerMemberId !== myMemberId) {
    return null;
  }
  return 0;
}

/** `매월 15일 결제`. 결제일이 없으면 null. */
export function billingDayLabel(
  card: Pick<CardSummary, "billingDay">
): string | null {
  return card.billingDay != null ? `매월 ${card.billingDay}일 결제` : null;
}
