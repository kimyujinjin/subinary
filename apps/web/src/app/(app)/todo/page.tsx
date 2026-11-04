"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 할 일 (/todo)  [C-8]
 *
 * 매일 생기는 **처리 작업** 3종을 한 화면에 모은다:
 *  1) 결제 실패(미해결) — `declined`는 거래로 승격되지 않아 어떤 집계에도 안 잡힌다
 *  2) 확인이 필요한 거래 — 확인필요 · 중복의심
 *  3) 읽지 못한 문자 — 파싱 실패 · LLM 격리
 *
 * **왜 이 화면이 따로 필요한가**: 홈은 '확인이 필요한 문자'를 최근 3일만 보여준다.
 * 홈을 깔끔하게 유지하려는 결정이었지만, 그 결과 처리되지 않은 문자가 3일 뒤 조용히
 * 사라졌다(드리프트 D-7). 문자 한 통이 거래 한 건이고, 사라지면 지출 합계가 영구히
 * 틀린다. 그래서 이 화면은 **기간 제한 없이** 전 기간 백로그를 보여준다.
 *
 * 새 백엔드는 없다 — 세 소스 모두 홈이 이미 호출하던 쿼리이고, `useTodoCounts()`가
 * 같은 queryKey를 공유하므로 홈↔여기를 오가도 요청이 늘지 않는다.
 *
 * **진입점**: 가계부 섹션 내비의 '할 일'(`components/ledger-nav.tsx`), 홈 소비 카드의
 * 처리 대기 링크, 설정 → 가계부 관리. 하단 탭이 5개에서 3개로 줄며 전용 탭은 사라졌고,
 * 숫자 배지는 섹션 내비로 옮겼다. 배지는 이 화면과 같은 `useTodoCounts().total`을
 * 쓴다 — 배지와 목록이 다른 수를 세면 안 된다.
 *
 * '처리 완료 이력' 섹션은 로드맵 와이어프레임에 있지만 **소스가 없다** — 확정한
 * 문자·거래에 "누가 언제 처리했는지"를 남기는 테이블이 없다(결제 실패만 해결/확인
 * 여부를 갖고 있어 `/declines`가 그 역할을 한다). 없는 이력을 지어내지 않는다.
 * ------------------------------------------------------------------------- */
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  MailWarning,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type {
  CardSmsEventSummary,
  TransactionSummary,
} from "@family/contracts";

import { LedgerHeader } from "@/components/ledger-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ListRow,
  Money,
  ReviewInboxDialog,
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
import { Button } from "@/components/ui/button";
import { transactionDetailHref } from "@/lib/deep-link";
import {
  formatDate,
  formatMoney,
  formatRelativeTime,
  formatSender,
  formatWon,
} from "@/lib/format";
import { postingMessage } from "@/lib/sms-posting";

