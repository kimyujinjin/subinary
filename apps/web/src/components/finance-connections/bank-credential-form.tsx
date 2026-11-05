"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAC_BANK_CREDENTIAL_CONSENT_TEXT, MAC_BANK_CREDENTIAL_CONSENT_VERSION, type MacBankCredentialState } from "@family/contracts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { useAuth } from "@/lib/auth-context";
import { macBankRunnerApi } from "@/lib/mac-bank-runner-client";

interface BankCredentialFormProps {
  householdId: string;
  runnerId: string;
  credentials: MacBankCredentialState | null;
  storageAvailable: boolean;
  disabled: boolean;
  onChanged: () => void;
  /** 저장에 성공하면 부른다 — 부모가 시트를 닫고 그 자리에 완료를 알린다. 없으면 폼 안에 완료를 보인다. */
  onSaved?: () => void;
}

const SAVE_FAILED = "저장 결과를 확인하지 못했어요. 보안을 위해 입력값을 지웠어요. 다시 입력해 주세요.";

/**
 * 평문을 브라우저 저장소에 쓰지 않고 제출 후 입력값을 즉시 지운다.
 *
 * 저장만 한다. 저장한 정보 지우기는 연결 화면의 ⋯ 메뉴가 맡는다(bank-start-panel) — 위험한 행동은 ⋯ 안에 두고,
 * 이 시트 위에 확인 창을 겹쳐 열지 않는다. 예전에는 저장해도 시트가 그대로였고 결과가 색 없는 한 줄이라
 * 저장됐는지 알기 어려웠다(2026-11-05 HIG 검수): 성공하면 부모가 시트를 닫고, 실패하면 시트에 남아 저장 버튼
 * 바로 위에 오류를 보인다. 비밀번호 칸에 '보기' 토글은 두지 않는다 — 글자로 보이는 동안 키보드가 단어로 배울 수 있다.
 */
export function BankCredentialForm({ householdId, runnerId, credentials, storageAvailable, disabled, onChanged, onSaved }: BankCredentialFormProps) {
  const { authedFetch } = useAuth();
  const form = useRef<HTMLFormElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"saved" | "failed" | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); form.current?.reset(); }; }, []);
  const stored = credentials?.stored === true && credentials.runnerId === runnerId;
  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (disabled || busy || submitting.current || !storageAvailable) return;
    const element = form.current;
    if (!element || !element.reportValidity()) return;
    submitting.current = true; setBusy(true); setResult(null);
    const request = new AbortController(); controller.current = request;
    let saved = false;
    try {
      const scope = { householdId, runnerId, expectedVersion: credentials?.version ?? null };
      const fields = new FormData(element);
      if (fields.get("consent") !== "on") throw new Error("consent_required");
      await authedFetch(token => macBankRunnerApi.saveCredentials(token, { ...scope,
        loginId: fields.get("loginId"), password: fields.get("password"), consentVersion: MAC_BANK_CREDENTIAL_CONSENT_VERSION }, request.signal));
      saved = mounted.current && !request.signal.aborted;
      if (saved && !onSaved) setResult("saved");
    } catch {
      if (mounted.current && !request.signal.aborted) setResult("failed");
    } finally {
      element.reset(); submitting.current = false;
      if (mounted.current && !request.signal.aborted) { setBusy(false); onChanged(); }
    }
    if (saved) onSaved?.();
  }
  return <section className="space-y-4" aria-label="신한은행 자동 로그인 설정">
    <p className="text-caption text-muted-foreground">{stored ? "암호화 저장됨 · 조회할 때 내 Mac이 자동으로 로그인해요." : "암호화해 저장하고, 조회할 때 내 Mac이 자동으로 로그인해요."}</p>
    {!storageAvailable ? <InlineNotice tone="error">암호화 저장을 사용할 수 없어요. 잠시 후 다시 시도해 주세요.</InlineNotice> : null}
    <form ref={form} method="post" autoComplete="off" onSubmit={event => { void save(event); }} className="space-y-4">
      <fieldset disabled={disabled || busy || !storageAvailable} className="space-y-4">
        {/* 흰 시트 위에서 보이는 기본 채움 칸(Input)을 그대로 쓴다 — 흰 배경·테두리로 덮으면 칸이 사라진다. */}
        <label className="text-body block space-y-1.5 font-medium"><span>이용자 ID</span>
          <Input name="loginId" type="text" required maxLength={100} autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
        <label className="text-body block space-y-1.5 font-medium"><span>비밀번호</span>
          <Input name="password" type="password" required maxLength={200} autoComplete="off" /></label>
        <div>
          <label className="text-body flex min-h-11 items-start gap-3"><Checkbox name="consent" required className="mt-0.5 size-5" />
            <span>로그인 정보 저장과 내 Mac 전달에 동의해요</span></label>
          <details className="text-caption text-muted-foreground pl-8">
            <summary className="min-h-11 cursor-pointer py-3">자세히</summary>
            <p className="pb-1">{MAC_BANK_CREDENTIAL_CONSENT_TEXT}</p>
          </details>
        </div>
        {/* 결과는 누른 버튼 바로 위 — 실패는 role="alert", 완료는 role="status"(InlineNotice). */}
        {result === "failed" ? <InlineNotice tone="error">{SAVE_FAILED}</InlineNotice> : null}
        {result === "saved" ? <InlineNotice tone="success">로그인 정보를 저장했어요.</InlineNotice> : null}
        <Button type="submit" size="lg" className="w-full">{busy ? "저장 중…" : "저장하기"}</Button>
      </fieldset>
    </form>
    {disabled ? <p className="text-caption text-muted-foreground">조회가 진행 중일 때는 바꿀 수 없어요.</p> : null}
  </section>;
}
