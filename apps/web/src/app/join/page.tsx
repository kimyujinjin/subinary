"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 초대 수락 (/join?token=..., 오늘의집 톤)
 *
 * (app) 그룹 밖 최상위 라우트 → 인증은 필요하되 가족 소속은 불필요(신규 가입자도 수락).
 * - loading: 스피너 / unauthenticated: 로그인·가입 안내 / token 없음: 유효하지 않은 초대.
 * - offline: 세션 확인 실패 → 수락 화면을 그리면 authedFetch가 확실히 실패하므로
 *   연결 안내 + 재시도로 막는다.
 * - authenticated: 수락 → POST /household-invitations/:token/accept
 *   → refreshMemberships + 활성 가족 전환 → 대시보드.
 *   '지금 계정: 이름(이메일)' 한 줄과 '다른 계정으로 로그인하기'(로그아웃 → 로그인 → 이 화면, invite-links의
 *   returnTo 규칙)를 둔다 — 특정 이메일 앞 초대를 다른 계정으로 열면 계정을 바꿀 길이 없었다.
 *   수락 실패는 토스트가 아니라 화면 안 문장이다(`accept-failure.ts`). 수락·취소·만료(409·410)면
 *   '지금은 쓸 수 없는 초대' 화면으로 바꿔 수락 버튼을 없앤다.
 * 가족 가입 동의 절차는 2026-11-05에 없앴다(소유자 결정) — 체크박스 없이 수락한다.
 *
 * **어느 가족이 초대했는지 먼저 보여준다**(C-1). 정보는 비인증 미리보기
 * (GET /v1/household-invitations/:token)로 받는다.
 * 로그인 전에도 보이므로 로그인 화면으로 갈 때 `returnTo`를 실어 여정이 끊기지 않게 한다.
 *
 * 토큰은 쿼리 파라미터(?token=)에서 읽는다. 동적 세그먼트(/join/[token])는 정적
 * export(mobile 타깃)에서 generateStaticParams가 필요해 클라이언트 라우트로 부적합.
 * useSearchParams는 export에서 <Suspense> 경계를 요구하므로 default export에서 감싼다.
 * ------------------------------------------------------------------------- */
import { CheckCircle2, Clock, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import type { HouseholdRole, InvitationPreview } from "@family/contracts";

import { ConnectionError } from "@/components/connection-error";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  isInvitableRole,
} from "@/lib/household-roles";
import { useHouseholdStore } from "@/lib/store";

import { loginHrefFor } from "../(auth)/invite-links";
import {
  DEAD_INVITE_COPY,
  acceptFailure,
  type AcceptFailure,
} from "./accept-failure";

/**
 * 수락 시 부여될 역할과 설명 한 줄(무엇에 동의하는지가 이 한 줄에 걸린다).
 * 초대하는 쪽(가족 화면 초대 폼)과 같은 말을 쓰도록 `household-roles`에서 가져온다.
 * 초대로는 소유자를 줄 수 없어(contracts `invitableRoleSchema`) 소유자는 이름만 보인다.
 */
function roleLine(role: HouseholdRole): string {
  return isInvitableRole(role)
    ? `${ROLE_LABEL[role]} — ${ROLE_DESCRIPTION[role]}`
    : ROLE_LABEL[role];
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-background flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

/** 만료까지 남은 시간을 해요체 한 줄로. 이미 지났으면 만료 문구. */
function expiryLine(expiresAt: string): string {
  const remainMs = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(remainMs) || remainMs <= 0) return "이미 만료됐어요";
  const hours = Math.floor(remainMs / (60 * 60 * 1000));
  if (hours < 1) return "1시간 안에 만료돼요";
  if (hours < 24) return `약 ${hours}시간 뒤 만료돼요`;
  return `약 ${Math.floor(hours / 24)}일 뒤 만료돼요`;
}

