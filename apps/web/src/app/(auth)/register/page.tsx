"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 회원가입 (오늘의집 톤)
 * registerRequestSchema로 클라 검증 → useAuth().register → /dashboard(→ 온보딩).
 * 카드 없는 화이트 베이스 센터 컬럼: 글자 로고 '모아' + 큰 제목 + 필드 + 풀폭 CTA.
 * 확인 칸 대신 비밀번호 '보기' 토글로 오타를 막는다(PasswordInput).
 *
 * 운영은 초대받은 사람만 가입할 수 있다(P0-4). 웹은 서버 설정을 모르므로 폼은
 * 그대로 두고, 폼 위 한 줄로 초대 여부를 먼저 알린다(문구는 `../invite-links`).
 * 서버 거절은 칸 아래가 아니라 폼 위에 둔다 — 이메일 칸 아래에 붙이면 이메일이
 * 틀린 것처럼 읽힌다.
 * ------------------------------------------------------------------------- */
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { registerRequestSchema, type RegisterRequest } from "@family/contracts";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { PasswordInput } from "@/components/widgets/password-input";
import { ApiError, api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";

import { BrandWordmark } from "../brand-wordmark";
import { joinPathFor, loginHrefFor, registerNoticeFor } from "../invite-links";

/**
 * `useSearchParams`는 Suspense 경계가 필요하다(정적 export 포함). 초대 링크에서
 * 넘어온 `?invite=` 토큰을 그대로 가입 요청에 실어야 서버의 invite 가입 게이트를
 * 통과한다 — 초대받은 사람만 계정을 만들 수 있다.
 */
export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite") || null;
  const { register, status } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  // 초대 화면(/join)과 같은 키라 거기서 넘어오면 캐시를 그대로 쓴다. 비인증 공개 경로다.
  const previewQuery = useQuery({
    queryKey: ["invitation-preview", inviteToken],
    enabled: inviteToken !== null,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: () => api.households.previewInvite(inviteToken ?? ""),
  });
  const notice = registerNoticeFor(
    inviteToken,
    previewQuery.data,
    previewQuery.error instanceof ApiError && previewQuery.error.status === 404,
  );

  const form = useForm<RegisterRequest>({
    resolver: zodResolver(registerRequestSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);

  async function onSubmit(values: RegisterRequest) {
    try {
      await register({ ...values, ...(inviteToken ? { inviteToken } : {}) });
      // 초대로 들어왔으면 가입 직후 수락 화면으로 되돌려 보낸다(가구 참여까지 한 번에).
      router.replace(inviteToken ? joinPathFor(inviteToken) : "/dashboard");
    } catch (err) {
      setServerError(
        err instanceof ApiError
          ? err.message
          : "가입하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    }
  }

  return (
    <main className="bg-background flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-8">
        {/* 글자 로고 + 큰 제목 */}
        <div className="flex flex-col items-center gap-2 text-center">
          <BrandWordmark />
          <h1 className="text-title tracking-tight">
            가족 소비 관리,
            <br />
            오늘부터 시작해요
          </h1>
          <p className="text-muted-foreground text-body">
            계정 하나로 가족 모두의 지출을 한곳에 모아요.
          </p>
        </div>

        <Form {...form}>
          <form
            onSubmit={(event) => {
              // 다시 누르면 지난 서버 거절은 지운다(칸 검증에서 멈춰도 남지 않게).
              setServerError(null);
              void form.handleSubmit(onSubmit)(event);
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <InlineNotice>{notice}</InlineNotice>
            {serverError ? (
              <InlineNotice tone="error">{serverError}</InlineNotice>
            ) : null}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>이름</FormLabel>
                  <FormControl>
                    <Input autoComplete="name" placeholder="홍길동" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>이메일</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
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
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>8자 이상 입력해 주세요</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              size="lg"
              className="mt-2 w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> 가입하고 있어요…
                </>
              ) : (
                "가입하고 시작하기"
              )}
            </Button>
          </form>
        </Form>

        <p className="text-muted-foreground text-body flex flex-wrap items-center justify-center gap-x-1">
          이미 계정이 있나요?
          {/* 초대로 왔으면 로그인 뒤 수락 화면으로 돌아오게 토큰을 실어 보낸다. */}
          <Link
            href={loginHrefFor(inviteToken)}
            className="text-accent-foreground inline-flex min-h-11 items-center px-1 font-medium hover:underline active:opacity-60"
          >
            로그인하기
          </Link>
        </p>
      </div>
    </main>
  );
}