export default function TodoPage() {
  // 확정·제외 직후 캐시를 갱신하고, 문자 자동 정리가 대기 중이면 해당 묶음만 다시 읽는다.
  const todo = useTodoCounts();
  // 문자는 요약에 원문이 없어 상세를 따로 받아야 한다 → 고른 **한 건만** 넘긴다.
  const [selectedSms, setSelectedSms] = useState<string | null>(null);
  const smsGroups = useCardSmsReviewGroups();
  const cardQuery = useCardList();
  const stopPolicy = useDisableSmsReviewPolicy();
  const scrolledProcessing = useRef(false);
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
  useEffect(() => {
    if (
      !scrolledProcessing.current &&
      new URLSearchParams(window.location.search).get("section") ===
        "processing"
    ) {
      const section = document.getElementById("processing");
      if (section) {
        section.scrollIntoView({ block: "start" });
        scrolledProcessing.current = true;
      }
    }
  }, [
    todo.processingLoading,
    todo.processing.length,
    todo.unpostedUnknown.length,
  ]);

  const loading =
    todo.declinesLoading ||
    todo.reviewsLoading ||
    smsGroups.isLoading ||
    todo.unpostedLoading;
  const anyError =
    todo.declinesError ||
    todo.reviewsError ||
    smsGroups.isError ||
    todo.unpostedError;
  // 빈 상태는 **다 읽어낸 뒤에만** 보여준다. 못 읽은 것을 "할 일 없음"으로 쓰면
  // 사용자는 처리할 게 없다고 믿는다.
  const showEmpty =
    !loading &&
    !anyError &&
    todo.declines.length +
      todo.reviews.length +
      groups.length +
      todo.unpostedNeedsReview.length ===
      0;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      {/* `nav-tabs.ts`가 이 경로를 가계부 탭으로 판정하므로 같은 섹션 내비를 둔다. */}
      <LedgerHeader active="todo" />

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : null}

      {showEmpty ? (
        <div className="finance-panel flex items-center gap-3 p-5">
          <CheckCircle2 className="text-success-strong size-6 shrink-0" aria-hidden="true" />
          <p className="text-body font-medium">확인할 내역이 없어요</p>
        </div>
      ) : null}

      {/* 1) 결제 실패 — 가장 위에 둔다. 셋 중 유일하게 **돈이 나가지 않은** 사고라
          방치하면 서비스가 끊긴다(정기결제 수단 미갱신 → 멤버십 종료). */}
      <Section
        show={todo.declinesError || todo.declines.length > 0}
        title="결제가 계속 실패하고 있어요"
        countText={pendingCountText(
          todo.declinesLoading,
          todo.declinesError,
          todo.declines.length,
          false
        )}
        error={todo.declinesError}
        errorText="실패한 결제를 불러오지 못했어요"
        footer={
          <FooterLink href="/declines">
            해결됐거나 확인한 실패도 보기
          </FooterLink>
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
              } · ${d.attempts}번 거절${hint ? ` · ${hint}` : ""}`}
              value={
                <span className="text-destructive text-[13px] font-medium">
                  {formatRelativeTime(d.lastAttemptAt)}
                </span>
              }
              chevron
            />
          );
        })}
      </Section>

      {/* 2) 확인이 필요한 거래 — 탭하면 그 건의 상세가 바로 열린다(목록으로 보내면
          사용자가 방금 누른 건을 다시 찾아야 한다). */}
      <Section
        show={todo.reviewsError || todo.reviews.length > 0}
        title="확인이 필요한 거래"
        countText={pendingCountText(
          todo.reviewsLoading,
          todo.reviewsError,
          todo.reviews.length,
          todo.reviewsTruncated
        )}
        error={todo.reviewsError}
        errorText="거래를 불러오지 못했어요"
        footer={
          <FooterLink href="/transactions?review=1">
            가계부에서 확인이 필요한 거래 보기
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
            subtitle={formatDate(t.approvedAt)}
            value={<Money amount={t.netAmount} currency={t.currency} />}
            valueSub={<StatusBadge status={t.status} />}
            chevron
          />
        ))}
      </Section>

      <Section
        show={todo.unpostedNeedsReview.length > 0}
        title="확인이 필요한 문자"
        countText={pendingCountText(
          todo.unpostedLoading,
          todo.unpostedError,
          todo.unpostedNeedsReview.length,
          todo.unpostedTruncated
        )}
        error={todo.unpostedError}
        errorText="거래 반영 상태를 확인하지 못했어요. 잠시 후 새로고침해 주세요."
      >
        {todo.unpostedNeedsReview.map((event) => (
          <ListRow
            key={event.id}
            onClick={() => setSelectedSms(event.id)}
            icon={<MailWarning />}
            title={`${formatSender(event.sender)}에서 온 문자`}
            subtitle={postingMessage(event)}
            value={
              <span className="text-muted-foreground text-xs">
                {formatRelativeTime(event.receivedAt)}
              </span>
            }
            chevron
          />
        ))}
      </Section>

      {/* 본인 문자를 같은 양식으로 묶고 대표 한 건을 검토한다. */}
      <Section
        show={smsGroups.isError || groups.length > 0}
        title="거래 반영 전 문자"
        countText={pendingCountText(
          smsGroups.isLoading,
          smsGroups.isError,
          smsGroups.data?.scannedCount ?? 0,
          smsGroups.data?.truncated ?? false
        )}
        error={smsGroups.isError}
        errorText="문자 묶음을 불러오지 못했어요"
        footer={
          smsGroups.data?.truncated ? (
            <p className="text-muted-foreground px-4 py-3 text-xs">
              최근 미처리 {smsGroups.data.scannedCount}건을 묶었어요. 처리하면
              이전 문자가 이어서 나타나요.
            </p>
          ) : null
        }
      >
        {groups.map((group) => (
          <ListRow
            key={group.groupId}
            onClick={() => setSelectedSms(group.representativeEventId)}
            icon={<MailWarning />}
            iconClassName="bg-warning/15 text-warning-strong"
            title={`${formatSender(group.sender)}에서 온 문자 ${group.count}건`}
            subtitle={`읽지 못함 ${group.parseFailed}건 · 확인 대기 ${group.quarantined}건`}
            value={
              <span className="text-muted-foreground text-[13px]">
                {formatRelativeTime(group.latestReceivedAt)}
              </span>
            }
            chevron
          />
        ))}
      </Section>

      {policies.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-heading px-1">문자 자동 정리</h2>
          <div className="finance-panel divide-y divide-border/60 px-5">
            {policies.map((policy) => (
              <div
                key={policy.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="text-body">
                  <p>
                    {cardQuery.data?.find(
                      (card) => card.id === policy.approvedCardId
                    )?.alias ?? "선택한 카드"}{" "}
                    · {policy.enabled ? "자동 정리 중" : "중지됨"}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {formatDate(policy.createdAt)}부터 · 약 5분마다 확인
                  </p>
                </div>
                {policy.enabled ? (
                  <Button
                    variant="weak"
                    size="sm"
                    disabled={stopPolicy.isPending}
                    onClick={() => stopPolicy.mutate(policy.id)}
                  >
                    중지
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          {stopPolicy.isError ? (
            <p role="alert" className="text-destructive text-sm">
              자동 정리 중지를 확인하지 못했어요. 다시 시도해 주세요.
            </p>
          ) : null}
        </section>
      ) : null}

      <Section
        id="processing"
        show={
          todo.processingLoading ||
          todo.processingError ||
          todo.processing.length + todo.unpostedUnknown.length > 0
        }
        title="처리 대기"
        countText={pendingCountText(
          todo.processingLoading,
          todo.processingError,
          todo.processing.length + todo.unpostedUnknown.length,
          todo.processingTruncated
        )}
        error={todo.processingError}
        errorText="처리 상태를 확인하지 못했어요. 확인이 필요한 내역이 없다는 뜻은 아니에요."
        footer={
          todo.processingTruncated ? (
            <p className="text-muted-foreground px-4 py-3 text-xs">
              조회 상한이 있어 일부 상태만 표시될 수 있어요.
            </p>
          ) : null
        }
      >
        {[...todo.processing, ...todo.unpostedUnknown].map((event) => (
          <div key={event.id} className="space-y-1 px-3 py-3">
            <p className="flex items-center justify-between gap-2">
              <span className="text-body font-medium">
                {event.currency ?? "통화 확인 중"} ·{" "}
                {formatRelativeTime(event.receivedAt)}
              </span>
              <StatusChip tone="pending">대기 중</StatusChip>
            </p>
            <p className="text-caption text-muted-foreground">
              {postingMessage(event)}
            </p>
          </div>
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
    </div>
  );
}

/** 섹션 1개(제목 + 건수 + 행 목록). `show`가 false면 아무것도 렌더하지 않는다. */
function Section({
  id,
  show,
  title,
  description,
  countText,
  error,
  errorText,
  footer,
  children,
}: Readonly<{
  id?: string;
  show: boolean;
  title: string;
  description?: string;
  countText: string;
  error: boolean;
  errorText: string;
  footer?: ReactNode;
  children: ReactNode;
}>) {
  if (!show) return null;
  return (
    <section id={id} className="space-y-2 scroll-mt-4">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-heading">{title}</h2>
        <span className="text-caption text-muted-foreground tabular-nums">
          {countText}
        </span>
      </div>
      {description ? (
        <p className="text-caption text-muted-foreground px-1">{description}</p>
      ) : null}
      <div className="finance-panel divide-border/60 divide-y overflow-hidden">
        {error ? (
          <p className="text-body text-muted-foreground px-4 py-6 text-center">
            {errorText}
          </p>
        ) : (
          <div className="flex flex-col px-2 py-1">{children}</div>
        )}
        {footer}
      </div>
    </section>
  );
}

/** 섹션 하단의 보조 링크(전체 보기 등). */
function FooterLink({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Link
      href={href}
      className="text-caption text-muted-foreground hover:bg-muted/50 hover:text-foreground block px-5 py-3 font-medium transition-colors"
    >
      {children} ›
    </Link>
  );
}

/** 마스킹/미확인을 고려한 가맹점 표시명(거래 목록과 동일 규칙). */
function merchantLabel(t: TransactionSummary): string {
  if (t.masked) return "(비공개)";
  return t.merchantNormalized ?? t.merchantRaw ?? "미확인 가맹점";
}

/**
 * 문자 한 줄 부제.
 * `quarantined`는 LLM이 값을 이미 뽑아 둔 상태라 **확인만** 하면 되고,
 * `parse_failed`는 값이 비어 있어 사용자가 직접 채워야 한다 — 그 차이를 알려 준다.
 */
function smsSubtitle(e: CardSmsEventSummary): string {
  if (e.parseStatus === "quarantined") {
    const amount =
      e.amount === null ? null : formatMoney(e.amount, e.currency ?? "KRW");
    const merchant = e.merchantRaw ?? "가맹점 미상";
    return `${merchant}${amount ? ` ${amount}` : ""} · 확인만 하면 돼요`;
  }
  return "자동으로 읽지 못했어요 · 원문을 보고 확정해 주세요";
}
