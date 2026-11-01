"use client";

import { useId } from "react";
import type {
  ManualHousingPaymentKind,
  ManualHousingPlanResponse,
} from "@family/contracts";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import {
  manualFinanceApi,
  useManualFinanceRefresh,
} from "@/lib/manual-finance-client";
import { PAYMENT_LABELS, paymentDraft, planDraft, planRequest } from "./model";
import { ConfirmAction, RecordDialog, VisibilityField } from "./shared";
import { useRecordEditor } from "./use-record-editor";

export function PlanEditor({
  householdId,
  initial,
  observedVersion,
  onChanged,
  onClose,
}: {
  householdId: string;
  initial?: ManualHousingPlanResponse;
  observedVersion?: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { authedFetch } = useAuth();
  const refresh = useManualFinanceRefresh();
  const formId = useId();
  const editor = useRecordEditor({
    initial: initial ?? null,
    observedVersion,
    emptyDraft: () => planDraft(),
    toDraft: (read: ManualHousingPlanResponse) =>
      planDraft(read.item, read.payments),
    validate: (draft, id) => planRequest(draft, id, householdId),
    save: (body, current) =>
      authedFetch((token) => {
        if (!current) return manualFinanceApi.createPlan(token, body);
        const { id: _id, householdId: _householdId, ...fields } = body;
        return manualFinanceApi.updatePlan(
          token,
          householdId,
          current.item.id,
          { ...fields, expectedVersion: current.item.version }
        );
      }),
    read: (id) =>
      authedFetch((token) => manualFinanceApi.plan(token, householdId, id)),
    remove: (current) =>
      authedFetch((token) =>
        manualFinanceApi.removePlan(
          token,
          householdId,
          current.item.id,
          current.item.version
        )
      ),
    onChanged,
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
  const existingPayments = new Set(
    editor.current?.payments.map((p) => p.id) ?? []
  );
  const updatePayment = (id: string, key: string, value: string) =>
    editor.setDraft((old) => ({
      ...old,
      payments: old.payments.map((payment) =>
        payment.id === id ? { ...payment, [key]: value } : payment
      ),
    }));
  return (
    <RecordDialog
      title={
        editor.current
          ? editor.canEdit
            ? "주택 계획 수정"
            : "공유 주택 계획"
          : "주택 계획 직접 기록"
      }
      description="계약서에서 확인한 일정만 정리해요. 실제 지급·자산 잔액 변경·카드 거래를 실행하지 않아요."
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
              {editor.phase === "saving" ? "저장 중…" : "주택 계획 저장"}
            </Button>
            {editor.current ? (
              <ConfirmAction
                label="이 수동 계획 삭제"
                title="수동 주택 계획을 삭제할까요?"
                description="이 계획과 그 지급 기록이 목록·예정 지급 안내에서 빠져요. 실제 주택 계약·납부·계좌·카드 거래는 취소되지 않아요. 개인정보의 완전한 파기는 아니에요."
                destructive
                disabled={disabled}
                onConfirm={() => void editor.remove()}
              />
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            기록한 사람만 내용과 공개 범위를 수정할 수 있어요.
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
          계획 이름
          <Input
            className="h-11"
            value={editor.draft.label}
            disabled={disabled}
            maxLength={100}
            autoComplete="off"
            placeholder="예: 풍무수자인 1차 59B"
            onChange={(e) => set("label", e.target.value)}
          />
          <span className="text-muted-foreground text-xs font-normal">
            이름은 직접 입력해요. 예시 이름이 계약·소유 사실을 확인한 것은
            아니에요.
          </span>
        </label>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            입주연도 · 선택
            <Input
              className="h-11"
              value={editor.draft.occupancyYear}
              disabled={disabled}
              maxLength={4}
              inputMode="numeric"
              autoComplete="off"
              placeholder="미확인"
              onChange={(e) => set("occupancyYear", e.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            계약 단계 · 선택
            <Input
              className="h-11"
              value={editor.draft.contractStage}
              disabled={disabled}
              maxLength={100}
              autoComplete="off"
              placeholder="확인한 경우만 입력"
              onChange={(e) => set("contractStage", e.target.value)}
            />
          </label>
        </div>
        <VisibilityField
          value={editor.draft.visibility}
          disabled={disabled}
          onChange={(value) => set("visibility", value)}
        />
        <section className="grid min-w-0 gap-3" aria-label="주택 지급 기록">
          <div>
            <h3 className="font-semibold">계약금·중도금·잔금·옵션</h3>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              금액·일정·납부 여부는 확인한 값만 입력해요. 옵션을 0원으로
              채우거나 미확인을 완납으로 표시하지 않아요.
            </p>
          </div>
          {editor.draft.payments.length === 0 ? (
            <p className="bg-muted rounded-lg p-4 text-sm">
              지급 기록 미입력 · 예정 금액과 남은 준비액을 아직 계산할 수
              없어요.
            </p>
          ) : null}
          {editor.draft.payments.map((payment, index) => (
            <fieldset
              key={payment.id}
              disabled={disabled}
              className="grid min-w-0 gap-3 rounded-xl border p-3"
            >
              <legend className="px-1 text-sm font-semibold">
                지급 기록 {index + 1}
              </legend>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  항목
                  <select
                    aria-label={`지급 기록 ${index + 1} 항목`}
                    className="bg-background h-11 rounded-md border px-3"
                    value={payment.kind}
                    onChange={(e) =>
                      updatePayment(
                        payment.id,
                        "kind",
                        e.target.value as ManualHousingPaymentKind
                      )
                    }
                  >
                    {Object.entries(PAYMENT_LABELS).map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  회차 · 선택
                  <Input
                    className="h-11"
                    value={payment.installment}
                    maxLength={4}
                    inputMode="numeric"
                    placeholder="미입력"
                    onChange={(e) =>
                      updatePayment(payment.id, "installment", e.target.value)
                    }
                  />
                </label>
              </div>
              <label className="grid gap-2 text-sm">
                예정 금액 · 원
                <Input
                  className="h-11 tabular-nums"
                  value={payment.amount}
                  maxLength={26}
                  inputMode="numeric"
                  placeholder="모르면 비워두세요"
                  onChange={(e) =>
                    updatePayment(payment.id, "amount", e.target.value)
                  }
                />
              </label>
              <label className="grid gap-2 text-sm">
                지급 예정일 · 선택
                <Input
                  type="date"
                  className="h-11 min-w-0"
                  value={payment.dueDate}
                  onChange={(e) =>
                    updatePayment(payment.id, "dueDate", e.target.value)
                  }
                />
              </label>
              <label className="grid gap-2 text-sm">
                이미 납부한 금액 · 원
                <Input
                  className="h-11 tabular-nums"
                  value={payment.paidAmount}
                  maxLength={26}
                  inputMode="numeric"
                  placeholder="미확인이면 비워두세요"
                  onChange={(e) =>
                    updatePayment(payment.id, "paidAmount", e.target.value)
                  }
                />
                <span className="text-muted-foreground text-xs">
                  납부 없음이 확인된 경우에만 0을 입력해요. 예정 금액을 초과할
                  수 없어요.
                </span>
              </label>
              <label className="grid gap-2 text-sm">
                실제 납부일 · 선택
                <Input
                  type="date"
                  className="h-11 min-w-0"
                  value={payment.paidDate}
                  onChange={(e) =>
                    updatePayment(payment.id, "paidDate", e.target.value)
                  }
                />
              </label>
              {!existingPayments.has(payment.id) && editor.canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 whitespace-normal"
                  onClick={() =>
                    set(
                      "payments",
                      editor.draft.payments.filter((p) => p.id !== payment.id)
                    )
                  }
                >
                  저장 전 이 입력 빼기
                </Button>
              ) : null}
            </fieldset>
          ))}
          {editor.canEdit ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={disabled || editor.draft.payments.length >= 100}
              onClick={() =>
                set("payments", [
                  ...editor.draft.payments,
                  paymentDraft(crypto.randomUUID()),
                ])
              }
            >
              <Plus className="size-4" />
              지급 기록 추가
            </Button>
          ) : null}
        </section>
        <label className="grid gap-2 text-sm font-medium">
          재원 용도 메모 · 선택
          <textarea
            rows={4}
            maxLength={2000}
            className="bg-background min-h-24 min-w-0 rounded-md border p-3 font-normal"
            value={editor.draft.fundingNote}
            disabled={disabled}
            placeholder="공유하면 가족에게 보이는 메모예요. 비공개 계좌 정보·전체 번호·인증정보는 적지 마세요."
            onChange={(e) => set("fundingNote", e.target.value)}
          />
          <span className="text-muted-foreground text-xs font-normal leading-relaxed">
            용도 메모만 기록해요. 통장 재원 배정·예약·대출 실행·현금 전망 계산은
            하지 않아요. 주택 계약금액은 자산 시가로 합산하지 않아요.
          </span>
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
            : "주택 계획을 저장하고 있어요."}
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
            {editor.latest.item.label} · 입주연도{" "}
            {editor.latest.item.occupancyYear ?? "미확인"} · 지급 기록{" "}
            {editor.latest.payments.length}개
          </p>
          <ConfirmAction
            label="입력을 버리고 현재 기록 불러오기"
            title="현재 저장된 기록으로 다시 시작할까요?"
            description="저장되지 않은 입력은 사라지고, 방금 확인한 계획과 모든 지급 기록을 불러와요."
            disabled={editor.busy}
            onConfirm={editor.resetLatest}
          />
        </section>
      ) : null}
    </RecordDialog>
  );
}
