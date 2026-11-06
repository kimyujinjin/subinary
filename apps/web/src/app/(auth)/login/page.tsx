"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 로그인 (오늘의집 톤)
 * loginRequestSchema로 클라 검증 → useAuth().login → `returnTo`(기본 /dashboard).
 * 카드 없는 화이트 베이스 센터 컬럼: 글자 로고 '모아'(앱 안 헤더와 같은 모양) + 제목 + 필드 + 풀폭 CTA.
 * 제목은 처음 온 사람에게도 맞는 '로그인'이다(예전 '다시 만나서 반가워요'는 재방문자에게만 맞았다).
 *
 * 오류 자리: 이메일·비밀번호가 틀린 경우(401)만 비밀번호 칸 아래에 둔다. 요청 과다(429)·서버·네트워크
 * 오류는 비밀번호와 무관하므로 폼 위 한 줄로 알린다(`login-failure.ts`).
 *
 * 비밀번호 분실: 메일 발송 기능이 없어 스스로 되찾는 길이 없다(API에 재설정 경로 없음). 비밀번호 칸 아래
 * '비밀번호를 잊었어요'가 안내 시트를 열어 앱을 관리하는 가족에게 임시 비밀번호를 받으라고 알린다. 운영자는
 * `scripts/ops/reset-password.sh <이메일>`로 임시 비밀번호를 만든다(2026-11-06 결정 4).
 *
 * `?returnTo=`는 초대 링크가 로그인에서 끊기지 않게 한다(C-1). 회원가입은 이미
 * invite를 보존했는데 **기존 계정 로그인만** 무조건 /dashboard로 가서, 초대받은
 * 사람이 수락 화면으로 돌아오지 못했다. 값은 공격자가 심을 수 있는 입력이므로
 * `safeInternalPath`로 앱 내부 경로만 통과시킨다(오픈 리다이렉트 차단).
 *
 * 네이티브 전용 흐름 2가지(웹에서는 둘 다 비활성):
 *  - 생체인식 재시도: 잠금이 켜진 채 부트스트랩 게이트를 취소/실패해 여기로
 *    왔을 때, 비밀번호 없이 다시 시도하는 보조 버튼.
 *  - 옵트인 제안: 비밀번호 로그인 직후 아직 묻지 않은 기기에서 1회 제안.
 *    선택지 둘의 안내라 바텀 시트로 띄우고(sheet-layout.ts), 떠 있는 동안은 대시보드 리다이렉트를 보류한다.
 *  생체 인식 이름은 기기별로 부른다(안드로이드 '지문·얼굴 인식', 아이폰 'Face ID' — `biometric-copy.ts`).
 * ------------------------------------------------------------------------- */
