"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 결제 카드와 사용 내역 진입
 *
 * 이 화면이 없던 동안 api.cards.create/update 는 호출자 0건의 데드 코드였고,
 * payment_cards 행이 생기지 않아 SMS→거래 자동연결(worker resolveCard)이 항상
 * 실패해 모든 거래가 cardId=null 로 남았다. 이 페이지가 그 끊긴 UI 한 겹을 잇는다.
 *
 * - 카드 = ListRow(카드 아이콘 · alias + 상태 칩 · '소유자 · 카드사 •••• 1234' 한 줄 ·
 *   이번 달 사용액 · 매월 N일 결제). 행 전체가 그 카드의 사용 내역 링크다.
 *   소유자 본인 또는 owner/admin 만 행 끝 ⋯(수정 / 뒤 4자리 정정 / 비활성·재활성)을
 *   본다(서버 §5.1과 일치). 비활성화는 확인을 거친다.
 * - maskedNumber '뒤 4자리'는 자동연결의 유일한 조인 키 → 강하게 유도(숫자 4자리 제한,
 *   미입력/중복 시 경고). 전체 PAN 붙여넣기는 maxLength=4+숫자필터로 UI 레벨 차단.
 * - visibility 는 이후 자동연결 거래에 '그 시점 값'으로 상속된다(소급 없음).
 * - 소유자 선택지는 현재 구성원만이고, 수정은 소유자가 **바뀐 경우에만** ownerMemberId를
 *   보낸다 — 소유자가 가족을 떠난 카드도 별칭·결제일을 고칠 수 있어야 한다(./card-rows.ts).
 * ------------------------------------------------------------------------- */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import type {
  CardCreateRequest,
  CardSummary,
  CardUpdateRequest,
  CardVisibility,
  MemberColor,
} from "@family/contracts";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  ListLoading,
  ListRow,
  Money,
  OverflowMenu,
  PageBackHeader,
  SectionHeader,
  StatusChip,
  type OverflowAction,
} from "@/components/widgets";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import { cardOwnerLabel } from "@/lib/card-identity-label";
import { currentMonth, formatWon } from "@/lib/format";
import {
  invalidateTransactionScope,
  queryKeys,
  useCardList,
  useCards,
  useHouseholdMembers,
} from "@/lib/queries";
import { memberColorClass } from "@/lib/member-color";
import { cn } from "@/lib/utils";
import { canCorrectCardLast4 } from "@/lib/card-last4-correction";
import { CardLast4CorrectionDialog } from "@/components/card-last4-correction-dialog";
import { useCardLast4Correction } from "@/lib/queries";

import {
  billingDayLabel,
  cardMonthSpend,
  cardRowChips,
  cardRowSubtitle,
  cardUpdateBody,
  lastFour,
  ownerOptionsFor,
  spendByCardId,
  type OwnerOption,
} from "./card-rows";

/** 표준 카드사 목록 — 분석 라벨('alias · issuer') 표기 일관성을 위해 자유입력 대신 고정. */
const ISSUER_OPTIONS = [
  "신한",
  "삼성",
  "현대",
  "KB국민",
  "롯데",
  "하나",
  "우리",
  "BC",
  "NH농협",
  "카카오뱅크",
  "토스뱅크",
  "기타",
] as const;

/** visibility 선택지 + 설명(이후 자동연결 거래에 상속되는 프라이버시 값). */
const VISIBILITY_OPTIONS: ReadonlyArray<{
  value: CardVisibility;
  label: string;
  description: string;
}> = [
  {
    value: "household",
    label: "가족 공개",
    description: "가맹점과 금액을 가족과 모두 공유해요.",
  },
  {
    value: "summary_only",
    label: "요약만 공유",
    description: "금액만 공유하고 가맹점은 가족에게 비공개예요.",
  },
  {
    value: "private",
    label: "나만 보기",
    description: "가족에게 보이지 않고 가족 합계에서도 빠져요.",
  },
];

/** 결제일 선택지(매월 1~31일). 그 달에 없는 날은 말일로 본다. */
const BILLING_DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

