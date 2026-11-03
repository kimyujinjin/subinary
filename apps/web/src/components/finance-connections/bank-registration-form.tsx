"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BANK_CONNECTION_CONSENT_VERSION, bankConnectionConsentDocuments, type BankSelector } from "@family/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface BankRegistrationInput { loginId: string; password: string; selector: BankSelector; consentVersion: typeof BANK_CONNECTION_CONSENT_VERSION }
export function BankRegistrationForm({ busy, onSubmit, onClose }: {
  busy: boolean; onSubmit: (input: BankRegistrationInput) => Promise<void>; onClose: () => void;
}) {
  const form = useRef<HTMLFormElement>(null), login = useRef<HTMLInputElement>(null), password = useRef<HTMLInputElement>(null);
  const last4 = useRef<HTMLInputElement>(null), type = useRef<HTMLSelectElement>(null), claimed = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const node = form.current; return () => node?.reset(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || claimed.current || !event.currentTarget.checkValidity()) return;
    const input: BankRegistrationInput = { loginId: login.current?.value ?? "", password: password.current?.value ?? "",
      consentVersion: BANK_CONNECTION_CONSENT_VERSION,
      selector: type.current?.value === "deposit" ? { accountLast4: last4.current?.value ?? "", accountType: "deposit" }
        : { accountLast4: last4.current?.value ?? "", loanType: type.current?.value === "jeonse" ? "jeonse" : "interim" } };
    if (!input.loginId.length || input.loginId.length > 64 || /[^A-Za-z0-9._-]/u.test(input.loginId)
      || !input.password.length || input.password.length > 64 || /[^\x21-\x7e]/u.test(input.password)
      || !/^[0-9]{4}$/.test(input.selector.accountLast4) || !type.current?.value) {
      setError("로그인 정보와 가져올 계좌를 확인해 주세요."); return;
    }
    claimed.current = true; setError(null); event.currentTarget.reset();
    try { await onSubmit(input); }
    finally { input.loginId = ""; input.password = ""; claimed.current = false; }
  }
  return <form ref={form} aria-label="신한은행 자동조회 등록" autoComplete="off" onSubmit={event => { void submit(event); }} className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
    <h2 className="font-semibold">신한은행 연결</h2>
    <p className="text-muted-foreground text-sm leading-relaxed">내 통장 잔액이나 전세·중도금 대출을 연결해요. 신한 인터넷뱅킹에 쓰는 아이디와 비밀번호를 입력해 주세요.</p>
    <label className="block space-y-2 text-sm font-medium"><span>아이디</span><Input ref={login} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={64} required disabled={busy} /></label>
    <label className="block space-y-2 text-sm font-medium"><span>비밀번호</span><Input ref={password} type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={64} required disabled={busy} /></label>
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block min-w-0 space-y-2 text-sm font-medium"><span>가져올 계좌</span><select ref={type} required disabled={busy} defaultValue="" className="min-h-12 w-full min-w-0 rounded-xl border bg-background px-3"><option value="">선택해 주세요</option><option value="deposit">입출금 통장</option><option value="interim">중도금 대출</option><option value="jeonse">전세 대출</option></select></label>
      <label className="block min-w-0 space-y-2 text-sm font-medium"><span>계좌 끝 4자리</span><Input ref={last4} inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required disabled={busy} /></label>
    </div>
    <p className="text-muted-foreground text-xs leading-relaxed">종류와 끝 4자리가 일치하는 계좌 하나만 가져와요. 통장은 원화 잔액을 확인하고, 출금 한도는 잔액에 더하지 않아요.</p>
    <fieldset disabled={busy} className="space-y-2 border-t pt-3">
      <legend className="pr-2 text-sm font-semibold">연결 전 확인해 주세요</legend>
      {bankConnectionConsentDocuments[BANK_CONNECTION_CONSENT_VERSION].map(label => <label key={label} className="flex min-h-11 items-start gap-3 text-sm leading-relaxed"><input type="checkbox" required className="mt-1 size-5 shrink-0" /><span>{label}</span></label>)}
    </fieldset>
    <p className="text-muted-foreground text-xs leading-relaxed">연결 내역은 본인에게만 보여요. 기존 가족 공개 대출을 덮어쓰거나 가족 합계에 중복으로 더하지 않아요. 추가 인증·로그인 오류가 나오면 자동조회를 멈춰요.</p>
    <details className="border-t text-xs leading-relaxed text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">로그인 정보와 조회 기록 보관 안내</summary><p className="pb-3">모아는 은행의 조회 화면만 조작해요. 은행 아이디 자체의 권한을 조회 전용으로 바꾸는 것은 아니에요. 연결을 해제하면 모아의 연결에서 로그인 정보를 삭제하고 더 이상 사용하지 않아요.</p><p>이전 조회 기록은 보관되며 연결 해제 뒤 이 화면에서는 숨겨져요.</p></details>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy} className="min-h-12 flex-1">{busy ? "연결 중…" : "동의하고 연결"}</Button><Button variant="outline" type="button" className="min-h-12" onClick={() => { form.current?.reset(); onClose(); }}>닫기</Button></div>
  </form>;
}
