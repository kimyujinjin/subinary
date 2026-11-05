"use client";
/* ---------------------------------------------------------------------------
 * 적금 자동 납입 입력(2026-11-04). 자산 편집기에서 종류가 적금일 때만 보인다.
 *
 * 현재 적립액은 서버가 읽을 때마다 계산한다: 기준 금액 + 매월 넣는 금액 × 지난 납입일 수.
 * 원금만 더하고 이자는 넣지 않는다(packages/shared manual-savings).
 * 2026-11-05 HIG 검수: 넣는 금액은 AmountInput(콤마·'원'), 검사 오류는 해당 칸 아래 한 줄.
 * ------------------------------------------------------------------------- */
import { useId } from "react";
import type { ManualSavingsStatus } from "@family/contracts";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatMonthDay } from "@/lib/format";

import { KrwAmountField } from "./krw-amount-field";
import { displayManualKrw } from "./model";
import { FieldError, NATIVE_SELECT } from "./shared";

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

export interface SavingsPlanDraft {
  autoSave: boolean;
  monthlyAmount: string;
  contributionDay: string;
  endDate: string;
}

type SavingsPlanErrors = Partial<
  Record<"monthlyAmount" | "contributionDay" | "endDate", string | null>
>;

export function SavingsPlanFields({
  draft,
  disabled,
  status,
  onChange,
  idPrefix,
  errors = {},
}: {
  draft: SavingsPlanDraft;
  disabled: boolean;
  /** 저장된 계획의 기준·횟수(수정 중일 때). */
  status: ManualSavingsStatus | null;
  onChange: (patch: Partial<SavingsPlanDraft>) => void;
  /** 칸 id 앞부분(폼의 useId). 없으면 여기서 만든다. */
  idPrefix?: string;
  /** 칸 아래에 붙일 검사 오류. */
  errors?: SavingsPlanErrors;
}) {
  const ownId = useId();
  const prefix = idPrefix ?? ownId;
  const id = (name: keyof SavingsPlanErrors) => `${prefix}-${name}`;
  const errorId = (name: keyof SavingsPlanErrors) => `${prefix}-${name}-error`;
  const invalid = (name: keyof SavingsPlanErrors) =>
    errors[name]
      ? { "aria-invalid": true, "aria-describedby": errorId(name) }
      : {};
  return (
    <section
      className="rounded-card grid min-w-0 gap-3 border p-3"
      aria-label="자동 납입"
    >
      <label className="text-body flex min-h-11 items-center justify-between gap-3 font-medium">
        <span>매월 자동으로 더하기</span>
        <Switch
          checked={draft.autoSave}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ autoSave: checked })}
          aria-label="매월 자동으로 더하기"
        />
      </label>
      {draft.autoSave ? (
        <>
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <div className="grid min-w-0 content-start gap-1.5">
              <Label htmlFor={id("contributionDay")}>넣는 날</Label>
              <select
                id={id("contributionDay")}
                disabled={disabled}
                className={NATIVE_SELECT}
                value={draft.contributionDay}
                {...invalid("contributionDay")}
                onChange={(event) =>
                  onChange({ contributionDay: event.target.value })
                }
              >
                <option value="">고르기</option>
                {DAYS.map((day) => (
                  <option key={day} value={String(day)}>
                    매월 {day}일
                  </option>
                ))}
              </select>
              {errors.contributionDay ? (
                <FieldError id={errorId("contributionDay")}>
                  {errors.contributionDay}
                </FieldError>
              ) : null}
            </div>
            <div className="grid min-w-0 content-start gap-1.5">
              <Label htmlFor={id("monthlyAmount")}>넣는 금액</Label>
              <KrwAmountField
                id={id("monthlyAmount")}
                value={draft.monthlyAmount}
                disabled={disabled}
                placeholder="예: 500,000"
                {...invalid("monthlyAmount")}
                onValueChange={(raw) => onChange({ monthlyAmount: raw })}
              />
              {errors.monthlyAmount ? (
                <FieldError id={errorId("monthlyAmount")}>
                  {errors.monthlyAmount}
                </FieldError>
              ) : null}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={id("endDate")}>만기일 · 선택</Label>
            <Input
              id={id("endDate")}
              type="date"
              className="min-w-0"
              value={draft.endDate}
              disabled={disabled}
              {...invalid("endDate")}
              onChange={(event) => onChange({ endDate: event.target.value })}
            />
            {errors.endDate ? (
              <FieldError id={errorId("endDate")}>{errors.endDate}</FieldError>
            ) : null}
          </div>
          <p className="text-caption text-muted-foreground">
            기준일 다음 날부터 매월 넣는 날에 이 금액을 더해요. 그 달에 없는
            날은 말일로 보고, 이자는 넣지 않아요.
          </p>
          {status && status.contributions > 0 ? (
            <p className="text-caption bg-muted rounded-control p-3 tabular-nums">
              {formatMonthDay(status.baseAsOfDate)} 기준{" "}
              {displayManualKrw(status.baseAmount)}에 {status.contributions}번
              더한 값이에요. 실제와 다르면 현재 적립액과 기준일을 다시 적어
              주세요.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
