"use client";

import * as React from "react";

import { currencyExponent } from "@family/shared";

import { cn } from "@/lib/utils";

/*
 * 금액 입력 — Input과 같은 모양에 자릿수 콤마와 오른쪽 단위를 더한다.
 * 2026-11-05 HIG 검수: '13380'·type="number" 칸은 0 하나 차이를 알아보기 어려웠다.
 *
 * 값은 콤마 없는 숫자 문자열(raw)로 주고받는다. 콤마는 화면에만 붙으므로 부모는 지금처럼
 * Number(raw)로 읽으면 된다. 빈 문자열은 '모름·미입력'이라 0으로 바꾸지 않는다('0원'과 다른 값).
 */

/**
 * 정수 자리 + 소수 자리 합의 상한. 소수 금액을 minor units(×10^decimals)로 바꿔도
 * 안전한 정수(2^53 ≈ 9.0e15) 안에 머물게 한다.
 */
const MAX_TOTAL_DIGITS = 15;

type Kept = { ch: string; beforeCaret: boolean };

/** 숫자·소수점만 남기고 앞자리 0·자리 수를 정리한다. caret은 정리된 raw 안의 위치. */
function sanitize(
  text: string,
  caret: number,
  decimals: number
): { raw: string; caret: number } {
  const places = Math.max(0, Math.trunc(decimals));
  const int: Kept[] = [];
  const frac: Kept[] = [];
  let dot: Kept | null = null;

  // 소수를 받지 않는 칸에 점이 들어오면 첫 점부터 커서까지를 버린다. 새로 들어온 글자는 커서 바로 앞에서
  // 끝나므로 이 구간이 붙여넣은 소수 부분('1,234.56'의 '.56')이다 — 점만 빼고 이으면 '123456'으로 100배가 된다.
  // 한 글자로 친 '.'는 그 자신만 빠지므로(무시) 가운데에 잘못 쳐도 뒤 숫자가 잘리지 않는다.
  // 커서 뒤의 점은 정리된 칸에선 생기지 않지만, 생기면 그 뒤를 모두 버린다.
  const firstDot = places === 0 ? text.indexOf(".") : -1;
  const cutEnd = firstDot < caret ? caret : text.length;

  for (let i = 0; i < text.length; i += 1) {
    if (firstDot !== -1 && i >= firstDot && i < cutEnd) continue;
    const ch = text.charAt(i);
    const beforeCaret = i < caret;
    if (ch >= "0" && ch <= "9") {
      if (dot === null) int.push({ ch, beforeCaret });
      else if (frac.length < places) frac.push({ ch, beforeCaret });
    } else if (ch === "." && places > 0 && dot === null) {
      dot = { ch, beforeCaret };
    }
  }

  // '007' → '7', '000' → '0'. 한 자리는 남긴다 — '이미 낸 돈 0원'처럼 0도 뜻이 있는 값이다.
  while (int.length > 1 && int[0]?.ch === "0") int.shift();
  if (dot !== null && int.length === 0) {
    int.push({ ch: "0", beforeCaret: dot.beforeCaret });
  }
  const maxInt = Math.max(1, MAX_TOTAL_DIGITS - places);
  if (int.length > maxInt) int.length = maxInt;

  const kept = dot === null ? int : [...int, dot, ...frac];
  return {
    raw: kept.map((k) => k.ch).join(""),
    caret: kept.filter((k) => k.beforeCaret).length,
  };
}

/**
 * 아무 글자(붙여넣은 '13,380원' 등)를 콤마 없는 금액 문자열로 정리한다.
 * 숫자 외 문자는 버리고 앞자리 0을 정리한다. 음수는 없다. `decimals`가 0이면 첫 소수점부터 끝까지 버린다
 * ('12.50' → '12', '1,234.56' → '1234').
 * 소수가 있으면 입력 중인 '12.'처럼 점으로 끝날 수 있다(Number('12.') === 12).
 */
