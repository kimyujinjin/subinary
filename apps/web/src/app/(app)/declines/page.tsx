"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 실패한 결제 (/declines)
 *
 * `declined`(승인거절)는 실제 체결이 아니라 거래로 승격되지 않는다 — 유령 거래를 만들지
 * 않기 위한 옳은 설계다. 그런데 그 결과 앱 어디에도 나타나지 않아 사용자가 실패를 알 수
 * 없었다. 실측(2026-07): `분실카드 승인거절 · OO피트니스 99,000원`이 7일 연속 15:00에
 * 반복되고 승인은 0건 — 정기결제 수단을 갱신하지 않아 멤버십이 끊긴 것으로 보이는데
 * 아무 신호도 없었다.
 *
 * 카드사가 매일 재시도하므로 시도를 낱개로 보여주면 같은 사건이 7줄이 된다. 서버가
 * `(가맹점, 금액)`으로 묶어 주고, 여기서는 **미해결 먼저** 보여준다.
 *
 * 모양은 홈·할 일과 같은 부품(SectionHeader·StatusChip·ListLoading·EmptyState·ErrorState)이다.
 * 색은 '결제 실패' 칩 하나에만 쓴다(2026-11-05 HIG 검수 — 빨간 아이콘·배지·안내의 3중 강조를 걷어냈다).
 * ------------------------------------------------------------------------- */
import { CheckCircle2, CreditCard } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorState,
  ListLoading,
  PageBackHeader,
  SectionHeader,
  StatusChip,
  declineGroupKey,
  declineReasonHint,
} from "@/components/widgets";
import { formatMonthDay, formatRelativeTime, formatWon } from "@/lib/format";
import { useDeclineList, useSetDeclineDismissed } from "@/lib/queries";
import type { CardSmsDeclineGroup } from "@family/contracts";

function DeclineRow({ item }: { item: CardSmsDeclineGroup }) {
  const autoResolved = item.resolvedAt !== null;
  const dismissed = item.dismissedAt !== null;
  // 조치가 끝난 것(자동 해결 또는 사용자 확인)은 회색 칩으로 내린다.
  const done = autoResolved || dismissed;
  // 사유 → 조치 문구는 할 일 화면과 **같은 표**를 쓴다(사본을 두면 갈린다).
  const hint = declineReasonHint(item.reason);
  const mutation = useSetDeclineDismissed();
  const card = [item.issuer, item.maskedCardNumber].filter(Boolean).join(" ");

  return (
    <li className="flex items-start gap-3 py-3.5">
      {/* 색은 상태 칩 하나에만 쓴다 — 아이콘·배지·안내를 모두 빨갛게 칠하면 어디를 봐야 할지 묻힌다
          (2026-11-05 HIG 검수). 아이콘은 줄 모양만 잡는 회색이다. */}
      <span
        aria-hidden="true"
        className="bg-muted text-muted-foreground mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-[18px]"
      >
        {done ? <CheckCircle2 /> : <CreditCard />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="text-body min-w-0 truncate font-semibold">
            {item.merchant ?? "확인 안 된 가맹점"}
          </p>
          <StatusChip tone={done ? "neutral" : "error"}>
            {autoResolved ? "해결됨" : dismissed ? "확인함" : "결제 실패"}
          </StatusChip>
        </div>
        <p className="text-caption text-muted-foreground mt-0.5">
          {item.amount === null ? "금액 미확인" : formatWon(item.amount)} ·{" "}
          {item.attempts}번 실패{card ? ` · ${card}` : ""}
        </p>
        {autoResolved ? (
          <p className="text-caption text-muted-foreground mt-0.5">
            {formatMonthDay(item.resolvedAt)}에 결제됐어요
          </p>
        ) : hint ? (
          <p
            className={`text-caption mt-0.5 ${
              dismissed ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {hint}
          </p>
        ) : null}
        <p className="text-caption text-muted-foreground mt-0.5">
          마지막 시도 {formatRelativeTime(item.lastAttemptAt)}
        </p>

        {/* 자동 해결된 것에는 버튼을 두지 않는다 — 이미 승인 기록으로 끝난 사건이다.
            직접 확인한 것은 되돌릴 수 있게 남긴다(잘못 눌렀을 때 복구 경로). */}
        {autoResolved ? null : (
          <Button
            type="button"
            variant="weak"
            className="mt-2"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                merchant: item.merchant,
                amount: item.amount,
                dismissed: !dismissed,
              })
            }
          >
            {dismissed ? "다시 알려 주세요" : "확인했어요"}
          </Button>
        )}
      </div>
    </li>
  );
}

/** 섹션 한 묶음 — 홈·할 일 섹션과 같은 모양(finance-panel + SectionHeader). */
function DeclineSection({
  title,
  count,
  children,
}: Readonly<{ title: string; count: number; children: ReactNode }>) {
  return (
    <section className="finance-panel min-w-0 overflow-hidden pt-2">
      <SectionHeader
        className="px-5"
        title={title}
        trailing={
          <span className="text-caption text-muted-foreground tabular-nums">
            {count}건
          </span>
        }
      />
      <ul className="divide-border/60 divide-y px-5 pb-1">{children}</ul>
    </section>
  );
}

export default function DeclinesPage() {
  const { data, isLoading, isError, isFetching, refetch } = useDeclineList();
  const items = data?.items ?? [];
  // 조치가 필요한 것 = 자동 해결도, 사용자 확인도 안 된 것.
  const unresolved = items.filter(
    (i) => i.resolvedAt === null && i.dismissedAt === null,
  );
  const resolved = items.filter(
    (i) => i.resolvedAt !== null || i.dismissedAt !== null,
  );

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-4">
      <PageBackHeader
        title="실패한 결제"
        subtitle="지출에는 포함하지 않아요"
      />

      {isLoading ? (
        <ListLoading rows={3} label="실패한 결제를 불러오는 중이에요." />
      ) : isError ? (
        <ErrorState
          message="실패한 결제를 불러오지 못했어요"
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title="실패한 결제가 없어요"
          description="결제가 실패하면 여기에 모아서 알려 드려요."
        />
      ) : (
        <>
          {unresolved.length > 0 ? (
            <DeclineSection title="아직 해결되지 않았어요" count={unresolved.length}>
              {unresolved.map((item) => (
                <DeclineRow key={declineGroupKey(item)} item={item} />
              ))}
            </DeclineSection>
          ) : null}

          {resolved.length > 0 ? (
            <DeclineSection title="해결됐거나 확인한 결제" count={resolved.length}>
              {resolved.map((item) => (
                <DeclineRow key={declineGroupKey(item)} item={item} />
              ))}
            </DeclineSection>
          ) : null}
        </>
      )}
    </div>
  );
}
