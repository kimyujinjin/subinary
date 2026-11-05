"use client";

import { useEffect, useId, useRef, useState } from "react";
import { loanImportUpdateRequestSchema, type ImportedLoanRecord, type ManualAsset } from "@family/contracts";
import { Button } from "@/components/ui/button";
import { ConfirmAction, RecordDialog } from "@/components/manual-finance/shared";
import { displayManualKrw } from "@/components/manual-finance/model";
import { ErrorState } from "@/components/widgets/error-state";
import { FieldList, FieldRow } from "@/components/widgets/field-row";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { useAuth } from "@/lib/auth-context";
import { formatMonthDay } from "@/lib/format";
import { loanImportApi } from "@/lib/loan-import-client";
import { manualFinanceApi, useManualFinanceRefresh } from "@/lib/manual-finance-client";
import { createLoanTaskSession, displayLoanCapturedAt, loanFailureMessage, loanReviewDraft, loanReviewFields } from "./model";
import { loanInclusionLabel } from "./loan-rows";
import { LoanReviewFields } from "./review-fields";

export function LoanRecordEditor({ item, observedVersion, householdId, userId, onClose }: {
  item: ImportedLoanRecord;
  observedVersion?: number;
  householdId: string;
  userId: string;
  onClose: () => void;
}) {
  const { authedFetch } = useAuth();
  const refresh = useManualFinanceRefresh();
  const [current, setCurrent] = useState(item);
  const [draft, setDraft] = useState(() => loanReviewDraft(item));
  const [options, setOptions] = useState<ManualAsset[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsEpoch, setOptionsEpoch] = useState(0);
  const [phase, setPhase] = useState<"idle" | "saving" | "removing" | "reading">("idle");
  const [readRequired, setReadRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(createLoanTaskSession());
  const completed = useRef(false);
  const optionsSession = useRef(createLoanTaskSession());
  const formId = useId();
  const busy = phase !== "idle";
  const changedElsewhere = observedVersion !== undefined && observedVersion > current.version;
  const disabled = busy || readRequired || changedElsewhere || !current.canEdit;
  const invalidate = () => { session.current.invalidate(); optionsSession.current.invalidate(); };

  useEffect(() => () => { session.current.invalidate(); optionsSession.current.invalidate(); }, []);
  useEffect(() => {
    const reader = optionsSession.current;
    reader.invalidate();
    setOptions([]); setOptionsLoading(true); setOptionsError(false);
    void reader.run(
      (signal) => authedFetch((token) => manualFinanceApi.listAssets(token, householdId, draft.visibility, signal, userId)),
      (result) => { setOptions(result.items); setOptionsLoading(false); },
      () => { setOptionsError(true); setOptionsLoading(false); }
    );
    return () => reader.invalidate();
  }, [authedFetch, householdId, userId, draft.visibility, optionsEpoch]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (completed.current || disabled || session.current.pending || optionsLoading || optionsError) return;
    const parsed = loanImportUpdateRequestSchema.safeParse({ expectedVersion: current.version, ...loanReviewFields(draft, options, userId, householdId) });
    if (!parsed.success) { setError("대출 이름, 가족 공유 동의, 연결할 대출을 확인해 주세요."); return; }
    setPhase("saving"); setError(null);
    await session.current.run(
      (signal) => authedFetch((token) => loanImportApi.update(token, householdId, userId, current.id, parsed.data, signal)),
      () => { completed.current = true; setPhase("idle"); void refresh(true); onClose(); },
      (failure) => { setPhase("idle"); setReadRequired(true); setError(loanFailureMessage(failure)); void refresh(true); }
    );
  };
  const remove = async () => {
    if (completed.current || disabled || session.current.pending) return;
    setPhase("removing"); setError(null);
    await session.current.run(
      async (signal) => {
        const result = await authedFetch((token) => loanImportApi.remove(token, householdId, current.id, current.version, signal));
        if (!result.deleted) throw new Error("delete unconfirmed");
        return result;
      },
      () => { completed.current = true; setPhase("idle"); void refresh(true); onClose(); },
      (failure) => { setPhase("idle"); setReadRequired(true); setError(loanFailureMessage(failure)); void refresh(true); }
    );
  };
  const reread = async () => {
    if (session.current.pending) return;
    setPhase("reading"); setError(null);
    await session.current.run(
      (signal) => authedFetch((token) => loanImportApi.records(token, householdId, userId, signal)),
      (result) => {
        const found = result.items.find((record) => record.id === current.id);
        setPhase("idle"); void refresh(true);
        if (!found || !found.canEdit) { onClose(); return; }
        setCurrent(found); setDraft(loanReviewDraft(found)); setReadRequired(false); setOptionsEpoch((value) => value + 1);
      },
      () => { setPhase("idle"); setReadRequired(true); setError("저장된 내용을 확인하지 못했어요. 잠시 뒤 '저장된 내용 불러오기'를 다시 눌러 주세요."); }
    );
  };
  // 2026-11-05 HIG 검수: 가져온 값은 읽기 전용 줄(이름 · 값), 바꿀 수 있는 것만 폼. 목록에서 빼기는 맨 아래 빨간 글자 버튼.
  return (
    <RecordDialog title="대출 기록 수정" description="이름·공개 범위·합계 반영 방법을 바꿀 수 있어요."
      dirty={JSON.stringify(draft) !== JSON.stringify(loanReviewDraft(current))}
      busy={busy} pending={() => session.current.pending} readRequired={readRequired || changedElsewhere}
      invalidate={invalidate} onClose={onClose}
      footer={<>
        {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        {changedElsewhere ? <InlineNotice>다른 곳에서 이 기록이 바뀌었어요. 저장된 내용을 불러와 주세요.</InlineNotice> : null}
        {busy ? <p role="status" className="text-body text-muted-foreground">{phase === "reading" ? "저장된 내용을 확인하고 있어요." : phase === "removing" ? "목록에서 빼는 중이에요." : "변경 내용을 저장하고 있어요."}</p> : null}
        <Button form={formId} type="submit" className="min-h-11 w-full" disabled={disabled || optionsLoading || optionsError}>{phase === "saving" ? "저장 중…" : "저장하기"}</Button>
      </>}>
      <FieldList>
        <FieldRow label="종류" value={current.loanType === "interim" ? "중도금 대출" : "전세 대출"} />
        <FieldRow label="계좌" value={`끝 ${current.accountLast4}`} />
        <FieldRow label="남은 원금" value={<span className="tabular-nums">{displayManualKrw(current.outstandingPrincipalKrw)}</span>} />
        <FieldRow label="만기일" value={current.maturityDate ? formatMonthDay(current.maturityDate) : "확인되지 않음"} muted={!current.maturityDate} />
        <FieldRow label="화면 확인" value={displayLoanCapturedAt(current.capturedAt)}>
          신한은행 대출계좌조회 화면에서 가져왔어요. 은행의 잔액 기준일은 알 수 없어요.
        </FieldRow>
      </FieldList>
      <InlineNotice>{loanInclusionLabel(current)}</InlineNotice>
      <form id={formId} onSubmit={(event) => void save(event)} className="grid min-w-0 grid-cols-1 gap-4" noValidate>
        <LoanReviewFields draft={draft} onChange={setDraft} options={options} userId={userId} householdId={householdId} disabled={disabled} />
      </form>
      {optionsLoading ? <p role="status" className="text-caption text-muted-foreground">연결할 대출 목록을 확인하고 있어요.</p> : null}
      {optionsError ? <ErrorState align="start" message="연결할 대출 목록을 불러오지 못했어요. 불러와야 저장할 수 있어요." onRetry={() => setOptionsEpoch((value) => value + 1)} /> : null}
      {readRequired || changedElsewhere ? <ConfirmAction label="저장된 내용 불러오기" title="저장된 내용으로 다시 열까요?" description="지금 수정한 내용은 사라지고 최신 저장 내용으로 바뀌어요." disabled={busy} onConfirm={() => void reread()} /> : null}
      <ConfirmAction appearance="text" label="목록에서 빼기" title="이 대출 기록을 목록에서 뺄까요?"
        description={`목록·가족 공유·합계에서 빠져요. 가져온 원금·만기 기록은 지워지지 않고 보관돼요.${current.totalMode === "replacement" ? " 이 기록 대신 계산하던 직접 입력 대출은 다시 합계에 들어가요." : ""}`}
        destructive disabled={disabled} onConfirm={() => void remove()} />
    </RecordDialog>
  );
}
