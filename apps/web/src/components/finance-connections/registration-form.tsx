"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ConnectionCredentials { clientId: string; clientSecret: string }

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
    <form ref={formRef} onSubmit={(event) => { void submit(event); }} autoComplete="off" className="space-y-4 rounded-2xl border bg-card p-4" aria-label="토스증권 연결 등록">
      <div>
        <h2 className="font-semibold">토스증권 연결</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">지금 로그인한 계정에 연결돼요. 다른 가족은 본인 앱 계정으로 로그인해 연결해 주세요.</p>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">토스증권에서 발급한 키가 필요해요. 공유하거나 공개한 적 없는 키를 입력해 주세요.</p>
      <label className="block space-y-2 text-sm font-medium">
        <span>클라이언트 키</span>
        <Input ref={keyRef} type="password" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={512} required disabled={busy} className="min-h-11" />
      </label>
      <label className="block space-y-2 text-sm font-medium">
        <span>시크릿 키</span>
        <Input ref={secretRef} type="password" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} required disabled={busy} className="min-h-11" />
      </label>
      <fieldset disabled={busy} className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">연결하기 전에 확인해 주세요</legend>
        <Consent label="제 명의 토스증권 계좌예요." />
        <Consent label="조회에 필요한 API 키와 보유 주식 조회 내역을 모아 서버에 저장하는 데 동의해요. API 키는 암호화해 보관해요." />
        <Consent label="자산 또는 연결 화면을 열 때 보유 주식을 새로 조회하는 데 동의해요." />
      </fieldset>
      <p className="text-xs leading-relaxed text-muted-foreground">국내·미국 보유 주식을 조회해요. 은행 잔액은 포함하지 않아요. 앱을 닫아 둔 동안에는 자동 조회하지 않아요.</p>
      <p className="text-xs leading-relaxed text-muted-foreground">이전에 조회한 기록은 보관되며, 연결 해제 뒤 이 화면에 표시되지 않아요.</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} className="min-h-11 flex-1">{busy ? "연결 확인 중…" : "동의하고 연결"}</Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => { formRef.current?.reset(); onClose(); }}>닫기</Button>
      </div>
    </form>
  );
}

function Consent({ label }: { label: string }) {
  return <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg py-2 text-sm leading-relaxed">
    <input type="checkbox" required className="mt-1 size-4 shrink-0 accent-primary" />
    <span>{label}</span>
  </label>;
}