export function normalizeAmountInput(text: string, decimals = 0): string {
  return sanitize(text, text.length, decimals).raw;
}

/** 정리된 금액 문자열의 정수 부분에 세 자리 콤마를 붙인다: '1234000' → '1,234,000', '1234.5' → '1,234.5'. */
export function formatAmountInput(raw: string): string {
  const dot = raw.indexOf(".");
  const int = dot === -1 ? raw : raw.slice(0, dot);
  const rest = dot === -1 ? "" : raw.slice(dot);
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + rest;
}

/** raw 안의 위치(콤마를 세지 않은 글자 수)를 콤마가 붙은 문자열 안의 위치로 바꾼다. */
function caretInFormatted(formatted: string, rawCaret: number): number {
  if (rawCaret <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (formatted.charAt(i) === ",") continue;
    seen += 1;
    if (seen === rawCaret) return i + 1;
  }
  return formatted.length;
}

export type AmountEdit = Readonly<{
  /** 입력 칸에 막 들어온 글자 그대로(콤마·문자 섞임). */
  text: string;
  /** 입력 직후 커서 위치(selectionStart). */
  caret: number;
  /** 입력 전 raw 값. */
  previousRaw: string;
  /** InputEvent.inputType — 콤마만 지운 Backspace/Delete를 알아보는 데 쓴다. */
  inputType?: string;
  decimals?: number;
}>;

/**
 * 한 번의 입력을 처리한다: 정리된 raw, 칸에 보일 글자, 커서 위치(사용자가 친 자리 바로 뒤).
 * 콤마 바로 뒤에서 Backspace를 누르면 콤마만 지워져 아무 일도 없는 것처럼 보이므로
 * 그 앞 숫자를 지운다(Delete는 뒤 숫자).
 */
export function applyAmountEdit({
  text,
  caret,
  previousRaw,
  inputType,
  decimals = 0,
}: AmountEdit): Readonly<{ raw: string; text: string; caret: number }> {
  let next = sanitize(text, caret, decimals);
  const previousText = formatAmountInput(previousRaw);
  const onlyCommaRemoved =
    next.raw === previousRaw &&
    text.length === previousText.length - 1 &&
    previousText.charAt(caret) === ",";
  if (onlyCommaRemoved && inputType === "deleteContentBackward" && caret > 0) {
    next = sanitize(
      text.slice(0, caret - 1) + text.slice(caret),
      caret - 1,
      decimals
    );
  } else if (onlyCommaRemoved && inputType === "deleteContentForward") {
    next = sanitize(
      text.slice(0, caret) + text.slice(caret + 1),
      caret,
      decimals
    );
  }
  const formatted = formatAmountInput(next.raw);
  return {
    raw: next.raw,
    text: formatted,
    caret: caretInFormatted(formatted, next.caret),
  };
}

/**
 * 칸 오른쪽 단위. 원화(또는 통화 없음)는 '원', 외화는 통화 코드(USD).
 * 기호를 쓰지 않는 이유: '$'는 USD·AUD·CAD·HKD가, '¥'는 JPY·CNY가 함께 써서 금액 칸에서 통화를 잘못 읽게 한다.
 */
export function amountUnit(currency?: string): string {
  const code = (currency ?? "").trim().toUpperCase();
  return code === "" || code === "KRW" ? "원" : code;
}

/**
 * 칸이 받는 소수 자리 수. `decimals`를 주면 그 값, 없으면 통화의 minor-unit 지수(KRW·JPY 0, USD 2, KWD 3),
 * 통화도 없으면 0. 통화에서 끌어오는 이유: 외화 칸에 decimals를 빠뜨리면 '12.50'이 원화처럼 정리되어,
 * 한 글자만 고쳐도 금액 계약(ADR-0027, minor units)과 어긋난 값이 경고 없이 저장된다.
 */
export function amountDecimals(currency?: string, decimals?: number): number {
  if (decimals !== undefined) return Math.max(0, Math.trunc(decimals));
  const code = (currency ?? "").trim();
  return code === "" ? 0 : currencyExponent(code);
}

type AmountInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "inputMode" | "value" | "defaultValue" | "onChange"
> & {
  /** 콤마 없는 숫자 문자열. 빈 문자열은 미입력. 콤마가 섞여 들어와도 정리해서 보여 준다. */
  value: string;
  /** 정리된 raw 값이 바뀔 때만 부른다(숫자 아닌 글자만 친 경우엔 부르지 않는다). */
  onValueChange: (raw: string) => void;
  /** ISO 통화 코드. 없거나 KRW면 '원'. */
  currency?: string;
  /** 소수 자리 수. 기본은 통화에서 정한다(amountDecimals — 원화·통화 없음 0, USD 2). 덮어쓸 때만 준다. */
  decimals?: number;
  /** 바깥 상자(위치·폭)용. `className`은 Input처럼 입력 칸 자체에 붙는다. */
  containerClassName?: string;
};

function AmountInput({
  value,
  onValueChange,
  currency,
  decimals,
  className,
  containerClassName,
  name,
  form,
  disabled,
  autoComplete = "off",
  "aria-describedby": describedBy,
  ...props
}: AmountInputProps) {
  const unitId = React.useId();
  const places = amountDecimals(currency, decimals);
  const raw = normalizeAmountInput(value, places);
  const unit = amountUnit(currency);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const native = event.nativeEvent;
    const next = applyAmountEdit({
      text: input.value,
      caret: input.selectionStart ?? input.value.length,
      previousRaw: raw,
      inputType:
        "inputType" in native && typeof native.inputType === "string"
          ? native.inputType
          : undefined,
      decimals: places,
    });
    // 콤마가 붙거나 빠지면 React가 값을 다시 쓰면서 커서를 끝으로 보낸다. 여기서 먼저 같은 글자를
    // 써 두면 다시 그릴 때 값이 같아 React가 칸을 건드리지 않아, 커서가 사용자가 친 자리 뒤에 남는다.
    // (부모가 값을 받지 않고 되돌리면 React가 원래 값으로 되쓰고 커서는 끝으로 간다.)
    input.value = next.text;
    if (input.ownerDocument.activeElement === input) {
      input.setSelectionRange(next.caret, next.caret);
    }
    if (next.raw !== raw) onValueChange(next.raw);
  }

  return (
    <div
      data-slot="amount-input"
      className={cn("relative w-full min-w-0", containerClassName)}
    >
      <input
        type="text"
        inputMode={places > 0 ? "decimal" : "numeric"}
        autoComplete={autoComplete}
        disabled={disabled}
        form={form}
        // 단위는 화면에 그린 글자라 읽기 프로그램이 칸과 함께 읽도록 설명으로 잇는다.
        aria-describedby={describedBy ? `${unitId} ${describedBy}` : unitId}
        {...props}
        value={formatAmountInput(raw)}
        onChange={handleChange}
        className={cn(
          "peer placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-muted text-body flex h-12 w-full min-w-0 rounded-control border border-transparent px-4 py-1 tabular-nums transition-colors outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:border-primary",
          "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
          className,
          // 단위 자리는 호출부의 px-*보다 뒤에 둬야 숫자가 단위 밑으로 들어가지 않는다.
          unit === "원" ? "pr-10" : "pr-14"
        )}
      />
      <span
        id={unitId}
        aria-hidden="true"
        className="text-body text-muted-foreground pointer-events-none absolute inset-y-0 right-4 flex items-center peer-disabled:opacity-50"
      >
        {unit}
      </span>
      {/* 보이는 칸은 콤마가 붙은 글자라, 폼 제출에는 숨은 칸으로 raw 값을 보낸다. */}
      {name ? (
        <input
          type="hidden"
          name={name}
          form={form}
          disabled={disabled}
          value={raw}
        />
      ) : null}
    </div>
  );
}

export { AmountInput };
export type { AmountInputProps };
