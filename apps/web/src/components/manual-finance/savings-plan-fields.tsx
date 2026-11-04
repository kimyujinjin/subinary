"use client";
/* ---------------------------------------------------------------------------
 * 적금 자동 납입 입력(2026-11-04). 자산 편집기에서 종류가 적금일 때만 보인다.
 *
 * 현재 적립액은 서버가 읽을 때마다 계산한다: 기준 금액 + 매월 넣는 금액 × 지난 납입일 수.
 * 원금만 더하고 이자는 넣지 않는다(packages/shared manual-savings).
 * ------------------------------------------------------------------------- */
import type { ManualSavingsStatus } from "@family/contracts";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { displayManualKrw } from "./model";

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);

export interface SavingsPlanDraft {
  autoSave: boolean;
  monthlyAmount: string;
  contributionDay: string;
  endDate: string;
}

export function SavingsPlanFields({
  draft,
  disabled,
  status,
  onChange,
}: {
  draft: SavingsPlanDraft;
  disabled: boolean;
  /** 저장된 계획의 기준·횟수(수정 중일 때). */
  status: ManualSavingsStatus | null;
  onChange: (patch: Partial<SavingsPlanDraft>) => void;
}) {
  return (
    <section
      className="grid min-w-0 gap-3 rounded-lg border p-3"
      aria-label="자동 납입"
    >
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
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
            <label className="grid min-w-0 gap-2 text-sm font-medium">
              넣는 날
              <select
                aria-label="넣는 날"
                disabled={disabled}
                className="bg-background h-11 min-w-0 rounded-md border px-3 font-normal"
                value={draft.contributionDay}
                onChange={(event) =>
                  onChange({ contributionDay: event.target.value })
                }
              >
                <option value="">선택</option>
                {DAYS.map((day) => (
                  <option key={day} value={String(day)}>
                    매월 {day}일
                  </option>
                ))}
              </select>
            </label>
            <label className="grid min-w-0 gap-2 text-sm font-medium">
              넣는 금액 · 원
              <Input
                className="h-11 tabular-nums"
                value={draft.monthlyAmount}
                disabled={disabled}
                maxLength={26}
                inputMode="numeric"
                autoComplete="off"
                placeholder="예: 500000"
                onChange={(event) =>
                  onChange({ monthlyAmount: event.target.value })
                }
              />
            </label>
          </div>
          <label className="grid gap-2 text-sm font-medium">
            만기일 · 선택
            <Input
              type="date"
              className="h-11 min-w-0"
              value={draft.endDate}
              disabled={disabled}
              onChange={(event) => onChange({ endDate: event.target.value })}
            />
          </label>
          <p className="text-muted-foreground text-xs font-normal">
            기준일 다음 날부터 매월 넣는 날에 이 금액을 더해 현재 적립액을
            계산해요. 그 달에 없는 날은 말일로 봐요. 이자는 넣지 않아요. 실제
            금액과 다르면 현재 적립액과 기준일을 다시 적어 주세요.
          </p>
          {status && status.contributions > 0 ? (
            <p className="bg-muted rounded-lg p-3 text-xs tabular-nums">
              {status.baseAsOfDate} 기준 {displayManualKrw(status.baseAmount)}에{" "}
              {status.contributions}번 더한 값이에요.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