import { zodResolver } from "@hookform/resolvers/zod";
import { Fingerprint, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { loginRequestSchema, type LoginRequest } from "@family/contracts";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { BottomSheet } from "@/components/widgets/bottom-sheet";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { PasswordInput } from "@/components/widgets/password-input";
import { useAuth } from "@/lib/auth-context";
import {
  authenticateBiometric,
  getBiometricPref,
  isBiometryAvailable,
  setBiometricPref,
} from "@/lib/biometric";
import { getStoredRefreshToken, isNative } from "@/lib/native";
import { safeInternalPath } from "@/lib/safe-redirect";

import { BrandWordmark } from "../brand-wordmark";
import { inviteTokenFromReturnTo, registerHrefFor } from "../invite-links";
import { currentBiometricCopy } from "./biometric-copy";
import { loginFailure } from "./login-failure";

/** `useSearchParams`는 Suspense 경계를 요구한다(정적 export 포함). */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 검증 실패(외부 URL·스킴·프로토콜 상대)는 조용히 홈으로 되돌린다 — 사용자에게
  // 알릴 것이 없고, 알리면 어떤 값이 통과하는지 알려 주는 셈이다.
  const returnTo =
    safeInternalPath(searchParams.get("returnTo")) ?? "/dashboard";
  // 가입은 초대받은 사람만 된다(P0-4). 초대 수락으로 돌아가는 길이 아니면 가입
  // 링크를 숨긴다 — 초대 없이 열면 다 입력한 뒤에야 서버가 거절한다.
  const registerHref = registerHrefFor(inviteTokenFromReturnTo(returnTo));
  const { login, status, biometricLogin } = useAuth();
  // 비밀번호와 무관한 실패(요청 과다·서버·네트워크)는 칸 아래가 아니라 폼 위에 둔다.
  const [formError, setFormError] = useState<string | null>(null);
  const bio = currentBiometricCopy();

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: "", password: "" },
  });

  // 생체인식 재시도 버튼 노출 여부(네이티브 && 잠금 on && 저장 세션 존재).
  const [bioRetry, setBioRetry] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [optInOpen, setOptInOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const optInEligible = useRef(false);
  // 옵트인 흐름 동안 status 기반 리다이렉트 보류. login()이 status를 바꾸기
  // 전에 동기적으로 세워야 레이스가 없으므로 state가 아닌 ref를 쓴다.
  const holdRedirect = useRef(false);

  useEffect(() => {
    if (!isNative()) return;
    void (async () => {
      const [pref, available, stored] = await Promise.all([
        getBiometricPref(),
        isBiometryAvailable(),
        getStoredRefreshToken(),
      ]);
      setBioRetry(pref === "on" && available && stored !== null);
      // 아직 묻지 않은 기기 + 생체인식 가능 → 로그인 성공 직후 1회 제안.
      optInEligible.current = pref === null && available;
    })();
  }, []);

  useEffect(() => {
    if (status === "authenticated" && !holdRedirect.current) {
      router.replace(returnTo);
    }
  }, [status, router, returnTo]);

  async function onSubmit(values: LoginRequest) {
    // 옵트인 대상이면 login()이 status를 authenticated로 바꾸기 전에 리다이렉트
    // 보류를 동기적으로 세운다. 다이얼로그는 로그인 "성공 후"에만 연다 —
    // 실패/진행 중 노출되면 미인증 상태로 설정이 영구 기록될 수 있다.
    if (optInEligible.current) holdRedirect.current = true;
    try {
      await login(values);
      if (optInEligible.current) {
        setOptInOpen(true);
      } else {
        router.replace(returnTo);
      }
    } catch (err) {
      holdRedirect.current = false;
      const failure = loginFailure(err);
      if (failure.field) form.setError("password", { message: failure.message });
      else setFormError(failure.message);
    }
  }

  /** 옵트인 응답 처리 — 어느 쪽이든 다이얼로그를 닫고 복귀 경로로 보낸다. */
  async function answerOptIn(enable: boolean) {
    if (enable) {
      const gate = await authenticateBiometric(
        "생체인식 잠금을 켜려면 본인 확인이 필요해요",
      );
      if (gate === "ok") {
        await setBiometricPref("on");
        toast.success("생체인식 잠금을 켰어요.");
      } else if (gate === "unsupported") {
        toast.error("이 기기에서는 생체인식을 사용할 수 없어요.");
        await setBiometricPref("off");
      } else {
        // 취소/실패 — 설정을 남기지 않아 다음 로그인 때 다시 제안한다.
        toast.error("생체인식을 확인하지 못했어요. 전체 탭에서 다시 켤 수 있어요.");
      }
    } else {
      await setBiometricPref("off");
    }
    setOptInOpen(false);
    holdRedirect.current = false;
    router.replace(returnTo);
  }

  async function onBiometricRetry() {
    setBioBusy(true);
    try {
      const result = await biometricLogin();
      if (result === "failed") {
        toast.error("본인 확인에 실패했어요. 비밀번호로 로그인해 주세요.");
      }
      // "ok"는 status 변화로 자동 리다이렉트, "cancelled"는 그대로 머무름.
    } catch {
      // 게이트는 통과했지만 세션이 만료된 경우.
      setBioRetry(false);
      toast.error("세션이 만료됐어요. 비밀번호로 다시 로그인해 주세요.");
    } finally {
      setBioBusy(false);
    }
  }

  return (
    <main className="bg-background flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-8">
        {/* 글자 로고 + 제목 */}
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandWordmark />
          <h1 className="text-title tracking-tight">로그인</h1>
          <p className="text-muted-foreground text-body">
            가족의 소비와 예산을 함께 관리해요.
          </p>
        </div>

        <Form {...form}>
          <form
            onSubmit={(event) => {
              // 다시 누르면 지난 실패 문구는 지운다(칸 검증에서 멈춰도 남지 않게).
              setFormError(null);
              void form.handleSubmit(onSubmit)(event);
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            {formError ? (
              <InlineNotice tone="error">{formError}</InlineNotice>
            ) : null}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>이메일</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="username"
                      placeholder="이메일 주소"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>비밀번호</FormLabel>
                  <FormControl>
                    <PasswordInput
                      autoComplete="current-password"
                      placeholder="비밀번호를 입력해 주세요"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="-mt-3 flex justify-end">
              <button
                type="button"
                aria-haspopup="dialog"
                className="text-muted-foreground text-caption inline-flex min-h-11 items-center px-1 font-medium hover:underline active:opacity-60"
                onClick={() => setForgotOpen(true)}
              >
                비밀번호를 잊었어요
              </button>
            </div>
            <Button
              type="submit"
              size="lg"
              className="mt-2 w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> 로그인하고 있어요…
                </>
              ) : (
                "로그인하기"
              )}
            </Button>
          </form>
        </Form>

        {bioRetry && (
          <Button
            type="button"
            variant="weak"
            size="lg"
            className="w-full"
            disabled={bioBusy}
            onClick={onBiometricRetry}
          >
            {bioBusy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> 확인하고 있어요…
              </>
            ) : (
              <>
                <Fingerprint className="size-4" /> {bio.by} 로그인
              </>
            )}
          </Button>
        )}

        {registerHref ? (
          <p className="text-muted-foreground text-body flex flex-wrap items-center justify-center gap-x-1">
            아직 계정이 없나요?
            <Link
              href={registerHref}
              className="text-accent-foreground inline-flex min-h-11 items-center px-1 font-medium hover:underline active:opacity-60"
            >
              회원가입하기
            </Link>
          </p>
        ) : (
          <p className="text-muted-foreground text-caption text-center">
            가입은 가족 초대 링크로 해요
          </p>
        )}
      </div>

      {/* 로그인 직후 1회 생체 인식 제안(네이티브 전용). 선택지 둘의 안내라 입력 폼 창이 아니라 시트다. */}
      <BottomSheet
        open={optInOpen}
        onOpenChange={(open) => {
          // 바깥 탭·닫기로 닫으면 '사용하지 않기'와 달리 설정을 남기지 않아
          // 다음 로그인 때 다시 제안한다.
          if (!open) {
            setOptInOpen(false);
            holdRedirect.current = false;
            router.replace(returnTo);
          }
        }}
        title={`${bio.by} 잠금을 풀까요?`}
      >
        <p className="text-body text-muted-foreground pb-4">
          앱을 열 때 {bio.by} 본인을 확인한 뒤 자동으로 로그인해요. 전체 탭의
          ‘생체인식 잠금’에서 언제든 바꿀 수 있어요.
        </p>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => void answerOptIn(true)}
          >
            <Fingerprint className="size-4" /> {bio.name} 사용하기
          </Button>
          <Button
            type="button"
            variant="weak"
            size="lg"
            className="w-full"
            onClick={() => void answerOptIn(false)}
          >
            사용하지 않기
          </Button>
        </div>
      </BottomSheet>

      {/* 비밀번호 분실 안내. 고를 것이 없는 안내라 시트이고, 버튼은 위젯이 다는 '닫기' 하나다. */}
      <BottomSheet
        open={forgotOpen}
        onOpenChange={setForgotOpen}
        title="비밀번호를 잊었나요?"
      >
        <div className="text-body text-muted-foreground flex flex-col gap-2 pb-3">
          <p>모아는 아직 메일로 비밀번호를 다시 설정할 수 없어요.</p>
          <p>
            이 앱을 관리하는 가족에게 임시 비밀번호를 받아 로그인한 뒤,{" "}
            <span className="text-foreground font-medium">
              전체 › 비밀번호 변경
            </span>
            에서 새 비밀번호로 바꿔 주세요.
          </p>
        </div>
      </BottomSheet>
    </main>
  );
}
