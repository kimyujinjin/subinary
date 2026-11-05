"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 개인정보 (/more/privacy) — C-3 **1단계**
 *
 * 이 화면이 답하는 질문은 셋이다.
 *   1. 나는 무엇에, 언제 동의했나 (동의 상태 · 문구 전문과 이력은 시트)
 *   2. 내 데이터가 어디서 들어오나 (문자 보내는 기기 수 → `/devices`)
 *   3. 지금 무엇이 얼마나 보관돼 있나 (카드 문자 건수 · 시작한 달, 읽기 전용)
 * 그리고 하나를 실행한다 — **철회**(기기 즉시 해제). ⋯ 메뉴 + 확인 뒤에만 실행되고,
 * 되돌릴 수 있다(재동의).
 *
 * ⚠️ 이 화면은 **삭제를 약속하지 않는다.** 문자 purge 잡·보존기간 선택은 **만들지
 * 않기로 했다**(2026-08-18 사용자 결정, 로드맵 5-1). 보존정책은 `none` 동결이다.
 * "N일 뒤 삭제"도 "곧 됩니다"도 쓰지 않는다 — 지키지 못할 약속과 **하지 않을 약속**은
 * 똑같이 거짓말이고, 후자가 더 오래 간다. 보관은 **지금 상태를 그대로 보여주기만** 한다.
 * 다시 볼 조건은 외부 사용자 개방 · 법정 요구 · 저장량 임계뿐이다.
 *
 * 문구 전문은 **동의해야 할 때만**(처음 · 개정 · 철회 뒤) 동의 버튼 바로 위에 펼친다 —
 * 읽고 누를 수 있어야 한다. 이미 동의한 상태에서는 '동의 내용' 시트로 접는다(지우지 않는다).
 * 문구 버전 이름(v2 등)은 보여 주지 않는다 — 사용자에게 의미 있는 것은 "바뀌었다"는 사실뿐이다.
 * 동의 문구 본문은 버전으로 고정된 법적 문구라 화면에서 고쳐 쓰지 않는다.
 * ------------------------------------------------------------------------- */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronRight,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  CURRENT_HOUSEHOLD_CONSENT_VERSION,
  householdConsentDocuments,
  type HouseholdConsentRecord,
  type PrivacyOverview,
} from "@family/contracts";
import { DEFAULT_TIMEZONE } from "@family/shared";

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
  BottomSheet,
  ListLoading,
  OverflowMenu,
  PageBackHeader,
  StatusChip,
} from "@/components/widgets";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
import {
  fetchPrivacyOverview,
  grantPrivacyConsent,
  privacyQueryKey,
  revokePrivacyConsent,
} from "./privacy-api";

/** 확인 시트의 '닫기' — 채움 버튼 아래의 글자 버튼(§3.3). */
const SHEET_CLOSE_CLASS =
  "h-11 w-full bg-transparent text-muted-foreground hover:bg-muted dark:bg-transparent dark:hover:bg-muted";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const yearMonthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEFAULT_TIMEZONE,
  year: "numeric",
  month: "numeric",
});

/** 보관을 시작한 달 — 올해면 `8월부터`, 아니면 `2025년 8월부터`(서울 기준). */
function sinceMonthLabel(iso: string): string {
  const part = (date: Date, type: "year" | "month") =>
    Number(yearMonthFormatter.formatToParts(date).find((p) => p.type === type)?.value);
  const then = new Date(iso);
  const now = new Date();
  const month = part(then, "month");
  return part(then, "year") === part(now, "year")
    ? `${month}월부터`
    : `${part(then, "year")}년 ${month}월부터`;
}

