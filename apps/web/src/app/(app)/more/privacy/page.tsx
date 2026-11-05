"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 개인정보 (/more/privacy)
 *
 * 이 화면이 답하는 질문은 둘이다.
 *   1. 내 데이터가 어디서 들어오나 (문자 보내는 기기 수 → `/devices`)
 *   2. 지금 무엇이 얼마나 보관돼 있나 (카드 문자 건수 · 시작한 달, 읽기 전용)
 *
 * 가족 가입 동의 절차는 2026-11-05에 없앴다(소유자 결정 — 두 사람이 쓰는 가족 앱이라 필요 없다).
 * 이미 남은 동의 기록은 DB에 그대로 있고, 문자 수집을 멈추려면 문자 연동에서 기기를 폐기한다.
 *
 * ⚠️ 이 화면은 **삭제를 약속하지 않는다.** 문자 purge 잡·보존기간 선택은 **만들지
 * 않기로 했다**(2026-08-18 사용자 결정, 로드맵 5-1). 보존정책은 `none` 동결이다.
 * "N일 뒤 삭제"도 "곧 됩니다"도 쓰지 않는다 — 지키지 못할 약속과 **하지 않을 약속**은
 * 똑같이 거짓말이고, 후자가 더 오래 간다. 보관은 **지금 상태를 그대로 보여주기만** 한다.
 * ------------------------------------------------------------------------- */
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  MessageSquareText,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import type { PrivacyOverview } from "@family/contracts";
import { DEFAULT_TIMEZONE } from "@family/shared";

import {
  BottomSheet,
  ErrorState,
  ListLoading,
  PageBackHeader,
} from "@/components/widgets";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import { fetchPrivacyOverview, privacyQueryKey } from "./privacy-api";

const yearMonthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEFAULT_TIMEZONE,
  year: "numeric",
  month: "numeric",
});

/** 보관을 시작한 달 — 올해면 `8월부터`, 아니면 `2025년 8월부터`(서울 기준). */
function sinceMonthLabel(iso: string, now: Date = new Date()): string {
  const part = (date: Date, type: "year" | "month") =>
    Number(
      yearMonthFormatter.formatToParts(date).find((p) => p.type === type)?.value
    );
  const then = new Date(iso);
  const month = part(then, "month");
  return part(then, "year") === part(now, "year")
    ? `${month}월부터`
    : `${part(then, "year")}년 ${month}월부터`;
}

/** 설정 목록 한 줄 — 전체 탭과 같은 모양(배경 없는 아이콘 24 · 제목 · 화살표). */
function SettingRow({
  icon: Icon,
  title,
  href,
}: Readonly<{
  icon: LucideIcon;
  title: ReactNode;
  href?: string;
}>) {
  const body = (
    <>
      <Icon
        className="text-muted-foreground size-6 shrink-0"
        strokeWidth={1.7}
        aria-hidden="true"
      />
      <span className="text-body min-w-0 flex-1">{title}</span>
      {href !== undefined ? (
        <ChevronRight
          className="text-muted-foreground/40 size-5 shrink-0"
          aria-hidden="true"
        />
      ) : null}
    </>
  );
  const className =
    "flex min-h-14 w-full items-center gap-4 px-5 py-3 text-left";
  return href !== undefined ? (
    <Link
      href={href}
      className={`${className} hover:bg-muted/60 active:bg-muted focus-visible:ring-ring transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset`}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export default function PrivacyPage() {
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();
  const [retentionOpen, setRetentionOpen] = useState(false);

  const overviewQuery = useQuery<PrivacyOverview>({
    queryKey: privacyQueryKey(householdId),
    enabled: householdId != null,
    queryFn: () =>
      authedFetch((token) =>
        fetchPrivacyOverview(token, householdId as string)
      ),
  });

  if (overviewQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <PageBackHeader title="개인정보" />
        <ListLoading rows={2} label="개인정보 설정을 불러오는 중이에요." />
      </div>
    );
  }

  const overview = overviewQuery.data;
  if (!overview) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <PageBackHeader title="개인정보" />
        <ErrorState
          align="start"
          message="개인정보 설정을 불러오지 못했어요"
          retrying={overviewQuery.isFetching}
          onRetry={() => void overviewQuery.refetch()}
        />
      </div>
    );
  }

  const { smsEventCount, oldestReceivedAt } = overview.retention;
  const deviceCount = overview.myActiveDeviceCount;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageBackHeader title="개인정보" />

      <section className="finance-panel panel-flush-top overflow-hidden py-1">
        <SettingRow
          icon={Smartphone}
          title={`문자 보내는 기기 ${deviceCount.toLocaleString("ko-KR")}대`}
          href="/devices"
        />
        <SettingRow
          icon={MessageSquareText}
          title={
            smsEventCount > 0 && oldestReceivedAt
              ? `카드 문자 ${smsEventCount.toLocaleString(
                  "ko-KR"
                )}건 보관 중 · ${sinceMonthLabel(oldestReceivedAt)}`
              : "보관 중인 카드 문자가 없어요"
          }
        />
        {/*
         * 지키지 못할 약속을 하지 않기 위한 문장이다. 없다는 사실은 여기 한 줄로, 그 이유는
         * '자세히' 시트에 둔다 — 이유 없는 부재는 게으름으로 읽히지만, 이유 있는 부재는 판단으로 읽힌다.
         */}
        <p className="text-caption text-muted-foreground px-5 pb-4">
          받은 문자는 자동으로 지워지지 않아요{" "}
          <button
            type="button"
            onClick={() => setRetentionOpen(true)}
            className="text-foreground -my-3 inline-flex min-h-11 items-center px-1 font-medium underline-offset-4 hover:underline"
          >
            자세히
          </button>
        </p>
      </section>

      <BottomSheet
        open={retentionOpen}
        onOpenChange={setRetentionOpen}
        title="보관 안내"
      >
        <div className="text-body text-muted-foreground flex max-h-[60dvh] flex-col gap-3 overflow-y-auto pb-2">
          <p>새 문자를 그만 받으려면 문자 연동에서 기기를 폐기하면 돼요.</p>
          <p>
            다만{" "}
            <strong className="text-foreground font-medium">
              이미 보관된 문자는 그대로 남아요.
            </strong>{" "}
            자동 삭제와 보관 기간 설정은 만들지 않기로 했어요.
          </p>
          <p>
            받은 문자는 금액이 틀렸을 때 다시 읽어 바로잡는 유일한 근거라서,
            지우면 과거 지출이 맞는지 확인할 방법이 함께 사라지거든요.
          </p>
          <p>지울 필요가 생기면 알려 주세요.</p>
        </div>
      </BottomSheet>
    </div>
  );
}
