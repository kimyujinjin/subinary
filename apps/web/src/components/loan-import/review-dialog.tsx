"use client";

import { useEffect, useId, useRef, useState } from "react";
import { loanImportCommitRequestSchema, type LoanImportCommitRequest, type LoanImportPreviewResponse } from "@family/contracts";
import { Button } from "@/components/ui/button";
import { displayManualKrw } from "@/components/manual-finance/model";
import { ConfirmAction, RecordDialog } from "@/components/manual-finance/shared";
import { FieldList, FieldRow } from "@/components/widgets/field-row";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { useAuth } from "@/lib/auth-context";
import { formatMonthDay } from "@/lib/format";
import { loanImportApi } from "@/lib/loan-import-client";
import { useManualFinanceRefresh } from "@/lib/manual-finance-client";
import { createLoanTaskSession, displayLoanCapturedAt, loanFailureMessage, loanFailureStatus, loanReviewDraft, loanReviewFields, type LoanReviewDraft } from "./model";
import { LoanReviewFields } from "./review-fields";

export function LoanCaptureReview({ preview: initial, householdId, userId, onClose, onSaved }: {
  preview: LoanImportPreviewResponse;
  householdId: string;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { authedFetch } = useAuth();
  const refresh = useManualFinanceRefresh();
  const [preview, setPreview] = useState(initial);
  const [draft, setDraft] = useState(() => loanReviewDraft(initial.existing ?? undefined, initial.capture));
  const [ownAccount, setOwnAccount] = useState(false);
  const [values, setValues] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "reading">("idle");
  const [recovery, setRecovery] = useState<"retry" | "read" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(createLoanTaskSession());
  const revision = useRef(0);
  const recordId = useRef<string | null>(initial.existing?.id ?? null);
  const attempt = useRef<{ revision: number; body: LoanImportCommitRequest } | null>(null);
  const completed = useRef(false);
  const formId = useId();
  const busy = phase !== "idle";
  const frozen = busy || recovery !== null;
  const changeDraft = (next: LoanReviewDraft) => { ++revision.current; attempt.current = null; setDraft(next); };
  useEffect(() => () => { session.current.invalidate(); attempt.current = null; }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (completed.current || session.current.pending || busy || recovery === "read") return;
    if (!ownAccount || !values) { setError("내 명의 계좌인지, 원금·만기일이 은행 화면과 같은지 확인해 주세요."); return; }
    if (!attempt.current || attempt.current.revision !== revision.current) {
      recordId.current ??= crypto.randomUUID();
      const result = loanImportCommitRequestSchema.safeParse({
        requestId: crypto.randomUUID(), recordId: recordId.current, householdId,
        expectedVersion: preview.existing?.version ?? null, capture: preview.capture,
        confirmedOwnAccount: true, confirmedValues: true,
        ...loanReviewFields(draft, preview.replacementOptions, userId, householdId),
      });
      if (!result.success) { setError("대출 이름, 가족 공유 동의, 연결할 대출을 확인해 주세요."); return; }
      attempt.current = { revision: revision.current, body: result.data };
    }
    const body = attempt.current.body;
    setPhase("saving"); setError(null);
    await session.current.run(
      (signal) => authedFetch((token) => loanImportApi.commit(token, body, userId, signal)),
      () => { completed.current = true; attempt.current = null; setPhase("idle"); void refresh(true); onSaved(); },
      (failure) => {
        setPhase("idle"); setError(loanFailureMessage(failure));
        const status = loanFailureStatus(failure);
        if (status === 400 || status === 422) { attempt.current = null; setRecovery(null); }
        else setRecovery(status === 409 || status === 403 || status === 404 ? "read" : "retry");
        void refresh(true);
      }
    );
  };
  const reread = async () => {
    if (session.current.pending) return;
    setPhase("reading"); setError(null);
    await session.current.run(
      (signal) => authedFetch((token) => loanImportApi.preview(token, { householdId, capture: preview.capture }, userId, signal)),
      (result) => {
        ++revision.current; attempt.current = null;
        if (result.existing) recordId.current = result.existing.id;
        setPreview(result); setDraft(loanReviewDraft(result.existing ?? undefined, result.capture));
        setOwnAccount(false); setValues(false); setRecovery(null); setPhase("idle");
      },
      () => { setPhase("idle"); setRecovery("read"); setError("저장된 내용을 확인하지 못했어요. 잠시 뒤 '저장 상태 확인하기'를 다시 눌러 주세요."); }
    );
  };
  const capture = preview.capture;
  // 2026-11-05 HIG 검수: 가져온 값은 읽기 전용 줄(이름 · 값), 확인 체크와 바꿀 수 있는 것만 폼.
  return (
    <RecordDialog title="신한 대출 확인 후 저장" description="저장하기 전에 계좌와 금액을 은행 화면과 비교해 주세요."
      dirty busy={busy} pending={() => session.current.pending} readRequired={recovery !== null}
      invalidate={() => { session.current.invalidate(); attempt.current = null; }} onClose={onClose}
      footer={<>
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        {busy ? <p role="status" className="text-body text-muted-foreground">{phase === "reading" ? "현재 기록을 다시 확인하고 있어요." : "저장 결과를 확인하고 있어요."}</p> : null}
        <Button form={formId} type="submit" className="min-h-11 h-auto w-full whitespace-normal" disabled={busy || recovery === "read" || !ownAccount || !values}>
          {phase === "saving" ? "저장 중…" : recovery === "retry" ? "같은 내용으로 다시 저장하기" : preview.existing ? "기존 기록 갱신하기" : "저장하기"}
        </Button>
      </>}>
      <section aria-label="가져온 대출 내용" className="grid min-w-0 gap-2">
        <p className="text-caption text-muted-foreground">남은 원금</p>
        <p className="text-title tabular-nums [overflow-wrap:anywhere]">{displayManualKrw(capture.outstandingPrincipalKrw)}</p>
        <FieldList>
          <FieldRow label="대출" value={`신한 ${capture.loanType === "interim" ? "중도금" : "전세"} 대출 · 끝 ${capture.accountLast4}`} />
          <FieldRow label="만기일" value={capture.maturityDate ? formatMonthDay(capture.maturityDate) : "화면에서 확인되지 않음"} muted={!capture.maturityDate} />
          <FieldRow label="화면 확인" value={displayLoanCapturedAt(capture.capturedAt)}>
            신한 인터넷뱅킹 대출계좌조회 화면을 확인한 시각이에요. 은행의 잔액 기준일은 알 수 없어요.
          </FieldRow>
          {preview.existing ? (
            <FieldRow label="이전 확인" value={displayLoanCapturedAt(preview.existing.capturedAt)}>
              같은 계좌의 기존 기록을 이 값으로 갱신해요.
            </FieldRow>
          ) : null}
        </FieldList>
      </section>
      <form id={formId} onSubmit={(event) => void save(event)} noValidate className="grid min-w-0 grid-cols-1 gap-4">
        <fieldset disabled={frozen} className="grid w-full min-w-0 grid-cols-1 gap-2 disabled:opacity-60">
          <legend className="sr-only">저장 전 확인</legend>
          <label className="text-body rounded-control flex min-h-11 min-w-0 items-start gap-3 border p-3">
            <input type="checkbox" className="mt-1 size-4 shrink-0" checked={ownAccount} onChange={(event) => { ++revision.current; attempt.current = null; setOwnAccount(event.target.checked); }} />
            <span className="min-w-0 flex-1 break-words">내 명의의 대출 계좌이며 계좌 끝 4자리를 확인했어요.</span>
          </label>
          <label className="text-body rounded-control flex min-h-11 min-w-0 items-start gap-3 border p-3">
            <input type="checkbox" className="mt-1 size-4 shrink-0" checked={values} onChange={(event) => { ++revision.current; attempt.current = null; setValues(event.target.checked); }} />
            <span className="min-w-0 flex-1 break-words">은행 화면에서 남은 원금과 만기일을 비교했어요. 만기일이 없으면 확인되지 않은 상태로 저장해요.</span>
          </label>
        </fieldset>
        <p className="text-caption text-muted-foreground">저장한 원금·만기 기록은 보관돼요. 나중에 목록에서 빼도 이전 기록은 지워지지 않아요.</p>
        <LoanReviewFields draft={draft} onChange={changeDraft} options={preview.replacementOptions} userId={userId} householdId={householdId} disabled={frozen} />
      </form>
      {recovery ? <ConfirmAction label="저장 상태 확인하기" title="현재 저장 상태를 다시 확인할까요?" description="합계 반영 방법과 확인 표시를 다시 검토해요. 이미 저장됐다면 기존 기록으로 보여요." disabled={busy} onConfirm={() => void reread()} /> : null}
    </RecordDialog>
  );
}