/** 설정 목록 한 줄 — 전체 탭과 같은 모양(배경 없는 아이콘 24 · 제목 · 화살표). */
function SettingRow({
  icon: Icon,
  iconClassName,
  title,
  subtitle,
  href,
  onClick,
}: Readonly<{
  icon?: LucideIcon;
  iconClassName?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  onClick?: () => void;
}>) {
  const interactive = href !== undefined || onClick !== undefined;
  const body = (
    <>
      {Icon ? (
        <Icon
          className={iconClassName ?? "text-muted-foreground size-6 shrink-0"}
          strokeWidth={1.7}
          aria-hidden="true"
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body">{title}</span>
        {subtitle ? (
          <span className="text-caption text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      {interactive ? (
        <ChevronRight
          className="text-muted-foreground/40 size-5 shrink-0"
          aria-hidden="true"
        />
      ) : null}
    </>
  );
  const className =
    "flex min-h-14 w-full items-center gap-4 px-5 py-3 text-left" +
    (interactive
      ? " hover:bg-muted/60 active:bg-muted focus-visible:ring-ring transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset"
      : "");
  if (href !== undefined) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  if (onClick !== undefined) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

/** 동의 문구 전문. 무엇에 동의하는지 고쳐 쓰지 않고 그대로 보여 준다. */
function ConsentDocument({ version }: Readonly<{ version: string }>) {
  const consentDocument = householdConsentDocuments[version];
  if (!consentDocument) {
    // 코드에 문구가 없는 버전 — 지어내지 않고 사실대로 말한다.
    return (
      <p className="text-caption text-muted-foreground">
        이 동의 문구를 찾을 수 없어요 — 알려 주시면 확인할게요
      </p>
    );
  }
  return (
    <dl className="flex flex-col gap-3">
      {consentDocument.clauses.map((clause) => (
        <div key={clause.title} className="flex flex-col gap-0.5">
          <dt className="text-body font-medium">{clause.title}</dt>
          <dd className="text-caption text-muted-foreground">{clause.body}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 동의 이력 한 줄. 철회도 지워지지 않고 여기 남는다. */
function HistoryRow({
  record,
  currentVersion,
}: Readonly<{ record: HouseholdConsentRecord; currentVersion: string }>) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body font-medium">
          {record.status === "granted" ? "동의" : "철회"}
        </span>
        <span className="text-caption text-muted-foreground">
          {record.status === "granted"
            ? formatDateTime(record.consentedAt)
            : `${formatDateTime(record.consentedAt)} 동의 → ${
                record.revokedAt ? formatDateTime(record.revokedAt) : "-"
              } 철회`}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {record.version !== currentVersion ? (
          <StatusChip>이전 문구</StatusChip>
        ) : null}
        {record.status === "revoked" && record.revokedReason === "member_removed" ? (
          <StatusChip>가족에서 나감</StatusChip>
        ) : null}
      </span>
    </div>
  );
}

type Sheet = "document" | "history" | "retention" | null;

export default function PrivacyPage() {
  const { householdId } = useHousehold();
  const { authedFetch } = useAuth();
  const queryClient = useQueryClient();
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);

  const overviewQuery = useQuery<PrivacyOverview>({
    queryKey: privacyQueryKey(householdId),
    enabled: householdId != null,
    queryFn: () =>
      authedFetch((token) =>
        fetchPrivacyOverview(token, householdId as string),
      ),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: privacyQueryKey(householdId),
    });
    // 철회는 기기를 폐기한다 — 기기 목록 캐시도 함께 무효화해야 화면이 어긋나지 않는다.
    await queryClient.invalidateQueries({ queryKey: ["devices", householdId] });
  };

  const grant = useMutation({
    mutationFn: () =>
      authedFetch((token) =>
        grantPrivacyConsent(
          token,
          householdId as string,
          // 화면이 방금 보여준 문구의 버전을 그대로 보낸다. 서버가 현재 버전과 대조해
          // 캐시된 옛 화면의 동의를 409로 거절한다.
          CURRENT_HOUSEHOLD_CONSENT_VERSION,
        ),
      ),
    onSuccess: async () => {
      await invalidate();
      toast.success("동의를 기록했어요.");
    },
    onError: () =>
      toast.error("동의를 기록하지 못했어요. 잠시 후 다시 시도해 주세요."),
  });

  const revoke = useMutation({
    mutationFn: () =>
      authedFetch((token) =>
        revokePrivacyConsent(token, householdId as string),
      ),
    onSuccess: async (result) => {
      await invalidate();
      setConfirmingRevoke(false);
      toast.success(
        result.revokedDeviceCount > 0
          ? `동의를 철회하고 기기 ${result.revokedDeviceCount}대의 연결을 해제했어요.`
          : "동의를 철회했어요.",
      );
    },
    onError: () => {
      setConfirmingRevoke(false);
      toast.error("철회하지 못했어요. 잠시 후 다시 시도해 주세요.");
    },
  });

  if (overviewQuery.isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <PageBackHeader title="개인정보" />
        <ListLoading rows={3} label="개인정보 설정을 불러오는 중이에요." />
      </div>
    );
  }

  const overview = overviewQuery.data;
  if (!overview) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <PageBackHeader title="개인정보" />
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-body text-destructive">
            개인정보 설정을 불러오지 못했어요
          </p>
          <Button variant="weak" onClick={() => void overviewQuery.refetch()}>
            다시 불러오기
          </Button>
        </div>
      </div>
    );
  }

  const active = overview.activeConsent;
  // 처음 · 개정 · 철회 뒤 — 문구를 펼쳐 두고 동의 버튼을 보여 준다.
  const needsConsent = !active || overview.needsRenewal;
  const busy = grant.isPending || revoke.isPending;
  const { smsEventCount, oldestReceivedAt } = overview.retention;
  const deviceCount = overview.myActiveDeviceCount;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageBackHeader
        title="개인정보"
        action={
          active ? (
            <OverflowMenu
              className="-mr-2.5"
              actions={[
                {
                  label: "동의 철회하기",
                  destructive: true,
                  disabled: busy,
                  onSelect: () => setConfirmingRevoke(true),
                },
              ]}
            />
          ) : undefined
        }
      />

      {/* ---- 1. 동의 상태 ---- */}
      <section className="finance-panel overflow-hidden py-1">
        <SettingRow
          icon={active ? ShieldCheck : AlertTriangle}
          iconClassName={
            active
              ? "text-success-strong size-6 shrink-0"
              : "text-destructive size-6 shrink-0"
          }
          title={active ? "동의 중이에요" : "동의하지 않은 상태예요"}
          subtitle={
            active
              ? `${formatDate(active.consentedAt)}에 동의했어요`
              : "카드 문자 수집이 멈춰 있어요"
          }
        />

        {needsConsent ? (
          <div className="flex flex-col gap-4 px-5 pt-1 pb-4">
            <p className="text-body">
              {overview.needsRenewal
                ? "문구가 바뀌어 다시 동의가 필요하지만, 확인 전에도 수집은 계속돼요"
                : overview.history.length > 0
                  ? "다시 동의하면 기기를 등록해 카드 문자를 받을 수 있어요"
                  : "동의하면 기기를 등록해 카드 문자를 받을 수 있어요"}
            </p>
            <ConsentDocument version={overview.currentVersion} />
            <Button
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={() => grant.mutate()}
            >
              {grant.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> 기록하고 있어요…
                </>
              ) : active ? (
                "새 문구에 동의하기"
              ) : (
                "동의하기"
              )}
            </Button>
          </div>
        ) : (
          <SettingRow title="동의 내용" onClick={() => setSheet("document")} />
        )}

        {overview.history.length > 0 ? (
          <SettingRow title="동의 기록" onClick={() => setSheet("history")} />
        ) : null}
      </section>

      {/* ---- 2. 어디서 들어오고, 무엇이 남아 있나 ---- */}
      <section className="finance-panel overflow-hidden py-1">
        <SettingRow
          icon={Smartphone}
          title={`문자 보내는 기기 ${deviceCount.toLocaleString("ko-KR")}대`}
          href="/devices"
        />
        <SettingRow
          icon={MessageSquareText}
          title={
            smsEventCount > 0 && oldestReceivedAt
              ? `카드 문자 ${smsEventCount.toLocaleString("ko-KR")}건 보관 중 · ${sinceMonthLabel(oldestReceivedAt)}`
              : "보관 중인 카드 문자가 없어요"
          }
        />
        {/*
         * 지키지 못할 약속을 하지 않기 위한 문장이다. 예전엔 "삭제는 준비 중"이라고
         * 썼는데, 그건 **하지 않기로 결정한 일**을 곧 한다고 말하는 것이었다. 없다는
         * 사실은 여기 한 줄로, 그 이유는 '자세히' 시트에 둔다 — 이유 없는 부재는 게으름으로
         * 읽히지만, 이유 있는 부재는 판단으로 읽힌다.
         */}
        <p className="text-caption text-muted-foreground px-5 pb-4">
          동의를 철회해도 이미 보관된 문자는 지워지지 않아요{" "}
          <button
            type="button"
            onClick={() => setSheet("retention")}
            className="text-foreground -my-3 inline-flex min-h-11 items-center px-1 font-medium underline-offset-4 hover:underline"
          >
            자세히
          </button>
        </p>
      </section>

      <BottomSheet
        open={sheet === "document"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="동의 내용"
      >
        <div className="max-h-[60dvh] overflow-y-auto pb-2">
          <ConsentDocument version={overview.currentVersion} />
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === "history"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="동의 기록"
      >
        <div className="divide-border/60 max-h-[60dvh] divide-y overflow-y-auto">
          {overview.history.map((record) => (
            <HistoryRow
              key={record.id}
              record={record}
              currentVersion={overview.currentVersion}
            />
          ))}
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === "retention"}
        onOpenChange={(open) => !open && setSheet(null)}
        title="보관 안내"
      >
        <div className="text-body text-muted-foreground flex max-h-[60dvh] flex-col gap-3 overflow-y-auto pb-2">
          <p>동의를 철회하면 새 문자 수집은 바로 멈춰요.</p>
          <p>
            다만 <strong className="text-foreground font-medium">이미 보관된 문자는 그대로 남아요.</strong>{" "}
            자동 삭제와 보관 기간 설정은 만들지 않기로 했어요.
          </p>
          <p>
            받은 문자는 금액이 틀렸을 때 다시 읽어 바로잡는 유일한 근거라서, 지우면 과거
            지출이 맞는지 확인할 방법이 함께 사라지거든요.
          </p>
          <p>지울 필요가 생기면 알려 주세요.</p>
        </div>
      </BottomSheet>

      <AlertDialog
        open={confirmingRevoke}
        onOpenChange={(open) => {
          if (!revoke.isPending) setConfirmingRevoke(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>동의를 철회할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {deviceCount > 0
                ? `기기 ${deviceCount}대의 연결이 바로 끊기고 새 카드 문자 수집이 멈추지만, 이미 보관된 문자는 지워지지 않아요.`
                : "새 카드 문자 수집이 멈추지만, 이미 보관된 문자는 지워지지 않아요."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-col">
            <AlertDialogAction
              disabled={revoke.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 h-11 w-full"
              onClick={(event) => {
                // 다이얼로그가 스스로 닫히면 진행 표시를 보여줄 자리가 없다.
                event.preventDefault();
                revoke.mutate();
              }}
            >
              {revoke.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> 철회하고 있어요…
                </>
              ) : (
                "철회하기"
              )}
            </AlertDialogAction>
            <AlertDialogCancel
              disabled={revoke.isPending}
              className={SHEET_CLOSE_CLASS}
            >
              닫기
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
