"use client";

import { useId } from "react";
import type { ManualAsset } from "@family/contracts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { displayManualKrw } from "@/components/manual-finance/model";
import { NATIVE_SELECT } from "@/components/manual-finance/shared";
import { LOAN_TOTAL_LABELS, matchingReplacementOptions, type LoanReviewDraft } from "./model";

export function LoanReviewFields({ draft, onChange, options, userId, householdId, disabled = false }: {
  draft: LoanReviewDraft;
  onChange: (draft: LoanReviewDraft) => void;
  options: ManualAsset[];
  userId: string;
  householdId: string;
  disabled?: boolean;
}) {
  const id = useId();
  const choices = matchingReplacementOptions(options, userId, householdId, draft.visibility);
  return (
    <fieldset disabled={disabled} className="grid w-full min-w-0 grid-cols-1 gap-4 disabled:opacity-60">
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-label`}>대출 이름</Label>
        <Input id={`${id}-label`} value={draft.label} maxLength={100} autoComplete="off"
          onChange={(event) => onChange({ ...draft, label: event.target.value })} />
      </div>
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-visibility`}>공개 범위</Label>
        <select id={`${id}-visibility`} className={NATIVE_SELECT} value={draft.visibility}
          onChange={(event) => onChange({ ...draft, visibility: event.target.value as LoanReviewDraft["visibility"], confirmedSharing: false, replacesManualAssetId: "" })}>
          <option value="private">나만 보기</option>
          <option value="household">가족 공개</option>
        </select>
      </div>
      {draft.visibility === "household" ? (
        <label className="text-body rounded-control flex min-h-11 min-w-0 items-start gap-3 border p-3">
          <input type="checkbox" className="mt-1 size-4 shrink-0" checked={draft.confirmedSharing}
            onChange={(event) => onChange({ ...draft, confirmedSharing: event.target.checked })} />
          <span className="min-w-0 flex-1 break-words">선택한 가족의 모든 구성원에게 대출 이름, 계좌 끝 4자리, 남은 원금, 만기일과 확인 시각을 공유하는 데 동의해요.</span>
        </label>
      ) : <p className="text-caption text-muted-foreground">가족에게 보이지 않고, 가족 자산 합계에도 들어가지 않아요.</p>}
      <div className="grid min-w-0 gap-1.5">
        <Label htmlFor={`${id}-total`}>합계에 반영하는 방법</Label>
        <select id={`${id}-total`} className={NATIVE_SELECT} value={draft.totalMode}
          aria-describedby={`${id}-total-help`}
          onChange={(event) => onChange({ ...draft, totalMode: event.target.value as LoanReviewDraft["totalMode"], replacesManualAssetId: "" })}>
          {Object.entries(LOAN_TOTAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <p id={`${id}-total-help`} className="text-caption text-muted-foreground">
          {draft.totalMode === "reference"
            ? "합계에 넣지 않아도 남은 원금과 만기일은 계속 볼 수 있어요. 나중에 바꿀 수 있어요."
            : draft.totalMode === "distinct"
              ? "같은 대출을 직접 입력해 뒀다면 두 번 계산될 수 있어요. 그때는 ‘직접 입력한 대출 대신 합산’을 골라 주세요."
              : "직접 입력한 기록은 남기고, 가져온 원금만 합계에 넣어요."}
        </p>
      </div>
      {draft.totalMode === "replacement" ? (
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-replaces`}>연결할 대출</Label>
          <select id={`${id}-replaces`} className={NATIVE_SELECT} value={draft.replacesManualAssetId}
            aria-describedby={`${id}-replaces-help`}
            onChange={(event) => onChange({ ...draft, replacesManualAssetId: event.target.value })}>
            <option value="">직접 입력한 대출 고르기</option>
            {choices.map((item) => <option key={item.id} value={item.id}>{item.label} · {displayManualKrw(item.amount)}</option>)}
          </select>
          <p id={`${id}-replaces-help`} className="text-caption text-muted-foreground">
            {choices.length === 0
              ? "연결할 대출이 없어요. ‘기록만 보관’으로 저장하거나 공개 범위를 확인해 주세요."
              : "내가 직접 입력했고 공개 범위가 같은 대출만 고를 수 있어요."}
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}
