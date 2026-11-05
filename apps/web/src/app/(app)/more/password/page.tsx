"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 비밀번호 변경 (/more/password)
 *
 * `POST /v1/auth/change-password`는 Phase 1부터 있었지만 화면이 없었다 —
 * `api-client`에 함수조차 없어서, 비밀번호를 잊거나 바꾸고 싶으면 DB를 직접 손대는
 * 수밖에 없었다(2인 사용에서 1명이 막히면 곧바로 장애다).
 *
 * 서버가 변경과 함께 **모든 세션을 폐기**하고 refresh 쿠키를 지운다. 그래서 성공 후엔
 * 로그아웃 상태로 만들고 로그인 화면으로 보낸다 — 그러지 않으면 다음 요청이 401로
 * 떨어져 사용자가 "바꿨는데 왜 튕기지"를 겪는다. 다른 기기도 함께 로그아웃된다는 것을
 * 미리 알린다.
 *
 * 지금 비밀번호가 틀리면 서버가 한국어 400을 돌려주고 세션은 그대로다 — 그 문구를
 * 지금 비밀번호 칸 아래에 보여 주고 화면에 머문다(로그아웃하지 않는다).
 * 오류는 해당 칸 아래에 둔다(`password-errors.ts`). 칸과 무관한 오류(네트워크·서버)만 버튼 위 한 줄이다.
 * 입력칸마다 보기/숨기기 버튼이 있다(PasswordInput) — 휴대폰에서 긴 비밀번호를 가린 채 두 번 맞추기 어렵다.
 * ------------------------------------------------------------------------- */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PageBackHeader } from "@/components/widgets";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { PasswordInput } from "@/components/widgets/password-input";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";

import {
  MIN_LENGTH,
  serverPasswordError,
  validatePasswordChange,
  type PasswordErrors,
} from "./password-errors";

/** 칸 아래 오류 한 줄. 입력칸의 aria-describedby가 이 id를 가리킨다. */
function FieldError({ id, message }: Readonly<{ id: string; message?: string }>) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-caption">
      {message}
    </p>
  );
}

/** 칸의 접근성 속성. 오류가 있으면 오류 줄을, 없으면 안내 줄(있을 때)을 가리킨다 — 둘은 같은 자리에 번갈아 뜬다. */
function invalidProps(errorId: string, message: string | undefined, hintId?: string) {
  return {
    "aria-invalid": message ? true : undefined,
    "aria-describedby": message ? errorId : hintId,
  };
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const { authedFetch, logout } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validatePasswordChange({
      current: currentPassword,
      next: newPassword,
      confirm,
    });
    setErrors(invalid);
    if (Object.keys(invalid).length > 0) return;

    setBusy(true);
    try {
      await authedFetch((token) =>
        api.auth.changePassword(token, { currentPassword, newPassword }),
      );
      toast.success("비밀번호를 바꿨어요. 다시 로그인해 주세요");
      // 서버가 이미 세션을 폐기했다. 클라이언트 상태도 비워야 401 루프가 안 생긴다.
      await logout();
      router.replace("/login");
    } catch (err) {
      setErrors(serverPasswordError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageBackHeader
        title="비밀번호 변경"
        subtitle="바꾸면 이 기기를 포함한 모든 기기에서 로그아웃돼요"
      />

      <Card>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="current-password">지금 비밀번호</Label>
              <PasswordInput
                id="current-password"
                name="current-password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                {...invalidProps("current-password-error", errors.current)}
              />
              <FieldError id="current-password-error" message={errors.current} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">새 비밀번호</Label>
              <PasswordInput
                id="new-password"
                name="new-password"
                autoComplete="new-password"
                minLength={MIN_LENGTH}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                {...invalidProps("new-password-error", errors.next, "new-password-hint")}
              />
              {errors.next ? (
                <FieldError id="new-password-error" message={errors.next} />
              ) : (
                <p id="new-password-hint" className="text-muted-foreground text-caption">
                  {MIN_LENGTH}자 이상으로 정해 주세요
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-password">새 비밀번호 확인</Label>
              <PasswordInput
                id="confirm-password"
                name="confirm-password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                {...invalidProps("confirm-password-error", errors.confirm)}
              />
              <FieldError id="confirm-password-error" message={errors.confirm} />
            </div>

            {errors.form ? (
              <InlineNotice tone="error">{errors.form}</InlineNotice>
            ) : null}

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
