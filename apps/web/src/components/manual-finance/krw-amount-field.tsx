"use client";
/**
 * 수동 기록(자산·적금 납입·주택 납부)의 원화 금액 칸 — 공용 AmountInput(입력 중 콤마·'원' 단위·숫자 키패드).
 * 2026-11-05 HIG 검수 4단계: '13380'처럼 콤마 없는 칸은 0 하나 차이를 알아보기 어려웠다.
 *
 * 금액 계약은 그대로다 — 값은 콤마 없는 숫자 문자열이고 빈 칸('')은 '모름'(0원과 다르다), 음수는 없다.
 * 다만 수동 기록은 20자리까지 저장할 수 있는데 AmountInput은 15자리(999조 원)에서 자른다.
 * 그보다 긴 값이 이미 저장돼 있으면 잘린 숫자를 보여 주지 않도록 그 칸만 예전 글자 칸으로 연다.
 * 칸 종류는 처음 열 때 한 번만 정한다 — 입력 도중 바뀌면 칸이 새로 그려지며 키보드가 내려간다.
 */
import { useState } from "react";

import {
  AmountInput,
  type AmountInputProps,
} from "@/components/ui/amount-input";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** AmountInput이 원화(소수 0자리)에서 받는 최대 자리 수(amount-input.tsx의 MAX_TOTAL_DIGITS). */
export const AMOUNT_INPUT_MAX_DIGITS = 15;

/** 저장된 값을 AmountInput이 그대로(자르지 않고) 보여 줄 수 있는가. */
export function fitsAmountInput(value: string): boolean {
  const digits = value.replaceAll(",", "");
  return /^\d*$/.test(digits) && digits.length <= AMOUNT_INPUT_MAX_DIGITS;
}

type KrwAmountFieldProps = Omit<AmountInputProps, "currency" | "decimals">;

export function KrwAmountField({
  value,
  onValueChange,
  containerClassName,
  className,
  ...props
}: KrwAmountFieldProps) {
  const [legacy] = useState(() => !fitsAmountInput(value));
  if (!legacy)
    return (
      <AmountInput
        {...props}
        value={value}
        onValueChange={onValueChange}
        className={className}
        containerClassName={containerClassName}
      />
    );
  return (
    <Input
      {...props}
      value={value}
      maxLength={26}
      inputMode="numeric"
      autoComplete="off"
      className={cn("tabular-nums", className)}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}
