"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 할 일 (/todo)  [C-8]
 *
 * 매일 생기는 **처리 작업**을 한 화면에 모은다(섹션 id = `TODO_SECTION_IDS`):
 *  1) 결제 실패(미해결) — `declined`는 거래로 승격되지 않아 어떤 집계에도 안 잡힌다
 *  2) 가족이 물어본 결제
 *  3) 확인할 거래 — 확인 필요 · 중복 의심
 *  4) 확인할 문자 — 파싱 실패 · LLM 격리 묶음과 그 밖에 반영 전 확인이 필요한 문자를 한 섹션으로
 *  5) 반영을 기다리는 문자 — 할 일이 아니라 상태(합계에 넣지 않는다)
 *
 * **왜 이 화면이 따로 필요한가**: 예전 홈은 '확인이 필요한 문자'를 최근 3일만 보여줬다.
 * 홈을 깔끔하게 유지하려는 결정이었지만, 그 결과 처리되지 않은 문자가 3일 뒤 조용히
 * 사라졌다(드리프트 D-7). 지금 홈은 전 기간 건수를 '확인할 문자' 줄로 세어 이 화면으로 보낸다. 문자 한 통이 거래 한 건이고, 사라지면 지출 합계가 영구히
 * 틀린다. 그래서 이 화면은 **기간 제한 없이** 전 기간 백로그를 보여준다.
 *
 * 새 백엔드는 없다 — 세 소스 모두 홈이 이미 호출하던 쿼리이고, `useTodoCounts()`가
 * 같은 queryKey를 공유하므로 홈↔여기를 오가도 요청이 늘지 않는다.
 *
 * **진입점**: 가계부 섹션 내비의 '할 일'(`components/ledger-nav.tsx`), 홈 소비 카드의
 * 할 일 줄(`/todo?section=…` — 그 섹션으로 스크롤한다). 홈에서 처리 대기는 상태
 * 문구일 뿐이고, 환율이 없어 멈춘 문자만 '반영을 기다리는 문자' 섹션으로 가는 줄이 있다.
 * 하단 탭이 5개에서 3개로 줄며 전용 탭은 사라졌고, 숫자 배지는 섹션 내비로 옮겼다.
 * 배지는 이 화면과 같은 `useTodoCounts().total`을 쓴다 — 배지와 목록이 다른 수를 세면
 * 안 된다.
 *
 * '처리 완료 이력' 섹션은 로드맵 와이어프레임에 있지만 **소스가 없다** — 확정한
 * 문자·거래에 "누가 언제 처리했는지"를 남기는 테이블이 없다(결제 실패만 해결/확인
 * 여부를 갖고 있어 `/declines`가 그 역할을 한다). 없는 이력을 지어내지 않는다.
 * ------------------------------------------------------------------------- */
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock,
  MailWarning,
  MessageCircleQuestionMark,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type {
  CardSmsReviewPolicy,
  TransactionSummary,
} from "@family/contracts";

import { LedgerHeader } from "@/components/ledger-header";
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
  EmptyState,
  ErrorState,
  InlineNotice,
  ListLoading,
  ListRow,
  Money,
  ReviewInboxDialog,
  SectionHeader,
  StatusBadge,
  StatusChip,
  declineGroupKey,
  declineReasonHint,
  pendingCountText,
  useTodoCounts,
} from "@/components/widgets";
import {
  useCardList,
  useCardSmsReviewGroups,
  useDisableSmsReviewPolicy,
} from "@/lib/queries";
import { useReviewRequests } from "@/lib/review-requests";
import { transactionDetailHref } from "@/lib/deep-link";
import {
  formatMonthDay,
  formatMonthDayTime,
  formatRelativeTime,
  formatWon,
} from "@/lib/format";
import { todoSmsTaskText } from "@/lib/sms-posting";
import {
  smsGroupTaskText,
  smsSourceLabel,
  smsWaitTitle,
} from "@/lib/sms-review-copy";
import { isTodoSectionId } from "@/components/widgets/todo-counts";