/** 초대장 본문 — 가족·초대자·역할·만료. 동의 위에 항상 이게 먼저 온다. */
function InvitationCard({ preview }: { preview: InvitationPreview }) {
  return (
    <div className="bg-muted rounded-card flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-muted-foreground text-caption">초대한 가족</span>
        <span className="text-body font-semibold">
          {preview.householdName}
        </span>
      </div>
      {preview.inviterName ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-caption">초대한 사람</span>
          <span className="text-body font-medium">
            {preview.inviterName}님
          </span>
        </div>
      ) : null}
      {preview.role ? (
        <div className="text-muted-foreground text-caption flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{roleLine(preview.role)}</span>
        </div>
      ) : null}
      <div className="text-muted-foreground text-caption flex items-center gap-2">
        <Clock className="size-4 shrink-0" aria-hidden="true" />
        <span>{expiryLine(preview.expiresAt)}</span>
      </div>
      {preview.emailRestricted ? (
        <p className="text-muted-foreground text-caption">
          이 초대는 특정 이메일 앞으로 보냈어요. 초대받은 계정으로 로그인해야
          수락할 수 있어요.
        </p>
      ) : null}
    </div>
  );
}

function JoinInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const {
    status,
    authedFetch,
    refreshMemberships,
    user,
    retryBootstrap,
    logout,
  } = useAuth();
  const setSelectedId = useHouseholdStore((s) => s.setSelectedId);

  const [submitting, setSubmitting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [failure, setFailure] = useState<AcceptFailure | null>(null);

  // 미리보기는 비인증 경로라 세션 상태와 무관하게 곧바로 부른다 — 로그인 화면으로
  // 보내기 **전에** "어느 가족인지"를 보여줘야 사용자가 로그인할 이유를 안다.
  const previewQuery = useQuery({
    queryKey: ["invitation-preview", token],
    enabled: token !== "",
    retry: false,
    // 초대장 내용은 거의 바뀌지 않는다. 로그인 왕복 후 돌아와도 다시 안 부르게 둔다.
    staleTime: 5 * 60_000,
    queryFn: () => api.households.previewInvite(token),
  });
  const preview = previewQuery.data;

  async function onAccept() {
    setSubmitting(true);
    setFailure(null);
    try {
      const household = await authedFetch((t) =>
        api.households.acceptInvite(t, token, {}),
      );
      await refreshMemberships();
      setSelectedId(household.id);
      toast.success(`'${household.name}' 가족에 참여했어요.`);
      router.replace("/dashboard");
    } catch (err) {
      setFailure(acceptFailure(err));
      setSubmitting(false);
    }
  }

  /** 다른 계정으로 로그인 — 로그아웃한 뒤 로그인 화면으로 간다. 로그인하면 이 초대 화면으로 돌아온다. */
  async function switchAccount() {
    setSwitching(true);
    try {
      await logout();
    } finally {
      router.replace(loginHrefFor(token));
    }
  }

  if (status === "loading") {
    return (
      <Centered>
        <div className="text-muted-foreground text-body flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" /> 불러오고 있어요…
        </div>
      </Centered>
    );
  }

  if (status === "offline") {
    return <ConnectionError onRetry={retryBootstrap} />;
  }

  // 토큰 없이 진입(직접 URL/딥링크 파싱 실패) → 수락할 대상이 없다.
  // 서버가 404를 준 경우(존재하지 않는 토큰)도 사용자 입장에서는 같은 상황이다.
  const unknownInvite =
    token === "" ||
    failure?.kind === "unknown" ||
    (previewQuery.isError &&
      previewQuery.error instanceof ApiError &&
      previewQuery.error.status === 404);
  if (unknownInvite) {
    return (
      <Centered>
        <div className="flex flex-col gap-6 text-center">
          <h1 className="text-title tracking-tight">
            유효하지 않은 초대예요
          </h1>
          <p className="text-muted-foreground text-body">
            초대 링크가 올바르지 않아요. 초대한 가족에게 링크를 다시 받아 주세요.
          </p>
          <Button asChild size="lg" className="w-full">
            <Link href="/dashboard">홈으로 가기</Link>
          </Button>
        </div>
      </Centered>
    );
  }

  // 수락·취소·만료된 초대 — 서버가 가족 정보를 주지 않는다. 사유만 정확히 알린다.
  // 미리보기는 대기 중이었는데 수락하려니 이미 처리·만료됐으면(409·410) 같은 화면으로 바꾼다.
  const deadMessage =
    failure?.kind === "dead"
      ? failure.message
      : preview && preview.status !== "pending"
        ? DEAD_INVITE_COPY[preview.status]
        : null;
  if (deadMessage) {
    return (
      <Centered>
        <div className="flex flex-col gap-6 text-center">
          <h1 className="text-title tracking-tight">
            지금은 쓸 수 없는 초대예요
          </h1>
          <p className="text-muted-foreground text-body">
            {deadMessage}
          </p>
          <Button asChild size="lg" className="w-full">
            <Link href="/dashboard">홈으로 가기</Link>
          </Button>
        </div>
      </Centered>
    );
  }

  if (previewQuery.isLoading) {
    return (
      <Centered>
        <div className="text-muted-foreground text-body flex items-center justify-center gap-2">
          <Loader2 className="size-4 animate-spin" /> 초대를 확인하고 있어요…
        </div>
      </Centered>
    );
  }

  const invitationCard = preview ? <InvitationCard preview={preview} /> : null;

  if (status === "unauthenticated") {
    // 로그인 뒤 이 화면으로 정확히 되돌아오게 한다(loginHrefFor의 returnTo). 이전에는 로그인이 무조건
    // /dashboard로 가서, 기존 계정 사용자는 초대 링크를 다시 찾아 열어야 했다.
    return (
      <Centered>
        <div className="flex flex-col gap-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="bg-accent text-accent-foreground flex size-14 items-center justify-center rounded-full">
              <Sparkles className="size-6" />
            </span>
            <h1 className="text-title tracking-tight">
              {preview?.householdName
                ? `'${preview.householdName}' 가족이 초대했어요`
                : "가족 초대가 도착했어요"}
            </h1>
            <p className="text-muted-foreground text-body">
              계속하려면 로그인이 필요해요. 로그인하면 이 화면으로 다시 돌아와요.
            </p>
          </div>

          {invitationCard}

          <div className="flex flex-col gap-2">
            <Button asChild size="lg" className="w-full">
              <Link href={loginHrefFor(token)}>로그인하고 계속하기</Link>
            </Button>
            <Button asChild variant="ghost" size="lg" className="w-full">
              <Link href={`/register?invite=${encodeURIComponent(token)}`}>
                회원가입하기
              </Link>
            </Button>
          </div>
        </div>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="bg-accent text-accent-foreground flex size-14 items-center justify-center rounded-full">
            <Sparkles className="size-6" />
          </span>
          <h1 className="text-title tracking-tight">
            {user?.name
              ? `${user.name}님, 가족 초대가 도착했어요`
              : "가족 초대가 도착했어요"}
          </h1>
          <p className="text-muted-foreground text-body">
            초대를 수락하면 가족의 카드 지출과 예산을 함께 볼 수 있어요.
          </p>
        </div>

        {invitationCard}

        {user ? (
          <div className="flex flex-col items-start">
            <p className="text-body min-w-0 [overflow-wrap:anywhere]">
              <span className="text-muted-foreground">지금 계정: </span>
              {user.name}({user.email})
            </p>
            <Button
              type="button"
              variant="link"
              className="px-0"
              disabled={submitting || switching}
              onClick={() => void switchAccount()}
            >
              다른 계정으로 로그인하기
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          {failure?.kind === "account" || failure?.kind === "retry" ? (
            <InlineNotice tone="error">{failure.message}</InlineNotice>
          ) : null}
          <Button
            size="lg"
            className="w-full"
            onClick={onAccept}
            disabled={submitting || switching}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> 참여하고 있어요…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4" /> 초대 수락하기
              </>
            )}
          </Button>
          {/* 링크면 disabled가 먹지 않아 수락 중에도 눌렸다 — 버튼으로 둔다. */}
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="w-full"
            disabled={submitting || switching}
            onClick={() => router.replace("/dashboard")}
          >
            나중에 할게요
          </Button>
        </div>
      </div>
    </Centered>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <Centered>
          <div className="text-muted-foreground text-body flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" /> 불러오고 있어요…
          </div>
        </Centered>
      }
    >
      <JoinInner />
    </Suspense>
  );
}
