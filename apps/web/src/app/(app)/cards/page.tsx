"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 결제 카드와 사용 내역 진입
 *
 * 이 화면이 없던 동안 api.cards.create/update 는 호출자 0건의 데드 코드였고,
 * payment_cards 행이 생기지 않아 SMS→거래 자동연결(worker resolveCard)이 항상
 * 실패해 모든 거래가 cardId=null 로 남았다. 이 페이지가 그 끊긴 UI 한 겹을 잇는다.
 *
 * - 카드 = ListRow(카드 아이콘 · alias + 상태 칩 · '소유자 · 카드사 •••• 1234' 한 줄 ·
 *   이번 달 사용액 · 매월 N일 결제 · ›). 행 전체가 그 카드의 사용 내역 링크라 폰에서도 ›를 단다.
 *   소유자 본인 또는 owner/admin 만 행 끝 ⋯(수정 / 뒤 4자리 정정 / 비활성·재활성)을
 *   본다(서버 §5.1과 일치). 비활성화는 확인을 거친다. 뒤 4자리 정정은 이 ⋯ 메뉴에서만 연다 —
 *   수정 창 안의 '정정' 링크는 입력 폼 위에 입력 폼, 그 위에 버리기 확인까지 세 겹을 쌓아서 없앴다.
 * - 등록·수정 창의 고르는 값은 설정 앱 스타일 한 목록이다(./card-fields.tsx).
 * - 결과가 목록에 그대로 보이는 저장·비활성화는 토스트를 띄우지 않는다. 등록 때 지난 거래를
 *   연결한 건수처럼 화면에 안 보이는 결과만 알린다.
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
import {
  EmptyState,
  ErrorState,
  InlineNotice,
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

import { CardEditFields, CardRegisterFields } from "./card-fields";
import {
  billingDayLabel,
  cardMonthSpend,
  cardRowChips,
  cardRowSubtitle,
  cardUpdateBody,
  lastFour,
  ownerOptionsFor,
  spendByCardId,
} from "./card-rows";

/** owner/admin 은 소유하지 않은 카드도 관리할 수 있다(서버 §5.1과 일치). */
const MANAGER_ROLES = ["owner", "admin"] as const;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
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
  // 등록 폼 오류는 그 칸 아래에 보인다(폼 맨 아래에 모으면 긴 폼에서 어느 칸 문제인지 안 보인다).
  const [issuerError, setIssuerError] = useState<string | null>(null);
  const [aliasError, setAliasError] = useState<string | null>(null);
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
  const [editAliasError, setEditAliasError] = useState<string | null>(null);
  const [editSharedError, setEditSharedError] = useState<string | null>(null);
  // 수정 창의 소유자 선택지 — 지금 소유자가 나간 사람이면 고를 수 없는 항목으로 이름만 남긴다.
  const editOwnerOptions = useMemo(
    () =>
      ownerOptionsFor(membersQuery.data ?? [], user?.id, editing?.ownerMemberId),
    [membersQuery.data, user?.id, editing?.ownerMemberId],
  );
  // 수정 중인 카드의 최신 값(창 머리의 카드사·뒤 4자리) — 목록이 새로 오면 그 값을 쓴다.
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
      // 소급 연결(backfill)이 지난 거래를 건드렸으면 거래 스코프 전체를 갱신하고 알린다 —
      // 연결한 건수는 이 화면에 보이지 않는다. 새 카드 줄은 목록에 바로 보이므로 따로 알리지 않는다.
      if (result.linkedTransactionCount > 0) {
        invalidateTransactionScope(queryClient);
        toast.success(
          `'${result.alias}' 카드에 지난 거래 ${result.linkedTransactionCount}건을 연결했어요.`,
        );
      }
      setIssuer("");
      setAlias("");
      setMasked("");
      setVisibility("household");
      setOwnerMemberId("");
      setIssuerError(null);
      setAliasError(null);
      setRegisterOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; body: CardUpdateRequest }) =>
      authedFetch((token) => api.cards.update(token, input.id, input.body)),
    // 바뀐 값은 목록 줄(별칭·칩·결제일·아이콘 색)에 그대로 보인다 — 토스트를 띄우지 않는다.
    onSuccess: () => {
      invalidateCards();
      setEditing(null);
    },
  });

  // 비활성·재활성은 수정 창과 따로 둔다. 결과는 줄의 '비활성' 칩으로 보이고,
  // 실패만 토스트로 알린다(⋯ 메뉴에서 눌러 그 자리에 오류를 둘 칸이 없다).
  const statusMutation = useMutation({
    mutationFn: (input: { id: string; status: CardSummary["status"] }) =>
      authedFetch((token) =>
        api.cards.update(token, input.id, { status: input.status }),
      ),
    onSuccess: () => invalidateCards(),
    onError: (error) =>
      toast.error(errorMessage(error, "카드 상태를 바꾸지 못했어요.")),
  });

  function onRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!householdId) return;
    // 비어 있는 칸을 한 번에 다 알린다 — 하나 고치면 다음 오류가 또 나오지 않게.
    const nextIssuerError = issuer === "" ? "카드사를 골라 주세요." : null;
    const nextAliasError =
      alias.trim() === "" ? "카드 별칭을 입력해 주세요." : null;
    setIssuerError(nextIssuerError);
    setAliasError(nextAliasError);
    if (nextIssuerError || nextAliasError) return;
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

  /** 등록 창 열기 — 지난번에 닫으며 남긴 칸 오류를 들고 오지 않는다. */
  function openRegister() {
    setIssuerError(null);
    setAliasError(null);
    setRegisterOpen(true);
  }

  function openEdit(card: CardSummary) {
    updateMutation.reset();
    setEditing(card);
    setEditAlias(card.alias);
    setEditVisibility(card.visibility);
    setEditOwnerMemberId(card.ownerMemberId);
    setEditIsShared(card.isShared);
    setEditBillingDay(card.billingDay != null ? String(card.billingDay) : "");
    setEditAliasError(null);
    setEditSharedError(null);
  }

  function onEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const nextAliasError =
      editAlias.trim() === "" ? "카드 별칭을 입력해 주세요." : null;
    // '나만 보기 + 공용'은 서버가 400으로 거절한다. 왕복 전에 여기서 먼저 막아 준다 —
    // "같이 쓰는데 나만 본다"는 모순이고, 그 조합에서는 집계가 사람마다 달라진다.
    const nextSharedError =
      editIsShared && editVisibility === "private"
        ? "나만 보기 카드는 공용 카드로 둘 수 없어요. 이 설정을 꺼 주세요."
        : null;
    setEditAliasError(nextAliasError);
    setEditSharedError(nextSharedError);
    if (nextAliasError || nextSharedError) return;
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
              // 금액 칼럼 위에 맞춘다: 행 안쪽 여백(4·sm 8) + › 자리(간격 10·sm 12 + 아이콘 20 − 4)
              // + ⋯ 메뉴가 있으면 간격 4 + 44.
              <span
                className={cn(
                  "text-caption text-muted-foreground",
                  hasCardMenu ? "mr-19.5 sm:mr-21" : "mr-7.5 sm:mr-9",
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
          <ErrorState
            message={errorMessage(cardsQuery.error, "카드를 불러오지 못했어요.")}
            onRetry={() => void cardsQuery.refetch()}
            retrying={cardsQuery.isFetching}
          />
        ) : cards.length === 0 ? (
          <EmptyState
            icon={<CreditCard />}
            title="아직 등록된 카드가 없어요"
            description="카드를 등록하면 문자 내역이 자동으로 연결돼요"
            action={
              <Button
                type="button"
                className="w-full"
                onClick={openRegister}
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
                    chevron
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
            onClick={openRegister}
          >
            <Plus /> 카드 등록하기
          </Button>
        ) : null}
      </section>

      {/* 뒤 4자리 정정 — 행 ⋯ 메뉴에서만 연다(다른 창 위에 겹쳐 열지 않는다). */}
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
            {/* 등록하면 서버가 이미 받은 문자 중 이 카드(카드사·뒤 4자리) 것을 찾아 지난 거래까지 연결한다. */}
            <DialogDescription>
              이 카드로 오는 문자를 자동으로 연결해요. 이미 받은 문자도 함께 연결해요.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onRegister} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="card-alias">별칭</Label>
              <Input
                id="card-alias"
                type="text"
                placeholder="예: 생활비카드"
                maxLength={100}
                required
                value={alias}
                aria-invalid={aliasError ? true : undefined}
                aria-describedby={aliasError ? "card-alias-error" : undefined}
                onChange={(e) => {
                  setAlias(e.target.value);
                  if (aliasError) setAliasError(null);
                }}
              />
              {aliasError ? (
                <p
                  id="card-alias-error"
                  className="text-destructive text-caption"
                  role="alert"
                >
                  {aliasError}
                </p>
              ) : null}
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

            <CardRegisterFields
              issuer={issuer}
              onIssuerChange={(next) => {
                setIssuer(next);
                setIssuerError(null);
              }}
              issuerError={issuerError}
              owners={ownerOptions}
              ownerId={createOwnerId}
              onOwnerChange={setOwnerMemberId}
              colorClassOf={ownerColorClass}
              visibility={visibility}
              onVisibilityChange={setVisibility}
              disabled={createMutation.isPending}
            />

            {createMutation.isError ? (
              <InlineNotice tone="error">
                {errorMessage(createMutation.error, "카드를 등록하지 못했어요.")}
              </InlineNotice>
            ) : null}
            <DialogFooter className="flex-col sm:flex-col">
              <Button
                type="submit"
                className="w-full"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "등록 중…" : "등록하기"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
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
            {/* 뒤 4자리는 일반 수정이 아니라 전용 정정 흐름(행 ⋯ 메뉴)으로만 바꾼다(낙관적 확인 필요). */}
            <DialogDescription>
              {editingCard
                ? `${editingCard.issuer} ${editTail ? `•••• ${editTail}` : "· 뒤 4자리 미등록"}`
                : null}
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
                aria-invalid={editAliasError ? true : undefined}
                aria-describedby={editAliasError ? "edit-alias-error" : undefined}
                onChange={(e) => {
                  setEditAlias(e.target.value);
                  if (editAliasError) setEditAliasError(null);
                }}
              />
              {editAliasError ? (
                <p
                  id="edit-alias-error"
                  className="text-destructive text-caption"
                  role="alert"
                >
                  {editAliasError}
                </p>
              ) : null}
            </div>
            {editing ? (
              <CardEditFields
                original={editing}
                owners={editOwnerOptions}
                ownerId={editOwnerMemberId}
                onOwnerChange={setEditOwnerMemberId}
                colorClassOf={ownerColorClass}
                visibility={editVisibility}
                onVisibilityChange={(next) => {
                  setEditVisibility(next);
                  setEditSharedError(null);
                }}
                billingDay={editBillingDay}
                onBillingDayChange={setEditBillingDay}
                isShared={editIsShared}
                onSharedChange={(next) => {
                  setEditIsShared(next);
                  setEditSharedError(null);
                }}
                sharedError={editSharedError}
                disabled={updateMutation.isPending}
              />
            ) : null}
            {updateMutation.isError ? (
              <InlineNotice tone="error">
                {errorMessage(updateMutation.error, "카드를 수정하지 못했어요.")}
              </InlineNotice>
            ) : null}
            <DialogFooter className="flex-col sm:flex-col">
              <Button
                type="submit"
                className="w-full"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "저장 중…" : "저장하기"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
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
              비활성화하기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
