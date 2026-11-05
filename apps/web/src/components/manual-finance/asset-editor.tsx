"use client";

import { useId } from "react";
import type {
  ManualAsset,
  ManualAssetKind,
  ManualAssetResponse,
} from "@family/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldList, FieldRow } from "@/components/widgets/field-row";
import { InlineNotice } from "@/components/widgets/inline-notice";
import { useAuth } from "@/lib/auth-context";
import { formatMonthDay } from "@/lib/format";
import {
  manualFinanceApi,
  useManualFinanceRefresh,
} from "@/lib/manual-finance-client";
import { useHouseholdMembers } from "@/lib/queries";
import {
  ASSET_LABELS,
  ASSET_VALUE_LABELS,
  assetDraft,
  assetRequest,
  displayManualKrw,
  savingsPlanLine,
} from "./model";
import { assetErrorField, type AssetField } from "./field-errors";
import { KrwAmountField } from "./krw-amount-field";
import { SavingsPlanFields } from "./savings-plan-fields";
import {
  ConfirmAction,
  FieldError,
  NATIVE_SELECT,
  RecordDialog,
  RecordSheet,
} from "./shared";
import { useRecordEditor } from "./use-record-editor";

type AssetEditorProps = {
  householdId: string;
  item?: ManualAsset;
  observedVersion?: number;
  onChanged: (item: ManualAsset) => void;
  onClose: () => void;
};

/**
 * 자산 입력 창(2026-11-05 HIG 검수 4단계로 다시 짬).
 * - 내가 고칠 수 없는 기록(가족이 등록했거나 지금 권한이 보기뿐)은 칸이 꺼진 폼이 아니라 읽기 전용 시트로 연다.
 * - 검사 오류는 해당 칸 아래 한 줄. 출처·공개 범위 상자는 없다(§8: 모든 기록은 가족 공개).
 * - 삭제는 폼 맨 아래 빨간 글자 버튼 → 액션 시트 '삭제하기'.
 */
export function AssetEditor(props: AssetEditorProps) {
  if (props.item && !props.item.canEdit)
    return <AssetDetailSheet item={props.item} onClose={props.onClose} />;
  return <AssetForm {...props} />;
}