export default function TodoPage() {
  // 확정·제외 직후 캐시를 갱신하고, 문자 자동 정리가 대기 중이면 해당 묶음만 다시 읽는다.
  const todo = useTodoCounts();
  // 가족이 나에게 물어본 결제(확인 요청). 내가 보낸 것은 결제 상세에서만 보인다.
  const requests = useReviewRequests(null);
  const received = (requests.data?.items ?? []).filter((item) => item.direction === "received");
  // 문자는 요약에 원문이 없어 상세를 따로 받아야 한다 → 고른 **한 건만** 넘긴다.
  const [selectedSms, setSelectedSms] = useState<string | null>(null);
  const smsGroups = useCardSmsReviewGroups();
  const cardQuery = useCardList();
  const stopPolicy = useDisableSmsReviewPolicy();
  // 자동 정리 중지는 액션 시트로 한 번 더 묻는다 — 이 화면에는 다시 켜는 버튼이 없다.
  const [stopTarget, setStopTarget] = useState<CardSmsReviewPolicy | null>(null);
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const scrolledToSection = useRef(false);
  const policies = smsGroups.data?.policies ?? [];
  const groups = smsGroups.data?.items ?? [];
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(
      "reviewSms"
    );
    if (
      requested &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        requested
      )
    ) {
      setSelectedSms(requested);
    }
  }, []);

  const loading =
    requests.isLoading ||
    todo.declinesLoading ||
    todo.reviewsLoading ||
    smsGroups.isLoading ||
    todo.unpostedLoading;
  // 홈 줄로 `/todo?section=…`에 오면 그 섹션으로 스크롤한다. 화면 전체를 다 읽은 뒤에만
  // 한다 — 위쪽 스켈레톤이 남아 있을 때 스크롤하면 스켈레톤이 빠지면서 목표 섹션이 위로
  // 밀려 올라간다. 처리 대기(문자함 쿼리)도 기다린다 — 끝나면 '확인할 문자'가 줄어
  // 아래 섹션이 움직인다. 오류도 isLoading을 false로 만드니 영영 막히지는 않는다.
  const settled = !loading && !todo.processingLoading;
  useEffect(() => {
    if (!settled || scrolledToSection.current) return;
    const target = new URLSearchParams(window.location.search).get("section");
    if (!isTodoSectionId(target)) return;
    // 다 읽었는데 섹션이 없으면(그사이 0건) 맨 위에 둔다. 나중에 새 건이 와도 화면을
    // 끌고 가지 않으려고 건수 변화로는 다시 찾지 않는다. 못 찾았을 때 끝났다고 표시하지
    // 않는 이유: householdId가 정해지기 전에는 쿼리가 꺼져 있어 읽기 전인데도 settled가
    // 되므로, 실제로 읽고 난 뒤 한 번 더 찾아야 한다.
    const section = document.getElementById(target);
    if (section) {
      section.scrollIntoView({ block: "start" });
      scrolledToSection.current = true;
    }
  }, [settled]);
  const anyError =
    requests.isError ||
    todo.declinesError ||
    todo.reviewsError ||
    smsGroups.isError ||
    todo.unpostedError;

  // 확인할 문자 = 본인 문자 묶음(같은 모양끼리) + 그 밖에 반영 전에 확인이 필요한 문자. 둘은 같은 확인
  // 창을 열어 사용자에게는 차이가 없어 한 섹션으로 합쳤다(2026-11-05 HIG 검수). 묶음 대표와 같은 문자는
  // 한 번만 보인다.
  const representativeIds = new Set(
    groups.map((group) => group.representativeEventId)
  );
  const smsRows = todo.unpostedNeedsReview.filter(
    (event) => !representativeIds.has(event.id)
  );
  const smsLoading = smsGroups.isLoading || todo.unpostedLoading;
  const smsError = smsGroups.isError || todo.unpostedError;
  // 묶음에는 카드사 필드가 없다 — 대표 문자가 문자함 목록에 있으면 거기서 읽은 카드사를 쓴다.
  const issuerById = new Map<string, string | null>();
  for (const event of [...todo.sms, ...todo.unposted]) {
    issuerById.set(event.id, event.issuer);
  }
  const waitingRows = [...todo.processing, ...todo.unpostedUnknown];

  // 빈 상태는 **다 읽어낸 뒤에만** 보여준다. 못 읽은 것을 "할 일 없음"으로 쓰면
  // 사용자는 처리할 게 없다고 믿는다.
  const showEmpty =
    !loading &&
    !anyError &&
    received.length +
      todo.declines.length +
      todo.reviews.length +
      groups.length +
      smsRows.length ===
      0;

  // '다시 불러오기'는 실패한 쿼리를 한꺼번에 다시 읽는다 — useTodoCounts가 쿼리별 refetch를
  // 내주지 않고, 실패가 겹쳤다면 사용자는 어차피 전부 다시 읽기를 바란다.
  const retryFailed = () => {
    if (retrying) return;
    setRetrying(true);
    void queryClient
      .refetchQueries({
        type: "active",
        predicate: (query) => query.state.status === "error",
      })
      .finally(() => setRetrying(false));
  };
  const cardAlias = (policy: CardSmsReviewPolicy) =>
    cardQuery.data?.find((card) => card.id === policy.approvedCardId)?.alias ??
    "고른 카드";

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-4">
      {/* `nav-tabs.ts`가 이 경로를 가계부 탭으로 판정하므로 같은 섹션 내비를 둔다. */}
      <LedgerHeader active="todo" />

      {loading ? <ListLoading rows={3} label="할 일을 불러오는 중이에요." /> : null}

      {showEmpty ? (
        <EmptyState
          icon={<CheckCircle2 />}
          iconClassName="bg-success/15 text-success-strong"
          title="지금은 할 일이 없어요"
          description="결제 실패나 확인할 거래·문자가 생기면 여기에 모여요."
        />
      ) : null}

      {/* 1) 결제 실패 — 가장 위에 둔다. 셋 중 유일하게 **돈이 나가지 않은** 사고라
          방치하면 서비스가 끊긴다(정기결제 수단 미갱신 → 멤버십 종료). */}
      <Section
        id="declines"
        show={todo.declinesError || todo.declines.length > 0}
        title="결제가 계속 실패하고 있어요"
        countText={pendingCountText(
          todo.declinesLoading,
          todo.declinesError,
          todo.declines.length,
          false
        )}
        error={todo.declinesError ? "실패한 결제를 불러오지 못했어요" : null}
        onRetry={retryFailed}
        retrying={retrying}
        footer={
          <FooterLink href="/declines">해결됐거나 확인한 결제도 보기</FooterLink>
        }
      >
        {todo.declines.map((d) => {
          const hint = declineReasonHint(d.reason);
          return (
            <ListRow
              // 묶음은 조회 시점 집계라 id가 없다 — (가맹점, 금액)이 묶음의 키다.
              // 이어 붙이지 않는 이유는 declineGroupKey의 주석에 있다.
              key={declineGroupKey(d)}
              href="/declines"
              icon={<AlertTriangle />}
              iconClassName="bg-destructive/10 text-destructive"
              title={d.merchant ?? "확인 안 된 가맹점"}
              subtitle={`${
                d.amount === null ? "금액 미확인" : formatWon(d.amount)
              } · ${d.attempts}번 실패${hint ? ` · ${hint}` : ""}`}
              value={<TimeText iso={d.lastAttemptAt} />}
              chevron
            />
          );
        })}
      </Section>

      {/* 가족이 물어본 결제 — 사람이 기다리는 일이라 결제 실패 다음에 둔다. 탭하면 결제 상세가
          열리고 거기서 '확인했어요'를 누른다. */}
      <Section
        id="requests"
        show={requests.isError || received.length > 0}
        title="가족이 물어본 결제"
        countText={pendingCountText(requests.isLoading, requests.isError, received.length, false)}
        error={requests.isError ? "물어본 결제를 불러오지 못했어요" : null}
        onRetry={retryFailed}
        retrying={retrying}
      >
        {received.map((item) => (
          <ListRow
            key={item.id}
            href={transactionDetailHref(item.transactionId)}
            icon={<MessageCircleQuestionMark />}
            iconClassName="bg-accent text-accent-foreground"
            title={item.merchant ?? "가맹점 미확인"}
            subtitle={`${item.requesterName}님이 물어봤어요 · ${formatMonthDay(item.occurredAt)}`}
            value={<Money amount={item.amount} currency={item.currency} />}
            chevron
          />
        ))}
      </Section>

      {/* 2) 확인할 거래 — 탭하면 그 건의 상세가 바로 열린다(목록으로 보내면 사용자가 방금 누른
          건을 다시 찾아야 한다). 섹션 제목이 이미 '확인'이라 줄마다 '확인 필요' 칩을 달지 않고,
          다른 상태(중복 의심)일 때만 칩을 단다. */}
      <Section
        id="reviews"
        show={todo.reviewsError || todo.reviews.length > 0}
        title="확인할 거래"
        countText={pendingCountText(
          todo.reviewsLoading,
          todo.reviewsError,
          todo.reviews.length,
          todo.reviewsTruncated
        )}
        error={todo.reviewsError ? "확인할 거래를 불러오지 못했어요" : null}
        onRetry={retryFailed}
        retrying={retrying}
        footer={
          <FooterLink href="/transactions?review=1">
            가계부에서 확인할 거래 보기
          </FooterLink>
        }
      >
        {todo.reviews.map((t) => (
          <ListRow
            key={t.id}
            href={`${transactionDetailHref(t.id)}&review=1`}
            icon={<CircleAlert />}
            iconClassName="bg-warning/15 text-warning-strong"
            title={merchantLabel(t)}
            subtitle={formatMonthDayTime(t.approvedAt ?? t.createdAt)}
            value={<Money amount={t.netAmount} currency={t.currency} />}
            valueSub={
              t.status === "pending_review" ? null : <StatusBadge status={t.status} />
            }
            chevron
          />
        ))}
      </Section>

      {/* 3) 확인할 문자 — 홈의 '확인할 문자' 줄이 이 id(section=sms)로 온다. */}
      <Section
        id="sms"
        show={smsError || groups.length + smsRows.length > 0}
        title="확인할 문자"
        countText={pendingCountText(
          smsLoading,
          smsError,
          (smsGroups.data?.scannedCount ?? 0) + smsRows.length,
          (smsGroups.data?.truncated ?? false) || todo.unpostedTruncated
        )}
        error={smsError ? "확인할 문자를 다 불러오지 못했어요" : null}
        onRetry={retryFailed}
        retrying={retrying}
        footer={
          smsGroups.data?.truncated ? (
            <FooterNote>
              최근 문자 {smsGroups.data.scannedCount}건만 보여 드려요. 확인하면 이전
              문자가 이어서 나와요.
            </FooterNote>
          ) : null
        }
      >
        {groups.map((group) => (
          <ListRow
            key={group.groupId}
            onClick={() => setSelectedSms(group.representativeEventId)}
            icon={<MailWarning />}
            iconClassName="bg-warning/15 text-warning-strong"
            title={`${smsSourceLabel(
              group.sender,
              issuerById.get(group.representativeEventId)
            )}${group.count > 1 ? ` ${group.count}건` : ""}`}
            subtitle={smsGroupTaskText(group)}
            value={<TimeText iso={group.latestReceivedAt} />}
            chevron
          />
        ))}
        {smsRows.map((event) => (
          <ListRow
            key={event.id}
            onClick={() => setSelectedSms(event.id)}
            icon={<MailWarning />}
            iconClassName="bg-warning/15 text-warning-strong"
            title={smsSourceLabel(event.sender, event.issuer)}
            subtitle={todoSmsTaskText(event)}
            value={<TimeText iso={event.receivedAt} />}
            chevron
          />
        ))}
      </Section>

      {policies.length > 0 ? (
        <section className="finance-panel min-w-0 overflow-hidden pt-2">
          <SectionHeader className="px-5" title="문자 자동 정리" />
          <ul className="divide-border/60 divide-y px-5">
            {policies.map((policy) => (
              <li
                key={policy.id}
                className="flex min-h-16 items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2">
                    <span className="text-body truncate font-semibold">
                      {cardAlias(policy)}
                    </span>
                    <StatusChip tone={policy.enabled ? "ok" : "neutral"}>
                      {policy.enabled ? "자동 정리 중" : "중지됨"}
                    </StatusChip>
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {policy.enabled
                      ? `${formatMonthDay(policy.createdAt)}부터 · 약 5분마다 확인해요`
                      : "같은 모양의 문자를 확인할 때 다시 켤 수 있어요"}
                  </p>
                </div>
                {policy.enabled ? (
                  <Button
                    type="button"
                    variant="weak"
                    disabled={stopPolicy.isPending}
                    onClick={() => setStopTarget(policy)}
                  >
                    중지하기
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {stopPolicy.isError ? (
            <InlineNotice tone="error" className="mx-5 mb-4">
              자동 정리를 중지하지 못했어요. 다시 시도해 주세요.
            </InlineNotice>
          ) : null}
        </section>
      ) : null}

      {/* 반영을 기다리는 문자 — 사용자가 할 일은 없어 할 일 합계에 넣지 않는다. 홈의 환율 대기 줄이
          이 id(section=processing)로 온다. 섹션 제목이 이미 '기다리는'이라 줄마다 대기 칩을 달지 않는다. */}
      <Section
        id="processing"
        show={todo.processingError || waitingRows.length > 0}
        title="반영을 기다리는 문자"
        description="따로 할 일은 없어요. 같은 문자를 다시 등록하지 않아도 돼요."
        countText={pendingCountText(
          todo.processingLoading,
          todo.processingError,
          waitingRows.length,
          todo.processingTruncated
        )}
        error={
          todo.processingError ? "반영을 기다리는 문자를 불러오지 못했어요" : null
        }
        onRetry={retryFailed}
        retrying={retrying}
        footer={
          todo.processingTruncated ? (
            <FooterNote>
              일부만 보여 드려요. 반영되면 나머지가 이어서 나와요.
            </FooterNote>
          ) : null
        }
      >
        {waitingRows.map((event) => (
          <ListRow
            key={event.id}
            icon={<Clock />}
            iconClassName="bg-muted text-muted-foreground"
            title={smsWaitTitle(event)}
            subtitle={[event.merchantRaw, formatRelativeTime(event.receivedAt)]
              .filter(Boolean)
              .join(" · ")}
          />
        ))}
      </Section>

      <ReviewInboxDialog
        open={selectedSms != null}
        events={selectedSms ? [{ id: selectedSms }] : []}
        onClose={() => setSelectedSms(null)}
        // 확정하면 그 문자는 목록에서 빠진다 — 열려 있는 폼이 이미 처리한 건을
        // 계속 보여주지 않도록 닫는다.
        onReviewed={() => setSelectedSms(null)}
      />

      <AlertDialog
        open={stopTarget != null}
        onOpenChange={(open) => {
          if (!open) setStopTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {stopTarget
                ? `${cardAlias(stopTarget)} 문자 자동 정리를 중지할까요?`
                : "문자 자동 정리를 중지할까요?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              자동으로 읽지 못한 같은 모양의 문자는 다시 여기서 확인을 기다려요. 그
              문자를 확인할 때 자동 정리를 다시 켤 수 있어요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>닫기</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (stopTarget) stopPolicy.mutate(stopTarget.id);
              }}
            >
              중지하기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * 섹션 1개(제목 + 건수 + 행 목록). `show`가 false면 아무것도 렌더하지 않는다.
 * 모양은 홈·정기 지출 섹션과 같다(finance-panel + SectionHeader). 못 읽은 축이 있으면 읽은 줄은
 * 그대로 두고 그 아래에 원인 + '다시 불러오기'를 둔다.
 */
function Section({
  id,
  show,
  title,
  description,
  countText,
  error,
  onRetry,
  retrying,
  footer,
  children,
}: Readonly<{
  id?: string;
  show: boolean;
  title: string;
  description?: string;
  countText: string;
  /** 못 읽었을 때 무엇을 못 했는지 한 줄. 읽었으면 `null`. */
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  footer?: ReactNode;
  children: ReactNode;
}>) {
  if (!show) return null;
  return (
    <section
      id={id}
      // 고정 헤더(--app-header-h) 밑에 제목이 가리지 않게 헤더 높이만큼 더 띄운다.
      className="finance-panel min-w-0 scroll-mt-[calc(var(--app-header-h)+1rem)] overflow-hidden pt-2"
    >
      <SectionHeader
        className="px-5"
        title={title}
        trailing={
          <span className="text-caption text-muted-foreground tabular-nums">
            {countText}
          </span>
        }
      />
      {description ? (
        <p className="text-caption text-muted-foreground px-5">{description}</p>
      ) : null}
      <div className="flex flex-col px-4 pb-1 sm:px-3">{children}</div>
      {error ? (
        <ErrorState
          align="start"
          className="px-5 pb-4 pt-1"
          message={error}
          onRetry={onRetry}
          retrying={retrying}
        />
      ) : null}
      {footer}
    </section>
  );
}

/** 섹션 하단의 보조 링크(전체 보기 등). 다른 화면으로 가는 줄이라 ›를 단다. */
function FooterLink({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Link
      href={href}
      className="text-caption text-muted-foreground hover:bg-muted/50 hover:text-foreground border-border/60 flex min-h-11 items-center justify-between gap-2 border-t px-5 font-medium transition-colors active:bg-muted active:text-foreground"
    >
      <span className="min-w-0">{children}</span>
      <ChevronRight
        className="text-muted-foreground/70 size-5 shrink-0"
        aria-hidden="true"
      />
    </Link>
  );
}

/** 섹션 하단의 안내 한 줄(일부만 보인다는 사실 등). */
function FooterNote({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p className="text-caption text-muted-foreground border-border/60 border-t px-5 py-3">
      {children}
    </p>
  );
}

/** 줄 오른쪽의 상대 시각('3시간 전'). 금액 자리라 기본 굵기를 덜어 낸다. */
function TimeText({ iso }: Readonly<{ iso: string | null }>) {
  return (
    <span className="text-caption text-muted-foreground font-normal">
      {formatRelativeTime(iso)}
    </span>
  );
}

/** 마스킹/미확인을 고려한 가맹점 표시명(거래 목록과 동일 규칙). */
function merchantLabel(t: TransactionSummary): string {
  if (t.masked) return "(비공개)";
  return t.merchantNormalized ?? t.merchantRaw ?? "미확인 가맹점";
}
