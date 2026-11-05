"use client";
/**
 * 가져온 대출 기록(`/assets/loan-records`) — 내가 가져와 저장한 신한 대출의 목록과 수정 창.
 * `recordsOnly`가 아니면 위에 파일 가져오기 단계가 붙는다(지금은 신한 연결 화면이 가져오기를 맡아 쓰는 곳이 없다).
 *
 * 2026-11-05 HIG 검수 4단계: 본문을 통째로 감싸던 접힘(details)을 없앴다. 줄을 누르면 수정 창이 열리고(›),
 * 줄마다 붙던 전폭 '기록 수정' 버튼과 '은행 잔액 기준일 미확인'은 목록 아래 안내 한 줄로 모았다.
 * 이름은 링크·제목·섹션 모두 '가져온 대출 기록' 하나다(예전에는 셋이 서로 달랐다).
 * '합계 제외' 칩은 자산 탭과 같은 importedLoanChip — 같은 대출이 두 화면에서 다른 말·색으로 보이지 않게 한다.
 */

import { useEffect, useRef, useState } from "react";
import type { ImportedLoanRecord, LoanImportPreviewResponse } from "@family/contracts";
import { importedLoanChip } from "@/app/(app)/assets/asset-rows";
import { Button } from "@/components/ui/button";
import { FinanceLoading } from "@/components/manual-finance/shared";
import { displayManualKrw } from "@/components/manual-finance/model";
import { EmptyState } from "@/components/widgets/empty-state";
import { ErrorState } from "@/components/widgets/error-state";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { ListRow } from "@/components/widgets/list-row";
import { PageBackHeader } from "@/components/widgets/page-back-header";
import { SectionHeader } from "@/components/widgets/section-header";
import { StatusChip } from "@/components/widgets/status-chip";
import { useAuth } from "@/lib/auth-context";
import { loanImportApi, useOwnedLoanImports } from "@/lib/loan-import-client";
import { createLoanTaskSession, loanFailureStatus, readLoanCaptureFile } from "./model";
import { loanRowSubtitle } from "./loan-rows";
import { LoanRecordEditor } from "./record-editor";
import { LoanCaptureReview } from "./review-dialog";