/** owner/admin 은 소유하지 않은 카드도 관리할 수 있다(서버 §5.1과 일치). */
const MANAGER_ROLES = ["owner", "admin"] as const;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * 소유자 선택 + 실시간 색 미리보기. 좌측 큰 아이콘은 선택된 소유자의 색을 즉시
 * 반영해(카드 목록의 아이콘과 동일 규칙) "소유자를 바꾸면 색이 바뀐다"를 폼에서
 * 바로 보여준다. 각 선택지에도 해당 구성원 색 스와치를 붙인다.
 */
function OwnerSelect({
  id,
  members,
  value,
  onChange,
  colorClassOf,
}: {
  id: string;
  members: OwnerOption[];
  value: string;
  onChange: (memberId: string) => void;
  colorClassOf: (memberId: string) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full transition-colors",
          value ? colorClassOf(value) : "bg-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        <CreditCard className="size-5" />
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="min-h-12 w-full">
          <SelectValue placeholder="소유자를 선택하세요" />
        </SelectTrigger>
        <SelectContent>
          {members.map((m) => (
            <SelectItem
              key={m.memberId}
              value={m.memberId}
              disabled={m.disabled}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full",
                    colorClassOf(m.memberId),
                  )}
                  aria-hidden="true"
                >
                  <CreditCard className="size-3" />
                </span>
                {m.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function CardsPage() {
  const { authedFetch, user } = useAuth();
  const { householdId, activeMembership } = useHousehold();
  const queryClient = useQueryClient();
  const correction = useCardLast4Correction();

  const cardsQuery = useCardList();
  const membersQuery = useHouseholdMembers();
  const cards = cardsQuery.data ?? [];

  // 행마다 보이는 이번 달 사용액 — 분석 화면의 카드별 집계와 같은 숫자다.
  const spendQuery = useCards(currentMonth(), { enabled: cards.length > 0 });
  const spendByCard = useMemo(
    () => (spendQuery.data ? spendByCardId(spendQuery.data.items) : null),
    [spendQuery.data],
  );

  // 정확 권한 게이팅: 내 memberId 역산(activeMembership 엔 role 만 있고 memberId 는 없음).
  const myMemberId = useMemo(
    () =>
      membersQuery.data?.find((m) => m.userId === user?.id)?.memberId ?? null,
    [membersQuery.data, user?.id],
  );

  // 구성원이 직접 고른 색(memberId → 팔레트 키). 없으면 해시 색 폴백.
  const memberColorById = useMemo(() => {
    const map = new Map<string, MemberColor | null>();
    for (const m of membersQuery.data ?? []) map.set(m.memberId, m.color);
    return map;
  }, [membersQuery.data]);
  // 이름표는 나간 구성원까지 — 그 사람이 소유한 카드의 이름은 계속 보여야 한다.
  const memberNames = useMemo(
    () =>
      new Map(
        (membersQuery.data ?? []).map((member) => [
          member.memberId,
          member.name,
        ]),
      ),
    [membersQuery.data],
  );

  // 소유자 선택지(현재 구성원만) + 소유자 memberId → 아이콘 색 클래스(목록과 동일 규칙).
  const ownerOptions = useMemo(
    () => ownerOptionsFor(membersQuery.data ?? [], user?.id),
    [membersQuery.data, user?.id],
  );
  const ownerColorClass = (memberId: string) =>
    memberColorClass(memberId, memberColorById.get(memberId) ?? null);
  const isManagerRole = MANAGER_ROLES.includes(
    activeMembership?.role as (typeof MANAGER_ROLES)[number],
  );
  const canManage = (card: CardSummary) =>
    isManagerRole || (myMemberId != null && card.ownerMemberId === myMemberId);
  const canCorrect = (card: CardSummary) =>
    canCorrectCardLast4(card, myMemberId, activeMembership?.role);

  // 등록 폼 상태(단순 폼 → useState + FormEvent 수동검증, devices 패턴).
  const [registerOpen, setRegisterOpen] = useState(false);
  const [issuer, setIssuer] = useState("");
  const [alias, setAlias] = useState("");
  const [masked, setMasked] = useState("");
  const [visibility, setVisibility] = useState<CardVisibility>("household");
  // 소유자(빈 값이면 본인 myMemberId로 폴백). 아이콘 색이 이 선택을 따른다.
  const [ownerMemberId, setOwnerMemberId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const createOwnerId = ownerMemberId || myMemberId || "";

  // 일반 수정과 뒤 4자리 정정은 별도 요청/상태를 사용한다.
  const [correcting, setCorrecting] = useState<CardSummary | null>(null);
  useEffect(() => { setCorrecting(null); }, [householdId]);
  const [editing, setEditing] = useState<CardSummary | null>(null);
  const [editAlias, setEditAlias] = useState("");
  const [editVisibility, setEditVisibility] =
    useState<CardVisibility>("household");
  const [editOwnerMemberId, setEditOwnerMemberId] = useState("");
  /**
   * 공용(공동사용) 표시. 켜면 구성원별 지출에서 이 카드의 결제가 사람이 아니라 '공용'으로
   * 묶인다 — 카드 문자에 누가 그었는지가 없어서, 소유자 한 명에게 전부 몰아주는 것보다
   * 귀속을 보류하는 편이 사실에 가깝다. 금액을 지분으로 쪼개지는 않는다.
   */
  const [editIsShared, setEditIsShared] = useState(false);
  /** 매월 결제일(""=선택 안 함). 홈 '다가오는 지출'이 결제일과 지난달 사용액을 보여준다. */
  const [editBillingDay, setEditBillingDay] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  // 수정 창의 소유자 선택지 — 지금 소유자가 나간 사람이면 고를 수 없는 항목으로 이름만 남긴다.
  const editOwnerOptions = useMemo(
    () =>
      ownerOptionsFor(membersQuery.data ?? [], user?.id, editing?.ownerMemberId),
    [membersQuery.data, user?.id, editing?.ownerMemberId],
  );
  // 수정 중인 카드의 최신 값 — 수정 창에서 연 뒤 4자리 정정이 끝나면 목록이 새로 온다.
  const editingCard = editing
    ? (cards.find((c) => c.id === editing.id) ?? editing)
    : null;

  // 비활성화 확인. 대상은 닫히는 동안에도 남겨 둔다(닫히는 애니메이션 중 제목이 비지 않게).
  const [deactivating, setDeactivating] = useState<CardSummary | null>(null);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  // 뒤 4자리 중복 감지(non-blocking 경고) — 활성 카드 대상, 자동연결이 섞일 수 있음.
  const maskedTail = lastFour(masked);
  const duplicateTail =
    maskedTail.length === 4 &&
    cards.some(
      (c) => c.status === "active" && lastFour(c.maskedNumber) === maskedTail,
    );

  const invalidateCards = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.cards(householdId),
    });
    // 카드별 집계(CardBreakdown)의 alias·issuer 라벨/합계 갱신.
    void queryClient.invalidateQueries({ queryKey: ["analytics"] });
    // card 스코프 예산의 scopeLabel이 카드 별칭을 임베드 → 별칭 변경 시 함께 갱신.
    void queryClient.invalidateQueries({ queryKey: ["budgets"] });
  };

  const createMutation = useMutation({
    mutationFn: (body: CardCreateRequest) =>
      authedFetch((token) => api.cards.create(token, body)),
    onSuccess: (result) => {
      invalidateCards();
      // 소급 연결(backfill)이 과거 거래를 건드렸으면 거래 스코프 전체를 갱신하고 알린다.
      if (result.linkedTransactionCount > 0) {
        invalidateTransactionScope(queryClient);
        toast.success(
          `'${result.alias}' 카드를 등록하고 과거 거래 ${result.linkedTransactionCount}건을 연결했어요.`,
        );
      } else {
        toast.success(`'${result.alias}' 카드를 등록했어요.`);
      }
      setIssuer("");
      setAlias("");
      setMasked("");
      setVisibility("household");
      setOwnerMemberId("");
      setFormError(null);
      setRegisterOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; body: CardUpdateRequest }) =>
      authedFetch((token) => api.cards.update(token, input.id, input.body)),
    onSuccess: (updated) => {
      invalidateCards();
      setEditing(null);
      toast.success(`'${updated.alias}' 카드를 저장했어요.`);
    },
  });

  // 비활성·재활성은 수정 창과 따로 둔다 — 실패는 그 자리에서 토스트로 알린다.
  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: CardSummary["status"] }) =>
      authedFetch((token) =>
        api.cards.update(token, input.id, { status: input.status }),
      ),
    onSuccess: (updated) => {
      invalidateCards();
      toast.success(
        updated.status === "inactive"
          ? `'${updated.alias}' 카드를 비활성화했어요.`
          : `'${updated.alias}' 카드를 다시 활성화했어요.`,
      );
    },
    onError: (error) =>
      toast.error(errorMessage(error, "카드 상태를 바꾸지 못했어요.")),
  });

  function onRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!householdId) return;
    if (issuer === "") {
      setFormError("카드사를 선택해 주세요.");
      return;
    }
    if (alias.trim() === "") {
      setFormError("카드 별칭을 입력해 주세요.");
      return;
    }
    createMutation.mutate({
      householdId,
      issuer,
      alias: alias.trim(),
      // 뒤 4자리는 선택이지만 자동연결의 유일한 키 → 4자리일 때만 전송, 아니면 생략.
      maskedNumber: maskedTail.length === 4 ? maskedTail : undefined,
      visibility,
      // 소유자 미선택이면 서버가 본인으로 설정(undefined 전송).
      ownerMemberId: createOwnerId || undefined,
    });
  }

  function openEdit(card: CardSummary) {
    updateMutation.reset();
    setEditing(card);
    setEditAlias(card.alias);
    setEditVisibility(card.visibility);
    setEditOwnerMemberId(card.ownerMemberId);
    setEditIsShared(card.isShared);
    setEditBillingDay(card.billingDay != null ? String(card.billingDay) : "");
    setEditError(null);
  }

  function onEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEditError(null);
    if (!editing) return;
    if (editAlias.trim() === "") {
      setEditError("카드 별칭을 입력해 주세요.");
      return;
    }
    // '나만 보기 + 공용'은 서버가 400으로 거절한다. 왕복 전에 여기서 먼저 막아 준다 —
    // "같이 쓰는데 나만 본다"는 모순이고, 그 조합에서는 집계가 사람마다 달라진다.
    if (editIsShared && editVisibility === "private") {
      setEditError("나만 보기 카드는 공용으로 표시할 수 없어요.");
      return;
    }
    updateMutation.mutate({
      id: editing.id,
      // 소유자는 바뀐 경우에만 보낸다 — 나간 구성원이 소유한 카드도 고칠 수 있게(card-rows.ts).
      body: cardUpdateBody(editing, {
        alias: editAlias,
        visibility: editVisibility,
        ownerMemberId: editOwnerMemberId,
        isShared: editIsShared,
        billingDay: editBillingDay,
      }),
    });
  }

  const correctionBusy = (card: CardSummary) =>
    updateMutation.isPending ||
    correction.isPending ||
    correction.cardPending(card.id, card.householdId) ||
    cardsQuery.isFetching;

  /** 행 끝 ⋯ 메뉴. 비활성화는 이 메뉴 안에만 두고 확인을 거친다(§3.3). */
  function cardActions(card: CardSummary): OverflowAction[] {
    const actions: OverflowAction[] = [
      {
        label: "수정",
        disabled: updateMutation.isPending,
        onSelect: () => openEdit(card),
      },
    ];
    if (canCorrect(card)) {
      actions.push({
        label: "뒤 4자리 정정",
        disabled: correctionBusy(card),
        onSelect: () => setCorrecting(card),
      });
    }
    actions.push(
      card.status === "active"
        ? {
            label: "비활성화",
            destructive: true,
            disabled: statusMutation.isPending,
            onSelect: () => {
              setDeactivating(card);
              setDeactivateOpen(true);
            },
          }
        : {
            label: "다시 활성화",
            disabled: statusMutation.isPending,
            onSelect: () =>
              statusMutation.mutate({ id: card.id, status: "active" }),
          },
    );
    return actions;
  }

  const isEmpty =
    !cardsQuery.isLoading && !cardsQuery.isError && cards.length === 0;
  const selectedVisibility = VISIBILITY_OPTIONS.find(
    (o) => o.value === visibility,
  );
  // 메뉴가 있는 행과 없는 행의 금액 칼럼이 세로로 맞도록, 하나라도 있으면 빈 자리를 둔다.
  const hasCardMenu = cards.some(canManage);
  const editTail = editingCard ? lastFour(editingCard.maskedNumber) : "";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageBackHeader title="결제 카드" />

      {/* 카드 목록 — 행 전체가 그 카드의 사용 내역으로 가는 링크다. */}
      <section
        className="finance-panel min-w-0 px-5 pt-2 pb-5"
        aria-label="등록된 카드"
      >
        <SectionHeader
          title="등록된 카드"
          trailing={
            cards.length > 0 ? (
              // 금액 칼럼 위에 맞춘다(⋯ 메뉴 44 + 간격 4 + 행 안쪽 여백).
              <span
                className={cn(
                  "text-caption text-muted-foreground",
                  hasCardMenu ? "mr-13 sm:mr-14" : "mr-1 sm:mr-2",
                )}
              >
                이번 달 사용
              </span>
            ) : undefined
          }
        />
        {cardsQuery.isLoading ? (
          <ListLoading rows={2} label="카드를 불러오는 중이에요." />
        ) : cardsQuery.isError ? (
          <p className="text-destructive text-caption py-2" role="alert">
            {errorMessage(cardsQuery.error, "카드를 불러오지 못했어요.")}
          </p>
        ) : cards.length === 0 ? (
          <EmptyState
            icon={<CreditCard />}
            title="아직 등록된 카드가 없어요"
            description="카드를 등록하면 문자 내역이 자동으로 연결돼요"
            action={
              <Button
                type="button"
                className="w-full"
                onClick={() => setRegisterOpen(true)}
              >
                <Plus /> 카드 등록하기
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col">
            {cards.map((c) => {
              const subtitle = cardRowSubtitle(c, memberNames);
              const chips = cardRowChips(c);
              const spend = cardMonthSpend(c, spendByCard, myMemberId);
              const billing = billingDayLabel(c);
              return (
                <div key={c.id} className="flex items-center gap-1">
                  <ListRow
                    className="min-w-0 flex-1"
                    href={`/transactions?cardId=${encodeURIComponent(c.id)}`}
                    ariaLabel={[
                      `${c.alias} 사용 내역`,
                      ...chips.map((chip) => chip.label),
                      subtitle,
                      spend != null ? `이번 달 ${formatWon(spend)}` : null,
                      billing,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    icon={<CreditCard />}
                    iconClassName={memberColorClass(
                      c.ownerMemberId,
                      memberColorById.get(c.ownerMemberId),
                    )}
                    title={
                      chips.length > 0 ? (
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{c.alias}</span>
                          {chips.map((chip) => (
                            <StatusChip key={chip.label} tone={chip.tone}>
                              {chip.label}
                            </StatusChip>
                          ))}
                        </span>
                      ) : (
                        c.alias
                      )
                    }
                    subtitle={subtitle}
                    value={
                      spend != null ? (
                        <Money amount={spend} muted={spend === 0} />
                      ) : undefined
                    }
                    valueSub={billing ?? undefined}
                  />
                  {canManage(c) ? (
                    <OverflowMenu
                      label={`${c.alias} ${subtitle} 관리 메뉴`}
                      actions={cardActions(c)}
                      className="shrink-0"
                    />
                  ) : hasCardMenu ? (
                    <span aria-hidden="true" className="size-11 shrink-0" />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {/* 주 CTA — 빈 상태에서는 빈 상태 안의 CTA 하나만 노출 */}
        {!isEmpty ? (
          <Button
            type="button"
            size="lg"
            className="mt-3 w-full"
            onClick={() => setRegisterOpen(true)}
          >
            <Plus /> 카드 등록
          </Button>
        ) : null}
      </section>

      {/* 뒤 4자리 정정 — 행 메뉴 또는 수정 창의 '정정'에서 연다(수정 창 위에 겹쳐 열린다). */}
      {correcting && correcting.householdId === householdId && canCorrectCardLast4(correcting, myMemberId, activeMembership?.role) ? (
        <CardLast4CorrectionDialog
          key={`${householdId}:${correcting.id}`}
          card={correcting}
          ownerLabelOf={(card) => cardOwnerLabel(card, memberNames)}
          canManage={(card) => canCorrectCardLast4(card, myMemberId, activeMembership?.role)}
          readRequired={correction.requiresRead(correcting.id, correcting.householdId)}
          attemptPending={correction.cardPending(correcting.id, correcting.householdId)}
          onCorrect={(body) => correction.mutateAsync({ id: correcting.id, householdId: correcting.householdId, body })}
          onRefresh={(signal) => correction.refresh(correcting.id, correcting.householdId, signal)}
          onClose={() => setCorrecting(null)}
        />
      ) : null}

      {/* 등록 Dialog */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>카드 등록</DialogTitle>
            <DialogDescription>
              등록 후 도착하는 카드 문자부터 이 카드에 자동으로 연결돼요.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onRegister} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="card-issuer">카드사</Label>
              <Select value={issuer} onValueChange={setIssuer}>
                <SelectTrigger id="card-issuer" className="min-h-12 w-full">
                  <SelectValue placeholder="카드사를 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {ISSUER_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="card-alias">별칭</Label>
              <Input
                id="card-alias"
                type="text"
                placeholder="예: 생활비카드"
                maxLength={100}
                required
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="card-owner">소유자</Label>
              <OwnerSelect
                id="card-owner"
                members={ownerOptions}
                value={createOwnerId}
                onChange={setOwnerMemberId}
                colorClassOf={ownerColorClass}
              />
              <p className="text-muted-foreground text-caption">
                같은 카드 상품을 각자 쓰면 소유자와 뒤 4자리를 각각 등록해 주세요.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="card-masked">카드번호 뒤 4자리</Label>
              <Input
                id="card-masked"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="1234"
                maxLength={4}
                value={masked}
                onChange={(e) =>
                  setMasked(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
              />
              {maskedTail.length > 0 && maskedTail.length < 4 ? (
                <p className="text-muted-foreground text-caption">
                  숫자 4자리를 모두 입력해 주세요.
                </p>
              ) : maskedTail.length === 0 ? (
                <p className="text-muted-foreground text-caption">
                  적지 않으면 다른 카드와 구분하지 못할 수 있어요.
                </p>
              ) : duplicateTail ? (
                <p className="text-warning-strong text-caption">
                  뒤 4자리가 같은 카드가 있으니 소유자를 꼭 확인해 주세요.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="card-visibility">공개 범위</Label>
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as CardVisibility)}
              >
                <SelectTrigger id="card-visibility" className="min-h-12 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedVisibility ? (
                <p className="text-muted-foreground text-caption">
                  {selectedVisibility.description}
                </p>
              ) : null}
            </div>

            {formError ? (
              <p className="text-destructive text-caption" role="alert">
                {formError}
              </p>
            ) : null}
            {createMutation.isError ? (
              <p className="text-destructive text-caption" role="alert">
                {errorMessage(createMutation.error, "카드를 등록하지 못했어요.")}
              </p>
            ) : null}
            <DialogFooter className="flex-col sm:flex-col">
              <Button
                type="submit"
                className="h-11 w-full"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "등록 중…" : "등록하기"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full"
                onClick={() => setRegisterOpen(false)}
              >
                닫기
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 수정 Dialog */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>카드 수정</DialogTitle>
            {/* 뒤 4자리는 일반 수정이 아니라 전용 정정 흐름으로만 바꾼다(낙관적 확인 필요). */}
            <DialogDescription>
              {editingCard ? (
                <>
                  {editingCard.issuer}{" "}
                  {editTail ? `•••• ${editTail}` : "뒤 4자리 미등록"}
                  {canCorrect(editingCard) ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="text-primary -my-2 inline-block py-2 font-semibold disabled:opacity-40"
                        disabled={correctionBusy(editingCard)}
                        onClick={() => setCorrecting(editingCard)}
                      >
                        정정
                      </button>
                    </>
                  ) : null}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onEditSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-alias">별칭</Label>
              <Input
                id="edit-alias"
                type="text"
                maxLength={100}
                required
                value={editAlias}
                onChange={(e) => setEditAlias(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-owner">소유자</Label>
              <OwnerSelect
                id="edit-owner"
                members={editOwnerOptions}
                value={editOwnerMemberId}
                onChange={setEditOwnerMemberId}
                colorClassOf={ownerColorClass}
              />
              <p className="text-muted-foreground text-caption">
                소유자를 바꿔도 거래에 기록된 구성원은 그대로예요.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-visibility">공개 범위</Label>
              <Select
                value={editVisibility}
                onValueChange={(v) => setEditVisibility(v as CardVisibility)}
              >
                <SelectTrigger id="edit-visibility" className="min-h-12 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-caption">
                공개 범위 변경은 앞으로 들어올 거래에만 적용돼요.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="edit-is-shared">함께 쓰는 카드</Label>
                <Switch
                  id="edit-is-shared"
                  checked={editIsShared}
                  onCheckedChange={setEditIsShared}
                  disabled={editVisibility === "private"}
                />
              </div>
              {/*
                공개 범위와 달리 이 설정은 **과거까지 함께** 바뀐다. 거래를 고치지 않고
                집계가 카드 플래그를 읽기 때문이다 — 그래서 켜고 끄는 것으로 되돌린다.
                사용자가 "앞으로만 적용되겠지"라고 오해하지 않게 그 차이를 적는다.
              */}
              <p className="text-muted-foreground text-caption">
                {editVisibility === "private"
                  ? "나만 보기 카드는 함께 쓰는 카드로 표시할 수 없어요."
                  : "구성원별 지출에서 이 카드 결제를 지난 기록까지 '공용'으로 묶어요."}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-billing-day">결제일</Label>
              <Select
                value={editBillingDay === "" ? "none" : editBillingDay}
                onValueChange={(v) => setEditBillingDay(v === "none" ? "" : v)}
              >
                <SelectTrigger id="edit-billing-day" className="min-h-12 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">선택 안 함</SelectItem>
                  {BILLING_DAYS.map((day) => (
                    <SelectItem key={day} value={String(day)}>
                      매월 {day}일
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-caption">
                홈 &lsquo;다가오는 지출&rsquo;에 결제일과 지난달 사용액(실제 청구액과 다를 수 있음)을 보여줘요.
              </p>
            </div>
            {editError ? (
              <p className="text-destructive text-caption" role="alert">
                {editError}
              </p>
            ) : null}
            {updateMutation.isError ? (
              <p className="text-destructive text-caption" role="alert">
                {errorMessage(updateMutation.error, "카드를 수정하지 못했어요.")}
              </p>
            ) : null}
            <DialogFooter className="flex-col sm:flex-col">
              <Button
                type="submit"
                className="h-11 w-full"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "저장 중…" : "저장하기"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 w-full"
                onClick={() => setEditing(null)}
              >
                닫기
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 비활성화 확인 — 메뉴(⋯)에서만 열린다. 다시 활성화는 위험하지 않아 바로 한다. */}
      <AlertDialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deactivating
                ? `'${deactivating.alias}' 카드를 비활성화할까요?`
                : "카드를 비활성화할까요?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              새로 오는 문자는 이 카드에 연결하지 않고, 기존 거래는 그대로 남아요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deactivating) {
                  statusMutation.mutate({
                    id: deactivating.id,
                    status: "inactive",
                  });
                }
              }}
              variant="destructive"
            >
              비활성화
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
