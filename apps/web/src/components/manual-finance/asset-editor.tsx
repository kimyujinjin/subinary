"use client";

import { useId } from "react";
import type {
  ManualAsset,
  ManualAssetKind,
  ManualAssetResponse,
} from "@family/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import {
  manualFinanceApi,
  useManualFinanceRefresh,
} from "@/lib/manual-finance-client";
import {
  ASSET_LABELS,
  ASSET_VALUE_LABELS,
  assetDraft,
  assetRequest,
  displayManualKrw,
} from "./model";
import { ConfirmAction, RecordDialog, VisibilityField } from "./shared";
import { useRecordEditor } from "./use-record-editor";

export function AssetEditor({
  householdId,
  item,
  observedVersion,
  onChanged,
  onClose,
}: {
  householdId: string;
  item?: ManualAsset;
  observedVersion?: number;
  onChanged: (item: ManualAsset) => void;
  onClose: () => void;
}) {
  const { authedFetch } = useAuth();
  const refresh = useManualFinanceRefresh();
  const formId = useId();
  const editor = useRecordEditor({
    initial: item ? { item } : null,
    observedVersion,
    emptyDraft: () => assetDraft(),
    toDraft: (read: ManualAssetResponse) => assetDraft(read.item),
    validate: (draft, id) => assetRequest(draft, id, householdId),
    save: (body, current) =>
      authedFetch((token) => {
        if (!current) return manualFinanceApi.createAsset(token, body);
        const { id: _id, householdId: _householdId, ...fields } = body;
        return manualFinanceApi.updateAsset(
          token,
          householdId,
          current.item.id,
          { ...fields, expectedVersion: current.item.version }
        );
      }),
    read: (id) =>
      authedFetch((token) => manualFinanceApi.asset(token, householdId, id)),
    remove: (current) =>
      authedFetch((token) =>
        manualFinanceApi.removeAsset(
          token,
          householdId,
          current.item.id,
          current.item.version
        )
      ),
    onChanged: (read) => onChanged(read.item),
    onClose,
    changed: (clear) => {
      void refresh(clear);
    },
  });
  const disabled = editor.busy || editor.readRequired || !editor.canEdit;
  const set = <K extends keyof typeof editor.draft>(
    key: K,
    value: (typeof editor.draft)[K]
  ) => editor.setDraft((old) => ({ ...old, [key]: value }));
  return (
    <RecordDialog
      title={
        editor.current
          ? editor.canEdit
            ? "자산 기록 수정"
            : "공유 자산 기록"
          : "자산 직접 기록"
      }
      description="직접 확인한 현재값만 적어요. 은행·증권 계좌나 실제 자금을 변경하지 않아요."
      dirty={editor.dirty}
      busy={editor.busy}
      pending={editor.pending}
      readRequired={editor.readRequired}
      invalidate={editor.invalidate}
      onClose={onClose}
      footer={
        editor.canEdit ? (
          <>
            <Button
              form={formId}
              type="submit"
              className="min-h-11 w-full"
              disabled={disabled}
            >
              {editor.phase === "saving" ? "저장 중…" : "수동 기록 저장"}
            </Button>
            {editor.current ? (
              <ConfirmAction
                label="이 수동 기록 삭제"
                title="수동 기록을 삭제할까요?"
                description="이 기록은 자산 목록과 합계에서 빠져요. 실제 계좌·잔액·카드 거래는 바뀌지 않아요. 이 삭제는 개인정보의 완전한 파기를 뜻하지 않아요."
                destructive
                disabled={disabled}
                onConfirm={() => void editor.remove()}
              />
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            기록한 사람만 내용을 수정하거나 공개 범위를 바꿀 수 있어요.
          </p>
        )
      }
    >
      <form
        id={formId}
        onSubmit={(event) => void editor.save(event)}
        noValidate
        className="grid min-w-0 gap-4"
        aria-busy={editor.busy}
      >
        <label className="grid gap-2 text-sm font-medium">
          종류
          <select
            aria-label="자산 종류"
            disabled={disabled}
            className="bg-background h-11 rounded-md border px-3 font-normal"
            value={editor.draft.kind}
            onChange={(e) => set("kind", e.target.value as ManualAssetKind)}
          >
            {Object.entries(ASSET_LABELS).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          기록 이름
          <Input
            className="h-11"
            value={editor.draft.label}
            disabled={disabled}
            maxLength={100}
            autoComplete="off"
            placeholder="예: 생활비 통장"
            onChange={(e) => set("label", e.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          {ASSET_VALUE_LABELS[editor.draft.kind]} · 원
          <Input
            className="h-11 tabular-nums"
            value={editor.draft.amount}
            disabled={disabled}
            maxLength={26}
            inputMode="numeric"
            autoComplete="off"
            placeholder="모르면 비워두세요"
            onChange={(e) => set("amount", e.target.value)}
          />
          <span className="text-muted-foreground text-xs font-normal">
            원화로 직접 확인한 값만 입력해요. 빈칸과 실제 0원을 구분해요. 적금
            만기 예상액·대출 한도는 넣지 않아요.
          </span>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          금액 기준일
          <Input
            type="date"
            className="h-11 min-w-0"
            value={editor.draft.asOfDate}
            disabled={disabled}
            onChange={(e) => set("asOfDate", e.target.value)}
          />
          <span className="text-muted-foreground text-xs font-normal">
            금액이 있으면 기준일이 필요해요. 모르는 날짜를 오늘로 채우지 않아요.
          </span>
        </label>
        <p className="bg-muted rounded-lg p-3 text-xs">
          출처: {editor.draft.amount.trim() ? "직접 입력" : "금액 미입력"} ·
          자동 조회·환산한 금액이 아니에요.
        </p>
        <label className="grid gap-2 text-sm font-medium">
          명의 메모 · 선택
          <Input
            className="h-11"
            value={editor.draft.legalOwnerLabel}
            disabled={disabled}
            maxLength={100}
            autoComplete="off"
            placeholder="미확정이면 비워두세요"
            onChange={(e) => set("legalOwnerLabel", e.target.value)}
          />
          <span className="text-muted-foreground text-xs font-normal">
            직접 적은 메모이며 법적 소유권·공동 지분을 확인하는 기능은 아니에요.
          </span>
        </label>
        <VisibilityField
          value={editor.draft.visibility}
          disabled={disabled}
          onChange={(value) => set("visibility", value)}
        />
        <label className="grid gap-2 text-sm font-medium">
          기준·출처 메모 · 선택
          <textarea
            rows={3}
            maxLength={1000}
            className="bg-background min-h-22 min-w-0 rounded-md border p-3 font-normal"
            value={editor.draft.note}
            disabled={disabled}
            placeholder="전체 계좌번호·카드번호·인증정보는 적지 마세요"
            onChange={(e) => set("note", e.target.value)}
          />
        </label>
      </form>
      {editor.error ? (
        <p role="alert" className="text-destructive text-sm break-words">
          {editor.error}
        </p>
      ) : null}
      {editor.notice ? (
        <p role="status" className="text-muted-foreground text-sm break-words">
          {editor.notice}
        </p>
      ) : null}
      {editor.busy ? (
        <p role="status" className="text-muted-foreground text-sm">
          {editor.phase === "reading"
            ? "현재 기록을 확인하고 있어요."
            : editor.phase === "removing"
            ? "삭제 결과를 확인하고 있어요."
            : "수동 기록을 저장하고 있어요."}
        </p>
      ) : null}
      {editor.readRequired ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 h-auto whitespace-normal"
          disabled={editor.busy}
          onClick={() => void editor.read()}
        >
          다시 보내기 전 현재 기록 확인
        </Button>
      ) : null}
      {editor.latest ? (
        <section className="bg-muted grid gap-2 rounded-lg p-3 text-sm">
          <h3 className="font-semibold">현재 저장된 기록</h3>
          <p className="break-words">
            {editor.latest.item.label} · {ASSET_LABELS[editor.latest.item.kind]}
          </p>
          <p className="break-all tabular-nums">
            {displayManualKrw(editor.latest.item.amount)} · 기준일{" "}
            {editor.latest.item.asOfDate ?? "미입력"}
          </p>
          <ConfirmAction
            label="입력을 버리고 현재 기록 불러오기"
            title="현재 저장된 기록으로 다시 시작할까요?"
            description="아직 저장되지 않은 입력은 사라지고, 방금 확인한 최신 기록을 불러와요."
            disabled={editor.busy}
            onConfirm={editor.resetLatest}
          />
        </section>
      ) : null}
    </RecordDialog>
  );
}