export function LoanImportScreen({ householdId, userId, canCreate, recordsOnly = false }: { householdId: string; userId: string; canCreate: boolean; recordsOnly?: boolean }) {
  const { authedFetch } = useAuth();
  const records = useOwnedLoanImports();
  const [preview, setPreview] = useState<LoanImportPreviewResponse | null>(null);
  const [editing, setEditing] = useState<ImportedLoanRecord | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const session = useRef(createLoanTaskSession());
  useEffect(() => () => { session.current.invalidate(); if (fileInput.current) fileInput.current.value = ""; }, []);
  const unavailable = Boolean(editing && (
    loanFailureStatus(records.error) === 403 || loanFailureStatus(records.error) === 404 ||
    (records.isSuccess && !records.isFetching && !records.data.items.some((item) => item.id === editing.id && item.canEdit))
  ));
  useEffect(() => { if (unavailable) { setEditing(null); setNotice("기록이나 권한이 바뀌었어요. 목록을 다시 확인해 주세요."); } }, [unavailable]);

  const importFile = async (file: File) => {
    if (!canCreate || session.current.pending || preview || editing) return;
    setReading(true); setError(null); setNotice(null);
    let localRead = true;
    await session.current.run(
      async (signal) => {
        const capture = await readLoanCaptureFile(file, signal);
        localRead = false;
        return authedFetch((token) => loanImportApi.preview(token, { householdId, capture }, userId, signal));
      },
      (result) => { setReading(false); setPreview(result); },
      (failure) => {
        setReading(false);
        setError(localRead && failure instanceof Error ? failure.message : "대출 내용을 확인하지 못했어요. 연결 상태와 선택한 가족을 확인한 뒤 파일을 다시 골라 주세요.");
      }
    );
  };
  const locked = reading || Boolean(preview || editing);
  const items = records.data?.items ?? [];
  return (
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-5">
      <PageBackHeader
        title={recordsOnly ? "가져온 대출 기록" : "신한 대출 가져오기"}
        subtitle={recordsOnly ? "내가 가져온 대출이에요. 가족에게 공유하지 않은 기록도 보여요." : "전세·중도금 대출의 남은 원금과 만기일을 저장해요."}
        backHref="/assets"
      />
      {!recordsOnly ? <section className="finance-panel grid min-w-0 grid-cols-1 gap-4 p-5">
        <div>
          <h2 className="text-heading">대출 내역 파일</h2>
          <ol className="text-caption text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-2" aria-label="가져오기 순서">
            {["파일 고르기", "내용 확인", "저장"].map((step, index) => <li key={step}><span className="mr-1.5 font-semibold text-foreground" aria-hidden="true">{index + 1}.</span>{step}</li>)}
          </ol>
        </div>
        <p className="text-caption text-muted-foreground">파일을 고르면 미리 보여 주려고 내용을 앱 서버로 보내요. 확인한 뒤 저장해야 기록이 생겨요.</p>
        <label className="text-body grid min-w-0 grid-cols-1 gap-1.5 font-medium">
          신한 대출 확인 파일 · 최대 64KB
          <input ref={fileInput} type="file" accept=".json,application/json" disabled={!canCreate || locked}
            className="bg-muted text-body rounded-control min-h-12 w-full min-w-0 max-w-full p-2 file:mr-3 file:rounded-control file:border-0 file:px-3 file:py-2 disabled:opacity-50"
            onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importFile(file); }} />
        </label>
        <p className="text-caption text-muted-foreground">은행에 자동으로 연결하지 않고 파일로 가져와요. 잔액을 새로 하려면 새 파일이 필요해요.</p>
        <details className="min-w-0 border-t">
          <summary className="text-body min-h-11 cursor-pointer py-3 font-medium">가져오는 방법</summary>
          <ol className="text-body text-muted-foreground list-inside list-decimal space-y-2 pb-3">
            <li>PC에서 신한 인터넷뱅킹에 직접 로그인하고 대출계좌조회를 열어요.</li>
            <li>수집 도구에서 계좌 한 개를 골라 파일을 만들어요.</li>
            <li>여기에서 파일을 고른 뒤 계좌·금액·공개 범위를 확인해요.</li>
          </ol>
          <p className="text-caption text-muted-foreground pb-2">수집 도구가 만든 파일만 받아요. 이 앱에는 비밀번호·인증서·로그인 정보를 입력하지 않아요.</p>
        </details>
        {!canCreate ? <p className="text-caption text-muted-foreground">지금 가족 권한으로는 가져온 대출을 추가하거나 고칠 수 없어요.</p> : null}
        {reading ? <div className="flex flex-wrap items-center gap-3"><p role="status" className="text-body">확인 파일을 읽고 있어요.</p><Button variant="weak" onClick={() => { session.current.invalidate(); setReading(false); setError(null); }}>읽기 멈추기</Button></div> : null}
        {error ? <div className="grid gap-3">
          <InlineNotice tone="error">{error}</InlineNotice>
          {canCreate ? <Button variant="weak" className="min-h-11 w-full" disabled={locked} onClick={() => fileInput.current?.click()}>파일 다시 고르기</Button> : null}
        </div> : null}
      </section> : null}
      {notice ? <InlineNotice>{notice}</InlineNotice> : null}
      <section className="finance-panel min-w-0 px-4 py-1" aria-label="가져온 대출 기록">
        {!recordsOnly ? <SectionHeader title="가져온 대출 기록" className="px-1 pt-2" /> : null}
        {records.isPending ? <FinanceLoading /> : records.isError ? (
          <ErrorState message="가져온 대출 기록을 불러오지 못했어요." onRetry={() => void records.refetch()} retrying={records.isFetching} />
        ) : items.length ? (
          <>
            <ul className="divide-border/60 divide-y">
              {items.map((item) => {
                const editable = item.canEdit && canCreate;
                const chip = importedLoanChip(item);
                return (
                  <li key={item.id} className="min-w-0 py-1">
                    <ListRow
                      title={item.label}
                      subtitle={loanRowSubtitle(item)}
                      value={displayManualKrw(item.outstandingPrincipalKrw)}
                      valueSub={chip ? <StatusChip tone={chip[0]}>{chip[1]}</StatusChip> : null}
                      // 창이 열린 동안에도 줄은 버튼으로 남긴다 — div로 바뀌면 누른 줄이 사라져 창을 닫을 때 포커스가 돌아갈 곳이 없다.
                      // ariaLabel을 주지 않아 화면 읽기 프로그램도 이름·만기·남은 원금·칩을 그대로 읽는다.
                      onClick={editable ? () => { if (!locked) setEditing(item); } : undefined}
                      chevron={editable}
                    />
                  </li>
                );
              })}
            </ul>
            <p className="text-caption text-muted-foreground px-1 pt-2 pb-4">
              남은 원금은 신한은행 화면을 확인한 때의 값이에요. 은행의 잔액 기준일은 알 수 없어요.
            </p>
          </>
        ) : <EmptyState title="아직 가져온 대출이 없어요" />}
      </section>
      {preview && canCreate ? <LoanCaptureReview preview={preview} householdId={householdId} userId={userId} onClose={() => setPreview(null)} onSaved={() => setPreview(null)} /> : null}
      {editing && !unavailable && canCreate ? <LoanRecordEditor key={editing.id} item={editing} observedVersion={records.data?.items.find((item) => item.id === editing.id)?.version} householdId={householdId} userId={userId} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
