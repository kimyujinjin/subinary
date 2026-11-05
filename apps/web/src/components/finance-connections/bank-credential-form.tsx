"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAC_BANK_CREDENTIAL_CONSENT_TEXT, MAC_BANK_CREDENTIAL_CONSENT_VERSION, type MacBankCredentialState } from "@family/contracts";
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
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { macBankRunnerApi } from "@/lib/mac-bank-runner-client";

interface BankCredentialFormProps {
  householdId: string;
  runnerId: string;
  credentials: MacBankCredentialState | null;
  storageAvailable: boolean;
  disabled: boolean;
  onChanged: () => void;
}

/** 평문을 브라우저 저장소에 쓰지 않고 제출 후 입력값을 즉시 지운다. */
export function BankCredentialForm({ householdId, runnerId, credentials, storageAvailable, disabled, onChanged }: BankCredentialFormProps) {
  const { authedFetch } = useAuth();
  const form = useRef<HTMLFormElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 지우면 Mac이 자동 로그인을 못 해 조회가 멈춘다 — 한 번 더 묻는다(리뉴얼 §3.3 위험 행동).
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); form.current?.reset(); }; }, []);
  const stored = credentials?.stored === true && credentials.runnerId === runnerId;
  async function change(action: "save" | "delete", event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    if (disabled || busy || submitting.current || !storageAvailable) return;
    const element = form.current;
    if (!element || (action === "save" && !element.reportValidity())) return;
    submitting.current = true; setBusy(true); setNotice(null);
    const request = new AbortController(); controller.current = request;
    try {
      const scope = { householdId, runnerId, expectedVersion: credentials?.version ?? null };
      if (action === "save") {
        const fields = new FormData(element);
        if (fields.get("consent") !== "on") throw new Error("consent_required");
        await authedFetch(token => macBankRunnerApi.saveCredentials(token, { ...scope,
          loginId: fields.get("loginId"), password: fields.get("password"), consentVersion: MAC_BANK_CREDENTIAL_CONSENT_VERSION }, request.signal));
      } else await authedFetch(token => macBankRunnerApi.deleteCredentials(token, scope, request.signal));
      if (mounted.current && !request.signal.aborted) setNotice(action === "save" ? "로그인 정보를 저장했어요." : "저장한 로그인 정보를 삭제했어요.");
    } catch {
      if (mounted.current && !request.signal.aborted) setNotice("저장 결과를 확인하지 못했어요. 로그인 정보를 다시 입력해 주세요.");
    } finally {
      element.reset(); submitting.current = false;
      if (mounted.current && !request.signal.aborted) { setBusy(false); onChanged(); }
    }
  }
  return <section className="space-y-4" aria-label="신한은행 자동 로그인 설정">
    <p className="text-caption text-muted-foreground">{stored ? "암호화 저장됨 · 조회할 때 내 Mac이 자동으로 로그인해요." : "암호화해 저장하고, 조회할 때 내 Mac이 자동으로 로그인해요."}</p>
    {!storageAvailable ? <p role="alert" className="text-caption text-destructive">암호화 저장을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.</p> : null}
    <form ref={form} method="post" autoComplete="off" onSubmit={event => { void change("save", event); }} className="space-y-4">
      <fieldset disabled={disabled || busy || !storageAvailable} className="space-y-4">
        {/* 흰 시트 위에서 보이는 기본 채움 칸(Input)을 그대로 쓴다 — 흰 배경·테두리로 덮으면 칸이 사라진다. */}
        <label className="text-caption block space-y-1.5 font-medium"><span>이용자 ID</span>
          <Input name="loginId" type="text" required maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
        <label className="text-caption block space-y-1.5 font-medium"><span>비밀번호</span>
          <Input name="password" type="password" required maxLength={200} autoComplete="off" /></label>
        <div>
          <label className="text-body flex min-h-11 items-start gap-3"><input name="consent" type="checkbox" required className="accent-primary mt-0.5 size-5 shrink-0" />
            <span>로그인 정보 저장과 내 Mac 전달에 동의해요</span></label>
          <details className="text-caption text-muted-foreground pl-8">
            <summary className="min-h-9 cursor-pointer py-2">자세히</summary>
            <p className="pb-1">{MAC_BANK_CREDENTIAL_CONSENT_TEXT}</p>
          </details>
        </div>
        <Button type="submit" size="lg" className="w-full">{busy ? "저장 중…" : stored ? "로그인 정보 변경" : "로그인 정보 저장"}</Button>
      </fieldset>
    </form>
    {disabled ? <p className="text-caption text-muted-foreground">조회가 진행 중일 때는 바꿀 수 없어요.</p> : null}
    {stored ? <Button type="button" variant="ghost" className="text-destructive w-full" disabled={disabled || busy || !storageAvailable} onClick={() => setConfirmDelete(true)}>로그인 정보 삭제</Button> : null}
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>저장한 로그인 정보를 지울까요?</AlertDialogTitle>
          <AlertDialogDescription>지우면 다시 저장할 때까지 신한은행을 조회할 수 없어요.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>닫기</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { void change("delete"); }}>지우기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    {notice ? <p role="alert" className="text-caption">{notice}</p> : null}
  </section>;
}
