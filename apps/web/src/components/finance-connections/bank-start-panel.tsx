"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { bankStartRequest } from "./bank-start-model";

type Feedback = "open_requested" | "copied" | null;

/** 사용자 동작 안에서 고정 요청문만 쓰며, 지원되지 않거나 거절되면 수동 복사로 돌린다. */
export async function copyBankStartRequest(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") return false;
    await navigator.clipboard.writeText(bankStartRequest().text);
    return true;
  } catch {
    return false;
  }
}

type PanelBodyProps = {
  panelId: string;
  disabled: boolean;
  copying: boolean;
  manualCopy: boolean;
  macConfirmed: boolean;
  feedback: Feedback;
  onConfirmMac: () => void;
  onOpenCodex: (event: MouseEvent<HTMLAnchorElement>) => void;
  onCopy: (event: MouseEvent<HTMLButtonElement>) => void;
  onClose: () => void;
};

/** 펼친 준비 안내의 표시를 담당하며 인증 입력이나 금융 API를 포함하지 않는다. */
export function BankStartPanelBody({ panelId, disabled, copying, manualCopy, macConfirmed, feedback, onConfirmMac, onOpenCodex, onCopy, onClose }: PanelBodyProps) {
  const request = bankStartRequest();
  const linkDisabled = disabled || copying;
  return <section id={panelId} aria-labelledby={`${panelId}-heading`} className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
    <h3 id={`${panelId}-heading`} className="font-semibold">신한은행 연동 준비</h3>
    <div className="space-y-2 text-sm leading-relaxed">
      <p>Codex에 요청문을 열어 드려요. Codex에서 보내기를 눌러야 시작해요.</p>
      <p>조회·자동저장은 아직 연결되지 않아 금액이 모아에 반영되지 않아요.</p>
      <p>Codex가 설치된 Mac에서 열어 주세요. 모바일에서는 요청문을 복사한 뒤 Mac의 Codex에 붙여넣어 주세요.</p>
      <p className="text-muted-foreground">휴대폰 앱에서는 Codex 열기 링크가 작동하지 않을 수 있어요. 요청문 복사를 이용해 주세요.</p>
      <p className="text-muted-foreground">은행 로그인과 추가 인증은 신한은행 화면에서 직접 진행해요.</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" className="min-h-11" disabled={disabled || copying} onClick={onCopy}>
        {copying ? "복사 중…" : manualCopy ? "요청문 다시 복사" : "요청문 복사"}
      </Button>
      <Button type="button" variant="outline" className="min-h-11 max-w-full whitespace-normal" disabled={disabled || copying || macConfirmed}
        aria-pressed={macConfirmed} onClick={onConfirmMac}>Codex가 설치된 Mac에서 보고 있어요</Button>
      <Button type="button" variant="ghost" className="min-h-11" disabled={disabled} onClick={onClose}>취소</Button>
    </div>
    {macConfirmed ? <div className="space-y-2">
      <p className="text-sm leading-relaxed">Mac에서만 아래 링크를 눌러 주세요. 열리지 않으면 요청문을 복사해 Codex에 붙여넣어 주세요.</p>
      <a href={linkDisabled ? undefined : request.href} aria-disabled={linkDisabled || undefined} tabIndex={linkDisabled ? -1 : undefined}
        onClick={onOpenCodex} className={`inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${linkDisabled ? "pointer-events-none opacity-50" : ""}`}>
        Mac의 Codex에서 열기
      </a>
    </div> : null}
    {copying ? <p role="status" className="text-sm leading-relaxed">요청문을 복사하고 있어요.</p>
      : feedback ? <p role="status" className="text-sm leading-relaxed">{feedback === "open_requested" ? "Codex 열기 요청" : "요청문을 복사했어요. Mac의 Codex에 붙여넣고 보내기를 눌러 주세요."}</p> : null}
    {manualCopy ? <div className="space-y-2">
      <p role="alert" className="text-sm leading-relaxed">자동 복사를 사용할 수 없어요. 아래 요청문을 직접 복사해 Mac의 Codex에 붙여넣어 주세요.</p>
      <label htmlFor={`${panelId}-request`} className="text-sm font-medium">직접 복사할 요청문</label>
      <textarea id={`${panelId}-request`} readOnly value={request.text} rows={10}
        className="w-full min-w-0 resize-y rounded-lg border bg-background p-3 text-sm leading-relaxed" />
    </div> : null}
  </section>;
}

/** 연동 준비 안내만 열며, Codex 전송·은행 조회·모아 저장을 실행하지 않는다. */
export function BankStartPanel({ disabled = false }: { disabled?: boolean }) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [copying, setCopying] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const [macConfirmed, setMacConfirmed] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const activeCopy = useRef(false);
  const generation = useRef(0);
  const unavailable = useRef(disabled);
  unavailable.current = disabled;

  useEffect(() => {
    if (!disabled) return;
    generation.current += 1; activeCopy.current = false;
    setExpanded(false); setCopying(false); setManualCopy(false); setMacConfirmed(false); setFeedback(null);
  }, [disabled]);
  useEffect(() => () => { generation.current += 1; activeCopy.current = false; }, []);

  function open(event: MouseEvent<HTMLButtonElement>): void {
    if (unavailable.current || event.detail > 1 || expanded) return;
    setExpanded(true);
  }
  function close(): void {
    generation.current += 1; activeCopy.current = false;
    setExpanded(false); setCopying(false); setManualCopy(false); setMacConfirmed(false); setFeedback(null);
  }
  function openCodex(event: MouseEvent<HTMLAnchorElement>): void {
    if (unavailable.current || activeCopy.current || event.detail > 1) { event.preventDefault(); return; }
    setFeedback("open_requested");
  }
  async function copyRequest(): Promise<void> {
    if (unavailable.current || activeCopy.current) return;
    activeCopy.current = true;
    const current = generation.current;
    setCopying(true); setFeedback(null);
    const copied = await copyBankStartRequest();
    if (current !== generation.current || unavailable.current) return;
    activeCopy.current = false; setCopying(false); setManualCopy(!copied);
    setFeedback(copied ? "copied" : null);
  }

  return <div className="min-w-0 space-y-3">
    <Button type="button" className="min-h-12 w-full" disabled={disabled} aria-expanded={expanded && !disabled}
      aria-controls={panelId} onClick={open}>신한은행 연동</Button>
    {expanded && !disabled ? <BankStartPanelBody panelId={panelId} disabled={disabled} copying={copying} manualCopy={manualCopy}
      macConfirmed={macConfirmed} feedback={feedback} onConfirmMac={() => { if (!unavailable.current && !activeCopy.current) setMacConfirmed(true); }}
      onOpenCodex={openCodex} onCopy={event => { if (event.detail <= 1) void copyRequest(); }} onClose={close} /> : null}
  </div>;
}