function AssetDetailSheet({
  item,
  onClose,
}: {
  item: ManualAsset;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const members = useHouseholdMembers();
  const memberName =
    members.data?.find((member) => member.userId === item.ownerUserId)?.name ??
    null;
  // 자산 목록과 같은 기준(§8): 명의자를 적었으면 명의자, 아니면 등록한 구성원.
  const owner = item.legalOwnerLabel ?? memberName ?? "가족 구성원";
  const plan = savingsPlanLine(item.savingsPlan);
  return (
    <RecordSheet title={item.label} onClose={onClose}>
      <FieldList>
        <FieldRow label="종류" value={ASSET_LABELS[item.kind]} />
        <FieldRow
          label={ASSET_VALUE_LABELS[item.kind]}
          value={
            item.amount === null ? (
              "미입력"
            ) : (
              <span className="tabular-nums">
                {displayManualKrw(item.amount)}
              </span>
            )
          }
          muted={item.amount === null}
        />
        <FieldRow
          label="기준일"
          value={item.asOfDate ? formatMonthDay(item.asOfDate) : "미입력"}
          muted={!item.asOfDate}
        />
        {plan ? <FieldRow label="자동 납입" value={plan} /> : null}
        <FieldRow label="주인" value={owner} />
      </FieldList>
      {item.note ? (
        <section aria-label="메모" className="grid gap-1">
          <h3 className="text-caption text-muted-foreground">메모</h3>
          <p className="text-body break-words whitespace-pre-wrap">
            {item.note}
          </p>
        </section>
      ) : null}
      <p className="text-caption text-muted-foreground">
        {item.ownerUserId === user?.id
          ? "지금 가족 권한으로는 고칠 수 없어요."
          : "등록한 사람만 고칠 수 있어요."}
      </p>
    </RecordSheet>
  );
}

function AssetForm({
  householdId,
  item,
  observedVersion,
  onChanged,
  onClose,
}: AssetEditorProps) {
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
  const invalidField = assetErrorField(editor.invalid);
  // 칸을 모르는 검사 오류와 서버 오류는 창 아래(저장 버튼 위) 한 줄로 남는다.
  const formError =
    (editor.invalid && !invalidField ? editor.invalid : null) ?? editor.error;
  const ids = {
    kind: `${formId}-kind`,
    label: `${formId}-label`,
    amount: `${formId}-amount`,
    asOfDate: `${formId}-as-of`,
    owner: `${formId}-owner`,
    note: `${formId}-note`,
  };
  const errorFor = (field: AssetField) =>
    invalidField === field ? editor.invalid : null;
  const errorId = (field: AssetField) => `${formId}-${field}-error`;
  const invalidProps = (field: AssetField) =>
    errorFor(field)
      ? { "aria-invalid": true, "aria-describedby": errorId(field) }
      : {};
  return (
    <RecordDialog
      title={editor.current ? "자산 수정" : "자산 추가"}
      description="직접 확인한 원화 금액을 적어요. 만기 예상액이나 대출 한도는 넣지 않아요."
      dirty={editor.dirty}
      busy={editor.busy}
      pending={editor.pending}
      readRequired={editor.readRequired}
      invalidate={editor.invalidate}
      onClose={onClose}
      footer={
        <>
          {formError ? (
            <InlineNotice tone="error">{formError}</InlineNotice>
          ) : null}
          {editor.notice ? <InlineNotice>{editor.notice}</InlineNotice> : null}
          {editor.busy ? (
            <p role="status" className="text-body text-muted-foreground">
              {editor.phase === "reading"
                ? "현재 기록을 확인하고 있어요."
                : editor.phase === "removing"
                  ? "삭제 결과를 확인하고 있어요."
                  : "자산을 저장하고 있어요."}
            </p>
          ) : null}
          {editor.readRequired ? (
            <div className="w-full">
              <Button
                type="button"
                variant="weak"
                className="min-h-11 h-auto w-full whitespace-normal"
                disabled={editor.busy}
                onClick={() => void editor.read()}
              >
                저장 상태 확인하기
              </Button>
            </div>
          ) : null}
          {editor.canEdit ? (
            <Button
              form={formId}
              type="submit"
              className="min-h-11 w-full"
              disabled={disabled}
            >
              {editor.phase === "saving" ? "저장 중…" : "저장하기"}
            </Button>
          ) : (
            <p className="text-body text-muted-foreground">
              등록한 사람만 고칠 수 있어요.
            </p>
          )}
        </>
      }
    >
      <form
        id={formId}
        onSubmitCapture={(event) => {
          // 칸을 모르는 오류(메모 길이 등)로 다시 제출해도 접어 둔 입력을 확인할 수 있게 한다.
          if (formError) {
            event.currentTarget.querySelectorAll<HTMLDetailsElement>("details[data-optional-input]").forEach((details) => { details.open = true; });
          }
        }}
        onSubmit={(event) => void editor.save(event)}
        noValidate
        className="grid min-w-0 gap-4"
        aria-busy={editor.busy}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={ids.kind}>종류</Label>
          <select
            id={ids.kind}
            disabled={disabled}
            className={NATIVE_SELECT}
            value={editor.draft.kind}
            onChange={(e) => set("kind", e.target.value as ManualAssetKind)}
          >
            {Object.entries(ASSET_LABELS).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={ids.label}>이름</Label>
          <Input
            id={ids.label}
            value={editor.draft.label}
            disabled={disabled}
            maxLength={100}
            autoComplete="off"
            placeholder="예: 생활비 통장"
            {...invalidProps("label")}
            onChange={(e) => set("label", e.target.value)}
          />
          {errorFor("label") ? (
            <FieldError id={errorId("label")}>{errorFor("label")}</FieldError>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={ids.amount}>
            {ASSET_VALUE_LABELS[editor.draft.kind]}
          </Label>
          <KrwAmountField
            id={ids.amount}
            value={editor.draft.amount}
            disabled={disabled}
            placeholder="모르면 비워 두세요"
            {...invalidProps("amount")}
            onValueChange={(raw) => set("amount", raw)}
          />
          {errorFor("amount") ? (
            <FieldError id={errorId("amount")}>{errorFor("amount")}</FieldError>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={ids.asOfDate}>금액 기준일</Label>
          <Input
            id={ids.asOfDate}
            type="date"
            className="min-w-0"
            value={editor.draft.asOfDate}
            disabled={disabled}
            aria-describedby={
              errorFor("asOfDate")
                ? `${errorId("asOfDate")} ${ids.asOfDate}-help`
                : `${ids.asOfDate}-help`
            }
            aria-invalid={errorFor("asOfDate") ? true : undefined}
            onChange={(e) => set("asOfDate", e.target.value)}
          />
          {errorFor("asOfDate") ? (
            <FieldError id={errorId("asOfDate")}>
              {errorFor("asOfDate")}
            </FieldError>
          ) : null}
          <p
            id={`${ids.asOfDate}-help`}
            className="text-caption text-muted-foreground"
          >
            금액을 확인한 날이에요. 금액을 적었으면 꼭 적어 주세요.
          </p>
        </div>
        {editor.draft.kind === "saving" ? (
          <SavingsPlanFields
            draft={editor.draft}
            disabled={disabled}
            status={editor.current?.item.savingsPlan ?? null}
            idPrefix={formId}
            errors={{
              monthlyAmount: errorFor("monthlyAmount"),
              contributionDay: errorFor("contributionDay"),
              endDate: errorFor("endDate"),
            }}
            onChange={(patch) =>
              editor.setDraft((old) => ({ ...old, ...patch }))
            }
          />
        ) : null}
        <details data-optional-input open={Boolean(editor.current?.item.legalOwnerLabel || editor.current?.item.note || formError)} className="min-w-0 border-y">
          <summary className="text-body focus-visible:outline-ring min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-offset-2">추가 메모 · 선택</summary>
          <div className="grid min-w-0 gap-4 pb-4">
            <div className="grid gap-1.5">
              <Label htmlFor={ids.owner}>명의자 · 선택</Label>
              <Input
                id={ids.owner}
                value={editor.draft.legalOwnerLabel}
                disabled={disabled}
                maxLength={100}
                autoComplete="off"
                aria-describedby={`${ids.owner}-help`}
                onChange={(e) => set("legalOwnerLabel", e.target.value)}
              />
              <p
                id={`${ids.owner}-help`}
                className="text-caption text-muted-foreground"
              >
                참고로 적는 이름이에요. 실제 소유나 지분은 확인하지 않아요.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={ids.note}>메모 · 선택</Label>
              <Textarea
                id={ids.note}
                rows={3}
                maxLength={1000}
                value={editor.draft.note}
                disabled={disabled}
                placeholder="전체 계좌번호·카드번호·비밀번호는 적지 마세요"
                onChange={(e) => set("note", e.target.value)}
              />
            </div>
          </div>
        </details>
      </form>
      {editor.latest ? (
        <section className="bg-muted rounded-card grid gap-2 p-3">
          <h3 className="text-body font-semibold">현재 저장된 기록</h3>
          <p className="text-body break-words">
            {editor.latest.item.label} · {ASSET_LABELS[editor.latest.item.kind]}
          </p>
          <p className="text-body break-all tabular-nums">
            {displayManualKrw(editor.latest.item.amount)} · 기준일{" "}
            {editor.latest.item.asOfDate
              ? formatMonthDay(editor.latest.item.asOfDate)
              : "미입력"}
          </p>
          <ConfirmAction
            label="저장된 내용 불러오기"
            title="저장된 내용으로 바꿀까요?"
            description="지금 입력한 내용은 사라지고, 최신 저장 내용으로 바뀌어요."
            disabled={editor.busy}
            onConfirm={editor.resetLatest}
          />
        </section>
      ) : null}
      {editor.current && editor.canEdit ? (
        <ConfirmAction
          appearance="text"
          label="삭제하기"
          title="이 자산을 삭제할까요?"
          description="목록과 합계에서 빠져요. 실제 계좌와 잔액은 그대로예요."
          destructive
          disabled={disabled}
          onConfirm={() => void editor.remove()}
        />
      ) : null}
    </RecordDialog>
  );
}
