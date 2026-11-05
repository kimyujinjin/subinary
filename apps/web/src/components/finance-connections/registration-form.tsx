"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/widgets/inline-notice";

export interface ConnectionCredentials { clientId: string; clientSecret: string }

/**
 * 토스증권 키 등록 폼. 두 키는 비제어 입력이라 React 상태·쿼리 캐시에 들어가지 않는다(값 처리는 그대로 둔다).
 * 키를 어디서 받는지 한 줄로 알린다 — 예전에는 받는 곳을 말하지 않아 폼 앞에서 막혔다(2026-11-05 HIG 검수).
 */

export function ConnectionRegistrationForm({ busy, onSubmit, onClose }: {
  busy: boolean;
  onSubmit: (credentials: ConnectionCredentials) => Promise<void>;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);
  const claimed = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const form = formRef.current;
    return () => { form?.reset(); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (claimed.current || busy) return;
    const clientId = keyRef.current?.value ?? "";
    const clientSecret = secretRef.current?.value ?? "";
    if (!/^\S{1,512}$/.test(clientId) || !/^\S{1,2048}$/.test(clientSecret)) {
      setError("클라이언트 키와 시크릿 키를 공백 없이 입력해 주세요.");
      return;
    }
    if (!event.currentTarget.checkValidity()) return;
    claimed.current = true;
    setError(null);
    // Uncontrolled password inputs never enter React state/query cache. Clear before awaiting.
    const credentials = { clientId, clientSecret };
    event.currentTarget.reset();
    try { await onSubmit(credentials); }
    finally {
      credentials.clientId = "";
      credentials.clientSecret = "";
      claimed.current = false;
    }
  }

  return (
    <form ref={formRef} onSubmit={(event) => { void submit(event); }} autoComplete="off" className="finance-panel min-w-0 space-y-4 p-5" aria-label="토스증권 연결 등록">
      <div>
        <h2 className="text-heading">토스증권 연결</h2>
        <p className="text-caption text-muted-foreground mt-1">내 모아 계정에 연결해요. 가족 계좌는 그 가족이 자기 계정에서 연결해요.</p>
      </div>
      <ol className="text-caption flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="연결 순서">
        {(["키 등록", "계좌 선택", "조회"] as const).map((step, index) => <li key={step} aria-current={index === 0 ? "step" : undefined} className={`inline-flex items-center gap-1 ${index === 0 ? "font-semibold text-primary" : "text-muted-foreground"}`}>
          <span aria-hidden="true">{index + 1}.</span>{step}
          {index < 2 ? <span aria-hidden="true" className="ml-2 text-muted-foreground">›</span> : null}
        </li>)}
      </ol>
      <div className="space-y-3">
        <p className="text-caption text-muted-foreground">두 키는 토스증권 개발자 센터(developers.tossinvest.com)에서 발급받아요.</p>
        <label className="text-body block space-y-1.5 font-medium">
        <span>클라이언트 키</span>
        <Input ref={keyRef} type="password" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={512} required />
      </label>
      <label className="text-body block space-y-1.5 font-medium">
        <span>시크릿 키</span>
        <Input ref={secretRef} type="password" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} required />
      </label>
      </div>
      {/* 다시 읽는 동안(busy)에도 입력칸은 막지 않는다 — 막으면 포커스가 빠져 키보드가 내려간다. 제출만 막는다. */}
      <fieldset>
        <legend className="text-caption text-muted-foreground pb-1 font-medium">필수 동의</legend>
        <Consent label="제 명의 토스증권 계좌예요." />
        <Consent label="조회에 필요한 두 키와 보유 주식 조회 내역을 모아 서버에 저장하는 데 동의해요. 키는 암호화해 보관해요." />
        <Consent label="자산 또는 연결 화면을 열 때 보유 주식을 새로 조회하는 데 동의해요." />
      </fieldset>
      <details className="text-caption text-muted-foreground">
        <summary className="min-h-11 cursor-pointer py-3">조회 범위와 기록 보관</summary>
        <p className="pb-3">국내·미국 보유 주식을 조회해요. 은행 잔액은 포함하지 않아요. 앱을 닫아 둔 동안에는 자동 조회하지 않아요.</p>
        <p>이전에 조회한 기록은 보관되며, 연결 해제 뒤 이 화면에 표시되지 않아요.</p>
      </details>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={busy} className="flex-1">{busy ? "연결 확인 중…" : "동의하고 연결하기"}</Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => { formRef.current?.reset(); onClose(); }}>닫기</Button>
      </div>
    </form>
  );
}

function Consent({ label }: { label: string }) {
  return <label className="text-body flex min-h-11 cursor-pointer items-start gap-3 py-2">
    <Checkbox required className="mt-0.5 size-5" />
    <span>{label}</span>
  </label>;
}
