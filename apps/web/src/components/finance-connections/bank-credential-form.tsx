"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAC_BANK_CREDENTIAL_CONSENT_TEXT, MAC_BANK_CREDENTIAL_CONSENT_VERSION, type MacBankCredentialState } from "@family/contracts";
import { Button } from "@/components/ui/button";
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
  const form = useRef<HTMLFormElement>(null), controller = useRef<AbortController | null>(null);
  const mounted = useRef(false), submitting = useRef(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null);
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
      if (mounted.current && !request.signal.aborted) setNotice(action === "save" ? "로그인 정보를 암호화해 저장했어요. 조회 시작을 누르면 Mac이 자동 로그인해요." : "저장한 로그인 정보를 삭제했어요.");
    } catch {
      if (mounted.current && !request.signal.aborted) setNotice("설정 결과를 확인하지 못했어요. 연결 상태를 다시 확인한 뒤 로그인 정보를 다시 입력해 주세요.");
    } finally {
      element.reset(); submitting.current = false;
      if (mounted.current && !request.signal.aborted) { setBusy(false); onChanged(); }
    }
  }
  return <section className="space-y-3 rounded-xl border p-4" aria-label="신한은행 자동 로그인 설정">
    <h3 className="font-semibold">신한은행 로그인 정보</h3>
    <p className="text-sm">{stored ? "암호화 저장됨 · 연결한 Mac에서 자동 로그인에 사용해요." : "아이디와 비밀번호를 설정하면 Mac이 자동으로 로그인해요."}</p>
    {!storageAvailable ? <p role="alert" className="text-sm">암호화 저장을 사용할 수 없어요. 연결 상태를 확인해 주세요.</p> : null}
    <form ref={form} method="post" autoComplete="off" onSubmit={event => { void change("save", event); }} className="space-y-3">
      <fieldset disabled={disabled || busy || !storageAvailable} className="space-y-3">
        <label className="block space-y-1 text-sm"><span>신한은행 이용자 ID</span>
          <input name="loginId" type="text" required maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false}
            className="min-h-11 w-full rounded-lg border bg-background px-3" /></label>
        <label className="block space-y-1 text-sm"><span>신한은행 비밀번호</span>
          <input name="password" type="password" required maxLength={200} autoComplete="off"
            className="min-h-11 w-full rounded-lg border bg-background px-3" /></label>
        <label className="flex items-start gap-2 text-xs leading-relaxed"><input name="consent" type="checkbox" required className="mt-1" />
          <span>{MAC_BANK_CREDENTIAL_CONSENT_TEXT}</span></label>
        <Button type="submit" className="min-h-11 w-full">{busy ? "설정 중…" : stored ? "로그인 정보 변경" : "로그인 정보 저장"}</Button>
      </fieldset>
    </form>
    {disabled ? <p className="text-xs text-muted-foreground">조회가 진행 중일 때는 로그인 정보를 변경할 수 없어요.</p> : null}
    {stored ? <Button type="button" variant="ghost" disabled={disabled || busy || !storageAvailable} onClick={() => { void change("delete"); }}>로그인 정보 삭제</Button> : null}
    {notice ? <p role="alert" className="text-sm">{notice}</p> : null}
  </section>;
}
